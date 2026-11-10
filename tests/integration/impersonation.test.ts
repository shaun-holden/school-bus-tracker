// Q7 (SEC-45 / DUP-2 / Q19): a master admin impersonating company A acts as
// an admin of A. Lists show only A, B's records are 404, creates land in A,
// the master's own users row is never written, and messaging is open only
// while impersonating. Real HTTP + real Postgres (Q4 harness).
//
// Describes run in order on one seeded DB. The create in "creates" adds an A
// school, so later list checks assert "contains", not equality. The
// stop-impersonating describe runs last because it ends the impersonation.
//
// Each title names the clause whose removal (or revert) turns it red.
import { describe, it, expect, beforeAll } from 'vitest';
import { and, eq } from 'drizzle-orm';
import { users, students, buses, routes, schools, parentChildLinks, linkCodes, directMessages } from '@shared/schema';
import { useIntegrationHarness, type Agent } from './harness';

const h = useIntegrationHarness();
let master: Agent; // master admin, NOT impersonating
let impersonator: Agent; // master admin impersonating company A
let parentA: Agent;
let driverA: Agent;

beforeAll(async () => {
  // 4 logins here + parentB in the mark-read describe = 5 (MAX_LOGINS_PER_FILE is 8).
  master = await h.loginAs('master');
  impersonator = await h.loginAs('master');
  parentA = await h.loginAs('parentA');
  driverA = await h.loginAs('driverA');

  // Preconditions outside the tests, so a broken impersonation fails the file.
  const imp = await impersonator.post(`/api/master-admin/impersonate/${h.ids.companyA}`).send({});
  expect(imp.status).toBe(200);
  const me = await impersonator.get('/api/auth/user');
  expect(me.body).toMatchObject({ role: 'master_admin', companyId: h.ids.companyA, _masterAdminImpersonating: true });
  const plain = await master.get('/api/auth/user');
  expect(plain.body.role).toBe('master_admin');
  expect(plain.body._masterAdminImpersonating).toBeUndefined();
});

const idsOf = (rows: Array<{ id: string }>) => rows.map((r) => r.id).sort();
const getUser = async (id: string) => (await h.db.select().from(users).where(eq(users.id, id)))[0];
const getStudent = async (id: string) => (await h.db.select().from(students).where(eq(students.id, id)))[0];
const getBus = async (id: string) => (await h.db.select().from(buses).where(eq(buses.id, id)))[0];
const getRoute = async (id: string) => (await h.db.select().from(routes).where(eq(routes.id, id)))[0];

const SCOPE_CLAUSE =
  'red if companyScope bypasses on isMasterAdminUser instead of isUnscopedMaster, or getCaller(req) drops the req.session.impersonatedCompanyId overlay';

describe('1. lists while impersonating A show only A', () => {
  it(`GET /api/schools → only schoolA (${SCOPE_CLAUSE})`, async () => {
    const res = await impersonator.get('/api/schools');
    expect(res.status).toBe(200);
    expect(idsOf(res.body)).toEqual([h.ids.schoolA]);
  });

  it(`GET /api/students → only studentA (${SCOPE_CLAUSE})`, async () => {
    const res = await impersonator.get('/api/students');
    expect(res.status).toBe(200);
    expect(idsOf(res.body)).toEqual([h.ids.studentA]);
  });

  it(`GET /api/buses → only busA (${SCOPE_CLAUSE})`, async () => {
    const res = await impersonator.get('/api/buses');
    expect(res.status).toBe(200);
    expect(idsOf(res.body)).toEqual([h.ids.busA]);
  });

  it(`GET /api/routes → only routeA (${SCOPE_CLAUSE})`, async () => {
    const res = await impersonator.get('/api/routes');
    expect(res.status).toBe(200);
    expect(idsOf(res.body)).toEqual([h.ids.routeA]);
  });

  it('positive control: the non-impersonating master still sees A and B schools (red if companyScope stops returning undefined for an unscoped master)', async () => {
    const res = await master.get('/api/schools');
    expect(res.status).toBe(200);
    expect(idsOf(res.body)).toEqual([h.ids.schoolA, h.ids.schoolB].sort());
  });
});

describe("2. B's records by id are 404 while impersonating A", () => {
  it("GET /api/students/:id of studentA → 200 (positive control: the impersonator reaches its own company's record)", async () => {
    const res = await impersonator.get(`/api/students/${h.ids.studentA}`);
    expect(res.status).toBe(200);
    expect(res.body.id).toBe(h.ids.studentA);
  });

  it("GET /api/students/:id of studentB → 404 (red if GET /api/students/:id uses `isMasterAdminUser(user)` instead of `isUnscopedMaster(user)`, or re-fetches with storage.getUser(userId) instead of getCaller(req))", async () => {
    const res = await impersonator.get(`/api/students/${h.ids.studentB}`);
    expect(res.status).toBe(404);
    expect(res.body).toEqual({ message: 'Student not found' });
  });

  it("PUT /api/students/:id of studentB → 404 and studentB is unchanged (red if PUT /api/students/:id uses `isMasterAdminUser(user)` instead of `isUnscopedMaster(user)` in its admin-path 404, or re-fetches with storage.getUser(userId))", async () => {
    const before = await getStudent(h.ids.studentB);
    const res = await impersonator.put(`/api/students/${h.ids.studentB}`).send({ firstName: 'IMP-Hijacked' });
    expect(res.status).toBe(404);
    expect(res.body).toEqual({ message: 'Student not found' });
    const after = await getStudent(h.ids.studentB);
    expect(after.firstName).toBe(before.firstName);
    expect(after.companyId).toBe(h.ids.companyB);
  });

  it("PATCH /api/buses/:id of busB → 404 and busB is unchanged (red if PATCH /api/buses/:id uses `isMasterAdminUser(user)` instead of `isUnscopedMaster(user)`, or re-fetches with storage.getUser)", async () => {
    const before = await getBus(h.ids.busB);
    const res = await impersonator.patch(`/api/buses/${h.ids.busB}`).send({ make: 'IMP-Make' });
    expect(res.status).toBe(404);
    expect(res.body).toEqual({ message: 'Bus not found' });
    const after = await getBus(h.ids.busB);
    expect(after.make).toBe(before.make);
    expect(after.companyId).toBe(h.ids.companyB);
  });

  it("PATCH /api/routes/:id of routeB → 404 and routeB is unchanged (red if PATCH /api/routes/:id uses `isMasterAdminUser(user)` instead of `isUnscopedMaster(user)`, or re-fetches with storage.getUser)", async () => {
    const before = await getRoute(h.ids.routeB);
    const res = await impersonator.patch(`/api/routes/${h.ids.routeB}`).send({ name: 'IMP-Route' });
    expect(res.status).toBe(404);
    expect(res.body).toEqual({ message: 'Route not found' });
    const after = await getRoute(h.ids.routeB);
    expect(after.name).toBe(before.name);
    expect(after.companyId).toBe(h.ids.companyB);
  });
});

describe('B1. PATCH /api/users/:id/role while impersonating A', () => {
  it("a company B user → 404 and the role is unchanged (red if the tenant 404 is `isOutsideCallerTenant` bypassing on isMasterAdminUser, or reverts to `!callerIsMaster && (...)`)", async () => {
    const res = await impersonator.patch(`/api/users/${h.ids.driverB2}/role`).send({ role: 'parent' });
    expect(res.status).toBe(404);
    expect(res.body).toEqual({ message: 'User not found' });
    expect((await getUser(h.ids.driverB2)).role).toBe('driver');
  });

  it('a company A user → 200 (positive control: the impersonator keeps admin powers in A; red if callerIsFullAdmin stops using isMasterAdminUser)', async () => {
    const res = await impersonator.patch(`/api/users/${h.ids.driverA2}/role`).send({ role: 'driver_admin' });
    expect(res.status).toBe(200);
    expect((await getUser(h.ids.driverA2)).role).toBe('driver_admin');
    const back = await impersonator.patch(`/api/users/${h.ids.driverA2}/role`).send({ role: 'driver' });
    expect(back.status).toBe(200);
    expect((await getUser(h.ids.driverA2)).role).toBe('driver');
  });
});

describe('3. creates while impersonating A land in A', () => {
  it('POST /api/schools with a body companyId of B is stored with companyId A (red if POST /api/schools re-fetches with storage.getUser instead of getCaller(req), or stops forcing `validatedData.companyId = user.companyId`)', async () => {
    const res = await impersonator
      .post('/api/schools')
      .send({ name: 'IMP-School', address: 'IMP-1 Impersonation Rd', companyId: h.ids.companyB });
    expect(res.status).toBe(200);
    const [row] = await h.db.select().from(schools).where(eq(schools.id, res.body.id));
    expect(row.companyId).toBe(h.ids.companyA);
  });
});

describe('B2. POST /api/link-child refuses any master admin', () => {
  it("impersonating master → 403, no link written, code still active (red if the `user?.role === 'master_admin'` 403 in POST /api/link-child is removed)", async () => {
    const res = await impersonator.post('/api/link-child').send({ code: 'A-LINK-0001' });
    expect(res.status).toBe(403);
    expect(res.body).toEqual({ message: "Master admins can't link children" });
    const links = await h.db.select().from(parentChildLinks).where(eq(parentChildLinks.parentId, h.ids.master));
    expect(links).toEqual([]);
    const [code] = await h.db.select().from(linkCodes).where(eq(linkCodes.id, h.ids.linkCodeA));
    expect(code.status).toBe('active');
    expect((await getUser(h.ids.master)).companyId).toBeNull();
  });

  it("non-impersonating master → 403 and its users.companyId stays NULL (red if the `user?.role === 'master_admin'` 403 in POST /api/link-child is removed: updateUserCompany would write company B onto the master)", async () => {
    const res = await master.post('/api/link-child').send({ code: 'B-LINK-0001' });
    expect(res.status).toBe(403);
    expect(res.body).toEqual({ message: "Master admins can't link children" });
    expect((await getUser(h.ids.master)).companyId).toBeNull();
    const links = await h.db
      .select()
      .from(parentChildLinks)
      .where(and(eq(parentChildLinks.parentId, h.ids.master), eq(parentChildLinks.studentId, h.ids.studentB)));
    expect(links).toEqual([]);
  });
});

describe('I4. PATCH /api/messages/:messageId/read: only the recipient may mark it read', () => {
  let parentB: Agent;
  let messageToB: string;
  const getMessage = async (id: string) =>
    (await h.db.select().from(directMessages).where(eq(directMessages.id, id)))[0];

  beforeAll(async () => {
    parentB = await h.loginAs('parentB');
    const [row] = await h.db
      .insert(directMessages)
      .values({ companyId: h.ids.companyB, senderId: h.ids.driverB, recipientId: h.ids.parentB, content: 'B-driver-to-B-parent' })
      .returning({ id: directMessages.id });
    messageToB = row.id;
  });

  it("parentA marking a message addressed to parentB → 404 and the row stays unread (red if `eq(directMessages.recipientId, recipientId)` is removed from storage.markMessageAsRead)", async () => {
    const res = await parentA.patch(`/api/messages/${messageToB}/read`).send({});
    expect(res.status).toBe(404);
    expect(res.body).toEqual({ message: 'Message not found' });
    const row = await getMessage(messageToB);
    expect(row.isRead).toBe(false);
    expect(row.readAt).toBeNull();
  });

  it('positive control: the recipient parentB marking it → 200 and isRead true (red if PATCH /api/messages/:messageId/read stops passing the caller id to markMessageAsRead)', async () => {
    const res = await parentB.patch(`/api/messages/${messageToB}/read`).send({});
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ id: messageToB, recipientId: h.ids.parentB, isRead: true });
    const row = await getMessage(messageToB);
    expect(row.isRead).toBe(true);
    expect(row.readAt).not.toBeNull();
  });
});

describe('4. the master users row is never written', () => {
  it("after all the impersonated requests, master's users.companyId is still NULL and role master_admin (red if any handler writes a getCaller() result back)", async () => {
    const row = await getUser(h.ids.master);
    expect(row.companyId).toBeNull();
    expect(row.role).toBe('master_admin');
  });
});

// Last: ends the impersonation on the impersonator agent.
describe('5. stop-impersonating restores the unscoped view', () => {
  it('POST /api/master-admin/stop-impersonating → GET /api/schools contains schoolA and schoolB (red if getCaller keeps the overlay after the session key is deleted, or companyScope stops returning undefined for an unscoped master)', async () => {
    const stop = await impersonator.post('/api/master-admin/stop-impersonating').send({});
    expect(stop.status).toBe(200);
    const res = await impersonator.get('/api/schools');
    expect(res.status).toBe(200);
    const got = idsOf(res.body);
    expect(got).toContain(h.ids.schoolA);
    expect(got).toContain(h.ids.schoolB);
  });

  it("master's users.companyId is still NULL after stop-impersonating", async () => {
    expect((await getUser(h.ids.master)).companyId).toBeNull();
  });
});
