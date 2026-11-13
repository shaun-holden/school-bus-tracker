// Q22 Part D: PATCH /api/driver/duty-status returns only what the dashboard
// needs ({ id, isOnDuty, dutyStartTime }), on both the changed path and the
// idempotent no-op path, never the full user row (S-8, S-12). Real HTTP +
// real Postgres.
import { describe, it, expect, beforeAll } from 'vitest';
import { eq } from 'drizzle-orm';
import { users } from '@shared/schema';
import { useIntegrationHarness, type Agent } from './harness';

const h = useIntegrationHarness();
const URL = '/api/driver/duty-status';
const KEYS = ['dutyStartTime', 'id', 'isOnDuty'];

let driverA: Agent;

beforeAll(async () => {
  await h.db.update(users).set({ isOnDuty: false, dutyStartTime: null }).where(eq(users.id, h.ids.driverA));
  // 1 login (MAX_LOGINS_PER_FILE is 8).
  driverA = await h.loginAs('driverA');
});

describe('Q22 duty toggle response', () => {
  it('off → on (changed path) returns exactly { id, isOnDuty, dutyStartTime } (red if res.json(updatedUser) comes back)', async () => {
    const res = await driverA.patch(URL).send({ isOnDuty: true });
    expect(res.status).toBe(200);
    expect(Object.keys(res.body).sort()).toEqual(KEYS);
    expect(res.body.id).toBe(h.ids.driverA);
    expect(res.body.isOnDuty).toBe(true);
    expect(res.body.dutyStartTime).toBeTruthy();
  });

  it('on → on (idempotent no-op path) returns exactly { id, isOnDuty, dutyStartTime } and keeps dutyStartTime (red if res.json(user) comes back)', async () => {
    const [before] = await h.db.select().from(users).where(eq(users.id, h.ids.driverA));
    const res = await driverA.patch(URL).send({ isOnDuty: true });
    expect(res.status).toBe(200);
    expect(Object.keys(res.body).sort()).toEqual(KEYS);
    expect(res.body.isOnDuty).toBe(true);
    const [after] = await h.db.select().from(users).where(eq(users.id, h.ids.driverA));
    expect(after.dutyStartTime?.getTime()).toBe(before.dutyStartTime?.getTime());
  });

  it('on → off (changed path) returns exactly the three keys with isOnDuty false and dutyStartTime null', async () => {
    const res = await driverA.patch(URL).send({ isOnDuty: false });
    expect(res.status).toBe(200);
    expect(Object.keys(res.body).sort()).toEqual(KEYS);
    expect(res.body.isOnDuty).toBe(false);
    expect(res.body.dutyStartTime).toBeNull();
  });
});
