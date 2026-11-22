// Q149: the admin bus-location simulator works only where GPS_SIMULATOR_ENABLED
// is "true" (staging). setup.ts turns it ON for every integration file; this
// file stubs it off per test. Real HTTP + real Postgres; each title names the
// guard clause whose deletion turns it red.
import { describe, it, expect, beforeAll, afterAll, afterEach, vi } from 'vitest';
import { eq } from 'drizzle-orm';
import { buses } from '@shared/schema';
import { useIntegrationHarness, type Agent } from './harness';

const h = useIntegrationHarness();
const MOVE = { latitude: '40.3', longitude: '-75.3', speed: '10' }; // the simulator sends strings

let adminA: Agent;
let driverA: Agent;

type SavedBus = { status: string | null; currentLatitude: string | null; currentLongitude: string | null; speed: string | null };
let savedBusA: SavedBus | undefined;

const busRow = async (id: string) => (await h.db.select().from(buses).where(eq(buses.id, id)))[0];
const KNOWN = { currentLatitude: '41.00000000', currentLongitude: '-76.00000000', speed: '5.00' };

beforeAll(async () => {
  const b = await busRow(h.ids.busA);
  savedBusA = { status: b.status, currentLatitude: b.currentLatitude, currentLongitude: b.currentLongitude, speed: b.speed };
  // 2 logins (MAX_LOGINS_PER_FILE is 8).
  adminA = await h.loginAs('adminA');
  driverA = await h.loginAs('driverA');
});

afterEach(() => {
  vi.unstubAllEnvs();
});

afterAll(async () => {
  if (savedBusA) await h.db.update(buses).set(savedBusA).where(eq(buses.id, h.ids.busA));
});

describe('Q149 PUT /api/buses/:busId/location is off unless GPS_SIMULATOR_ENABLED=true', () => {
  it('flag off: adminA moving its own busA → 404 "Not found", busA unchanged (red if the gpsSimulatorEnabled() check is removed from PUT /api/buses/:busId/location)', async () => {
    await h.db.update(buses).set(KNOWN).where(eq(buses.id, h.ids.busA));
    // Preconditions: adminA's own company's bus, so the role gate and tenant check both pass.
    expect((await busRow(h.ids.busA)).companyId).toBe(h.ids.companyA);
    vi.stubEnv('GPS_SIMULATOR_ENABLED', 'false');

    const res = await adminA.put(`/api/buses/${h.ids.busA}/location`).send(MOVE);
    expect(res.status).toBe(404);
    expect(res.body).toEqual({ message: 'Not found' });
    const bus = await busRow(h.ids.busA);
    expect(bus.currentLatitude).toBe(KNOWN.currentLatitude);
    expect(bus.currentLongitude).toBe(KNOWN.currentLongitude);
    expect(bus.speed).toBe(KNOWN.speed);
  });

  it('flag on: adminA moving busA → 200 and the new lat/lng are stored (positive control)', async () => {
    vi.stubEnv('GPS_SIMULATOR_ENABLED', 'true');
    const res = await adminA.put(`/api/buses/${h.ids.busA}/location`).send(MOVE);
    expect(res.status).toBe(200);
    const bus = await busRow(h.ids.busA);
    expect(Number(bus.currentLatitude)).toBe(40.3);
    expect(Number(bus.currentLongitude)).toBe(-75.3);
  });
});

describe('Q149 GET /api/gps-simulator reports the flag to admins only', () => {
  it('flag off: adminA → 200 { enabled: false }', async () => {
    vi.stubEnv('GPS_SIMULATOR_ENABLED', 'false');
    const res = await adminA.get('/api/gps-simulator');
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ enabled: false });
  });

  it('flag on: adminA → 200 { enabled: true }', async () => {
    vi.stubEnv('GPS_SIMULATOR_ENABLED', 'true');
    const res = await adminA.get('/api/gps-simulator');
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ enabled: true });
  });

  it('driverA → 403 (red if the isAdminRole gate is removed from GET /api/gps-simulator)', async () => {
    vi.stubEnv('GPS_SIMULATOR_ENABLED', 'true');
    const res = await driverA.get('/api/gps-simulator');
    expect(res.status).toBe(403);
    expect(res.body).toEqual({ message: 'Unauthorized - admin required' });
  });
});
