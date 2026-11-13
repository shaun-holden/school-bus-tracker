// Q18 round 2: pin each tenant guard on its own (SHELL merge report, GREEN
// mutations 2a, 2c/2e, 2f, 2g, 9a, 9b; reviewer M4). Real HTTP + real
// Postgres; foreign and null-company rows are seeded so each guard is
// reachable. Where two guards return the same 404, the test also asserts that
// the next storage call never happens (a spy on the shared storage instance),
// so the first guard is pinned by itself. Each title names the clause whose
// removal turns it red.
import { describe, it, expect, beforeAll, afterEach, vi } from 'vitest';
import { eq } from 'drizzle-orm';
import { routes, buses, students, parentChildLinks, studentCheckIns, parentNotifications } from '@shared/schema';
import { storage } from '../../server/storage';
import { useIntegrationHarness, type Agent } from './harness';
import { insertUser, SEED_PASSWORD } from './seed';

const h = useIntegrationHarness();
const NOT_FOUND = { message: 'Check-in not found' };
const DRIVER_NULL_EMAIL = 'q18r2-driver-null@sbt.test';

let driverA: Agent;
let driverNull: Agent;
let master: Agent;
let adminNull: Agent;

let driverNullId: string;
let routeNull: string;
let routeANull: string; // company-A route whose driverId is driverNull
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
    .values({ companyId: h.ids.companyA, studentId: h.ids.studentA, parentId: h.ids.parentA, routeId: h.ids.routeA, status: 'waiting', ...values })
    .returning({ id: studentCheckIns.id });
  return row.id;
}
const getCheckIn = async (id: string) => (await h.db.select().from(studentCheckIns).where(eq(studentCheckIns.id, id)))[0];

beforeAll(async () => {
  driverNullId = await insertUser(
    { email: DRIVER_NULL_EMAIL, firstName: 'Null-Driver', lastName: 'Seed', role: 'driver', companyId: null },
    { password: true },
  );
  const [rn] = await h.db.insert(routes).values({ companyId: null, name: 'Null-Route', driverId: driverNullId }).returning({ id: routes.id });
  routeNull = rn.id;
  const [ra] = await h.db.insert(routes).values({ companyId: h.ids.companyA, name: 'A-Route-NullDriver', driverId: driverNullId }).returning({ id: routes.id });
  routeANull = ra.id;
  const [bn] = await h.db.insert(buses).values({ companyId: null, busNumber: 'Null-200', driverId: driverNullId }).returning({ id: buses.id });
  busNull = bn.id;
  // A null-company student on driverNull's null route, linked to parentNull
  // (a parent the fail-open storage path would return).
  const [sn] = await h.db
    .insert(students)
    .values({ companyId: null, firstName: 'Null-Student', lastName: 'Seed', parentId: h.ids.parentNull, routeId: routeNull })
    .returning({ id: students.id });
  await h.db.insert(parentChildLinks).values({ parentId: h.ids.parentNull, studentId: sn.id });

  // 4 logins (MAX_LOGINS_PER_FILE is 8).
  driverA = await h.loginAs('driverA');
  driverNull = await login(DRIVER_NULL_EMAIL);
  master = await h.loginAs('master');
  adminNull = await h.loginAs('adminNull');
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('confirm-dropoff tenant check, each skip alone', () => {
  it('2g: driverA drops off a boarded check-in whose companyId is NULL and whose driverId is driverA → 404, still boarded (red if the existingCheckIn.companyId && skip comes back)', async () => {
    const id = await insertCheckIn({ companyId: null, status: 'boarded', driverId: h.ids.driverA });
    const res = await driverA.post('/api/check-in/confirm-dropoff').send({ checkInId: id });
    expect(res.status).toBe(404);
    expect(res.body).toEqual(NOT_FOUND);
    const row = await getCheckIn(id);
    expect(row.status).toBe('boarded');
    expect(row.droppedOffAt).toBeNull();
  });

  it('2f: a no-company driver drops off their own boarded check-in that has no company → 404, still boarded (red if the user.companyId && skip comes back)', async () => {
    const id = await insertCheckIn({ companyId: null, routeId: routeNull, status: 'boarded', driverId: driverNullId, parentId: h.ids.parentNull });
    const res = await driverNull.post('/api/check-in/confirm-dropoff').send({ checkInId: id });
    expect(res.status).toBe(404);
    expect(res.body).toEqual(NOT_FOUND);
    const row = await getCheckIn(id);
    expect(row.status).toBe('boarded');
    expect(row.droppedOffAt).toBeNull();
  });
});

describe('confirm-boarded tenant checks, each alone', () => {
  it('2c/2e: driverA on busA and routeA boards a waiting check-in whose companyId is NULL → 404, still waiting (red if the existingCheckIn.companyId && skip comes back)', async () => {
    const id = await insertCheckIn({ companyId: null });
    const res = await driverA.post('/api/check-in/confirm-boarded').send({ checkInId: id, busId: h.ids.busA, routeId: h.ids.routeA });
    expect(res.status).toBe(404);
    expect(res.body).toEqual(NOT_FOUND);
    const row = await getCheckIn(id);
    expect(row.status).toBe('waiting');
    expect(row.boardedAt).toBeNull();
    const boarded = await h.db.select().from(parentNotifications).where(eq(parentNotifications.title, 'Child Boarded Bus'));
    expect(boarded).toHaveLength(0);
  });

  it('2a: a no-company driver against company A\'s busA is stopped by the bus check before the check-in is even read (red if the user.companyId && skip comes back on the bus check)', async () => {
    const id = await insertCheckIn({ routeId: routeANull });
    const spy = vi.spyOn(storage, 'getCheckInById');
    const res = await driverNull.post('/api/check-in/confirm-boarded').send({ checkInId: id, busId: h.ids.busA, routeId: routeANull });
    expect(res.status).toBe(404);
    expect(res.body).toEqual(NOT_FOUND);
    expect(spy).not.toHaveBeenCalled();
    expect((await getCheckIn(id)).status).toBe('waiting');
  });

  it('no-company driver, no-company bus, company-A check-in on their route → 404, still waiting', async () => {
    const id = await insertCheckIn({ routeId: routeANull });
    const res = await driverNull.post('/api/check-in/confirm-boarded').send({ checkInId: id, busId: busNull, routeId: routeANull });
    expect(res.status).toBe(404);
    expect((await getCheckIn(id)).status).toBe('waiting');
  });
});

describe('getParentsForDriver fail-open, each layer alone', () => {
  it('9a: storage.getParentsForDriver(driverId, \'\') and (driverId, null) return [] even though driverNull\'s null-company route has a linked null-company parent (red if storage fails open on a missing companyId)', async () => {
    expect(await storage.getParentsForDriver(driverNullId, '')).toEqual([]);
    expect(await storage.getParentsForDriver(driverNullId, null as unknown as string)).toEqual([]);
  });

  it('9b: a no-company driver\'s contacts are [] and getParentsForDriver is never called (red if the route\'s user.companyId short-circuit is removed)', async () => {
    const spy = vi.spyOn(storage, 'getParentsForDriver');
    const res = await driverNull.get('/api/messages/contacts');
    expect(res.status).toBe(200);
    expect(res.body).toEqual([]);
    expect(spy).not.toHaveBeenCalled();
  });
});

describe('M4: POST /api/notifications needs a company', () => {
  it('an unscoped master and a no-company admin each get 400 "No company assigned" and no row is written', async () => {
    const before = (await h.db.select().from(parentNotifications)).length;
    for (const agent of [master, adminNull]) {
      const res = await agent.post('/api/notifications').send({ type: 'info', title: 'M4', message: 'M4 body' });
      expect(res.status).toBe(400);
      expect(res.body).toEqual({ message: 'No company assigned' });
    }
    expect((await h.db.select().from(parentNotifications)).length).toBe(before);
  });
});
