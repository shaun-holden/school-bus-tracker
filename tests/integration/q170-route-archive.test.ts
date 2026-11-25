// Q170: admins can archive, restore and delete a route.
// - POST /api/routes/:id/archive hides the route from every route list (GET
//   /api/routes, GET /api/available-routes), clears the route's own driverId,
//   and is refused (409, counts only) while students, buses or drivers on a
//   shift still use it.
// - POST /api/routes/:id/restore re-lists it.
// - DELETE /api/routes/:id { confirmName } removes a route only when the typed
//   name matches and nothing uses it or ever recorded it (history), otherwise
//   409 "Archive it instead".
// - GET /api/routes?archived=1 is for admins only.
// - A shift can't start on an archived route (activate-route, check-in).
// All three endpoints: admin (403) → route exists → tenant (404).
// Real HTTP + real Postgres. Each title names the clause whose deletion turns
// it red; preconditions are asserted first.
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { asc, eq, inArray, like } from 'drizzle-orm';
import { attendance, buses, busJourneys, parentNotifications, routes, routeSchools, routeStops, schools, students, systemNotifications, users } from '@shared/schema';
import { useIntegrationHarness, type Agent } from './harness';

const h = useIntegrationHarness();
const HISTORY_MSG = 'This route has past trips or records. Archive it instead.';
// Q172: an admin's write onto their own archived route.
const ARCHIVED = { message: 'This route is archived. Restore it first.' };
const ROUTE_404 = { message: 'Route not found' };

let adminA: Agent;
let driverA: Agent;
let parentA: Agent;

type SavedUser = { isOnDuty: boolean | null; dutyStartTime: Date | null; assignedRouteId: string | null };
type SavedBus = { driverId: string | null; status: string | null; currentRouteId: string | null };
let savedDriverA: SavedUser | undefined;
let savedDriverA2: SavedUser | undefined;
let savedBusA: SavedBus | undefined;
const createdRoutes: string[] = [];
const createdStudents: string[] = [];
const createdBuses: string[] = [];
const createdJourneys: string[] = [];
const createdAttendance: string[] = [];
const createdSchools: string[] = [];

let seq = 0;
// A route with one stop and one route_schools row (its own parts).
async function mkRoute(companyId: string, schoolId: string, extra: Partial<typeof routes.$inferInsert> = {}) {
  seq += 1;
  const name = `Q170-Route-${seq}`;
  const [r] = await h.db.insert(routes).values({ companyId, name, schoolId, ...extra }).returning();
  createdRoutes.push(r.id);
  await h.db.insert(routeStops).values({ routeId: r.id, schoolId, name: `${name}-Stop`, address: `${seq} Q170 St`, order: 1 });
  await h.db.insert(routeSchools).values({ routeId: r.id, schoolId, order: 0 });
  return r;
}
const mkRouteA = (extra: Partial<typeof routes.$inferInsert> = {}) => mkRoute(h.ids.companyA, h.ids.schoolA, extra);
const routeRow = async (id: string) => (await h.db.select().from(routes).where(eq(routes.id, id)))[0];
const ids = (body: any[]) => body.map((r: any) => r.id);
const userRow = async (id: string) => (await h.db.select().from(users).where(eq(users.id, id)))[0];
const pickUser = (u: any): SavedUser => ({ isOnDuty: u.isOnDuty, dutyStartTime: u.dutyStartTime, assignedRouteId: u.assignedRouteId });
const restoreDriverA = async () => {
  if (savedDriverA) await h.db.update(users).set(savedDriverA).where(eq(users.id, h.ids.driverA));
  if (savedBusA) await h.db.update(buses).set(savedBusA).where(eq(buses.id, h.ids.busA));
};

beforeAll(async () => {
  savedDriverA = pickUser(await userRow(h.ids.driverA));
  savedDriverA2 = pickUser(await userRow(h.ids.driverA2));
  const [bA] = await h.db.select().from(buses).where(eq(buses.id, h.ids.busA));
  savedBusA = { driverId: bA.driverId, status: bA.status, currentRouteId: bA.currentRouteId };
  // 3 logins (MAX_LOGINS_PER_FILE is 8).
  adminA = await h.loginAs('adminA');
  driverA = await h.loginAs('driverA');
  parentA = await h.loginAs('parentA');
});

afterAll(async () => {
  // Q172: anything a mutation run might have written (titles/names are unique to this file).
  await h.db.delete(parentNotifications).where(like(parentNotifications.title, 'Q172-%'));
  await h.db.delete(systemNotifications).where(like(systemNotifications.title, 'Q172-%'));
  await h.db.delete(students).where(like(students.firstName, 'A-Q172%'));
  await h.db.delete(students).where(like(students.firstName, 'A-Q168%'));
  if (createdAttendance.length) await h.db.delete(attendance).where(inArray(attendance.id, createdAttendance));
  if (createdJourneys.length) await h.db.delete(busJourneys).where(inArray(busJourneys.id, createdJourneys));
  if (createdStudents.length) await h.db.delete(students).where(inArray(students.id, createdStudents));
  if (createdBuses.length) await h.db.delete(buses).where(inArray(buses.id, createdBuses));
  await restoreDriverA();
  if (savedDriverA2) await h.db.update(users).set(savedDriverA2).where(eq(users.id, h.ids.driverA2));
  // route_stops and route_schools cascade with the route.
  if (createdRoutes.length) await h.db.delete(routes).where(inArray(routes.id, createdRoutes));
  if (createdSchools.length) await h.db.delete(schools).where(inArray(schools.id, createdSchools));
});

describe('Q170 archive and restore', () => {
  it('(1) archiving an unused route hides it from GET /api/routes and GET /api/available-routes, and lists it under ?archived=1 (red if archived routes stop being hidden from route lists)', async () => {
    const r = await mkRouteA();
    expect(ids((await adminA.get('/api/routes')).body)).toContain(r.id);
    expect(ids((await driverA.get('/api/available-routes')).body)).toContain(r.id);

    const res = await adminA.post(`/api/routes/${r.id}/archive`).send({});
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ archived: true });
    expect((await routeRow(r.id)).isActive).toBe(false);

    const list = await adminA.get('/api/routes');
    expect(list.status).toBe(200);
    expect(ids(list.body)).not.toContain(r.id);
    expect(ids(list.body)).toContain(h.ids.routeA);
    const avail = await driverA.get('/api/available-routes');
    expect(avail.status).toBe(200);
    expect(ids(avail.body)).not.toContain(r.id);
    const archived = await adminA.get('/api/routes?archived=1');
    expect(archived.status).toBe(200);
    expect(ids(archived.body)).toContain(r.id);
    expect(ids(archived.body)).not.toContain(h.ids.routeA);
  });

  it('(2) restoring an archived route puts it back in both lists (red if restore stops re-listing the route)', async () => {
    const r = await mkRouteA({ isActive: false });
    expect(ids((await adminA.get('/api/routes')).body)).not.toContain(r.id);

    const res = await adminA.post(`/api/routes/${r.id}/restore`).send({});
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ archived: false });
    expect((await routeRow(r.id)).isActive).toBe(true);
    expect(ids((await adminA.get('/api/routes')).body)).toContain(r.id);
    expect(ids((await driverA.get('/api/available-routes')).body)).toContain(r.id);
    expect(ids((await adminA.get('/api/routes?archived=1')).body)).not.toContain(r.id);
  });

  it('(3) ?archived=1 from a driver or a parent lists active routes only (red if non-admins can list archived routes)', async () => {
    const r = await mkRouteA({ isActive: false });
    // Precondition: an admin does see it under ?archived=1.
    expect(ids((await adminA.get('/api/routes?archived=1')).body)).toContain(r.id);

    // driverA reads its own routes (by driverId); parentA reads the company
    // list, the branch that honours ?archived=1 for admins.
    for (const agent of [driverA, parentA]) {
      const res = await agent.get('/api/routes?archived=1');
      expect(res.status).toBe(200);
      expect(ids(res.body)).not.toContain(r.id);
      expect(res.body.every((x: any) => x.isActive !== false)).toBe(true);
    }
    expect(ids((await parentA.get('/api/routes?archived=1')).body)).toContain(h.ids.routeA);
  });

  it('(4a) archive is refused while an active student rides the route: 409 students 1, still active (red if an archive refusal count is removed: students)', async () => {
    const r = await mkRouteA();
    const [st] = await h.db.insert(students).values({
      companyId: h.ids.companyA, firstName: 'A-Q170', lastName: 'Seed', parentId: h.ids.parentA, schoolId: h.ids.schoolA, routeId: r.id,
    }).returning({ id: students.id });
    createdStudents.push(st.id);

    const res = await adminA.post(`/api/routes/${r.id}/archive`).send({});
    expect(res.status).toBe(409);
    expect(res.body).toMatchObject({ students: 1, buses: 0, drivers: 0 });
    expect(res.body.message).toBe('This route still has 1 student. Move them first.');
    expect((await routeRow(r.id)).isActive).toBe(true);
  });

  it('(4b) archive is refused while a bus is on the route: 409 buses 1, still active (red if an archive refusal count is removed: buses)', async () => {
    const r = await mkRouteA();
    const [b] = await h.db.insert(buses).values({
      companyId: h.ids.companyA, busNumber: 'A-Q170', make: 'A-Make', currentRouteId: r.id,
    }).returning({ id: buses.id });
    createdBuses.push(b.id);

    const res = await adminA.post(`/api/routes/${r.id}/archive`).send({});
    expect(res.status).toBe(409);
    expect(res.body).toMatchObject({ students: 0, buses: 1, drivers: 0 });
    expect(res.body.message).toBe('This route still has 1 bus on it now. Move them first.');
    expect((await routeRow(r.id)).isActive).toBe(true);
  });

  it('(4c) archive is refused while a driver is on a shift on the route: 409 drivers 1, still active (red if an archive refusal count is removed: drivers)', async () => {
    const r = await mkRouteA();
    try {
      await h.db.update(users).set({ assignedRouteId: r.id }).where(eq(users.id, h.ids.driverA2));
      expect((await userRow(h.ids.driverA2)).companyId).toBe(h.ids.companyA);

      const res = await adminA.post(`/api/routes/${r.id}/archive`).send({});
      expect(res.status).toBe(409);
      expect(res.body).toMatchObject({ students: 0, buses: 0, drivers: 1 });
      expect(res.body.message).toBe('This route still has 1 driver on a shift on it. Move them first.');
      expect((await routeRow(r.id)).isActive).toBe(true);
    } finally {
      if (savedDriverA2) await h.db.update(users).set(savedDriverA2).where(eq(users.id, h.ids.driverA2));
    }
  });

  it("(12) archiving clears the route's own driverId (red if archiving keeps the route's driver)", async () => {
    const r = await mkRouteA({ driverId: h.ids.driverA2 });
    expect((await routeRow(r.id)).driverId).toBe(h.ids.driverA2);

    const res = await adminA.post(`/api/routes/${r.id}/archive`).send({});
    expect(res.status).toBe(200);
    const row = await routeRow(r.id);
    expect(row.isActive).toBe(false);
    expect(row.driverId).toBeNull();
  });
});

describe('Q170 delete', () => {
  it("(5) deleting an unused route with its exact name removes it and its own stops and route_schools rows (red if DELETE stops removing an unused route)", async () => {
    const r = await mkRouteA();
    expect(await h.db.select().from(routeStops).where(eq(routeStops.routeId, r.id))).toHaveLength(1);
    expect(await h.db.select().from(routeSchools).where(eq(routeSchools.routeId, r.id))).toHaveLength(1);

    const res = await adminA.delete(`/api/routes/${r.id}`).send({ confirmName: `  ${r.name} ` });
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ deleted: true });
    expect(await routeRow(r.id)).toBeUndefined();
    expect(await h.db.select().from(routeStops).where(eq(routeStops.routeId, r.id))).toHaveLength(0);
    expect(await h.db.select().from(routeSchools).where(eq(routeSchools.routeId, r.id))).toHaveLength(0);
  });

  it('(6) a wrong or missing confirmName → 400 and the route is unchanged (red if DELETE stops checking the typed name)', async () => {
    const r = await mkRouteA();
    for (const body of [{ confirmName: `${r.name}x` }, { confirmName: '' }, {}]) {
      const res = await adminA.delete(`/api/routes/${r.id}`).send(body);
      expect(res.status, JSON.stringify(body)).toBe(400);
      expect(res.body).toEqual({ message: "Type the route's name to delete it." });
    }
    expect(await routeRow(r.id)).toBeDefined();
    expect(await h.db.select().from(routeStops).where(eq(routeStops.routeId, r.id))).toHaveLength(1);
  });

  it('(7) a route with a bus_journeys row, or an attendance row, → 409 "Archive it instead" with history ≥ 1, nothing deleted (red if DELETE stops refusing a route with history)', async () => {
    const rJ = await mkRouteA();
    const [j] = await h.db.insert(busJourneys).values({
      companyId: h.ids.companyA, busId: h.ids.busA, routeId: rJ.id, journeyDate: new Date('2026-11-02T13:00:00Z'),
    }).returning({ id: busJourneys.id });
    createdJourneys.push(j.id);
    const rA = await mkRouteA();
    const [a] = await h.db.insert(attendance).values({
      companyId: h.ids.companyA, studentId: h.ids.studentA, routeId: rA.id, date: new Date('2026-11-02T13:00:00Z'),
    }).returning({ id: attendance.id });
    createdAttendance.push(a.id);

    for (const r of [rJ, rA]) {
      const res = await adminA.delete(`/api/routes/${r.id}`).send({ confirmName: r.name });
      expect(res.status, r.name).toBe(409);
      expect(res.body.message).toBe(HISTORY_MSG);
      expect(res.body.history).toBeGreaterThanOrEqual(1);
      expect(await routeRow(r.id)).toBeDefined();
      expect(await h.db.select().from(routeStops).where(eq(routeStops.routeId, r.id))).toHaveLength(1);
    }
    expect(await h.db.select().from(busJourneys).where(eq(busJourneys.id, j.id))).toHaveLength(1);
    expect(await h.db.select().from(attendance).where(eq(attendance.id, a.id))).toHaveLength(1);
  });

  it('(8) a route with only an ARCHIVED student on it → 409 history ≥ 1, unchanged (red if DELETE ignores archived students)', async () => {
    const r = await mkRouteA();
    const [st] = await h.db.insert(students).values({
      companyId: h.ids.companyA, firstName: 'A-Q170-Archived', lastName: 'Seed', parentId: h.ids.parentA, schoolId: h.ids.schoolA, routeId: r.id, isActive: false,
    }).returning({ id: students.id });
    createdStudents.push(st.id);
    // Precondition: an archived student is not "in use", so archiving goes
    // through (and an archived route may still be deleted under the same rules).
    const arch = await adminA.post(`/api/routes/${r.id}/archive`).send({});
    expect(arch.status).toBe(200);

    const res = await adminA.delete(`/api/routes/${r.id}`).send({ confirmName: r.name });
    expect(res.status).toBe(409);
    expect(res.body.message).toBe(HISTORY_MSG);
    expect(res.body.history).toBeGreaterThanOrEqual(1);
    expect(await routeRow(r.id)).toBeDefined();
    expect((await h.db.select().from(students).where(eq(students.id, st.id)))[0].routeId).toBe(r.id);
  });
});

describe('Q170 guards', () => {
  it("(9) adminA on company B's route: archive, restore and delete → 404 each, unchanged (red if a route endpoint drops the tenant check)", async () => {
    const rB = await mkRoute(h.ids.companyB, h.ids.schoolB);
    expect(rB.companyId).toBe(h.ids.companyB);
    const calls = [
      () => adminA.post(`/api/routes/${rB.id}/archive`).send({}),
      () => adminA.post(`/api/routes/${rB.id}/restore`).send({}),
      () => adminA.delete(`/api/routes/${rB.id}`).send({ confirmName: rB.name }),
    ];
    for (const call of calls) {
      const res = await call();
      expect(res.status).toBe(404);
      expect(res.body).toEqual({ message: 'Route not found' });
      const row = await routeRow(rB.id);
      expect(row).toBeDefined();
      expect(row.isActive).toBe(true);
    }
    // restore needs an archived route to be reachable: archive it in the DB.
    await h.db.update(routes).set({ isActive: false }).where(eq(routes.id, rB.id));
    const res = await adminA.post(`/api/routes/${rB.id}/restore`).send({});
    expect(res.status).toBe(404);
    expect((await routeRow(rB.id)).isActive).toBe(false);
  });

  it('(10) driverA on archive, restore and delete → 403 each, unchanged (red if a route endpoint stops requiring an admin)', async () => {
    const r = await mkRouteA();
    const archivedR = await mkRouteA({ isActive: false });
    const calls: Array<[() => any, string, boolean]> = [
      [() => driverA.post(`/api/routes/${r.id}/archive`).send({}), r.id, true],
      [() => driverA.post(`/api/routes/${archivedR.id}/restore`).send({}), archivedR.id, false],
      [() => driverA.delete(`/api/routes/${r.id}`).send({ confirmName: r.name }), r.id, true],
    ];
    for (const [call, id, active] of calls) {
      const res = await call();
      expect(res.status).toBe(403);
      const row = await routeRow(id);
      expect(row).toBeDefined();
      expect(row.isActive).toBe(active);
    }
  });

  it('(11) driverA on duty with an archived shift route: activate-route → 404 and assignedRouteId unchanged (red if a shift can start on an archived route)', async () => {
    const r = await mkRouteA({ isActive: false });
    try {
      await h.db.update(users)
        .set({ isOnDuty: true, dutyStartTime: new Date(), assignedRouteId: r.id })
        .where(eq(users.id, h.ids.driverA));
      await h.db.update(buses).set({ driverId: h.ids.driverA, currentRouteId: null, status: 'idle' }).where(eq(buses.id, h.ids.busA));
      expect((await routeRow(r.id)).isActive).toBe(false);

      const res = await driverA.post('/api/driver/activate-route').send({});
      expect(res.status).toBe(404);
      expect(res.body).toEqual({ message: 'Route not found' });
      expect((await userRow(h.ids.driverA)).assignedRouteId).toBe(r.id);
      const [bA] = await h.db.select().from(buses).where(eq(buses.id, h.ids.busA));
      expect(bA.currentRouteId).toBeNull();
      expect(bA.status).toBe('idle');
    } finally {
      await restoreDriverA();
    }
  });

  it('(11b) check-in on an archived route → 404 "Not found" and driverA is not put on it (red if check-in stops treating an archived route as not found)', async () => {
    const r = await mkRouteA({ isActive: false });
    try {
      const before = await userRow(h.ids.driverA);
      const res = await driverA.post('/api/driver-check-in').send({
        driverId: h.ids.driverA, routeId: r.id, busId: h.ids.busA,
        fuelLevel: 'Full', interiorClean: true, exteriorClean: true,
      });
      expect(res.status).toBe(404);
      expect(res.body).toEqual({ message: 'Not found' });
      const after = await userRow(h.ids.driverA);
      expect(after.assignedRouteId).toBe(before.assignedRouteId);
      expect(after.assignedRouteId).not.toBe(r.id);
      expect((await routeRow(r.id)).driverId).toBeNull();
    } finally {
      await restoreDriverA();
    }
  });
});

describe('Q170 r2 tenant list, PATCH and driver list', () => {
  it("(13) X-1: company B's archived route never shows in adminA's GET /api/routes?archived=1 (red if GET /api/routes?archived=1 drops the companyId filter)", async () => {
    const rB = await mkRoute(h.ids.companyB, h.ids.schoolB, { isActive: false });
    const rA = await mkRouteA({ isActive: false });
    // Preconditions: rB is archived and company B's; adminA's archived list works.
    const row = await routeRow(rB.id);
    expect(row.companyId).toBe(h.ids.companyB);
    expect(row.isActive).toBe(false);

    const res = await adminA.get('/api/routes?archived=1');
    expect(res.status).toBe(200);
    expect(ids(res.body)).toContain(rA.id);
    expect(ids(res.body)).not.toContain(rB.id);
  });

  it('(14) PATCH { isActive: false, name: <same> } on an active route → 200 and the route is still active (red if PATCH /api/routes accepts isActive)', async () => {
    const r = await mkRouteA();
    expect((await routeRow(r.id)).isActive).toBe(true);

    const res = await adminA.patch(`/api/routes/${r.id}`).send({ isActive: false, name: r.name });
    expect(res.status).toBe(200);
    const row = await routeRow(r.id);
    expect(row.isActive).toBe(true);
    expect(row.name).toBe(r.name);
  });

  it('(15) PATCH { name } or { driverId } on an archived route → 409, name, driver and isActive unchanged (red if PATCH can edit an archived route)', async () => {
    const r = await mkRouteA({ isActive: false });
    const before = await routeRow(r.id);
    expect(before.isActive).toBe(false);
    expect(before.driverId).toBeNull();

    for (const body of [{ name: 'x' }, { driverId: h.ids.driverA }]) {
      const res = await adminA.patch(`/api/routes/${r.id}`).send(body);
      expect(res.status, JSON.stringify(body)).toBe(409);
      expect(res.body).toEqual({ message: 'Restore the route before editing it.' });
      const row = await routeRow(r.id);
      expect(row.name).toBe(before.name);
      expect(row.driverId).toBeNull();
      expect(row.isActive).toBe(false);
    }
  });

  it('(16) an archived route still carrying driverA (bad data) is not in driverA\'s GET /api/routes (red if the driver route list shows archived routes)', async () => {
    const r = await mkRouteA({ isActive: false });
    try {
      await h.db.update(routes).set({ driverId: h.ids.driverA }).where(eq(routes.id, r.id));
      // Preconditions: the bad row points at driverA; driverA's list works (routeA).
      const row = await routeRow(r.id);
      expect(row.driverId).toBe(h.ids.driverA);
      expect(row.isActive).toBe(false);

      const res = await driverA.get('/api/routes');
      expect(res.status).toBe(200);
      expect(ids(res.body)).toContain(h.ids.routeA);
      expect(ids(res.body)).not.toContain(r.id);
    } finally {
      await h.db.update(routes).set({ driverId: null }).where(eq(routes.id, r.id));
    }
  });
});

// Q172: an archived route is read-only. An admin's write onto their OWN
// archived route → 409 ARCHIVED, nothing written. Tenant checks run first, so
// company B's route (archived or not) is still 404, never 409.
const studentRow = async (id: string) => (await h.db.select().from(students).where(eq(students.id, id)))[0];
const stopsOf = async (routeId: string) => h.db.select().from(routeStops).where(eq(routeStops.routeId, routeId));
const schoolOrders = async (routeId: string) =>
  (await h.db.select().from(routeSchools).where(eq(routeSchools.routeId, routeId)).orderBy(asc(routeSchools.order)))
    .map((r) => ({ schoolId: r.schoolId, order: r.order }));
const mkSchool = async (companyId: string) => {
  seq += 1;
  const [s] = await h.db.insert(schools).values({ companyId, name: `Q172-School-${seq}`, address: `${seq} Q172 Rd` }).returning({ id: schools.id });
  createdSchools.push(s.id);
  return s.id;
};
const mkStudentA = async (extra: Partial<typeof students.$inferInsert> = {}) => {
  seq += 1;
  const [st] = await h.db.insert(students).values({
    companyId: h.ids.companyA, firstName: `A-Q172-${seq}`, lastName: 'Seed', parentId: h.ids.parentA, schoolId: h.ids.schoolA, ...extra,
  }).returning();
  createdStudents.push(st.id);
  return st;
};
const archivedA = async () => {
  const r = await mkRouteA({ isActive: false });
  expect((await routeRow(r.id)).isActive).toBe(false);
  return r;
};
const archivedB = async () => {
  const r = await mkRoute(h.ids.companyB, h.ids.schoolB, { isActive: false });
  const row = await routeRow(r.id);
  expect(row.companyId).toBe(h.ids.companyB);
  expect(row.isActive).toBe(false);
  return r;
};

describe('Q172 students on an archived route', () => {
  it('(17) POST /api/students with an own archived routeId → 409, no student written (red if checkStudentForeignKeys drops the archived-route 409)', async () => {
    const r = await archivedA();
    const res = await adminA.post('/api/students').send({
      firstName: 'A-Q172-Post', lastName: 'Seed', parentId: h.ids.parentA, routeId: r.id,
    });
    expect(res.status).toBe(409);
    expect(res.body).toEqual(ARCHIVED);
    expect(await h.db.select().from(students).where(eq(students.firstName, 'A-Q172-Post'))).toHaveLength(0);
  });

  it('(18) PUT /api/students/:id moving a student onto an own archived route → 409, it keeps its old route (red if checkStudentForeignKeys drops the archived-route 409)', async () => {
    const r = await archivedA();
    const st = await mkStudentA({ routeId: h.ids.routeA });
    expect((await studentRow(st.id)).routeId).toBe(h.ids.routeA);

    const res = await adminA.put(`/api/students/${st.id}`).send({ routeId: r.id });
    expect(res.status).toBe(409);
    expect(res.body).toEqual(ARCHIVED);
    expect((await studentRow(st.id)).routeId).toBe(h.ids.routeA);
  });

  it('(18b) PUT a name change carrying the unchanged archived routeId/stopId on an inactive student → 200, name saved (red if the unchanged-routeId skip is removed)', async () => {
    const r = await archivedA();
    const [stop] = await stopsOf(r.id);
    const st = await mkStudentA({ routeId: r.id, stopId: stop.id, isActive: false });
    expect(await studentRow(st.id)).toMatchObject({ routeId: r.id, stopId: stop.id, isActive: false });

    const res = await adminA.put(`/api/students/${st.id}`).send({ firstName: 'A-Q172-Renamed', routeId: r.id, stopId: stop.id });
    expect(res.status).toBe(200);
    expect(await studentRow(st.id)).toMatchObject({ firstName: 'A-Q172-Renamed', routeId: r.id, isActive: false });
  });

  it('(18c) PUT isActive: true on an inactive student whose (unchanged) route is archived → 409, still inactive (red if reactivating a student on an archived route is allowed)', async () => {
    const r = await archivedA();
    const st = await mkStudentA({ routeId: r.id, isActive: false });
    expect((await studentRow(st.id)).isActive).toBe(false);

    for (const body of [{ isActive: true }, { isActive: true, routeId: r.id }]) {
      const res = await adminA.put(`/api/students/${st.id}`).send(body);
      expect(res.status, JSON.stringify(body)).toBe(409);
      expect(res.body).toEqual(ARCHIVED);
      expect((await studentRow(st.id)).isActive).toBe(false);
    }
  });

  it("(19) a stopId on an own archived route → 409; a stopId on company B's archived route → 404 (red if the stop branch of checkStudentForeignKeys drops the archived check)", async () => {
    const rA = await archivedA();
    const rB = await archivedB();
    const [stopA] = await stopsOf(rA.id);
    const [stopB] = await stopsOf(rB.id);

    const own = await adminA.post('/api/students').send({ firstName: 'A-Q172-StopA', lastName: 'Seed', parentId: h.ids.parentA, stopId: stopA.id });
    expect(own.status).toBe(409);
    expect(own.body).toEqual(ARCHIVED);
    const foreign = await adminA.post('/api/students').send({ firstName: 'A-Q172-StopB', lastName: 'Seed', parentId: h.ids.parentA, stopId: stopB.id });
    expect(foreign.status).toBe(404);
    expect(foreign.body).toEqual({ message: 'Stop not found' });
    expect(await h.db.select().from(students).where(like(students.firstName, 'A-Q172-Stop%'))).toHaveLength(0);
  });

  it("(20) X-1 mask: adminA POST /api/students with company B's ARCHIVED routeId → 404 \"Route not found\", not 409 (red if the archived check runs before the tenant check)", async () => {
    const rB = await archivedB();
    const res = await adminA.post('/api/students').send({
      firstName: 'A-Q172-Mask', lastName: 'Seed', parentId: h.ids.parentA, routeId: rB.id,
    });
    expect(res.status).toBe(404);
    expect(res.body).toEqual(ROUTE_404);
    expect(await h.db.select().from(students).where(eq(students.firstName, 'A-Q172-Mask'))).toHaveLength(0);
  });
});

describe('Q172 route parts on an archived route', () => {
  it("(21) POST /api/routes/:archived/stops → 409, no stop; company B's archived route → 404 (red if POST route stops drops the archived check)", async () => {
    const rA = await archivedA();
    const rB = await archivedB();
    const body = { name: 'Q172-Stop', address: '1 Q172 Way', order: 2 };

    const own = await adminA.post(`/api/routes/${rA.id}/stops`).send(body);
    expect(own.status).toBe(409);
    expect(own.body).toEqual(ARCHIVED);
    expect(await stopsOf(rA.id)).toHaveLength(1);
    const foreign = await adminA.post(`/api/routes/${rB.id}/stops`).send(body);
    expect(foreign.status).toBe(404);
    expect(foreign.body).toEqual(ROUTE_404);
    expect(await stopsOf(rB.id)).toHaveLength(1);
  });

  it("(22) POST /api/routes/:archived/schools/:school → 409, no route_schools row and no stop; company B's archived route → 404 (red if POST route-schools drops the archived check)", async () => {
    const rA = await archivedA();
    const rB = await archivedB();
    const schoolA2 = await mkSchool(h.ids.companyA);
    const schoolB2 = await mkSchool(h.ids.companyB);

    const own = await adminA.post(`/api/routes/${rA.id}/schools/${schoolA2}`).send({});
    expect(own.status).toBe(409);
    expect(own.body).toEqual(ARCHIVED);
    expect(await schoolOrders(rA.id)).toEqual([{ schoolId: h.ids.schoolA, order: 0 }]);
    expect(await stopsOf(rA.id)).toHaveLength(1);
    const foreign = await adminA.post(`/api/routes/${rB.id}/schools/${schoolB2}`).send({});
    expect(foreign.status).toBe(404);
    expect(foreign.body).toEqual(ROUTE_404);
    expect(await schoolOrders(rB.id)).toEqual([{ schoolId: h.ids.schoolB, order: 0 }]);
  });

  it("(23) PUT /api/routes/:archived/schools/reorder → 409, orders unchanged 0/5; company B's archived route → 404 (red if the reorder PUT drops the archived check)", async () => {
    const rA = await archivedA();
    const rB = await archivedB();
    const schoolA2 = await mkSchool(h.ids.companyA);
    const schoolB2 = await mkSchool(h.ids.companyB);
    await h.db.insert(routeSchools).values([
      { routeId: rA.id, schoolId: schoolA2, order: 5 },
      { routeId: rB.id, schoolId: schoolB2, order: 5 },
    ]);
    const before = (s2: string, s1: string) => [{ schoolId: s1, order: 0 }, { schoolId: s2, order: 5 }];
    expect(await schoolOrders(rA.id)).toEqual(before(schoolA2, h.ids.schoolA));

    const own = await adminA.put(`/api/routes/${rA.id}/schools/reorder`).send({ schoolId: schoolA2, direction: 'up' });
    expect(own.status).toBe(409);
    expect(own.body).toEqual(ARCHIVED);
    expect(await schoolOrders(rA.id)).toEqual(before(schoolA2, h.ids.schoolA));
    const foreign = await adminA.put(`/api/routes/${rB.id}/schools/reorder`).send({ schoolId: schoolB2, direction: 'up' });
    expect(foreign.status).toBe(404);
    expect(foreign.body).toEqual(ROUTE_404);
    expect(await schoolOrders(rB.id)).toEqual(before(schoolB2, h.ids.schoolB));
  });

  it("(24) DELETE /api/routes/:archived/schools/:school → 409, the row stays; company B's archived route → 404 (red if DELETE route-school drops the archived check)", async () => {
    const rA = await archivedA();
    const rB = await archivedB();

    const own = await adminA.delete(`/api/routes/${rA.id}/schools/${h.ids.schoolA}`).send({});
    expect(own.status).toBe(409);
    expect(own.body).toEqual(ARCHIVED);
    expect(await schoolOrders(rA.id)).toEqual([{ schoolId: h.ids.schoolA, order: 0 }]);
    const foreign = await adminA.delete(`/api/routes/${rB.id}/schools/${h.ids.schoolB}`).send({});
    expect(foreign.status).toBe(404);
    expect(foreign.body).toEqual(ROUTE_404);
    expect(await schoolOrders(rB.id)).toEqual([{ schoolId: h.ids.schoolB, order: 0 }]);
  });
});

describe('Q172 alerts on an archived route', () => {
  it("(25) POST /api/notifications with an own archived routeId → 409, no row; company B's archived routeId → 404 (red if POST /api/notifications drops the archived check)", async () => {
    const rA = await archivedA();
    const rB = await archivedB();
    const send = (routeId: string, title: string) =>
      adminA.post('/api/notifications').send({ type: 'delay', title, message: 'Q172 body', routeId, isGlobal: false });

    const own = await send(rA.id, 'Q172-Alert-Own');
    expect(own.status).toBe(409);
    expect(own.body).toEqual(ARCHIVED);
    const foreign = await send(rB.id, 'Q172-Alert-Foreign');
    expect(foreign.status).toBe(404);
    expect(foreign.body).toEqual(ROUTE_404);
    expect(await h.db.select().from(parentNotifications).where(like(parentNotifications.title, 'Q172-Alert-%'))).toHaveLength(0);
  });

  it("(26) POST /api/system-notifications with an own archived routeId → 409, no row; company B's archived routeId → 404 (red if POST /api/system-notifications drops the archived check)", async () => {
    const rA = await archivedA();
    const rB = await archivedB();
    const send = (routeId: string, title: string) =>
      adminA.post('/api/system-notifications').send({ type: 'info', title, message: 'Q172 body', recipientRole: 'route_parents', routeId });

    const own = await send(rA.id, 'Q172-System-Own');
    expect(own.status).toBe(409);
    expect(own.body).toEqual(ARCHIVED);
    const foreign = await send(rB.id, 'Q172-System-Foreign');
    expect(foreign.status).toBe(404);
    expect(foreign.body).toEqual(ROUTE_404);
    expect(await h.db.select().from(systemNotifications).where(like(systemNotifications.title, 'Q172-System-%'))).toHaveLength(0);
  });
});

describe('Q172 create is active, bus link skips archived', () => {
  it('(27) POST /api/routes { isActive: false, driverId } → success and the new route is active (red if insertRouteSchema keeps isActive)', async () => {
    const res = await adminA.post('/api/routes').send({ name: 'Q172-Created', isActive: false, driverId: h.ids.driverA2 });
    expect([200, 201]).toContain(res.status);
    expect(res.body.id).toBeTruthy();
    createdRoutes.push(res.body.id);
    const row = await routeRow(res.body.id);
    expect(row.companyId).toBe(h.ids.companyA);
    expect(row.driverId).toBe(h.ids.driverA2);
    expect(row.isActive).toBe(true);
  });

  it('(28) bus PATCH: driverA on duty with an archived assignedRouteId (bad data), assign driverA to busA → busA currentRouteId null (red if the bus PATCH route link drops isActive !== false)', async () => {
    const r = await archivedA();
    try {
      await h.db.update(users).set({ isOnDuty: true, dutyStartTime: new Date(), assignedRouteId: r.id }).where(eq(users.id, h.ids.driverA));
      await h.db.update(buses).set({ driverId: null, currentRouteId: null }).where(eq(buses.id, h.ids.busA));
      expect(await userRow(h.ids.driverA)).toMatchObject({ isOnDuty: true, assignedRouteId: r.id, companyId: h.ids.companyA });

      const res = await adminA.patch(`/api/buses/${h.ids.busA}`).send({ driverId: h.ids.driverA });
      expect(res.status).toBe(200);
      const [bA] = await h.db.select().from(buses).where(eq(buses.id, h.ids.busA));
      expect(bA.driverId).toBe(h.ids.driverA);
      expect(bA.currentRouteId).toBeNull();
    } finally {
      await restoreDriverA();
    }
  });
});

// Q168: a blank Route / School / Stop select sends "" — it must mean "none"
// (null), not a 500 from the foreign key.
describe('Q168 blank route, school and stop', () => {
  it('(29) POST /api/students with routeId "" and schoolId "" → 201, both stored as null (red if insertStudentSchema stops turning "" into null)', async () => {
    const res = await adminA.post('/api/students').send({
      firstName: 'A-Q168-Post', lastName: 'Seed', parentId: h.ids.parentA, routeId: '', schoolId: '', stopId: '',
    });
    expect(res.status).toBe(201);
    const [row] = await h.db.select().from(students).where(eq(students.firstName, 'A-Q168-Post'));
    expect(row).toBeDefined();
    expect(row.companyId).toBe(h.ids.companyA);
    expect(row.routeId).toBeNull();
    expect(row.schoolId).toBeNull();
    expect(row.stopId).toBeNull();
  });

  it('(30) PUT { routeId: "" } on a student on routeA → 200 and the route is cleared (red if insertStudentSchema stops turning "" into null)', async () => {
    seq += 1;
    const [st] = await h.db.insert(students).values({
      companyId: h.ids.companyA, firstName: `A-Q168-${seq}`, lastName: 'Seed', parentId: h.ids.parentA, schoolId: h.ids.schoolA, routeId: h.ids.routeA,
    }).returning();
    createdStudents.push(st.id);
    expect((await studentRow(st.id)).routeId).toBe(h.ids.routeA);

    const res = await adminA.put(`/api/students/${st.id}`).send({ routeId: '', schoolId: '' });
    expect(res.status).toBe(200);
    const row = await studentRow(st.id);
    expect(row.routeId).toBeNull();
    expect(row.schoolId).toBeNull();
  });
});

describe('Q172b student PUT on archived routes', () => {
  it("(31) PUT moving a student onto company B's ARCHIVED route → 404 \"Route not found\", still on routeA (red if the archived check runs before the tenant check on PUT)", async () => {
    const rB = await archivedB();
    const st = await mkStudentA({ routeId: h.ids.routeA });
    expect((await studentRow(st.id)).routeId).toBe(h.ids.routeA);

    const res = await adminA.put(`/api/students/${st.id}`).send({ routeId: rB.id });
    expect(res.status).toBe(404);
    expect(res.body).toEqual(ROUTE_404);
    expect((await studentRow(st.id)).routeId).toBe(h.ids.routeA);
  });

  it('(32) PUT a new stop on the same (unchanged) archived route → 409, stop unchanged (red if the unchanged-stop skip is widened to the route)', async () => {
    const r = await archivedA();
    const [stop1] = await stopsOf(r.id);
    const [stop2] = await h.db.insert(routeStops).values({ routeId: r.id, schoolId: h.ids.schoolA, name: 'Q172b-Stop2', address: '2 Q172b St', order: 2 }).returning();
    const st = await mkStudentA({ routeId: r.id, stopId: stop1.id, isActive: false });
    expect(await studentRow(st.id)).toMatchObject({ routeId: r.id, stopId: stop1.id });

    const res = await adminA.put(`/api/students/${st.id}`).send({ routeId: r.id, stopId: stop2.id });
    expect(res.status).toBe(409);
    expect(res.body).toEqual(ARCHIVED);
    expect((await studentRow(st.id)).stopId).toBe(stop1.id);
  });

  it('(33) PUT isActive: true on an inactive student with no route but a stop on an own archived route → 409, still inactive (red if the reactivation stop check is removed)', async () => {
    const r = await archivedA();
    const [stop] = await stopsOf(r.id);
    const st = await mkStudentA({ routeId: null, stopId: stop.id, isActive: false });
    expect(await studentRow(st.id)).toMatchObject({ routeId: null, stopId: stop.id, isActive: false });

    const res = await adminA.put(`/api/students/${st.id}`).send({ isActive: true });
    expect(res.status).toBe(409);
    expect(res.body).toEqual(ARCHIVED);
    expect((await studentRow(st.id)).isActive).toBe(false);
  });

  it('(34) PUT { firstName, isActive: true } on an already-active student on an archived route (bad data) → 200 (red if the reactivation gate on existingStudent.isActive is removed)', async () => {
    const r = await archivedA();
    const st = await mkStudentA({ routeId: r.id, isActive: true });
    expect(await studentRow(st.id)).toMatchObject({ routeId: r.id, isActive: true });

    const res = await adminA.put(`/api/students/${st.id}`).send({ firstName: 'A-Q172-StillActive', isActive: true });
    expect(res.status).toBe(200);
    expect(await studentRow(st.id)).toMatchObject({ firstName: 'A-Q172-StillActive', isActive: true });
  });

  it("(35) mask: reactivating a student whose stop is on company B's archived route (bad data) is not refused with 409 (red if the stop check uses a lookup without the company)", async () => {
    const rB = await archivedB();
    const [stopB] = await stopsOf(rB.id);
    const st = await mkStudentA({ routeId: null, stopId: stopB.id, isActive: false });
    expect(await studentRow(st.id)).toMatchObject({ routeId: null, stopId: stopB.id, isActive: false });

    const res = await adminA.put(`/api/students/${st.id}`).send({ isActive: true });
    expect(res.status).not.toBe(409);
    expect(res.status).toBe(200);
    expect(JSON.stringify(res.body)).not.toContain('archived');
  });
});
