// Q145: PUT /api/buses/:busId/location (the admin GPS simulator) is admin-only
// (isAdminRole: admin, driver_admin, master). A driver, even on duty moving its
// own bus, gets 403; drivers report location via POST /api/driver/update-location.
// The tenant check stays: an impersonating master can't move another company's
// bus (404, masked). Real HTTP + real Postgres; each title names the guard
// clause whose deletion turns it red.
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { eq } from 'drizzle-orm';
import { buses, users } from '@shared/schema';
import { useIntegrationHarness, type Agent } from './harness';

const h = useIntegrationHarness();
const put = (busId: string) => `/api/buses/${busId}/location`;
const MOVE = { latitude: '40.3', longitude: '-75.3', speed: '10' }; // the simulator sends strings

let driverA: Agent;
let master: Agent;
let adminA: Agent;

type SavedBus = { status: string | null; currentLatitude: string | null; currentLongitude: string | null; speed: string | null };
let savedDriver: { isOnDuty: boolean | null; dutyStartTime: Date | null; assignedRouteId: string | null } | undefined;
const savedBuses: Record<string, SavedBus> = {};

const busRow = async (id: string) => (await h.db.select().from(buses).where(eq(buses.id, id)))[0];
const KNOWN = { currentLatitude: '41.00000000', currentLongitude: '-76.00000000', speed: '5.00' };
const seedKnown = (id: string) => h.db.update(buses).set(KNOWN).where(eq(buses.id, id));
const expectKnown = async (id: string) => {
  const bus = await busRow(id);
  expect(bus.currentLatitude).toBe(KNOWN.currentLatitude);
  expect(bus.currentLongitude).toBe(KNOWN.currentLongitude);
  expect(bus.speed).toBe(KNOWN.speed);
};

beforeAll(async () => {
  // Capture what this file changes before changing anything.
  const [driver] = await h.db.select().from(users).where(eq(users.id, h.ids.driverA));
  savedDriver = { isOnDuty: driver.isOnDuty, dutyStartTime: driver.dutyStartTime, assignedRouteId: driver.assignedRouteId };
  for (const id of [h.ids.busA, h.ids.busB]) {
    const b = await busRow(id);
    savedBuses[id] = { status: b.status, currentLatitude: b.currentLatitude, currentLongitude: b.currentLongitude, speed: b.speed };
  }

  // 3 logins (MAX_LOGINS_PER_FILE is 8).
  driverA = await h.loginAs('driverA');
  master = await h.loginAs('master');
  adminA = await h.loginAs('adminA');
});

afterAll(async () => {
  if (savedDriver) await h.db.update(users).set(savedDriver).where(eq(users.id, h.ids.driverA));
  for (const [id, saved] of Object.entries(savedBuses)) {
    if (saved) await h.db.update(buses).set(saved).where(eq(buses.id, id));
  }
});

describe('Q145 PUT /api/buses/:busId/location is admin-only', () => {
  it('driver on duty moving its own bus → 403 (red if the PUT bus-location gate goes back to isDriverRole || isAdminRole)', async () => {
    await h.db.update(users).set({ isOnDuty: true, dutyStartTime: new Date(), assignedRouteId: h.ids.routeA }).where(eq(users.id, h.ids.driverA));
    await seedKnown(h.ids.busA);
    // Preconditions: its own bus, its own company, on duty, so only the role clause can refuse.
    const bus = await busRow(h.ids.busA);
    expect(bus.driverId).toBe(h.ids.driverA);
    expect(bus.companyId).toBe(h.ids.companyA);
    const [driver] = await h.db.select().from(users).where(eq(users.id, h.ids.driverA));
    expect(driver).toMatchObject({ isOnDuty: true, companyId: h.ids.companyA, role: 'driver' });

    const res = await driverA.put(put(h.ids.busA)).send(MOVE);
    expect(res.status).toBe(403);
    expect(res.body).toEqual({ message: 'Unauthorized - admin required' });
    await expectKnown(h.ids.busA);
  });

  it('a master impersonating company A moving company B\'s busB → 404 "Bus not found", busB unchanged (red if isOutsideCallerTenant(user, existingBus.companyId) is removed from the PUT bus-location handler)', async () => {
    await seedKnown(h.ids.busB);
    expect((await busRow(h.ids.busB)).companyId).toBe(h.ids.companyB);
    try {
      const imp = await master.post(`/api/master-admin/impersonate/${h.ids.companyA}`).send({});
      expect(imp.status).toBe(200);
      const res = await master.put(put(h.ids.busB)).send(MOVE);
      expect(res.status).toBe(404);
      expect(res.body).toEqual({ message: 'Bus not found' });
      await expectKnown(h.ids.busB);
    } finally {
      await master.post('/api/master-admin/stop-impersonating').send({});
    }
  });

  it('adminA moving busA → 200 and the new lat/lng are stored (positive control)', async () => {
    await seedKnown(h.ids.busA);
    const res = await adminA.put(put(h.ids.busA)).send(MOVE);
    expect(res.status).toBe(200);
    const bus = await busRow(h.ids.busA);
    expect(Number(bus.currentLatitude)).toBe(40.3);
    expect(Number(bus.currentLongitude)).toBe(-75.3);
  });
});
