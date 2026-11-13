// Q18 Part C1: fail-open and null === null tenant guards (SEC-47, SEC-49,
// SEC-50). A null-company caller must not reach a null-company record, and a
// cross-tenant id gets the same 404 as a missing one. Real HTTP + real
// Postgres. Each title names the clause whose deletion (or revert) turns it
// red; the foreign / null-company rows are seeded so they are reachable.
import { describe, it, expect, beforeAll, vi } from 'vitest';
import { and, eq } from 'drizzle-orm';
import {
  users,
  routes,
  schools,
  students,
  parentChildLinks,
  routeSchools,
  driverInvitations,
  directMessages,
  busJourneys,
} from '@shared/schema';
import { sendDriverInvitationEmail } from '../../server/emailService';
import { useIntegrationHarness, type Agent } from './harness';
import { insertUser, SEED_PASSWORD } from './seed';

const h = useIntegrationHarness();

const DRIVER_NULL_EMAIL = 'q18-driver-null@sbt.test';

let adminNull: Agent;
let adminA: Agent;
let master: Agent;
let parentNull: Agent;
let parentA: Agent;
let driverNull: Agent;

let driverNullId: string;
let routeNullId: string;
let schoolNullId: string;

async function login(email: string): Promise<Agent> {
  const agent = h.anon();
  const res = await h.loginAttempt(email, SEED_PASSWORD, agent);
  expect(res.status).toBe(200);
  return agent;
}

const getUser = async (id: string) => (await h.db.select().from(users).where(eq(users.id, id)))[0];

beforeAll(async () => {
  // A null-company driver (email, password) on a null-company route with a
  // null-company student linked to parentNull: the null === null targets.
  driverNullId = await insertUser(
    { email: DRIVER_NULL_EMAIL, firstName: 'Null-Driver', lastName: 'Seed', role: 'driver', companyId: null, phone: '5550000000' },
    { password: true },
  );
  const [school] = await h.db.insert(schools).values({ companyId: null, name: 'Null-School', address: 'Null-1 Rd' }).returning({ id: schools.id });
  schoolNullId = school.id;
  const [route] = await h.db
    .insert(routes)
    .values({ companyId: null, name: 'Null-Route', driverId: driverNullId, schoolId: schoolNullId })
    .returning({ id: routes.id });
  routeNullId = route.id;
  const [student] = await h.db
    .insert(students)
    .values({ companyId: null, firstName: 'Null-Student', lastName: 'Seed', parentId: h.ids.parentNull, routeId: routeNullId, schoolId: schoolNullId })
    .returning({ id: students.id });
  await h.db.insert(parentChildLinks).values({ parentId: h.ids.parentNull, studentId: student.id });

  // On-duty drivers in A and B.
  await h.db.update(users).set({ isOnDuty: true }).where(eq(users.id, h.ids.driverA));
  await h.db.update(users).set({ isOnDuty: true }).where(eq(users.id, h.ids.driverB));
  await h.db.update(users).set({ isOnDuty: true }).where(eq(users.id, driverNullId));

  // 6 logins (MAX_LOGINS_PER_FILE is 8).
  adminNull = await h.loginAs('adminNull');
  adminA = await h.loginAs('adminA');
  master = await h.loginAs('master');
  parentNull = await h.loginAs('parentNull');
  parentA = await h.loginAs('parentA');
  driverNull = await login(DRIVER_NULL_EMAIL);
});

describe('C1 GET /api/on-duty-drivers', () => {
  it('a null-company admin gets [] and never another company\'s drivers (red if companyScope is reverted to user.companyId || undefined)', async () => {
    const res = await adminNull.get('/api/on-duty-drivers');
    expect(res.status).toBe(200);
    expect(res.body).toEqual([]);
  });

  it('adminA sees driverA but not driverB', async () => {
    const res = await adminA.get('/api/on-duty-drivers');
    const ids = res.body.map((d: { id: string }) => d.id);
    expect(ids).toContain(h.ids.driverA);
    expect(ids).not.toContain(h.ids.driverB);
    expect(ids).not.toContain(driverNullId);
  });
});

describe('C1 PATCH /api/drivers/:id', () => {
  it('a null-company admin patching a null-company driver gets 404 and the row is unchanged (red if isOutsideCallerTenant is reverted to !isUnscopedMaster && !==)', async () => {
    const res = await adminNull.patch(`/api/drivers/${driverNullId}`).send({ phone: '5551112222' });
    expect(res.status).toBe(404);
    expect((await getUser(driverNullId)).phone).toBe('5550000000');
  });

  it('adminA patching driverB gets 404', async () => {
    const res = await adminA.patch(`/api/drivers/${h.ids.driverB}`).send({ phone: '5551113333' });
    expect(res.status).toBe(404);
  });
});

describe('C1 POST /api/drivers/:id/send-invitation', () => {
  it('a null-company admin inviting a null-company driver (email, no invitation yet) gets 404 and no email (red if the bare !== comes back)', async () => {
    // driverNull has a password; the null === null check runs before the
    // hasPassword check, so without the guard the reply would be 400, not 404.
    vi.mocked(sendDriverInvitationEmail).mockClear();
    const res = await adminNull.post(`/api/drivers/${driverNullId}/send-invitation`);
    expect(res.status).toBe(404);
    expect(sendDriverInvitationEmail).not.toHaveBeenCalled();
  });

  it('adminA inviting company B\'s driverB2 gets 404 and no invitation row', async () => {
    vi.mocked(sendDriverInvitationEmail).mockClear();
    const res = await adminA.post(`/api/drivers/${h.ids.driverB2}/send-invitation`);
    expect(res.status).toBe(404);
    expect(sendDriverInvitationEmail).not.toHaveBeenCalled();
    expect(await h.db.select().from(driverInvitations).where(eq(driverInvitations.driverId, h.ids.driverB2))).toHaveLength(0);
  });

  it('adminA inviting a company-B driver who has no email gets 404, not the 400 "no email" that would reveal the driver exists (red if the tenant check runs after the email check)', async () => {
    const [noEmail] = await h.db
      .insert(users)
      .values({ email: null, firstName: 'B-NoEmail', lastName: 'Seed', role: 'driver', companyId: h.ids.companyB })
      .returning({ id: users.id });
    const res = await adminA.post(`/api/drivers/${noEmail.id}/send-invitation`);
    expect(res.status).toBe(404);
    expect(res.body).toEqual({ message: 'Driver not found' });
  });

  it('an unscoped master inviting company B\'s driverB2 gets 200; the invitation row and the email use company B (the driver\'s company, not the caller\'s)', async () => {
    vi.mocked(sendDriverInvitationEmail).mockClear();
    const res = await master.post(`/api/drivers/${h.ids.driverB2}/send-invitation`);
    expect(res.status).toBe(200);
    const rows = await h.db.select().from(driverInvitations).where(eq(driverInvitations.driverId, h.ids.driverB2));
    expect(rows).toHaveLength(1);
    expect(rows[0].companyId).toBe(h.ids.companyB);
    expect(sendDriverInvitationEmail).toHaveBeenCalledTimes(1);
    expect(vi.mocked(sendDriverInvitationEmail).mock.calls[0][2]).toBe('B-Company');
  });
});

describe('C1 POST /api/routes/:routeId/schools/:schoolId', () => {
  const linkCount = async (routeId: string, schoolId: string) =>
    (await h.db.select().from(routeSchools).where(and(eq(routeSchools.routeId, routeId), eq(routeSchools.schoolId, schoolId)))).length;

  it('a null-company admin linking a null-company school to a null-company route gets 404 "Route not found" and no link (red if the route check alone is reverted to a bare !==: the school check would then answer "School not found")', async () => {
    const res = await adminNull.post(`/api/routes/${routeNullId}/schools/${schoolNullId}`);
    expect(res.status).toBe(404);
    expect(res.body).toEqual({ message: 'Route not found' });
    expect(await linkCount(routeNullId, schoolNullId)).toBe(0);
  });

  it('adminA linking B\'s school to routeA gets 404 "School not found" and no link', async () => {
    const res = await adminA.post(`/api/routes/${h.ids.routeA}/schools/${h.ids.schoolB}`);
    expect(res.status).toBe(404);
    expect(res.body).toEqual({ message: 'School not found' });
    expect(await linkCount(h.ids.routeA, h.ids.schoolB)).toBe(0);
  });

  it('adminA linking A\'s school to routeB gets 404 "Route not found"', async () => {
    const res = await adminA.post(`/api/routes/${h.ids.routeB}/schools/${h.ids.schoolA}`);
    expect(res.status).toBe(404);
    expect(res.body).toEqual({ message: 'Route not found' });
    expect(await linkCount(h.ids.routeB, h.ids.schoolA)).toBe(0);
  });

  it('an unscoped master cannot link company B\'s school to company A\'s route (red if the school.companyId === route.companyId check is deleted)', async () => {
    const res = await master.post(`/api/routes/${h.ids.routeA}/schools/${h.ids.schoolB}`);
    expect(res.status).toBe(404);
    expect(await linkCount(h.ids.routeA, h.ids.schoolB)).toBe(0);
  });
});

describe('C1 GET /api/messages/contacts (driver branch)', () => {
  it('a null-company driver with a null-company route and a linked parent gets [] (red if getParentsForDriver fails open on a missing companyId)', async () => {
    const res = await driverNull.get('/api/messages/contacts');
    expect(res.status).toBe(200);
    expect(res.body).toEqual([]);
  });
});

describe('C1 POST /api/messages', () => {
  it('a null-company parent messaging a null-company driver gets 404 and no message row (red if null === null passes the company check)', async () => {
    const res = await parentNull.post('/api/messages').send({ recipientId: driverNullId, content: 'Q18 null to null' });
    expect(res.status).toBe(404);
    const rows = await h.db.select().from(directMessages).where(eq(directMessages.recipientId, driverNullId));
    expect(rows).toHaveLength(0);
  });

  it('parentA messaging company B\'s driverB gets 404 with a body equal to the missing-recipient body (T-2)', async () => {
    const missing = await parentA.post('/api/messages').send({ recipientId: 'no-such-user', content: 'Q18 missing' });
    const foreign = await parentA.post('/api/messages').send({ recipientId: h.ids.driverB, content: 'Q18 foreign' });
    expect(missing.status).toBe(404);
    expect(foreign.status).toBe(404);
    expect(foreign.body).toEqual(missing.body);
  });

  it('parentA messaging driverA (same company) still works', async () => {
    const res = await parentA.post('/api/messages').send({ recipientId: h.ids.driverA, content: 'Q18 same company' });
    expect(res.status).toBe(200);
  });
});

describe('C1 POST /api/driver-check-in journey write', () => {
  it('an unscoped master checking in driverA on routeA / busA writes today\'s journey under company A (red if the journey uses user.companyId)', async () => {
    const res = await master.post('/api/driver-check-in').send({
      driverId: h.ids.driverA, routeId: h.ids.routeA, busId: h.ids.busA, fuelLevel: 'Full', interiorClean: true, exteriorClean: true,
    });
    expect(res.status).toBe(200);
    const journeys = await h.db.select().from(busJourneys).where(eq(busJourneys.busId, h.ids.busA));
    expect(journeys).toHaveLength(1);
    expect(journeys[0].companyId).toBe(h.ids.companyA);
  });
});
