// Q25: login limiter gaps found by SHELL's Q23 mutation run. Its own file so
// it gets fresh limiter instances (vitest isolates modules per file) and its
// 100 failed logins don't eat other tests' budget.
//
// Everything here comes from one IP (supertest's loopback address).
// `ipFailures` counts every login response >= 400 in this file, because
// loginIpLimiter (skipSuccessfulRequests) counts exactly those, including a
// 429 that loginLimiter answers after loginIpLimiter has run.
import { describe, it, expect } from 'vitest';
import { useIntegrationHarness } from './harness';
import { EMAILS, SEED_PASSWORD } from './seed';

const h = useIntegrationHarness();
const TOO_MANY = { message: 'Too many attempts, please try again in 15 minutes' };
const IP_BACKSTOP = 100;

let ipFailures = 0;
const login = async (email: string, password: string) => {
  const res = await h.anon().post('/api/auth/login').send({ email, password });
  if (res.status >= 400) ipFailures += 1;
  return res;
};

describe('login and forgot-password do not share a counter (Q25)', () => {
  it("spending one email's login budget leaves forgot-password answering 200 (red if authLimiter is stacked on the login route)", async () => {
    for (let i = 1; i <= 10; i++) {
      const res = await login(EMAILS.driverA, `wrong-${i}`);
      expect(res.status, `failed login #${i}`).toBe(401);
    }
    const blocked = await login(EMAILS.driverA, SEED_PASSWORD);
    expect(blocked.status).toBe(429);

    const forgot = await h.anon().post('/api/auth/forgot-password').send({ email: 'nobody@sbt.test' });
    expect(forgot.status, JSON.stringify(forgot.body)).toBe(200);
  });
});

describe('IP-wide backstop on failed logins (Q25)', () => {
  it('failed logins across many different emails from one IP: the 101st is 429 (red if loginIpLimiter is removed from the login route)', async () => {
    // Distinct emails, so the per-email loginLimiter never fires here.
    let n = 0;
    while (ipFailures < IP_BACKSTOP) {
      n += 1;
      const res = await login(`spray-${n}@sbt.test`, 'wrong-password');
      expect(res.status, `failed login #${ipFailures} from this IP`).toBe(401);
    }
    expect(ipFailures).toBe(IP_BACKSTOP);

    const last = await login(`spray-${n + 1}@sbt.test`, 'wrong-password');
    expect(last.status).toBe(429);
    expect(last.body).toEqual(TOO_MANY);
  }, 60000);
});
