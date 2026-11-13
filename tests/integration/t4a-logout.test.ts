// T4a area 2 (review B2, DeShaun's decision 10): POST /api/auth/logout turns
// off push on THIS phone only (the deviceToken the app sends) plus the
// caller's web tokens. The user's other phones stay on, another user's rows
// are never touched, a bad body is ignored (logout always works), and a
// logout with no session changes nothing. Real HTTP + real Postgres; rows
// are seeded directly so each clause is reachable.
import { describe, it, expect, beforeEach } from 'vitest';
import { eq } from 'drizzle-orm';
import { deviceTokens } from '@shared/schema';
import { useIntegrationHarness } from './harness';

const h = useIntegrationHarness();
const URL = '/api/auth/logout';
const PHONE_A = 'a'.repeat(64);
const PHONE_B = 'b'.repeat(64);
const WEB = JSON.stringify({ endpoint: 'https://push.example.test/w1', keys: { p256dh: 'k', auth: 'a' } });

let ids: Record<'phoneA' | 'phoneB' | 'web' | 'otherUser', string>;

const active = async (id: string) => (await h.db.select().from(deviceTokens).where(eq(deviceTokens.id, id)))[0].isActive;

async function seedTokens() {
  await h.db.delete(deviceTokens);
  const rows = await h.db
    .insert(deviceTokens)
    .values([
      { userId: h.ids.parentA, token: PHONE_A, platform: 'ios', isActive: true },
      { userId: h.ids.parentA, token: PHONE_B, platform: 'ios', isActive: true },
      { userId: h.ids.parentA, token: WEB, platform: 'web', isActive: true },
      // Another user, same token string as phone A, another platform.
      { userId: h.ids.driverA, token: PHONE_A, platform: 'android', isActive: true },
    ])
    .returning({ id: deviceTokens.id });
  ids = { phoneA: rows[0].id, phoneB: rows[1].id, web: rows[2].id, otherUser: rows[3].id };
}

beforeEach(seedTokens);

describe('T4a logout', () => {
  // Each test logs parentA in fresh (logout ends the session): 3 logins.
  it('logout with phone A\'s token → phone A off, the same user\'s phone B on, their web token off, another user\'s same-string row on (red if the userId clause is removed, deactivateDeviceTokensForUser comes back, or the web clause is removed)', async () => {
    const agent = await h.loginAs('parentA');
    const res = await agent.post(URL).send({ deviceToken: PHONE_A });
    expect(res.status).toBe(200);
    expect(await active(ids.phoneA)).toBe(false);
    expect(await active(ids.phoneB)).toBe(true);
    expect(await active(ids.web)).toBe(false);
    expect(await active(ids.otherUser)).toBe(true);
  });

  it('logout with no body → web tokens off, both phones untouched', async () => {
    const agent = await h.loginAs('parentA');
    const res = await agent.post(URL);
    expect(res.status).toBe(200);
    expect(await active(ids.web)).toBe(false);
    expect(await active(ids.phoneA)).toBe(true);
    expect(await active(ids.phoneB)).toBe(true);
    expect(await active(ids.otherUser)).toBe(true);
  });

  it('logout with a bad deviceToken (600 characters) → 200, web tokens off, phones untouched (a bad body never blocks logout)', async () => {
    const agent = await h.loginAs('parentA');
    const res = await agent.post(URL).send({ deviceToken: 'x'.repeat(600) });
    expect(res.status).toBe(200);
    expect(await active(ids.web)).toBe(false);
    expect(await active(ids.phoneA)).toBe(true);
    expect(await active(ids.phoneB)).toBe(true);
  });

  it('logout with no session → 200 and nothing changes, even with a deviceToken in the body', async () => {
    const res = await h.anon().post(URL).send({ deviceToken: PHONE_A });
    expect(res.status).toBe(200);
    for (const id of Object.values(ids)) expect(await active(id)).toBe(true);
  });
});
