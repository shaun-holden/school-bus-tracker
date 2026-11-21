// Q133: POST /api/driver/update-location range-checks its body (lat ±90,
// lng ±180, speed ±999 to fit numeric(5,2)), so a bad value is a 400 with the
// existing message, never a DB-overflow 500. Speed mapping: omitted keeps the
// stored speed, a negative (iOS invalid GPS speed) is saved as null
// ("unknown"), anything else, 0 included, is saved. Plus the admin GPS
// simulator's PUT /api/buses/:busId/location speed ceiling.
// Real HTTP + real Postgres. Each title names the clause whose deletion turns
// it red.
import { describe, it, expect, beforeAll } from 'vitest';
import { eq } from 'drizzle-orm';
import { buses, users } from '@shared/schema';
import { useIntegrationHarness, type Agent } from './harness';

const h = useIntegrationHarness();
const LOC = '/api/driver/update-location';
const REQUIRED = { message: 'Latitude and longitude are required' };

let driverA: Agent;
let adminA: Agent;

// Copied from q121-125 (file-local there), plus speed in resetBus.
const onDuty = () =>
  h.db.update(users).set({ isOnDuty: true, dutyStartTime: new Date(), assignedRouteId: h.ids.routeA }).where(eq(users.id, h.ids.driverA));
const busRow = async () => (await h.db.select().from(buses).where(eq(buses.id, h.ids.busA)))[0];
const resetBus = () =>
  h.db.update(buses).set({ status: 'idle', currentLatitude: null, currentLongitude: null, speed: null }).where(eq(buses.id, h.ids.busA));
const seedSpeed = () =>
  h.db.update(buses).set({ currentLatitude: '40.00000000', currentLongitude: '-75.00000000', speed: '25.00' }).where(eq(buses.id, h.ids.busA));

beforeAll(async () => {
  expect((await busRow()).driverId).toBe(h.ids.driverA);
  await onDuty();
  // 2 logins (MAX_LOGINS_PER_FILE is 8).
  driverA = await h.loginAs('driverA');
  adminA = await h.loginAs('adminA');
});

describe('Q133 update-location ranges', () => {
  it('boundaries lat ±90, lng ±180, speed 999 → 200 and each is stored exactly', async () => {
    for (const body of [
      { latitude: 90, longitude: 180, speed: 999 },
      { latitude: -90, longitude: -180, speed: 999 },
    ]) {
      await resetBus();
      const res = await driverA.post(LOC).send(body);
      expect(res.status, JSON.stringify(body)).toBe(200);
      const bus = await busRow();
      expect(Number(bus.currentLatitude)).toBe(body.latitude);
      expect(Number(bus.currentLongitude)).toBe(body.longitude);
      expect(Number(bus.speed)).toBe(999);
    }
  });

  const justOut: Array<[string, Record<string, number>]> = [
    ['latitude .max(90)', { latitude: 90.0001, longitude: 0 }],
    ['latitude .min(-90)', { latitude: -90.0001, longitude: 0 }],
    ['longitude .max(180)', { latitude: 0, longitude: 180.0001 }],
    ['longitude .min(-180)', { latitude: 0, longitude: -180.0001 }],
    ['speed .max(999)', { latitude: 40, longitude: -75, speed: 999.01 }],
    ['speed .min(-999)', { latitude: 40, longitude: -75, speed: -999.01 }],
  ];
  for (const [clause, body] of justOut) {
    it(`just out of range ${JSON.stringify(body)} → 400 "Latitude and longitude are required", bus unchanged (red if ${clause} is removed from updateLocationBodySchema)`, async () => {
      await resetBus();
      const res = await driverA.post(LOC).send(body);
      expect(res.status).toBe(400);
      expect(res.body).toEqual(REQUIRED);
      const bus = await busRow();
      expect(bus.currentLatitude).toBeNull();
      expect(bus.speed).toBeNull();
      expect(bus.status).toBe('idle');
    });
  }

  const overflow: Array<[string, Record<string, number>]> = [
    ['latitude .max(90)', { latitude: 100, longitude: 0 }],
    ['longitude .max(180)', { latitude: 0, longitude: 1000 }],
    ['speed .max(999)', { latitude: 40, longitude: -75, speed: 1000 }],
    ['speed .min(-999)', { latitude: 40, longitude: -75, speed: -1000 }],
  ];
  for (const [clause, body] of overflow) {
    it(`a column-overflowing value ${JSON.stringify(body)} → 400, not a 500 (red if ${clause} is removed from updateLocationBodySchema)`, async () => {
      await resetBus();
      const res = await driverA.post(LOC).send(body);
      expect(res.status).toBe(400);
      expect(res.body).toEqual(REQUIRED);
    });
  }
});

describe('Q133 update-location speed mapping', () => {
  it('speed 0 over a stored 25.00 → stored 0 (red if the handler\'s `speed ? speed.toString() : undefined` truthiness comes back)', async () => {
    await seedSpeed();
    const res = await driverA.post(LOC).send({ latitude: 40.1, longitude: -75.1, speed: 0 });
    expect(res.status).toBe(200);
    const bus = await busRow();
    expect(bus.speed).not.toBeNull();
    expect(Number(bus.speed)).toBe(0);
  });

  it('speed -2 (iOS invalid GPS speed) over a stored 25.00 → 200 and speed is null, "unknown" (red if the handler\'s `speed < 0 ? null` branch is removed, or storage\'s `speed !== undefined` goes back to `if (speed)`)', async () => {
    await seedSpeed();
    const res = await driverA.post(LOC).send({ latitude: 40.1, longitude: -75.1, speed: -2 });
    expect(res.status).toBe(200);
    expect((await busRow()).speed).toBeNull();
  });

  it('speed omitted over a stored 25.00 → still 25.00, location updated (pins "undefined keeps the stored speed")', async () => {
    await seedSpeed();
    const res = await driverA.post(LOC).send({ latitude: 40.1, longitude: -75.1 });
    expect(res.status).toBe(200);
    const bus = await busRow();
    expect(bus.speed).toBe('25.00');
    expect(Number(bus.currentLatitude)).toBeCloseTo(40.1, 5);
  });
});

describe('Q133 PUT /api/buses/:busId/location speed ceiling (admin GPS simulator)', () => {
  it('adminA speed 1000 → 400, not a 500, speed unchanged (red if .max(999) is removed from the PUT location schema)', async () => {
    await seedSpeed();
    const res = await adminA.put(`/api/buses/${h.ids.busA}/location`).send({ latitude: 40.2, longitude: -75.2, speed: 1000 });
    expect(res.status).toBe(400);
    expect((await busRow()).speed).toBe('25.00');
  });

  it('adminA speed 50 → 200 and 50 is stored (positive control)', async () => {
    await seedSpeed();
    const res = await adminA.put(`/api/buses/${h.ids.busA}/location`).send({ latitude: 40.2, longitude: -75.2, speed: 50 });
    expect(res.status).toBe(200);
    expect(Number((await busRow()).speed)).toBe(50);
  });
});
