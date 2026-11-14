// Q59: POST /api/auth/delete-account sits behind authLimiter (10 requests per
// 15 minutes per IP, shared with forgot/reset-password). One login, then 11
// wrong-password attempts: the first 10 are 400 BAD_PASSWORD, the 11th is
// 429, and the account is untouched. Fresh modules per file = a fresh limiter.
import { describe, it, expect, beforeAll } from 'vitest';
import { eq } from 'drizzle-orm';
import { users } from '@shared/schema';
import { useIntegrationHarness, type Agent } from './harness';
import { EMAILS } from './seed';

const h = useIntegrationHarness();
let parentA: Agent;

beforeAll(async () => {
  parentA = await h.loginAs('parentA');
});

describe('Q59 delete-account rate limit', () => {
  it('11 wrong-password attempts → ten 400s, then 429; the account is unchanged', async () => {
    const statuses: number[] = [];
    for (let i = 0; i < 11; i++) {
      statuses.push((await parentA.post('/api/auth/delete-account').send({ password: `wrong-${i}` })).status);
    }
    expect(statuses.slice(0, 10)).toEqual(Array(10).fill(400));
    expect(statuses[10]).toBe(429);
    const [row] = await h.db.select().from(users).where(eq(users.id, h.ids.parentA));
    expect(row.email).toBe(EMAILS.parentA);
  });
});
