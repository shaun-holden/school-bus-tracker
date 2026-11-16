// Q80 (SB-3): the forgot-password email link is built from APP_URL, never from
// the request's Host / X-Forwarded-Host / X-Forwarded-Proto (all client-set).
// Two POSTs only: forgot-password has authLimiter (10 per 15 min per IP).
import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import { sendPasswordResetEmail } from '../../server/emailService';
import { useIntegrationHarness } from './harness';
import { EMAILS } from './seed';

const h = useIntegrationHarness();
const TRUSTED = 'https://trusted.example.test';
const hadAppUrl = 'APP_URL' in process.env;
const savedAppUrl = process.env.APP_URL;
let knownBody: unknown;

beforeAll(() => {
  process.env.APP_URL = TRUSTED;
});

afterAll(() => {
  if (hadAppUrl) process.env.APP_URL = savedAppUrl;
  else delete process.env.APP_URL;
});

beforeEach(() => {
  vi.mocked(sendPasswordResetEmail).mockClear();
});

describe('POST /api/auth/forgot-password reset link base (Q80, SB-3)', () => {
  it("A: a forged Host / X-Forwarded-Host / X-Forwarded-Proto does not reach the emailed link (red if the reset link base comes from req.get('host') / req.protocol)", async () => {
    const res = await h
      .anon()
      .post('/api/auth/forgot-password')
      .set('Host', 'evil.example.test')
      .set('X-Forwarded-Host', 'evil.example.test')
      .set('X-Forwarded-Proto', 'http')
      .send({ email: EMAILS.parentA });
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    knownBody = res.body;
    expect(sendPasswordResetEmail).toHaveBeenCalledTimes(1);
    const url = String(vi.mocked(sendPasswordResetEmail).mock.calls[0][2]);
    expect(url).toMatch(/^https:\/\/trusted\.example\.test\/reset-password\?token=[0-9a-f]{64}$/);
    expect(url).not.toContain('evil');
  });

  it('B: control, an unknown email gets the same 200 body and no email is sent (S-8: same answer for known and unknown emails)', async () => {
    const res = await h
      .anon()
      .post('/api/auth/forgot-password')
      .send({ email: 'q80-nobody@sbt.test' });
    expect(res.status).toBe(200);
    expect(knownBody).toBeDefined();
    expect(res.body).toEqual(knownBody);
    expect(sendPasswordResetEmail).not.toHaveBeenCalled();
  });
});
