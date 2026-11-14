// Q59 client: account deletion. Unit only (no DB, no DOM): the pure helpers in
// client/src/lib/accountDeletion.ts, plus source-text checks on App.tsx routes
// and the delete mutation in use-auth.ts.
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import {
  canSelfDeleteAccount,
  deleteAccountErrorText,
  CONTACT_SUPPORT_TEXT,
} from '../client/src/lib/accountDeletion';

const read = (p: string) => readFileSync(resolve(__dirname, '..', p), 'utf8');

describe('canSelfDeleteAccount', () => {
  it.each([
    ['parent', undefined, true],
    ['driver', undefined, true],
    ['admin', undefined, false],
    ['driver_admin', undefined, false],
    ['master_admin', undefined, false],
    ['master_admin', true, false],
    // an impersonating master never self-deletes, whatever the role field says
    ['parent', true, false],
    ['driver', true, false],
  ] as const)('role %s, impersonating %s → %s', (role, imp, expected) => {
    expect(canSelfDeleteAccount({ role, _masterAdminImpersonating: imp })).toBe(expected);
  });

  it('no user or no role → false', () => {
    expect(canSelfDeleteAccount(null)).toBe(false);
    expect(canSelfDeleteAccount(undefined)).toBe(false);
    expect(canSelfDeleteAccount({ role: null })).toBe(false);
  });
});

describe('deleteAccountErrorText', () => {
  const err = (status: number, body: unknown) =>
    new Error(`${status}: ${typeof body === 'string' ? body : JSON.stringify(body)}`);

  it.each([
    ['400 BAD_PASSWORD', err(400, { code: 'BAD_PASSWORD', message: 'Password is incorrect' }), "That password isn't right."],
    ['400 without a code (Zod shape)', err(400, { message: 'Invalid input', errors: [] }), 'Enter your password.'],
    ['401', err(401, { message: 'Unauthorized' }), 'Your session ended, sign in again.'],
    ['403 CONTACT_SUPPORT', err(403, { code: 'CONTACT_SUPPORT', message: 'x' }), CONTACT_SUPPORT_TEXT],
    ['409 ON_DUTY', err(409, { code: 'ON_DUTY', message: 'x' }), 'Go off duty first.'],
    ['429 (limiter text, not JSON)', err(429, 'Too many requests, please try again later.'), 'Too many attempts, try again in 15 minutes.'],
    ['401 with a non-JSON body', err(401, 'Unauthorized'), 'Your session ended, sign in again.'],
    ['500 → friendlyErrorText (server message)', err(500, { message: 'Failed to delete account' }), 'Failed to delete account'],
    ['418 non-JSON HTML → friendlyErrorText fallback', err(418, '<html>teapot</html>'), 'Something went wrong, please try again'],
    ['network error (no status) → friendlyErrorText', new Error('Failed to fetch'), 'Failed to fetch'],
  ])('%s', (_label, input, expected) => {
    expect(deleteAccountErrorText(input)).toBe(expected);
  });

  it('the contact-support text names the support address', () => {
    expect(CONTACT_SUPPORT_TEXT).toContain('support@schoolbustracker.org');
  });
});

describe('App.tsx routes', () => {
  const app = read('client/src/App.tsx');
  // The authenticated branch of `{!isAuthenticated ? ( … ) : ( <> … </> )}`.
  const authStart = app.indexOf('{!isAuthenticated ? (');
  const fragStart = app.indexOf('<>', authStart);
  const fragEnd = app.indexOf('</>', fragStart);

  it('finds the authenticated fragment', () => {
    expect(authStart).toBeGreaterThan(-1);
    expect(fragStart).toBeGreaterThan(authStart);
    expect(fragEnd).toBeGreaterThan(fragStart);
  });

  it('/delete-account is a public route, before (outside) the authenticated branch', () => {
    const at = app.indexOf('<Route path="/delete-account" component={DeleteAccount} />');
    expect(at).toBeGreaterThan(-1);
    expect(at).toBeLessThan(authStart);
    expect(app.match(/path="\/delete-account"/g)).toHaveLength(1);
  });

  it('/account is inside the authenticated fragment', () => {
    const at = app.indexOf('<Route path="/account" component={AccountPage} />');
    expect(at).toBeGreaterThan(fragStart);
    expect(at).toBeLessThan(fragEnd);
    expect(app.match(/path="\/account"/g)).toHaveLength(1);
  });
});

describe('use-auth.ts delete mutation', () => {
  const src = read('client/src/hooks/use-auth.ts');
  const start = src.indexOf('const deleteAccountMutation = useMutation({');
  // The mutation object ends at the first `});` at its indentation.
  const end = src.indexOf('\n  });', start);
  const block = start > -1 && end > start ? src.slice(start, end) : '';

  it('finds the mutation', () => {
    expect(start).toBeGreaterThan(-1);
    expect(block.length).toBeGreaterThan(0);
  });

  it('onSuccess calls queryClient.clear()', () => {
    expect(block).toMatch(/onSuccess:\s*\(\)\s*=>\s*\{[^}]*queryClient\.clear\(\);/);
  });

  it('the push cleanup runs inside runWhileLoggingOut, after the awaited request', () => {
    const cb = block.match(/runWhileLoggingOut\(async \(\) => \{([\s\S]*?)\n\s{6}\}\)/);
    expect(cb, 'runWhileLoggingOut callback').not.toBeNull();
    const body = cb![1];
    const req = body.indexOf("await apiRequest(\"/api/auth/delete-account\", \"POST\"");
    expect(req).toBeGreaterThan(-1);
    const steps = [
      'await unregisterNativePush()',
      'removeAllDeliveredNotifications()',
      'clearPushToken()',
      'localStorage.removeItem("bluetooth_device_id")',
    ];
    let last = req;
    for (const s of steps) {
      const at = body.indexOf(s, last);
      expect(at, s).toBeGreaterThan(last);
      last = at;
    }
  });

  it('nothing is cleaned up on a failed request (no try/finally around it)', () => {
    expect(block).not.toMatch(/finally/);
  });

  it('exports deleteAccountAsync and isDeletingAccount', () => {
    expect(src).toMatch(/deleteAccountAsync:\s*deleteAccountMutation\.mutateAsync/);
    expect(src).toMatch(/isDeletingAccount:\s*deleteAccountMutation\.isPending/);
  });
});
