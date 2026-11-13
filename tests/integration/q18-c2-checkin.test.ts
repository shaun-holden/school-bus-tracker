// Q18 Part C2: POST /api/check-in/confirm-boarded and confirm-dropoff. Every
// refusal is a 404 (never a 403 that shows the check-in exists), and the
// route / bus / check-in company checks no longer skip on a null value. Real
// HTTP + real Postgres. Each title names the clause whose deletion turns it
// red; foreign and null-company rows are seeded so they are reachable.
import { describe, it, expect, beforeAll } from 'vitest';
import { eq } from 'drizzle-orm';
import { routes, buses, studentCheckIns, parentNotifications } from '@shared/schema';
import { useIntegrationHarness, type Agent } from './harness';
import { insertUser, SEED_PASSWORD } from './seed';

const h = useIntegrationHarness();
const NOT_FOUND = { message: 'Check-in not found' };
const DRIVER_NULL_EMAIL = 'q18c2-driver-null@sbt.test';

let driverA: Agent;
let driverAdminA: Agent;
let driverNull: Agent;

let routeA2: string;
let routeNull: string;
let busNull: string;

async function login(email: string): Promise<Agent> {
  const agent = h.anon();
  const res = await h.loginAttempt(email, SEED_PASSWORD, agent);
  expect(res.status).toBe(200);
  return agent;
}

async function insertCheckIn(values: Partial<typeof studentCheckIns.$inferInsert>) {
  const [row] = await h.db
    .insert(studentCheckIns)
    .values({
      companyId: h.ids.companyA,
      studentId: h.ids.studentA,
      parentId: h.ids.parentA,
      routeId: h.ids.routeA,
      status: 'waiting',
      ...values,
    })
    .returning({ id: studentCheckIns.id });
  return row.id;
}

const getCheckIn = async (id: string) => (await h.db.select().from(studentCheckIns).where(eq(studentCheckIns.id, id)))[0];

const board = (agent: Agent, checkInId: string, over: Record<string, string> = {}) =>
  agent.post('/api/check-in/confirm-boarded').send({ checkInId, busId: h.ids.busA, routeId: h.ids.routeA, ...over });

beforeAll(async () => {
  const [r2] = await h.db.insert(routes).values({ companyId: h.ids.companyA, name: 'A-Route2', schoolId: h.ids.schoolA }).returning({ id: routes.id });
  routeA2 = r2.id;

  // Null-company driver on a null-company route with a null-company bus.
  const driverNullId = await insertUser(
    { email: DRIVER_NULL_EMAIL, firstName: 'Null-Driver', lastName: 'Seed', role: 'driver', companyId: null },
    { password: true },
  );
  const [rn] = await h.db.insert(routes).values({ companyId: null, name: 'Null-Route', driverId: driverNullId }).returning({ id: routes.id });
  routeNull = rn.id;
  const [bn] = await h.db.insert(buses).values({ companyId: null, busNumber: 'Null-100', driverId: driverNullId }).returning({ id: buses.id });
  busNull = bn.id;

  // 3 logins (MAX_LOGINS_PER_FILE is 8).
  driverA = await h.loginAs('driverA');
  driverAdminA = await h.loginAs('driverAdminA');
  driverNull = await login(DRIVER_NULL_EMAIL);
});

describe('C2 confirm-boarded refusals (404, check-in still waiting)', () => {
  it('a check-in with routeId NULL gives 404 (red if the route check skips a null existingCheckIn.routeId)', async () => {
    const id = await insertCheckIn({ routeId: null });
    const res = await board(driverA, id);
    expect(res.status).toBe(404);
    expect(res.body).toEqual(NOT_FOUND);
    expect((await getCheckIn(id)).status).toBe('waiting');
  });

  it('a check-in on routeA2 confirmed with routeA gives 404, not 403 (existingCheckIn.routeId === routeId)', async () => {
    const id = await insertCheckIn({ routeId: routeA2 });
    const res = await board(driverA, id);
    expect(res.status).toBe(404);
    expect(res.body).toEqual(NOT_FOUND);
    expect((await getCheckIn(id)).status).toBe('waiting');
  });

  it('company B\'s bus gives 404, not 403 (isOutsideCallerTenant(user, bus.companyId))', async () => {
    const id = await insertCheckIn({});
    const res = await board(driverA, id, { busId: h.ids.busB });
    expect(res.status).toBe(404);
    expect(res.body).toEqual(NOT_FOUND);
    expect((await getCheckIn(id)).status).toBe('waiting');
  });

  it('a company-B check-in that names routeA (bad data) gives 404, not 403 (red if isOutsideCallerTenant(user, existingCheckIn.companyId) is deleted)', async () => {
    const id = await insertCheckIn({ companyId: h.ids.companyB, studentId: h.ids.studentB, parentId: h.ids.parentB });
    const res = await board(driverA, id);
    expect(res.status).toBe(404);
    expect(res.body).toEqual(NOT_FOUND);
    expect((await getCheckIn(id)).status).toBe('waiting');
  });

  it('a route the driver is not assigned to gives 404, not 403', async () => {
    const id = await insertCheckIn({ routeId: routeA2 });
    const res = await board(driverA, id, { routeId: routeA2 });
    expect(res.status).toBe(404);
    expect(res.body).toEqual(NOT_FOUND);
  });

  it('a null-company driver with a null-company bus and check-in gives 404 (red only if both the bus and the check-in company checks skip a no-company caller; each alone is pinned in q18-round2-guards)', async () => {
    const id = await insertCheckIn({ companyId: null, routeId: routeNull, studentId: h.ids.studentA, parentId: h.ids.parentNull });
    const res = await driverNull.post('/api/check-in/confirm-boarded').send({ checkInId: id, busId: busNull, routeId: routeNull });
    expect(res.status).toBe(404);
    expect((await getCheckIn(id)).status).toBe('waiting');
  });
});

describe('C2 confirm-boarded / confirm-dropoff happy path and dropoff refusals', () => {
  let goodId: string;

  it('driverA boards a company-A check-in on routeA with busA: 200 and a "Child Boarded Bus" row targeted at parentA', async () => {
    goodId = await insertCheckIn({});
    const res = await board(driverA, goodId);
    expect(res.status).toBe(200);
    expect((await getCheckIn(goodId)).status).toBe('boarded');
    const rows = await h.db.select().from(parentNotifications).where(eq(parentNotifications.title, 'Child Boarded Bus'));
    expect(rows.map((r) => r.targetParentId)).toEqual([h.ids.parentA]);
  });

  it('another company-A driver (driver_admin) dropping off driverA\'s check-in gets 404, not 403', async () => {
    const res = await driverAdminA.post('/api/check-in/confirm-dropoff').send({ checkInId: goodId });
    expect(res.status).toBe(404);
    expect(res.body).toEqual(NOT_FOUND);
    expect((await getCheckIn(goodId)).status).toBe('boarded');
  });

  it('a company-B check-in whose driverId is driverA gives 404 on drop-off (red if isOutsideCallerTenant(user, existingCheckIn.companyId) is missing in confirm-dropoff)', async () => {
    const id = await insertCheckIn({
      companyId: h.ids.companyB, studentId: h.ids.studentB, parentId: h.ids.parentB, routeId: h.ids.routeB, status: 'boarded', driverId: h.ids.driverA,
    });
    const res = await driverA.post('/api/check-in/confirm-dropoff').send({ checkInId: id });
    expect(res.status).toBe(404);
    expect(res.body).toEqual(NOT_FOUND);
    expect((await getCheckIn(id)).status).toBe('boarded');
  });

  it('driverA drops off their own company-A check-in: 200', async () => {
    const res = await driverA.post('/api/check-in/confirm-dropoff').send({ checkInId: goodId });
    expect(res.status).toBe(200);
  });
});
