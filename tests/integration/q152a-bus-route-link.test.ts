// Q152a: buses.currentRouteId (the only way a parent's children-buses card
// finds the bus) follows the route the driver is running. activate-route links
// the driver's own bus to the in-tenant shift route (null when the shift route
// is missing or foreign), off duty clears the link (unassignDriverFromBus), and
// check-in clears the route from every other bus of the company.
// Real HTTP + real Postgres. Each title names the clause whose deletion turns
// it red. Seed: parentA is studentA's parent (students.parentId plus a
// parentChildLinks row), studentA rides routeA; parentB's studentB rides routeB.
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { and, eq, notInArray } from 'drizzle-orm';
import { buses, busJourneys, driverShiftReports, routes, students, users } from '@shared/schema';
import { useIntegrationHarness, type Agent } from './harness';

const h = useIntegrationHarness();
const ACTIVATE = '/api/driver/activate-route';
const CHILD_BUSES = '/api/parent/children-buses';

let driverA: Agent;
let parentA: Agent;
let parentB: Agent;

// What this file changes, captured before it changes anything (restored in afterAll).
type SavedDriver = {
  isOnDuty: boolean | null; dutyStartTime: Date | null; assignedRouteId: string | null;
  lastCheckInFuelLevel: string | null; lastCheckInInteriorClean: boolean | null;
  lastCheckInExteriorClean: boolean | null; lastCheckInTime: Date | null;
};
type SavedBus = { driverId: string | null; status: string | null; currentRouteId: string | null; fuelLevel: string | null };
let savedDriver: SavedDriver | undefined;
let savedBus: SavedBus | undefined;
let savedShiftIds: string[] = [];
let savedJourneyIds: string[] = [];

const busRow = async (id: string) => (await h.db.select().from(buses).where(eq(buses.id, id)))[0];
// driverA on duty, running routeA, driving busA; busA's link set to `link`.
const startState = async (link: string | null, shiftRoute: string = h.ids.routeA) => {
  await h.db.update(users)
    .set({ isOnDuty: true, dutyStartTime: new Date(), assignedRouteId: shiftRoute })
    .where(eq(users.id, h.ids.driverA));
  await h.db.update(buses)
    .set({ driverId: h.ids.driverA, status: 'idle', currentRouteId: link })
    .where(eq(buses.id, h.ids.busA));
};
const busFor = (body: any[], studentId: string) => body.find((c) => c.student?.id === studentId)?.bus ?? null;

beforeAll(async () => {
  const bus = await busRow(h.ids.busA);
  expect(bus.driverId).toBe(h.ids.driverA);
  const [d] = await h.db.select().from(users).where(eq(users.id, h.ids.driverA));
  savedDriver = {
    isOnDuty: d.isOnDuty, dutyStartTime: d.dutyStartTime, assignedRouteId: d.assignedRouteId,
    lastCheckInFuelLevel: d.lastCheckInFuelLevel, lastCheckInInteriorClean: d.lastCheckInInteriorClean,
    lastCheckInExteriorClean: d.lastCheckInExteriorClean, lastCheckInTime: d.lastCheckInTime,
  };
  savedBus = { driverId: bus.driverId, status: bus.status, currentRouteId: bus.currentRouteId, fuelLevel: bus.fuelLevel };
  savedShiftIds = (await h.db.select({ id: driverShiftReports.id }).from(driverShiftReports)).map((r) => r.id);
  savedJourneyIds = (await h.db.select({ id: busJourneys.id }).from(busJourneys)).map((r) => r.id);
  // 3 logins (MAX_LOGINS_PER_FILE is 8).
  driverA = await h.loginAs('driverA');
  parentA = await h.loginAs('parentA');
  parentB = await h.loginAs('parentB');
});

afterAll(async () => {
  // Rows this file's off-duty / check-in calls created (shift report, journey).
  const newShifts = savedShiftIds.length
    ? and(eq(driverShiftReports.driverId, h.ids.driverA), notInArray(driverShiftReports.id, savedShiftIds))
    : eq(driverShiftReports.driverId, h.ids.driverA);
  await h.db.delete(driverShiftReports).where(newShifts);
  const newJourneys = savedJourneyIds.length
    ? and(eq(busJourneys.busId, h.ids.busA), notInArray(busJourneys.id, savedJourneyIds))
    : eq(busJourneys.busId, h.ids.busA);
  await h.db.delete(busJourneys).where(newJourneys);
  if (savedDriver) await h.db.update(users).set(savedDriver).where(eq(users.id, h.ids.driverA));
  if (savedBus) await h.db.update(buses).set(savedBus).where(eq(buses.id, h.ids.busA));
});

describe('Q152a the bus-route link follows the driver', () => {
  it('activate-route links busA to the shift route routeA, and parentA sees busA for studentA (red if activate-route stops writing currentRouteId: user.assignedRouteId)', async () => {
    await startState(null);
    const before = await parentA.get(CHILD_BUSES);
    expect(before.status).toBe(200);
    expect(busFor(before.body, h.ids.studentA)).toBeNull();

    const res = await driverA.post(ACTIVATE).send({});
    expect(res.status).toBe(200);
    expect(res.body.busId).toBe(h.ids.busA);
    const bus = await busRow(h.ids.busA);
    expect(bus.currentRouteId).toBe(h.ids.routeA);
    expect(bus.status).toBe('on_route');

    const after = await parentA.get(CHILD_BUSES);
    expect(after.status).toBe(200);
    expect(busFor(after.body, h.ids.studentA)?.id).toBe(h.ids.busA);
  });

  it('off duty clears busA\'s link, and parentA sees no bus for studentA (red if unassignDriverFromBus stops clearing currentRouteId)', async () => {
    await startState(h.ids.routeA);
    const linked = await parentA.get(CHILD_BUSES);
    expect(busFor(linked.body, h.ids.studentA)?.id).toBe(h.ids.busA);

    const res = await driverA.patch('/api/driver/duty-status').send({ isOnDuty: false });
    expect(res.status).toBe(200);
    expect(res.body.isOnDuty).toBe(false);
    expect((await busRow(h.ids.busA)).currentRouteId).toBeNull();

    const after = await parentA.get(CHILD_BUSES);
    expect(after.status).toBe(200);
    expect(busFor(after.body, h.ids.studentA)).toBeNull();
  });

  it('check-in with busA + routeA clears routeA from the other company-A bus (red if check-in stops clearing other buses on the same route)', async () => {
    await startState(h.ids.routeA);
    const [other] = await h.db.insert(buses)
      .values({ companyId: h.ids.companyA, busNumber: 'A-Q152A', make: 'A-Make', currentRouteId: h.ids.routeA })
      .returning({ id: buses.id });
    try {
      const res = await driverA.post('/api/driver-check-in').send({
        driverId: h.ids.driverA, routeId: h.ids.routeA, busId: h.ids.busA,
        fuelLevel: 'Full', interiorClean: true, exteriorClean: true,
      });
      expect(res.status).toBe(200);
      expect((await busRow(other.id)).currentRouteId).toBeNull();
      expect((await busRow(h.ids.busA)).currentRouteId).toBe(h.ids.routeA);
      // Company B's bus keeps its own route (the clear is company-scoped).
      expect((await busRow(h.ids.busB)).currentRouteId).toBe(h.ids.routeB);
    } finally {
      await h.db.delete(buses).where(eq(buses.id, other.id));
    }
  });

  it('X-1: a foreign shift route (routeB, bad data) → activate-route writes no link, and parentB never sees busA (red if shiftRouteInTenant(user) is removed from the activate-route link write)', async () => {
    try {
      // Preconditions: routeB really is company B's, and parentB's studentB
      // rides it, so "parentB never sees busA" below is not vacuous.
      const [rB] = await h.db.select().from(routes).where(eq(routes.id, h.ids.routeB));
      expect(rB.companyId).toBe(h.ids.companyB);
      const [sB] = await h.db.select().from(students).where(eq(students.id, h.ids.studentB));
      expect(sB.routeId).toBe(h.ids.routeB);
      expect(sB.companyId).toBe(h.ids.companyB);

      await startState(null, h.ids.routeB);
      const res = await driverA.post(ACTIVATE).send({});
      expect(res.status).toBe(200);
      const bus = await busRow(h.ids.busA);
      expect(bus.currentRouteId).not.toBe(h.ids.routeB);
      expect(bus.currentRouteId).toBeNull();

      const b = await parentB.get(CHILD_BUSES);
      expect(b.status).toBe(200);
      expect(JSON.stringify(b.body)).not.toContain(h.ids.busA);
    } finally {
      await startState(savedBus?.currentRouteId ?? null);
    }
  });

  it('check-in never clears another company\'s bus link (red if eq(buses.companyId, companyId) is removed from clearRouteFromOtherBuses)', async () => {
    const orig = await busRow(h.ids.busB);
    try {
      // Bad data across companies: company B's bus points at company A's routeA.
      await h.db.update(buses).set({ currentRouteId: h.ids.routeA }).where(eq(buses.id, h.ids.busB));
      const before = await busRow(h.ids.busB);
      expect(before.companyId).toBe(h.ids.companyB);
      expect(before.currentRouteId).toBe(h.ids.routeA);

      await startState(h.ids.routeA);
      const res = await driverA.post('/api/driver-check-in').send({
        driverId: h.ids.driverA, routeId: h.ids.routeA, busId: h.ids.busA,
        fuelLevel: 'Full', interiorClean: true, exteriorClean: true,
      });
      expect(res.status).toBe(200);
      expect((await busRow(h.ids.busA)).currentRouteId).toBe(h.ids.routeA);
      expect((await busRow(h.ids.busB)).currentRouteId).toBe(h.ids.routeA);
    } finally {
      await h.db.update(buses)
        .set({ currentRouteId: orig.currentRouteId, status: orig.status })
        .where(eq(buses.id, h.ids.busB));
    }
  });
});
