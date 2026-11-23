// Q160: when an admin changes a bus's driver (PATCH /api/buses/:id), the route
// link (buses.currentRouteId) follows the driver. The bus the driver left is
// unlinked; the bus an on-duty driver now holds carries their shift route, with
// exactly one bus of that company on it (clearRouteFromOtherBuses). The link is
// written only for a route whose (non-null) company equals the bus's, and an
// unchanged driver leaves the link alone. Real HTTP + real Postgres; each title
// names the clause whose deletion turns it red, and each test asserts its
// preconditions (and any foreign row) first (X-1/X-2).
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { eq } from 'drizzle-orm';
import { buses, routes, users } from '@shared/schema';
import { useIntegrationHarness, type Agent } from './harness';

const h = useIntegrationHarness();
const patch = (busId: string) => `/api/buses/${busId}`;

let adminA: Agent;
let extraId: string | undefined; // company-A bus this file creates
let extra2Id: string | undefined; // a second company-A bus (the "bad data" duplicate)

type SavedUser = { isOnDuty: boolean | null; dutyStartTime: Date | null; assignedRouteId: string | null };
type SavedBus = { driverId: string | null; status: string | null; currentRouteId: string | null; fuelLevel: string | null; lastUpdated: Date | null };
let savedDriver: SavedUser | undefined;
let savedBusA: SavedBus | undefined;
let savedBusB: SavedBus | undefined;

const busRow = async (id: string) => (await h.db.select().from(buses).where(eq(buses.id, id)))[0];
const userRow = async (id: string) => (await h.db.select().from(users).where(eq(users.id, id)))[0];
const routeRow = async (id: string) => (await h.db.select().from(routes).where(eq(routes.id, id)))[0];
const pickBus = (b: any): SavedBus => ({ driverId: b.driverId, status: b.status, currentRouteId: b.currentRouteId, fuelLevel: b.fuelLevel, lastUpdated: b.lastUpdated });

const setDriver = (fields: Partial<SavedUser>) => h.db.update(users).set(fields).where(eq(users.id, h.ids.driverA));
const setBus = (id: string, fields: Partial<SavedBus>) => h.db.update(buses).set(fields).where(eq(buses.id, id));
const onDuty = (routeId: string) => setDriver({ isOnDuty: true, dutyStartTime: new Date(), assignedRouteId: routeId });

// Start of every test: busA is driverA's bus on routeA; the extra buses are free and unlinked.
const reset = async () => {
  await setBus(h.ids.busA, { driverId: h.ids.driverA, status: 'idle', currentRouteId: h.ids.routeA });
  await setBus(extraId!, { driverId: null, currentRouteId: null });
  await setBus(extra2Id!, { driverId: null, currentRouteId: null });
  if (savedBusB) await setBus(h.ids.busB, savedBusB);
};

beforeAll(async () => {
  savedDriver = (({ isOnDuty, dutyStartTime, assignedRouteId }) => ({ isOnDuty, dutyStartTime, assignedRouteId }))(await userRow(h.ids.driverA));
  savedBusA = pickBus(await busRow(h.ids.busA));
  savedBusB = pickBus(await busRow(h.ids.busB));
  const [e1] = await h.db.insert(buses).values({ companyId: h.ids.companyA, busNumber: 'A-Q160', make: 'A-Make' }).returning({ id: buses.id });
  extraId = e1.id;
  const [e2] = await h.db.insert(buses).values({ companyId: h.ids.companyA, busNumber: 'A-Q160-2', make: 'A-Make' }).returning({ id: buses.id });
  extra2Id = e2.id;
  // 1 login (MAX_LOGINS_PER_FILE is 8).
  adminA = await h.loginAs('adminA');
});

afterAll(async () => {
  try {
    if (savedDriver) await setDriver(savedDriver);
    if (savedBusA) await setBus(h.ids.busA, savedBusA);
    if (savedBusB) await setBus(h.ids.busB, savedBusB);
  } finally {
    if (extraId) await h.db.delete(buses).where(eq(buses.id, extraId));
    if (extra2Id) await h.db.delete(buses).where(eq(buses.id, extra2Id));
  }
});

describe('Q160 PATCH /api/buses/:id moves the route link with the driver', () => {
  it("(1) swap: busA → no driver, the extra bus → on-duty driverA → busA unlinked, the extra bus on routeA (red if the bus PATCH stops linking the new on-duty driver's shift route)", async () => {
    await reset();
    await onDuty(h.ids.routeA);
    const [a, e, d] = [await busRow(h.ids.busA), await busRow(extraId!), await userRow(h.ids.driverA)];
    expect(a).toMatchObject({ driverId: h.ids.driverA, currentRouteId: h.ids.routeA, companyId: h.ids.companyA });
    expect(e).toMatchObject({ driverId: null, currentRouteId: null, companyId: h.ids.companyA });
    expect(d).toMatchObject({ isOnDuty: true, assignedRouteId: h.ids.routeA, companyId: h.ids.companyA });

    const r1 = await adminA.patch(patch(h.ids.busA)).send({ driverId: null });
    expect(r1.status).toBe(200);
    const r2 = await adminA.patch(patch(extraId!)).send({ driverId: h.ids.driverA });
    expect(r2.status).toBe(200);

    expect((await busRow(h.ids.busA)).currentRouteId).toBeNull();
    const bus = await busRow(extraId!);
    expect(bus.driverId).toBe(h.ids.driverA);
    expect(bus.currentRouteId).toBe(h.ids.routeA);
  });

  it('(2) busA linked to routeA, PATCH busA to no driver → busA unlinked (red if the bus PATCH stops clearing the link when the driver changes)', async () => {
    await reset();
    await onDuty(h.ids.routeA);
    expect(await busRow(h.ids.busA)).toMatchObject({ driverId: h.ids.driverA, currentRouteId: h.ids.routeA });

    const res = await adminA.patch(patch(h.ids.busA)).send({ driverId: null });
    expect(res.status).toBe(200);
    const bus = await busRow(h.ids.busA);
    expect(bus.driverId).toBeNull();
    expect(bus.currentRouteId).toBeNull();
  });

  it('(3) a second company-A bus already on routeA (bad data): PATCH the extra bus to on-duty driverA → the second bus is unlinked (red if the bus PATCH stops calling clearRouteFromOtherBuses)', async () => {
    await reset();
    await onDuty(h.ids.routeA);
    await setBus(h.ids.busA, { driverId: null, currentRouteId: null });
    await setBus(extra2Id!, { currentRouteId: h.ids.routeA });
    expect(await busRow(extra2Id!)).toMatchObject({ companyId: h.ids.companyA, currentRouteId: h.ids.routeA });

    const res = await adminA.patch(patch(extraId!)).send({ driverId: h.ids.driverA });
    expect(res.status).toBe(200);
    expect((await busRow(extraId!)).currentRouteId).toBe(h.ids.routeA);
    expect((await busRow(extra2Id!)).currentRouteId).toBeNull();
  });

  it('(4) new driver off duty (shift route routeA) → the bus stays unlinked and no other bus changes (red if the bus PATCH links a route for an off-duty driver)', async () => {
    await reset();
    await setDriver({ isOnDuty: false, dutyStartTime: null, assignedRouteId: h.ids.routeA });
    await setBus(h.ids.busA, { driverId: null, currentRouteId: h.ids.routeA }); // another bus on routeA
    expect((await userRow(h.ids.driverA)).isOnDuty).toBe(false);

    const res = await adminA.patch(patch(extraId!)).send({ driverId: h.ids.driverA });
    expect(res.status).toBe(200);
    const bus = await busRow(extraId!);
    expect(bus.driverId).toBe(h.ids.driverA);
    expect(bus.currentRouteId).toBeNull();
    expect((await busRow(h.ids.busA)).currentRouteId).toBe(h.ids.routeA);
  });

  it("(5) a company-A driver on duty with company B's routeB (bad data) → the company-A bus stays unlinked and busB keeps routeB (red if the bus PATCH stops comparing the route's company with the bus's)", async () => {
    await reset();
    await onDuty(h.ids.routeB);
    await setBus(h.ids.busA, { driverId: null, currentRouteId: null });
    await setBus(h.ids.busB, { currentRouteId: h.ids.routeB });
    expect((await routeRow(h.ids.routeB)).companyId).toBe(h.ids.companyB);
    expect(await busRow(h.ids.busB)).toMatchObject({ companyId: h.ids.companyB, currentRouteId: h.ids.routeB });
    expect(await userRow(h.ids.driverA)).toMatchObject({ companyId: h.ids.companyA, isOnDuty: true, assignedRouteId: h.ids.routeB });

    try {
      const res = await adminA.patch(patch(extraId!)).send({ driverId: h.ids.driverA });
      expect(res.status).toBe(200);
      expect((await busRow(extraId!)).currentRouteId).toBeNull();
      expect((await busRow(h.ids.busB)).currentRouteId).toBe(h.ids.routeB);
    } finally {
      if (savedBusB) await setBus(h.ids.busB, savedBusB);
    }
  });

  it('(6) unchanged driver: busA linked, PATCH busA with only fuelLevel → still linked (red if the bus PATCH touches the link when the driver is unchanged)', async () => {
    await reset();
    await setDriver({ isOnDuty: false, dutyStartTime: null, assignedRouteId: h.ids.routeA });
    expect(await busRow(h.ids.busA)).toMatchObject({ driverId: h.ids.driverA, currentRouteId: h.ids.routeA });

    const res = await adminA.patch(patch(h.ids.busA)).send({ fuelLevel: '75' });
    expect(res.status).toBe(200);
    const bus = await busRow(h.ids.busA);
    expect(bus.fuelLevel).toBe('75');
    expect(bus.driverId).toBe(h.ids.driverA);
    expect(bus.currentRouteId).toBe(h.ids.routeA);
  });
});
