import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// Q35: the "new business signed up" email goes to SIGNUP_NOTIFY_EMAIL (set on
// Railway by hand), never to an address hardcoded in server code.
const sendMock = vi.fn(async () => ({ data: { id: 'email_1' }, error: null }));

vi.mock('resend', () => ({
  // A plain class (not vi.fn) so vi.restoreAllMocks() can't wipe it between tests.
  Resend: class {
    emails = { send: sendMock };
  },
}));

import { sendNewBusinessSignupNotification } from '../server/emailService';

describe('sendNewBusinessSignupNotification recipient (SIGNUP_NOTIFY_EMAIL)', () => {
  beforeEach(() => {
    sendMock.mockClear();
    vi.stubEnv('RESEND_API_KEY', 're_test_key');
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    vi.spyOn(console, 'log').mockImplementation(() => {});
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    vi.restoreAllMocks();
  });

  it('`if (!notifyEmail) return { success: false }`: unset SIGNUP_NOTIFY_EMAIL sends nothing', async () => {
    vi.stubEnv('SIGNUP_NOTIFY_EMAIL', '');
    const result = await sendNewBusinessSignupNotification(
      'Test Co', 'contact@company.test', 'Test Contact', 'pending_selection',
    );
    expect(result).toEqual({ success: false, error: 'SIGNUP_NOTIFY_EMAIL not set' });
    expect(sendMock).not.toHaveBeenCalled();
  });

  it('`if (!notifyEmail) …`: whitespace-only SIGNUP_NOTIFY_EMAIL sends nothing', async () => {
    vi.stubEnv('SIGNUP_NOTIFY_EMAIL', '   ');
    const result = await sendNewBusinessSignupNotification(
      'Test Co', 'contact@company.test', 'Test Contact', 'pending_selection',
    );
    expect(result.success).toBe(false);
    expect(sendMock).not.toHaveBeenCalled();
  });

  it('`to: notifyEmail`: the email goes to the SIGNUP_NOTIFY_EMAIL value (trimmed)', async () => {
    vi.stubEnv('SIGNUP_NOTIFY_EMAIL', ' owner@example.test ');
    const result = await sendNewBusinessSignupNotification(
      'Test Co', 'contact@company.test', 'Test Contact', 'pending_selection',
    );
    expect(result.success).toBe(true);
    expect(sendMock).toHaveBeenCalledTimes(1);
    expect(sendMock.mock.calls[0][0]).toMatchObject({ to: 'owner@example.test' });
  });

  it('`console.log(\'Sending new business signup notification\')`: no address in the log line', async () => {
    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
    vi.stubEnv('SIGNUP_NOTIFY_EMAIL', 'owner@example.test');
    await sendNewBusinessSignupNotification(
      'Test Co', 'contact@company.test', 'Test Contact', 'pending_selection',
    );
    const logged = logSpy.mock.calls.map((c) => c.map(String).join(' ')).join('\n');
    expect(logged).toContain('Sending new business signup notification');
    expect(logged).not.toContain('owner@example.test');
  });
});
