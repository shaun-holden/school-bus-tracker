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
import { eq, inArray } from 'drizzle-orm';
import { attendance, buses, busJourneys, routes, routeSchools, routeStops, students, users } from '@shared/schema';
import { useIntegrationHarness, type Agent } from './harness';

const h = useIntegrationHarness();
const HISTORY_MSG = 'This route has past trips or records. Archive it instead.';

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
  if (createdAttendance.length) await h.db.delete(attendance).where(inArray(attendance.id, createdAttendance));
  if (createdJourneys.length) await h.db.delete(busJourneys).where(inArray(busJourneys.id, createdJourneys));
  if (createdStudents.length) await h.db.delete(students).where(inArray(students.id, createdStudents));
  if (createdBuses.length) await h.db.delete(buses).where(inArray(buses.id, createdBuses));
  await restoreDriverA();
  if (savedDriverA2) await h.db.update(users).set(savedDriverA2).where(eq(users.id, h.ids.driverA2));
  // route_stops and route_schools cascade with the route.
  if (createdRoutes.length) await h.db.delete(routes).where(inArray(routes.id, createdRoutes));
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
