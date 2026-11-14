// Q60 PL-2: a password reset turns off every push token of that user, so a
// phone left logged in with the old password stops getting pushes. Another
// user's tokens are untouched (positive control). Tokens are registered
// through the real POST /api/device-tokens; the reset token is seeded hashed
// the way POST /api/auth/forgot-password stores it (sha256). Real HTTP + real
// Postgres.
import { describe, it, expect, beforeAll } from 'vitest';
import crypto from 'crypto';
import { eq } from 'drizzle-orm';
import { deviceTokens } from '@shared/schema';
import { storage } from '../../server/storage';
import { useIntegrationHarness, type Agent } from './harness';

const h = useIntegrationHarness();
const RAW_RESET = 'q60-reset-token-raw-value-0001';

let parentA: Agent;
let parentB: Agent;

const rowsFor = (userId: string) => h.db.select().from(deviceTokens).where(eq(deviceTokens.userId, userId));

beforeAll(async () => {
  // 2 logins (MAX_LOGINS_PER_FILE is 8).
  parentA = await h.loginAs('parentA');
  parentB = await h.loginAs('parentB');
  expect((await parentA.post('/api/device-tokens').send({ token: 'a'.repeat(64), platform: 'ios' })).status).toBe(200);
  expect((await parentA.post('/api/device-tokens').send({ token: 'q60-android:token-A_1', platform: 'android' })).status).toBe(200);
  expect((await parentB.post('/api/device-tokens').send({ token: 'b'.repeat(64), platform: 'ios' })).status).toBe(200);
});

describe('Q60 password reset turns off push tokens', () => {
  it('a valid reset turns off both of parentA\'s tokens and leaves parentB\'s on (red if the deactivateDeviceTokensForUser call is removed)', async () => {
    expect((await rowsFor(h.ids.parentA)).every((r) => r.isActive)).toBe(true);
    const hashed = crypto.createHash('sha256').update(RAW_RESET).digest('hex');
    await storage.setPasswordResetToken(h.ids.parentA, hashed, new Date(Date.now() + 60 * 60 * 1000));

    const res = await h.anon().post('/api/auth/reset-password').send({ token: RAW_RESET, password: 'Q60-New-Pass-123' });
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ message: 'Password has been reset successfully' });

    const a = await rowsFor(h.ids.parentA);
    expect(a).toHaveLength(2);
    expect(a.every((r) => r.isActive === false)).toBe(true);
    const b = await rowsFor(h.ids.parentB);
    expect(b).toHaveLength(1);
    expect(b[0].isActive).toBe(true);
  });

  it('the new password works for login (the reset itself is unchanged)', async () => {
    const res = await h.loginAttempt('parent-a@sbt.test', 'Q60-New-Pass-123');
    expect(res.status).toBe(200);
  });
});
