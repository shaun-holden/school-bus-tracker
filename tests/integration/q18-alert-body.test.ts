// Q18 round 2 Part B (reviewer M1 + M3): POST /api/notifications body.
// M1: an estimatedDelay of 0 (what the admin form sends for a cleared delay
// box) is stored as NULL, so parent screens using {estimatedDelay && …}
// never render a stray "0". M3: expiresAt must parse as a date or be null; a
// bad date is a 400, not a 500. Real HTTP + real Postgres.
import { describe, it, expect, beforeAll } from 'vitest';
import { eq } from 'drizzle-orm';
import { parentNotifications } from '@shared/schema';
import { useIntegrationHarness, type Agent } from './harness';

const h = useIntegrationHarness();
const URL = '/api/notifications';

let adminA: Agent;

const rowOf = async (id: string) => (await h.db.select().from(parentNotifications).where(eq(parentNotifications.id, id)))[0];
const noticeCount = async () => (await h.db.select().from(parentNotifications)).length;

beforeAll(async () => {
  // 1 login (MAX_LOGINS_PER_FILE is 8).
  adminA = await h.loginAs('adminA');
});

describe('M1 estimatedDelay', () => {
  it('a delay of 0 is stored as NULL (red if the 0 → null preprocess is removed)', async () => {
    const res = await adminA.post(URL).send({ type: 'delay', title: 'Zero delay', message: 'x', estimatedDelay: 0 });
    expect(res.status).toBe(200);
    expect((await rowOf(res.body.id)).estimatedDelay).toBeNull();
  });

  it('a delay of 15 is stored as 15; no delay is stored as NULL', async () => {
    const a = await adminA.post(URL).send({ type: 'delay', title: 'Fifteen', message: 'x', estimatedDelay: 15 });
    expect(a.status).toBe(200);
    expect((await rowOf(a.body.id)).estimatedDelay).toBe(15);
    const b = await adminA.post(URL).send({ type: 'info', title: 'No delay', message: 'x' });
    expect(b.status).toBe(200);
    expect((await rowOf(b.body.id)).estimatedDelay).toBeNull();
  });

  it('a negative delay is still a 400', async () => {
    const res = await adminA.post(URL).send({ type: 'delay', title: 'Negative', message: 'x', estimatedDelay: -5 });
    expect(res.status).toBe(400);
  });
});

describe('M3 expiresAt', () => {
  it('a bad date gives 400, not 500, and writes nothing (red if expiresAt is loosened back to z.string())', async () => {
    const before = await noticeCount();
    const res = await adminA.post(URL).send({ type: 'info', title: 'Bad date', message: 'x', expiresAt: 'not-a-date' });
    expect(res.status).toBe(400);
    expect(await noticeCount()).toBe(before);
  });

  it('a valid ISO date is stored; null is stored as NULL', async () => {
    const a = await adminA.post(URL).send({ type: 'info', title: 'Good date', message: 'x', expiresAt: '2099-01-01T12:00:00.000Z' });
    expect(a.status).toBe(200);
    expect((await rowOf(a.body.id)).expiresAt?.toISOString()).toBe('2099-01-01T12:00:00.000Z');
    const b = await adminA.post(URL).send({ type: 'info', title: 'Null date', message: 'x', expiresAt: null });
    expect(b.status).toBe(200);
    expect((await rowOf(b.body.id)).expiresAt).toBeNull();
  });
});
