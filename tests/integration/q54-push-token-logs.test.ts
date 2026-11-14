// Brief step 3b (SHELL's Q2b-1 merge, S-13): with drizzle 0.45 a failed query
// is a DrizzleQueryError whose message and .params carry the bound values,
// here a phone's push token. The logout cleanup, the device-token register /
// remove catches and the route-save DB branch must log a fixed text plus the
// pg code only. Each test makes the storage call throw a real
// DrizzleQueryError whose params contain a marker token, spies console.error
// and asserts no logged argument (inspected deeply) contains it.
import { describe, it, expect, beforeAll, afterEach, vi } from 'vitest';
import { inspect } from 'util';
import { DrizzleQueryError } from 'drizzle-orm';
import { storage } from '../../server/storage';
import { useIntegrationHarness, type Agent } from './harness';

const h = useIntegrationHarness();
const TOKEN = 'f'.repeat(60) + 'abcd';

let adminA: Agent;

const dbError = (params: unknown[]) =>
  new DrizzleQueryError('update "device_tokens" set "is_active" = $1 where "token" = $2', params, Object.assign(new Error('boom'), { code: 'XX000' }));

function loggedText(spy: ReturnType<typeof vi.spyOn>): string {
  return spy.mock.calls.map((args) => args.map((a) => inspect(a, { depth: 10 })).join(' ')).join('\n');
}

beforeAll(async () => {
  adminA = await h.loginAs('adminA');
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('3b no push token in logs', () => {
  it('logout cleanup failing with a DrizzleQueryError → 200, and the token appears in no console.error argument (red if the log goes back to err)', async () => {
    const agent = await h.loginAs('parentA');
    const err = vi.spyOn(console, 'error').mockImplementation(() => {});
    vi.spyOn(storage, 'deactivateDeviceTokenForUser').mockRejectedValue(dbError([false, TOKEN]));
    const res = await agent.post('/api/auth/logout').send({ deviceToken: TOKEN });
    expect(res.status).toBe(200);
    expect(err).toHaveBeenCalled();
    expect(loggedText(err)).not.toContain(TOKEN);
  });

  it('POST /api/device-tokens failing with a DrizzleQueryError → 500, and the token appears in no console.error argument', async () => {
    const err = vi.spyOn(console, 'error').mockImplementation(() => {});
    vi.spyOn(storage, 'registerDeviceToken').mockRejectedValue(dbError([TOKEN, 'ios']));
    const res = await adminA.post('/api/device-tokens').send({ token: TOKEN, platform: 'ios' });
    expect(res.status).toBe(500);
    expect(err).toHaveBeenCalled();
    expect(loggedText(err)).not.toContain(TOKEN);
  });

  it('DELETE /api/device-tokens failing with a DrizzleQueryError → 500, and the token appears in no console.error argument', async () => {
    const err = vi.spyOn(console, 'error').mockImplementation(() => {});
    vi.spyOn(storage, 'deactivateDeviceTokenForUser').mockRejectedValue(dbError([false, TOKEN]));
    const res = await adminA.delete('/api/device-tokens').send({ token: TOKEN, platform: 'ios' });
    expect(res.status).toBe(500);
    expect(err).toHaveBeenCalled();
    expect(loggedText(err)).not.toContain(TOKEN);
  });

  it('a route save that fails in the DB logs only the code, not the submitted value', async () => {
    const err = vi.spyOn(console, 'error').mockImplementation(() => {});
    const res = await adminA.patch(`/api/routes/${h.ids.routeA}`).send({ name: 'Q54Marker\u0000Name' });
    expect(res.status).toBe(500);
    expect(loggedText(err)).not.toContain('Q54Marker');
  });
});
