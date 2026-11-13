// T4a area 1: POST / DELETE /api/device-tokens. A token is stored once per
// (user, token, platform), moves to the new user on the same phone (same
// token AND platform only), is capped at 10 active per user, and can only be
// turned off by its owner. Masters (impersonating or not) can't register.
// Real HTTP + real Postgres. Each title names the clause whose removal turns
// it red; other users' rows are seeded so they can be reached.
import { describe, it, expect, beforeAll } from 'vitest';
import { and, eq } from 'drizzle-orm';
import { deviceTokens } from '@shared/schema';
import { useIntegrationHarness, type Agent } from './harness';

const h = useIntegrationHarness();
const URL = '/api/device-tokens';
const hex = (n: number) => n.toString(16).padStart(64, '0');

let parentA: Agent; // "user A"
let driverA: Agent; // "user B"
let master: Agent;
let masterImp: Agent;

const rowsFor = (userId: string, token?: string) =>
  h.db
    .select()
    .from(deviceTokens)
    .where(token ? and(eq(deviceTokens.userId, userId), eq(deviceTokens.token, token)) : eq(deviceTokens.userId, userId));

beforeAll(async () => {
  // 4 logins (MAX_LOGINS_PER_FILE is 8).
  parentA = await h.loginAs('parentA');
  driverA = await h.loginAs('driverA');
  master = await h.loginAs('master');
  masterImp = await h.loginAs('master');
  const imp = await masterImp.post(`/api/master-admin/impersonate/${h.ids.companyA}`).send({});
  expect(imp.status).toBe(200);
});

describe('register', () => {
  it('the same (user, token, platform) twice → exactly 1 row in total and its updatedAt moves forward (red if every call inserts)', async () => {
    const token = hex(1);
    expect((await parentA.post(URL).send({ token, platform: 'ios' })).status).toBe(200);
    const [first] = await rowsFor(h.ids.parentA, token);
    await new Promise((r) => setTimeout(r, 20));
    expect((await parentA.post(URL).send({ token, platform: 'ios' })).status).toBe(200);
    const rows = await rowsFor(h.ids.parentA, token);
    expect(rows).toHaveLength(1);
    expect(rows[0].isActive).toBe(true);
    expect(rows[0].updatedAt!.getTime()).toBeGreaterThan(first.updatedAt!.getTime());
  });

  it('user B registering A\'s (token, platform) → A\'s row inactive, B\'s active (red if the deactivate-other-users step is removed)', async () => {
    const token = hex(2);
    await parentA.post(URL).send({ token, platform: 'ios' });
    expect((await driverA.post(URL).send({ token, platform: 'ios' })).status).toBe(200);
    expect((await rowsFor(h.ids.parentA, token))[0].isActive).toBe(false);
    expect((await rowsFor(h.ids.driverA, token))[0].isActive).toBe(true);
  });

  it('the same token string on a different platform does not deactivate A\'s row (red if the move step drops the platform binding)', async () => {
    const token = 'shared-token-string-0001';
    await parentA.post(URL).send({ token, platform: 'android' });
    expect((await driverA.post(URL).send({ token, platform: 'web' })).status).toBe(200);
    expect((await rowsFor(h.ids.parentA, token))[0].isActive).toBe(true);
  });

  it('an 11th active token deactivates the caller\'s oldest one, never the one just registered (red if the per-user cap is removed)', async () => {
    // Fresh user for a clean count: driverA's tokens from above are cleared first.
    await h.db.delete(deviceTokens).where(eq(deviceTokens.userId, h.ids.driverA));
    for (let i = 0; i < 11; i++) {
      expect((await driverA.post(URL).send({ token: hex(100 + i), platform: 'ios' })).status).toBe(200);
      await new Promise((r) => setTimeout(r, 5));
    }
    const active = (await rowsFor(h.ids.driverA)).filter((r) => r.isActive);
    expect(active).toHaveLength(10);
    expect(active.map((r) => r.token)).not.toContain(hex(100));
    expect(active.map((r) => r.token)).toContain(hex(110));
  });

  it('a bad iOS token or an extra field → 400 with errors, no row (red if the iOS hex check is loosened / .strict() dropped)', async () => {
    const bad = await parentA.post(URL).send({ token: 'not-hex-at-all', platform: 'ios' });
    expect(bad.status).toBe(400);
    expect(bad.body.errors).toBeTruthy();
    const extra = await parentA.post(URL).send({ token: hex(3), platform: 'ios', userId: h.ids.driverA });
    expect(extra.status).toBe(400);
    expect(await rowsFor(h.ids.parentA, 'not-hex-at-all')).toHaveLength(0);
    expect(await rowsFor(h.ids.parentA, hex(3))).toHaveLength(0);
    expect((await parentA.post(URL).send({ token: hex(4), platform: 'symbian' })).status).toBe(400);
    expect((await parentA.post(URL).send({ token: 'x'.repeat(513), platform: 'web' })).status).toBe(400);
  });

  it('an Android FCM-style token with : - _ and today\'s web payload { token, platform: "web" } are accepted', async () => {
    const fcm = 'cX9a-Bc_d:APA91bH-abc_DEF123:xyz-_';
    expect((await parentA.post(URL).send({ token: fcm, platform: 'android' })).status).toBe(200);
    const web = JSON.stringify({ endpoint: 'https://push.example.test/abc', keys: { p256dh: 'k', auth: 'a' } });
    expect((await parentA.post(URL).send({ token: web, platform: 'web' })).status).toBe(200);
  });

  it('an unscoped master and an impersonating master get 403 and no row (red if the master guard is removed)', async () => {
    for (const agent of [master, masterImp]) {
      const res = await agent.post(URL).send({ token: hex(5), platform: 'ios' });
      expect(res.status).toBe(403);
    }
    expect(await rowsFor(h.ids.master)).toHaveLength(0);
  });
});

describe('DELETE', () => {
  it('B deleting A\'s token → 200 and A\'s row is still active (red if the userId clause is removed)', async () => {
    const token = hex(6);
    await parentA.post(URL).send({ token, platform: 'ios' });
    const res = await driverA.delete(URL).send({ token, platform: 'ios' });
    expect(res.status).toBe(200);
    expect((await rowsFor(h.ids.parentA, token))[0].isActive).toBe(true);
  });

  it('deleting your own token → inactive', async () => {
    const token = hex(7);
    await parentA.post(URL).send({ token, platform: 'ios' });
    expect((await parentA.delete(URL).send({ token, platform: 'ios' })).status).toBe(200);
    expect((await rowsFor(h.ids.parentA, token))[0].isActive).toBe(false);
  });

  it('a bad DELETE body → 400', async () => {
    expect((await parentA.delete(URL).send({})).status).toBe(400);
  });
});
