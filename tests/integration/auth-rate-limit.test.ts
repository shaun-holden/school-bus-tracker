// Q23: the login limiter counts only FAILED logins, per IP + email, with an
// IP-wide backstop; forgot-password / reset-password / driver-invitation keep a
// strict all-requests limit on a counter of their own.
//
// Each test file gets fresh modules, so fresh limiter instances. This file
// calls the endpoints directly (not h.loginAttempt, whose per-file cap exists
// for the old shared limiter). Tests run in order and share one IP (supertest's
// loopback address), which is the point: one school Wi-Fi.
import { describe, it, expect } from 'vitest';
import { useIntegrationHarness } from './harness';
import { EMAILS, SEED_PASSWORD } from './seed';

const h = useIntegrationHarness();
const TOO_MANY = { message: 'Too many attempts, please try again in 15 minutes' };

const login = (email: string, password: string) =>
  h.anon().post('/api/auth/login').send({ email, password });

describe('login rate limit (Q23)', () => {
  it('12 successful logins from one IP never get 429 (clause: skipSuccessfulRequests on loginLimiter)', async () => {
    for (let i = 1; i <= 12; i++) {
      const res = await login(EMAILS.parentA, SEED_PASSWORD);
      expect(res.status, `successful login #${i}: ${JSON.stringify(res.body)}`).toBe(200);
    }
  });

  it('101 successful logins by different staff on one IP never hit the 100-per-IP backstop (clause: skipSuccessfulRequests on loginIpLimiter)', async () => {
    const staff = [EMAILS.adminA, EMAILS.driverA, EMAILS.parentA, EMAILS.adminB, EMAILS.driverB, EMAILS.parentB];
    for (let i = 1; i <= 101; i++) {
      const res = await login(staff[i % staff.length], SEED_PASSWORD);
      expect(res.status, `successful login #${i}: ${JSON.stringify(res.body)}`).toBe(200);
    }
  }, 60000);

  it('10 failed logins for email A → the 11th for A is 429, but email B on the same IP still logs in (clause: keyGenerator includes the email)', async () => {
    for (let i = 1; i <= 10; i++) {
      const res = await login(EMAILS.driverA, 'wrong-password-' + i);
      expect(res.status, `failed login #${i}`).toBe(401);
    }

    // Even the right password is refused once A's failed-attempt budget is spent.
    const blocked = await login(EMAILS.driverA, SEED_PASSWORD);
    expect(blocked.status).toBe(429);
    expect(blocked.body).toEqual(TOO_MANY);

    // The key is lower-cased: a case variant of A shares A's counter.
    const blockedUpper = await login(EMAILS.driverA.toUpperCase(), SEED_PASSWORD);
    expect(blockedUpper.status).toBe(429);

    // Another person on the same IP is not locked out.
    const other = await login(EMAILS.parentB, SEED_PASSWORD);
    expect(other.status, JSON.stringify(other.body)).toBe(200);
  });
});

describe('sensitive auth routes keep the strict limit (Q23)', () => {
  it('forgot-password is still limited at 10 per 15 min per IP, counting every request', async () => {
    for (let i = 1; i <= 10; i++) {
      const res = await h.anon().post('/api/auth/forgot-password').send({ email: `nobody-${i}@sbt.test` });
      expect(res.status, `forgot-password #${i}: ${JSON.stringify(res.body)}`).toBe(200);
    }
    const blocked = await h.anon().post('/api/auth/forgot-password').send({ email: 'nobody-11@sbt.test' });
    expect(blocked.status).toBe(429);
    expect(blocked.body).toEqual(TOO_MANY);
  });

  it('login no longer shares a counter with forgot-password (clause: login has its own limiter instances)', async () => {
    // forgot-password's IP budget is spent (previous test); login must still work.
    const res = await login(EMAILS.adminA, SEED_PASSWORD);
    expect(res.status, JSON.stringify(res.body)).toBe(200);
  });
});
