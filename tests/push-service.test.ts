// T1 push transport (server/pushService.ts). http2, firebase-admin and
// storage are mocked; nothing leaves the machine. Each title names the clause
// whose deletion (or change) turns it red.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { EventEmitter } from 'events';
import crypto from 'crypto';
import { inspect } from 'util';

// ---- mocks -----------------------------------------------------------------
type Reply = { status: number; body?: string } | 'hang';

const m = vi.hoisted(() => ({
  connect: vi.fn(),
  reply: (() => ({ status: 200 })) as (path: string) => unknown,
  sessions: [] as any[],
  requests: [] as Array<{ host: string; headers: Record<string, unknown>; body: string; stream: any }>,
  open: 0,
  maxOpen: 0,
  sendEach: vi.fn(),
  initializeApp: vi.fn(),
  cert: vi.fn((x: unknown) => x),
  deactivateDeviceTokenById: vi.fn(async () => undefined),
  getDeviceTokensForUser: vi.fn(async () => [] as any[]),
  getDeviceTokensForUsers: vi.fn(async () => [] as any[]),
  getUsersByCompanyId: vi.fn(async () => [] as any[]),
}));

vi.mock('http2', async () => {
  const { EventEmitter: EE } = await import('events');
  const connect = (url: string) => {
    m.connect(url);
    const session: any = new EE();
    session.closed = false;
    session.destroyed = false;
    session.close = vi.fn(() => {
      session.closed = true;
    });
    session.destroy = vi.fn(() => {
      session.destroyed = true;
    });
    m.sessions.push(session);
    session.request = vi.fn((headers: Record<string, unknown>) => {
      const stream: any = new EE();
      stream.setEncoding = () => undefined;
      let finished = false;
      const done = () => {
        if (!finished) {
          finished = true;
          m.open--;
        }
      };
      stream.close = vi.fn(done);
      m.open++;
      m.maxOpen = Math.max(m.maxOpen, m.open);
      const entry = { host: url, headers, body: '', stream };
      m.requests.push(entry);
      stream.respond = (r: { status: number; body?: string }) => {
        if (finished) return;
        stream.emit('response', { ':status': r.status });
        if (r.body) stream.emit('data', r.body);
        done();
        stream.emit('end');
      };
      stream.end = (body: string) => {
        entry.body = body;
        const r = m.reply(String(headers[':path'])) as Reply;
        if (r !== 'hang') Promise.resolve().then(() => stream.respond(r));
      };
      return stream;
    });
    return session;
  };
  const mod = { connect, constants: { NGHTTP2_CANCEL: 8 } };
  return { default: mod, ...mod };
});

vi.mock('firebase-admin', () => {
  const admin = {
    apps: [] as unknown[],
    initializeApp: m.initializeApp,
    credential: { cert: m.cert },
    messaging: () => ({ sendEach: m.sendEach }),
  };
  return { default: admin, ...admin };
});

vi.mock('../server/storage', () => ({
  storage: {
    deactivateDeviceTokenById: m.deactivateDeviceTokenById,
    getDeviceTokensForUser: m.getDeviceTokensForUser,
    getDeviceTokensForUsers: m.getDeviceTokensForUsers,
    getUsersByCompanyId: m.getUsersByCompanyId,
  },
}));

// ---- helpers ---------------------------------------------------------------
const { privateKey } = crypto.generateKeyPairSync('ec', { namedCurve: 'P-256' });
const P8 = privateKey.export({ type: 'pkcs8', format: 'pem' }).toString();

const IOS_TOKEN = 'deadbeef'.repeat(8); // 64 hex
const IOS_TOKEN_2 = 'cafebabe'.repeat(8);
const FCM_TOKEN = 'fcmTOKENabcdefghijklmnopqrstuvwxyz0123456789:APA91bQ';

let seq = 0;
const row = (token: string, platform: 'ios' | 'android' | 'web' = 'ios', userId = 'user-1') =>
  ({ id: `dt-${++seq}`, userId, token, platform, isActive: true, createdAt: new Date(), updatedAt: new Date() }) as any;

const APNS_ENV = {
  APNS_KEY_ID: 'KEYID12345',
  APNS_TEAM_ID: 'TEAMID1234',
  APNS_PRIVATE_KEY: P8,
  APNS_BUNDLE_ID: 'com.example.test',
};

let logs: string[] = [];
const fmt = (args: unknown[]) => args.map((a) => (typeof a === 'string' ? a : inspect(a, { depth: 5 }))).join(' ');

async function load(env: Record<string, string | undefined>) {
  vi.resetModules();
  for (const k of ['APNS_KEY_ID', 'APNS_TEAM_ID', 'APNS_PRIVATE_KEY', 'APNS_BUNDLE_ID', 'APNS_ENVIRONMENT', 'FIREBASE_SERVICE_ACCOUNT']) {
    vi.stubEnv(k, '');
  }
  for (const [k, v] of Object.entries(env)) vi.stubEnv(k, v ?? '');
  const mod = await import('../server/pushService');
  loaded.push(mod.pushService);
  return mod;
}
const loaded: Array<{ close(): void }> = [];

const flush = async (n = 5) => {
  for (let i = 0; i < n; i++) await new Promise((r) => setImmediate(r));
};

const fcmOk = () => m.sendEach.mockImplementation(async (msgs: any[]) => ({
  successCount: msgs.length,
  failureCount: 0,
  responses: msgs.map(() => ({ success: true })),
}));

beforeEach(() => {
  logs = [];
  for (const level of ['log', 'info', 'warn', 'error', 'debug'] as const) {
    vi.spyOn(console, level).mockImplementation((...args: unknown[]) => {
      logs.push(fmt(args));
    });
  }
  m.connect.mockClear();
  m.sendEach.mockReset();
  m.initializeApp.mockClear();
  m.deactivateDeviceTokenById.mockClear();
  m.getDeviceTokensForUser.mockReset().mockResolvedValue([]);
  m.getDeviceTokensForUsers.mockReset().mockResolvedValue([]);
  m.getUsersByCompanyId.mockReset().mockResolvedValue([]);
  m.requests = [];
  m.sessions = [];
  m.open = 0;
  m.maxOpen = 0;
  m.reply = () => ({ status: 200 });
});

afterEach(() => {
  while (loaded.length) loaded.pop()!.close();
  vi.useRealTimers();
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

// Every test also checks that no log line holds a token or a piece of one.
function expectNoTokenInLogs(tokens: string[] = [IOS_TOKEN, IOS_TOKEN_2, FCM_TOKEN]) {
  const all = logs.join('\n').toLowerCase();
  for (const t of tokens) {
    for (let i = 0; i + 8 <= t.length; i++) {
      const piece = t.slice(i, i + 8).toLowerCase();
      if (all.includes(piece)) {
        throw new Error(`log contains token piece "${piece}":\n${logs.join('\n')}`);
      }
    }
  }
}

// ---- host (APNS_ENVIRONMENT allow-list, S-22) ------------------------------
describe('APNS_ENVIRONMENT picks the APNs host (allow-list)', () => {
  it('sandbox → api.sandbox.push.apple.com', async () => {
    const { pushService } = await load({ ...APNS_ENV, APNS_ENVIRONMENT: 'sandbox', NODE_ENV: 'production' });
    expect(await pushService.sendToDevice(row(IOS_TOKEN), { title: 't', body: 'b' })).toBe(true);
    expect(m.connect).toHaveBeenCalledWith('https://api.sandbox.push.apple.com:443');
  });

  it('production → api.push.apple.com', async () => {
    const { pushService } = await load({ ...APNS_ENV, APNS_ENVIRONMENT: 'production', NODE_ENV: 'test' });
    expect(await pushService.sendToDevice(row(IOS_TOKEN), { title: 't', body: 'b' })).toBe(true);
    expect(m.connect).toHaveBeenCalledWith('https://api.push.apple.com:443');
  });

  it("unset keeps today's NODE_ENV rule (production → live, otherwise sandbox)", async () => {
    const { resolveApnsHost } = await load({});
    expect(resolveApnsHost({ NODE_ENV: 'production' } as any)).toBe('api.push.apple.com');
    expect(resolveApnsHost({ NODE_ENV: 'development' } as any)).toBe('api.sandbox.push.apple.com');
    expect(resolveApnsHost({ NODE_ENV: 'production', APNS_ENVIRONMENT: '' } as any)).toBe('api.push.apple.com');
  });

  it('any other value turns APNs off, logged once at startup, and nothing connects (red if resolveApnsHost accepts any value)', async () => {
    const { pushService, resolveApnsHost } = await load({ ...APNS_ENV, APNS_ENVIRONMENT: 'evil.example.com' });
    expect(resolveApnsHost({ APNS_ENVIRONMENT: 'evil.example.com' } as any)).toBeNull();
    expect(resolveApnsHost({ APNS_ENVIRONMENT: 'Production' } as any)).toBeNull();
    expect(await pushService.sendToDevice(row(IOS_TOKEN), { title: 't', body: 'b' })).toBe(false);
    expect(await pushService.sendToDevice(row(IOS_TOKEN_2), { title: 't', body: 'b' })).toBe(false);
    expect(m.connect).not.toHaveBeenCalled();
    expect(logs.filter((l) => l.includes('APNS_ENVIRONMENT must be'))).toHaveLength(1);
    expect(logs.join('\n')).not.toContain('evil.example.com');
  });

  it('missing APNs keys: "APNs not configured" once at startup, not per send', async () => {
    const { pushService } = await load({});
    await pushService.sendToDevice(row(IOS_TOKEN), { title: 't', body: 'b' });
    await pushService.sendToDevice(row(IOS_TOKEN_2), { title: 't', body: 'b' });
    expect(logs.filter((l) => l.includes('APNs not configured'))).toHaveLength(1);
    expect(m.connect).not.toHaveBeenCalled();
  });
});

// ---- timeouts --------------------------------------------------------------
describe('timeouts (S-22)', () => {
  it('an APNs request with no answer resolves false after 10 s and keeps the token (red if the APNS_TIMEOUT_MS timer is removed)', async () => {
    const { pushService } = await load({ ...APNS_ENV, APNS_ENVIRONMENT: 'sandbox' });
    m.reply = () => 'hang';
    vi.useFakeTimers();
    let result: boolean | undefined;
    pushService.sendToDevice(row(IOS_TOKEN), { title: 't', body: 'b' }).then((r) => (result = r));
    await vi.advanceTimersByTimeAsync(9_999);
    expect(result).toBeUndefined();
    await vi.advanceTimersByTimeAsync(2);
    expect(result).toBe(false);
    expect(m.requests[0].stream.close).toHaveBeenCalled();
    expect(m.deactivateDeviceTokenById).not.toHaveBeenCalled();
    expect(logs.some((l) => l.includes('APNs timeout'))).toBe(true);
    expectNoTokenInLogs();
  });

  it('an FCM batch with no answer resolves false after 10 s and keeps the token (red if the FCM Promise.race timeout is removed)', async () => {
    const { pushService } = await load({ FIREBASE_SERVICE_ACCOUNT: '{"project_id":"p"}' });
    m.sendEach.mockImplementation(() => new Promise(() => undefined));
    vi.useFakeTimers();
    let result: boolean | undefined;
    pushService.sendToDevice(row(FCM_TOKEN, 'android'), { title: 't', body: 'b' }).then((r) => (result = r));
    await vi.advanceTimersByTimeAsync(9_999);
    expect(result).toBeUndefined();
    await vi.advanceTimersByTimeAsync(2);
    expect(result).toBe(false);
    expect(m.deactivateDeviceTokenById).not.toHaveBeenCalled();
    expectNoTokenInLogs();
  });
});

// ---- token cleanup ---------------------------------------------------------
describe('APNs token cleanup: only dead-token answers deactivate', () => {
  const cases: Array<[string, number, string | undefined, boolean]> = [
    ['410 Unregistered deactivates', 410, 'Unregistered', true],
    ['400 BadDeviceToken deactivates', 400, 'BadDeviceToken', true],
    ['400 DeviceTokenNotForTopic deactivates', 400, 'DeviceTokenNotForTopic', true],
    ['400 BadTopic keeps the token (red if the rule goes back to `400 || 410`)', 400, 'BadTopic', false],
    ['400 with no reason keeps the token', 400, undefined, false],
    ['403 InvalidProviderToken keeps the token (red if 403 joins the deactivate set)', 403, 'InvalidProviderToken', false],
    ['500 keeps the token', 500, 'InternalServerError', false],
  ];
  for (const [title, status, reason, dead] of cases) {
    it(title, async () => {
      const { pushService } = await load({ ...APNS_ENV, APNS_ENVIRONMENT: 'sandbox' });
      m.reply = () => ({ status, body: reason ? JSON.stringify({ reason }) : '' });
      const t = row(IOS_TOKEN);
      expect(await pushService.sendToDevice(t, { title: 't', body: 'b' })).toBe(false);
      if (dead) {
        // By row id, never by the token string (red if deactivate goes back to the token string).
        expect(m.deactivateDeviceTokenById).toHaveBeenCalledWith(t.id);
        expect(m.deactivateDeviceTokenById).not.toHaveBeenCalledWith(IOS_TOKEN);
      } else {
        expect(m.deactivateDeviceTokenById).not.toHaveBeenCalled();
      }
      if (!dead && (status === 400 || status === 403)) {
        expect(logs.some((l) => l.includes('APNs config error') && (!reason || l.includes(reason)))).toBe(true);
      }
      expectNoTokenInLogs();
    });
  }

  it('an APNs reason that is not a plain word is logged as "unknown" (no echo of response text)', async () => {
    const { pushService } = await load({ ...APNS_ENV, APNS_ENVIRONMENT: 'sandbox' });
    m.reply = () => ({ status: 400, body: JSON.stringify({ reason: `x ${IOS_TOKEN}` }) });
    await pushService.sendToDevice(row(IOS_TOKEN), { title: 't', body: 'b' });
    expect(logs.some((l) => l.includes('unknown'))).toBe(true);
    expectNoTokenInLogs();
  });
});

describe('FCM token cleanup', () => {
  const codes: Array<[string, boolean]> = [
    ['messaging/registration-token-not-registered', true],
    ['messaging/invalid-registration-token', true],
    ['messaging/internal-error', false],
    ['messaging/third-party-auth-error', false],
  ];
  for (const [code, dead] of codes) {
    it(`${code} ${dead ? 'deactivates' : 'keeps'} the token (FCM_DEAD_TOKEN_CODES)`, async () => {
      const { pushService } = await load({ FIREBASE_SERVICE_ACCOUNT: '{"project_id":"p"}' });
      m.sendEach.mockResolvedValue({
        successCount: 0,
        failureCount: 1,
        responses: [{ success: false, error: { code, message: `bad token ${FCM_TOKEN}` } }],
      });
      const t = row(FCM_TOKEN, 'android');
      expect(await pushService.sendToDevice(t, { title: 't', body: 'b' })).toBe(false);
      if (dead) expect(m.deactivateDeviceTokenById).toHaveBeenCalledWith(t.id);
      else expect(m.deactivateDeviceTokenById).not.toHaveBeenCalled();
      expect(logs.some((l) => l.includes(code))).toBe(true);
      expectNoTokenInLogs();
    });
  }

  it('a thrown sendEach logs only the code, never err.message', async () => {
    const { pushService } = await load({ FIREBASE_SERVICE_ACCOUNT: '{"project_id":"p"}' });
    m.sendEach.mockRejectedValue(Object.assign(new Error(`boom ${FCM_TOKEN}`), { code: 'app/network-error' }));
    expect(await pushService.sendToDevice(row(FCM_TOKEN, 'android'), { title: 't', body: 'b' })).toBe(false);
    expect(m.deactivateDeviceTokenById).not.toHaveBeenCalled();
    expectNoTokenInLogs();
  });
});

// ---- send-time checks ------------------------------------------------------
describe('send-time checks', () => {
  it('a non-hex iOS token is skipped, deactivated and never put in a request path (red if the IOS_TOKEN_RE check is removed)', async () => {
    const { pushService } = await load({ ...APNS_ENV, APNS_ENVIRONMENT: 'sandbox' });
    const bad = '../../3/device/zz' + 'q'.repeat(60);
    const t = row(bad);
    expect(await pushService.sendToDevice(t, { title: 't', body: 'b' })).toBe(false);
    expect(m.requests).toHaveLength(0);
    expect(m.deactivateDeviceTokenById).toHaveBeenCalledWith(t.id);
    expectNoTokenInLogs([bad]);
  });

  it('a too-short hex iOS token (63 chars) is skipped too', async () => {
    const { pushService } = await load({ ...APNS_ENV, APNS_ENVIRONMENT: 'sandbox' });
    expect(await pushService.sendToDevice(row(IOS_TOKEN.slice(1)), { title: 't', body: 'b' })).toBe(false);
    expect(m.requests).toHaveLength(0);
  });

  it('the same token on two rows (two users) is sent once (red if dedupeTokens is removed)', async () => {
    const { pushService } = await load({
      ...APNS_ENV,
      APNS_ENVIRONMENT: 'sandbox',
      FIREBASE_SERVICE_ACCOUNT: '{"project_id":"p"}',
    });
    fcmOk();
    m.getDeviceTokensForUsers.mockResolvedValue([
      row(IOS_TOKEN, 'ios', 'u1'),
      row(IOS_TOKEN, 'ios', 'u2'),
      row(FCM_TOKEN, 'android', 'u1'),
      row(FCM_TOKEN, 'android', 'u2'),
    ]);
    await pushService.sendToUsers(['u1', 'u2', 'u1'], { title: 't', body: 'b' });
    expect(m.getDeviceTokensForUsers).toHaveBeenCalledWith(['u1', 'u2']);
    expect(m.requests).toHaveLength(1);
    expect(m.sendEach).toHaveBeenCalledTimes(1);
    expect(m.sendEach.mock.calls[0][0]).toHaveLength(1);
  });

  it(`at most ${100} APNs streams are in flight; the rest wait (red if the APNS_MAX_STREAMS cap is removed)`, async () => {
    const { pushService } = await load({ ...APNS_ENV, APNS_ENVIRONMENT: 'sandbox' });
    m.reply = () => 'hang';
    const rows = Array.from({ length: 150 }, (_, i) => row(i.toString(16).padStart(64, 'a')));
    const done = pushService.sendToDevices(rows, { title: 't', body: 'b' });
    await flush();
    expect(m.requests).toHaveLength(100);
    expect(m.open).toBe(100);
    // Answer the first 100; the queued 50 then go out, never above 100 at once.
    for (const r of m.requests.slice(0, 100)) r.stream.respond({ status: 200 });
    await flush();
    expect(m.requests).toHaveLength(150);
    for (const r of m.requests.slice(100)) r.stream.respond({ status: 200 });
    const results = await done;
    expect(results).toHaveLength(150);
    expect(results.every(Boolean)).toBe(true);
    expect(m.maxOpen).toBe(100);
    expect(m.connect).toHaveBeenCalledTimes(1); // one session per host
  });

  it('FCM sendEach goes out in batches of at most 500 (red if FCM_BATCH_SIZE chunking is removed)', async () => {
    const { pushService } = await load({ FIREBASE_SERVICE_ACCOUNT: '{"project_id":"p"}' });
    fcmOk();
    const rows = Array.from({ length: 1200 }, (_, i) => row(`fcm-${i}`, i % 2 ? 'android' : 'web'));
    const results = await pushService.sendToDevices(rows, { title: 't', body: 'b' });
    expect(m.sendEach.mock.calls.map((c) => c[0].length)).toEqual([500, 500, 200]);
    expect(results).toHaveLength(1200);
    expect(results.every(Boolean)).toBe(true);
  });

  it('a goaway drops the session and the next send reconnects', async () => {
    const { pushService } = await load({ ...APNS_ENV, APNS_ENVIRONMENT: 'sandbox' });
    await pushService.sendToDevice(row(IOS_TOKEN), { title: 't', body: 'b' });
    await pushService.sendToDevice(row(IOS_TOKEN_2), { title: 't', body: 'b' });
    expect(m.connect).toHaveBeenCalledTimes(1);
    m.sessions[0].emit('goaway');
    expect(m.sessions[0].close).toHaveBeenCalled();
    expect(await pushService.sendToDevice(row(IOS_TOKEN), { title: 't', body: 'b' })).toBe(true);
    expect(m.connect).toHaveBeenCalledTimes(2);
  });

  it('a session error is logged by code only, and the next send reconnects', async () => {
    const { pushService } = await load({ ...APNS_ENV, APNS_ENVIRONMENT: 'sandbox' });
    await pushService.sendToDevice(row(IOS_TOKEN), { title: 't', body: 'b' });
    m.sessions[0].emit('error', Object.assign(new Error(`tls ${IOS_TOKEN}`), { code: 'ECONNRESET' }));
    expect(m.sessions[0].destroy).toHaveBeenCalled();
    expect(await pushService.sendToDevice(row(IOS_TOKEN), { title: 't', body: 'b' })).toBe(true);
    expect(m.connect).toHaveBeenCalledTimes(2);
    expect(logs.some((l) => l.includes('ECONNRESET'))).toBe(true);
    expectNoTokenInLogs();
  });

  it('the session closes after 60 s idle', async () => {
    const { pushService } = await load({ ...APNS_ENV, APNS_ENVIRONMENT: 'sandbox' });
    vi.useFakeTimers();
    const p = pushService.sendToDevice(row(IOS_TOKEN), { title: 't', body: 'b' });
    await vi.advanceTimersByTimeAsync(0);
    expect(await p).toBe(true);
    expect(m.sessions[0].close).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(60_000);
    expect(m.sessions[0].close).toHaveBeenCalled();
  });
});

// ---- payload ---------------------------------------------------------------
describe('payload', () => {
  it('no badge in the aps payload by default (red if `badge: payload.badge ?? 1` returns)', async () => {
    const { pushService } = await load({ ...APNS_ENV, APNS_ENVIRONMENT: 'sandbox' });
    await pushService.sendToDevice(row(IOS_TOKEN), { title: 't', body: 'b' });
    const body = JSON.parse(m.requests[0].body);
    expect(body.aps).not.toHaveProperty('badge');
    expect(body.aps.sound).toBe('default');
  });

  it('path and headers: /3/device/<token>, topic, alert push type, priority 10, bearer JWT', async () => {
    const { pushService } = await load({ ...APNS_ENV, APNS_ENVIRONMENT: 'sandbox' });
    await pushService.sendToDevice(row(IOS_TOKEN), { title: 't', body: 'b' });
    const h = m.requests[0].headers;
    expect(h[':method']).toBe('POST');
    expect(h[':path']).toBe(`/3/device/${IOS_TOKEN}`);
    expect(h['apns-topic']).toBe('com.example.test');
    expect(h['apns-push-type']).toBe('alert');
    expect(h['apns-priority']).toBe('10');
    expect(String(h.authorization)).toMatch(/^bearer [\w-]+\.[\w-]+\.[\w-]+$/);
  });

  it('apns-expiration is an absolute epoch in the future, and absent (never "0") when not asked (red if it goes back to "0" or a duration)', async () => {
    const { pushService } = await load({ ...APNS_ENV, APNS_ENVIRONMENT: 'sandbox' });
    const before = Math.floor(Date.now() / 1000);
    await pushService.sendToDevice(row(IOS_TOKEN), { title: 't', body: 'b', expiresInSec: 3600, collapseId: 'route-1' });
    const h = m.requests[0].headers;
    const exp = Number(h['apns-expiration']);
    expect(exp).toBeGreaterThanOrEqual(before + 3600);
    expect(exp).toBeLessThanOrEqual(Math.floor(Date.now() / 1000) + 3600);
    expect(h['apns-collapse-id']).toBe('route-1');

    await pushService.sendToDevice(row(IOS_TOKEN_2), { title: 't', body: 'b' });
    expect(m.requests[1].headers).not.toHaveProperty('apns-expiration');
  });

  it('the FCM android payload carries channelId, icon, color, tag and ttl (red if channelId/icon are dropped)', async () => {
    const { pushService } = await load({ FIREBASE_SERVICE_ACCOUNT: '{"project_id":"p"}' });
    fcmOk();
    await pushService.sendToDevice(row(FCM_TOKEN, 'android'), {
      title: 't',
      body: 'b',
      collapseId: 'route-1',
      expiresInSec: 600,
      channelId: 'messages',
    });
    const msg = m.sendEach.mock.calls[0][0][0];
    expect(msg.android.notification).toMatchObject({
      channelId: 'messages',
      icon: 'ic_stat_notify',
      color: '#1e40af',
      tag: 'route-1',
    });
    expect(msg.android.ttl).toBe(600_000);

    await pushService.sendToDevice(row('fcm-2', 'android'), { title: 't', body: 'b', sound: 'critical' });
    const msg2 = m.sendEach.mock.calls[1][0][0];
    expect(msg2.android.notification.channelId).toBe('bus_updates');
    expect(msg2.android.notification.icon).toBe('ic_stat_notify');
    expect(msg2.android.notification.sound).toBe('default');
  });

  it('notifyUsersOfAlert: an emergency uses the default sound (no "critical" branch) and the EMERGENCY category', async () => {
    const { pushService } = await load({ ...APNS_ENV, APNS_ENVIRONMENT: 'sandbox' });
    m.getDeviceTokensForUsers.mockResolvedValue([row(IOS_TOKEN, 'ios', 'p1')]);
    await pushService.notifyUsersOfAlert(['p1'], 'Alert', 'Bus delayed', 'emergency');
    const body = JSON.parse(m.requests[0].body);
    expect(body.aps.sound).toBe('default');
    expect(body.aps.category).toBe('EMERGENCY');
  });

  for (const adminType of ['emergency', 'delay', 'info', 'route_change']) {
    it(`notifyUsersOfAlert (${adminType}): data is exactly { type: 'alert' }, no companyId (red if the admin type goes back into data.type, B1)`, async () => {
      const { pushService } = await load({ FIREBASE_SERVICE_ACCOUNT: '{"project_id":"p"}' });
      m.sendEach.mockResolvedValue({ successCount: 1, failureCount: 0, responses: [{ success: true }] });
      m.getDeviceTokensForUsers.mockResolvedValue([row('fcm-alert', 'android', 'p1')]);
      await pushService.notifyUsersOfAlert(['p1'], 'Alert', 'Bus delayed', adminType);
      const msg = m.sendEach.mock.calls[0][0][0];
      expect(msg.data).toEqual({ type: 'alert' });
    });
  }

  it('notifyUsersOfAlert sends to exactly the given ids', async () => {
    const { pushService } = await load({ ...APNS_ENV, APNS_ENVIRONMENT: 'sandbox' });
    await pushService.notifyUsersOfAlert(['p1', 'p2', 'p1'], 'Alert', 'Bus delayed', 'delay');
    expect(m.getDeviceTokensForUsers).toHaveBeenCalledWith(['p1', 'p2']);
    expect(m.getUsersByCompanyId).not.toHaveBeenCalled();
  });
});

// ---- notifyNewMessage --------------------------------------------------------
describe('notifyNewMessage', () => {
  const SECRET_TEXT = 'pick-up moved to the back gate at 3pm';

  it('the body is exactly "{name} sent you a message", never the message text (red if content goes back in the body)', async () => {
    const { pushService } = await load({
      ...APNS_ENV,
      APNS_ENVIRONMENT: 'sandbox',
      FIREBASE_SERVICE_ACCOUNT: '{"project_id":"p"}',
    });
    fcmOk();
    m.getDeviceTokensForUser.mockResolvedValue([row(IOS_TOKEN, 'ios', 'recipient-1'), row(FCM_TOKEN, 'android', 'recipient-1')]);
    await pushService.notifyNewMessage('recipient-1', 'Ann', SECRET_TEXT);
    const apns = m.requests[0].body;
    expect(JSON.parse(apns).aps.alert.body).toBe('Ann sent you a message');
    expect(apns).not.toContain('back gate');
    const fcm = JSON.stringify(m.sendEach.mock.calls[0][0][0]);
    expect(fcm).not.toContain('back gate');
    expect(m.sendEach.mock.calls[0][0][0].notification.body).toBe('Ann sent you a message');
    expect(logs.join('\n')).not.toContain('back gate');
  });

  it('data.senderId is the sender when given, absent otherwise, and never the recipient (red if `senderId: recipientId` returns)', async () => {
    const { pushService } = await load({ ...APNS_ENV, APNS_ENVIRONMENT: 'sandbox' });
    m.getDeviceTokensForUser.mockResolvedValue([row(IOS_TOKEN, 'ios', 'recipient-1')]);

    await pushService.notifyNewMessage('recipient-1', 'Ann', SECRET_TEXT);
    expect(JSON.parse(m.requests[0].body)).not.toHaveProperty('senderId');

    await pushService.notifyNewMessage('recipient-1', 'Ann', SECRET_TEXT, 'sender-9');
    expect(JSON.parse(m.requests[1].body).senderId).toBe('sender-9');

    await pushService.notifyNewMessage('recipient-1', 'Ann', SECRET_TEXT, 'recipient-1');
    expect(JSON.parse(m.requests[2].body)).not.toHaveProperty('senderId');

    for (const r of m.requests) expect(JSON.parse(r.body).senderId).not.toBe('recipient-1');
  });
});

// ---- startup logs (S-13 / S-15) ---------------------------------------------
describe('startup logs', () => {
  it('a bad FIREBASE_SERVICE_ACCOUNT logs only the fixed message, never the error or the JSON text (red if `err` is logged in the init catch)', async () => {
    const { pushService } = await load({ FIREBASE_SERVICE_ACCOUNT: '{"private_key": SECRETKEYMATERIAL123}' });
    expect(logs.some((l) => l.includes('FIREBASE_SERVICE_ACCOUNT is not valid JSON'))).toBe(true);
    const all = logs.join('\n');
    expect(all).not.toContain('SECRETKEYMATERIAL');
    expect(all).not.toContain('private_key');
    expect(all).not.toMatch(/SyntaxError|Unexpected token/);
    expect(m.initializeApp).not.toHaveBeenCalled();
    expect(await pushService.sendToDevice(row(FCM_TOKEN, 'android'), { title: 't', body: 'b' })).toBe(false);
  });

  it('an unset FIREBASE_SERVICE_ACCOUNT logs "FCM not configured" once at startup, not per send', async () => {
    const { pushService } = await load({});
    await pushService.sendToDevice(row(FCM_TOKEN, 'android'), { title: 't', body: 'b' });
    await pushService.sendToDevice(row('fcm-x', 'android'), { title: 't', body: 'b' });
    expect(logs.filter((l) => l.includes('FCM not configured'))).toHaveLength(1);
    expect(m.sendEach).not.toHaveBeenCalled();
  });

  it('no log line contains the APNs private key or the JWT', async () => {
    const { pushService } = await load({ ...APNS_ENV, APNS_ENVIRONMENT: 'sandbox' });
    m.reply = () => ({ status: 403, body: JSON.stringify({ reason: 'InvalidProviderToken' }) });
    await pushService.sendToDevice(row(IOS_TOKEN), { title: 't', body: 'b' });
    const all = logs.join('\n');
    expect(all).not.toContain('PRIVATE KEY');
    expect(all).not.toContain(String(m.requests[0].headers.authorization).slice(7, 30));
    expectNoTokenInLogs();
  });
});

// ---- round 2 ----------------------------------------------------------------
describe('Firebase initializeApp failure (S-13 / S-15)', () => {
  const MARKER = 'SVCACCTMARKER7731';
  const ACCOUNT = JSON.stringify({ project_id: 'p', private_key: `-----BEGIN ${MARKER}-----` });

  it('a throwing initializeApp logs only the fixed "init failed" line, never the error or account text (red if `err` is logged in the initializeApp catch)', async () => {
    m.initializeApp.mockImplementationOnce(() => {
      throw new Error(`Failed to parse private key: ${MARKER} Invalid PEM`);
    });
    const { pushService } = await load({ FIREBASE_SERVICE_ACCOUNT: ACCOUNT });
    expect(m.initializeApp).toHaveBeenCalledTimes(1);
    expect(logs.some((l) => l.includes('Firebase Admin SDK init failed'))).toBe(true);
    const all = logs.join('\n');
    expect(all).not.toContain(MARKER);
    expect(all).not.toContain('Error');
    expect(all).not.toContain('private key');
    expect(await pushService.sendToDevice(row(FCM_TOKEN, 'android'), { title: 't', body: 'b' })).toBe(false);
    expect(m.sendEach).not.toHaveBeenCalled();
  });

  it('a throwing credential.cert is handled the same way', async () => {
    m.cert.mockImplementationOnce(() => {
      throw new Error(`Service account object must contain ${MARKER}`);
    });
    const { pushService } = await load({ FIREBASE_SERVICE_ACCOUNT: ACCOUNT });
    expect(logs.some((l) => l.includes('Firebase Admin SDK init failed'))).toBe(true);
    expect(logs.join('\n')).not.toContain(MARKER);
    expect(await pushService.sendToDevice(row(FCM_TOKEN, 'android'), { title: 't', body: 'b' })).toBe(false);
  });
});

describe('APNs JWT reset on provider-token errors', () => {
  const auth = (i: number) => String(m.requests[i].headers.authorization);

  for (const reason of ['ExpiredProviderToken', 'InvalidProviderToken']) {
    it(`403 ${reason} drops the cached JWT so the next send signs a new one, and keeps the device token (red if the APNS_JWT_REJECTED_REASONS clearing is removed)`, async () => {
      const { pushService } = await load({ ...APNS_ENV, APNS_ENVIRONMENT: 'sandbox' });
      m.reply = () => ({ status: 403, body: JSON.stringify({ reason }) });
      expect(await pushService.sendToDevice(row(IOS_TOKEN), { title: 't', body: 'b' })).toBe(false);
      m.reply = () => ({ status: 200 });
      expect(await pushService.sendToDevice(row(IOS_TOKEN), { title: 't', body: 'b' })).toBe(true);
      // ES256 signatures are randomised, so a fresh signature never equals the old one.
      expect(auth(1)).not.toBe(auth(0));
      expect(m.deactivateDeviceTokenById).not.toHaveBeenCalled();
      expectNoTokenInLogs();
    });
  }

  it('other answers keep the cached JWT (it is reused, not re-signed per send)', async () => {
    const { pushService } = await load({ ...APNS_ENV, APNS_ENVIRONMENT: 'sandbox' });
    m.reply = () => ({ status: 403, body: JSON.stringify({ reason: 'TopicDisallowed' }) });
    await pushService.sendToDevice(row(IOS_TOKEN), { title: 't', body: 'b' });
    m.reply = () => ({ status: 200 });
    await pushService.sendToDevice(row(IOS_TOKEN), { title: 't', body: 'b' });
    await pushService.sendToDevice(row(IOS_TOKEN_2), { title: 't', body: 'b' });
    expect(auth(1)).toBe(auth(0));
    expect(auth(2)).toBe(auth(0));
  });
});

describe('tests/integration/setup.ts pushService mock is complete', () => {
  // Private helpers on the class: not callable from routes, so not mocked.
  const PRIVATE_METHODS = new Set([
    'constructor',
    'getAPNsJwt',
    'deactivate',
    'sendToAPNs',
    'fcmMessage',
    'sendToFCM',
    'alertPayload',
  ]);

  it('mocks every module export and every public PushService method (red if a new export or method is added without a mock entry)', async () => {
    const { readFileSync } = await import('fs');
    const src = readFileSync(new URL('./integration/setup.ts', import.meta.url), 'utf8');
    const start = src.indexOf("vi.mock('../../server/pushService'");
    expect(start).toBeGreaterThan(-1);
    const block = src.slice(start, src.indexOf('\n});', start));
    const mocked = new Set(
      [...block.matchAll(/^\s+([A-Za-z_]\w*)(?::|,)/gm)].map((x) => x[1]),
    );

    const real = await load({});
    for (const name of Object.keys(real)) {
      expect(mocked, `export "${name}" is missing from the setup.ts pushService mock`).toContain(name);
    }
    const methods = Object.getOwnPropertyNames(real.PushService.prototype).filter((n) => !PRIVATE_METHODS.has(n));
    expect(methods.length).toBeGreaterThan(5);
    for (const name of methods) {
      expect(mocked, `pushService.${name} is missing from the setup.ts mock`).toContain(name);
    }
  });
});

// ---- Q167: Apple push settings cleaned and checked at startup ---------------
describe('Q167 APNs settings are trimmed, repaired and checked once at startup (names-only lines)', () => {
  const jwtParts = (i = 0) => {
    const token = String(m.requests[i].headers.authorization).slice('bearer '.length);
    const [h, p] = token.split('.');
    const dec = (s: string) => JSON.parse(Buffer.from(s, 'base64url').toString('utf8'));
    return { token, header: dec(h), payload: dec(p) };
  };
  const BODY = P8.replace(/-----(BEGIN|END) PRIVATE KEY-----/g, '').replace(/\s+/g, '');
  const rsaPem = crypto.generateKeyPairSync('rsa', { modulusLength: 2048 }).privateKey.export({ type: 'pkcs8', format: 'pem' }).toString();
  const p384Pem = crypto.generateKeyPairSync('ec', { namedCurve: 'P-384' }).privateKey.export({ type: 'pkcs8', format: 'pem' }).toString();
  const bodyOf = (pem: string) => pem.replace(/-----(BEGIN|END) PRIVATE KEY-----/g, '').replace(/\s+/g, '');
  const BAD_KEY_ID = 'KEYID1234'; // 9 characters
  const BAD_BUNDLE = 'com.example .test'; // a space inside
  // Q171: a converted (SEC1) P-256 key, the shape Apple never issues.
  const sec1Pem = crypto.generateKeyPairSync('ec', { namedCurve: 'P-256' }).privateKey.export({ type: 'sec1', format: 'pem' }).toString();
  const SEC1_LINE = 'APNs setting problem: APNS_PRIVATE_KEY is a SEC1 "EC PRIVATE KEY"; paste Apple\'s .p8 file (BEGIN PRIVATE KEY); iOS push is off';
  const ODD_NAME = 'APNS_key id'; // lower case and a space: never printed
  const SECRET_VALUES = ['KEYID12345', 'TEAMID1234', 'com.example.test', BAD_KEY_ID, BAD_BUNDLE, ODD_NAME, 'key id'];
  const SECRET_BODIES = [BODY, bodyOf(rsaPem), bodyOf(p384Pem), sec1Pem.replace(/-----(BEGIN|END) EC PRIVATE KEY-----/g, '').replace(/\s+/g, '')];

  // Q171 (O-3): every test in this describe checks its OWN log lines, so each one
  // passes when run alone with -t (red if a startup line logs a setting value or
  // any 16-character slice of a key body).
  function expectNoSecretInLogs(lines: string[]) {
    const all = lines.join('\n');
    for (const v of SECRET_VALUES) expect(all, `log contains the value "${v}"`).not.toContain(v);
    for (const body of SECRET_BODIES) {
      for (let i = 0; i + 16 <= body.length; i++) {
        if (all.includes(body.slice(i, i + 16))) throw new Error(`log contains a 16-character slice of a test key body at offset ${i}`);
      }
    }
  }
  afterEach(() => {
    expectNoSecretInLogs(logs);
  });

  it('(1) padded APNS_KEY_ID / APNS_TEAM_ID / APNS_BUNDLE_ID → kid, iss and apns-topic are the trimmed values, and the trimmed line names them (red if APNs settings stop being trimmed)', async () => {
    const { pushService } = await load({
      APNS_KEY_ID: 'KEYID12345 ',
      APNS_TEAM_ID: 'TEAMID1234\n',
      APNS_BUNDLE_ID: ' com.example.test\r\n',
      APNS_PRIVATE_KEY: P8,
      APNS_ENVIRONMENT: 'sandbox',
    });
    expect(await pushService.sendToDevice(row(IOS_TOKEN), { title: 't', body: 'b' })).toBe(true);
    const { header, payload } = jwtParts();
    expect(header.kid).toBe('KEYID12345');
    expect(payload.iss).toBe('TEAMID1234');
    expect(m.requests[0].headers['apns-topic']).toBe('com.example.test');
    expect(logs).toContain('APNs settings had extra spaces trimmed: APNS_KEY_ID, APNS_TEAM_ID, APNS_BUNDLE_ID');
  });

  const KEY_FORMS: Array<[string, string]> = [
    ['the clean PEM', P8],
    ['literal \\n', P8.replace(/\n/g, '\\n')],
    ['CRLF', P8.replace(/\n/g, '\r\n')],
    ['the bare base64 body', BODY],
    ['newlines turned into spaces', P8.replace(/\n/g, ' ')],
  ];
  for (const [form, key] of KEY_FORMS) {
    it(`(2) key as ${form} signs an ES256 JWT that verifies (red if the key repair path is removed)`, async () => {
      const jwtLib = (await import('jsonwebtoken')).default;
      const { pushService } = await load({ ...APNS_ENV, APNS_PRIVATE_KEY: key, APNS_ENVIRONMENT: 'sandbox' });
      expect(await pushService.sendToDevice(row(IOS_TOKEN), { title: 't', body: 'b' })).toBe(true);
      const { token, header } = jwtParts();
      expect(header.alg).toBe('ES256');
      expect(() => jwtLib.verify(token, crypto.createPublicKey(P8), { algorithms: ['ES256'] })).not.toThrow();
      expect(logs.some((l) => l.includes('APNs setting problem'))).toBe(false);
    });
  }

  const BAD_KEYS: Array<[string, string]> = [
    ['an RSA key', rsaPem],
    ['an EC P-384 key', p384Pem],
    ['the text "not a key"', 'not a key'],
  ];
  for (const [what, key] of BAD_KEYS) {
    it(`(3) ${what} → iOS push off with the EC line, no signing or request at send time (red if the EC P-256 check is removed)`, async () => {
      const { pushService } = await load({ ...APNS_ENV, APNS_PRIVATE_KEY: key, APNS_ENVIRONMENT: 'sandbox' });
      expect(logs).toContain('APNs setting problem: APNS_PRIVATE_KEY is not an EC P-256 private key; iOS push is off');
      expect(await pushService.sendToDevice(row(IOS_TOKEN), { title: 't', body: 'b' })).toBe(false);
      expect(m.connect).not.toHaveBeenCalled();
      expect(m.requests).toHaveLength(0);
      expect(logs.some((l) => l.includes('JwtSignFailed'))).toBe(false);
    });
  }

  it('(4) missing settings → the startup line lists exactly the missing names (red if the missing-names line stops naming the settings)', async () => {
    const { pushService } = await load({ APNS_KEY_ID: 'KEYID12345', APNS_PRIVATE_KEY: P8, APNS_BUNDLE_ID: '   ' });
    expect(logs).toContain('APNs not configured (missing: APNS_TEAM_ID, APNS_BUNDLE_ID); iOS push is off');
    expect(await pushService.sendToDevice(row(IOS_TOKEN), { title: 't', body: 'b' })).toBe(false);
    expect(m.connect).not.toHaveBeenCalled();
  });

  it('(5) APNS_KEYS_ID → "did you mean APNS_KEY_ID?"; APNS_FOO → no suggestion; push stays on (red if unknown APNS_ names stop being reported)', async () => {
    const { pushService } = await load({ ...APNS_ENV, APNS_ENVIRONMENT: 'sandbox', APNS_KEYS_ID: 'KEYID12345', APNS_FOO: 'x' });
    expect(logs).toContain('APNs unknown setting name APNS_KEYS_ID (did you mean APNS_KEY_ID?)');
    expect(logs).toContain('APNs unknown setting name APNS_FOO');
    expect(await pushService.sendToDevice(row(IOS_TOKEN), { title: 't', body: 'b' })).toBe(true);
  });

  const SHAPES: Array<[string, Record<string, string>, string]> = [
    ['a 9-character APNS_KEY_ID', { APNS_KEY_ID: BAD_KEY_ID }, 'APNs setting problem: APNS_KEY_ID must be exactly 10 characters, A-Z or 0-9; iOS push is off'],
    ['an APNS_BUNDLE_ID with a space inside', { APNS_BUNDLE_ID: BAD_BUNDLE }, 'APNs setting problem: APNS_BUNDLE_ID must be dot-separated parts of letters, digits or hyphens (like com.example.app); iOS push is off'],
  ];
  for (const [what, over, line] of SHAPES) {
    it(`(6) ${what} → iOS push off with the named rule (red if the shape checks are removed)`, async () => {
      const { pushService } = await load({ ...APNS_ENV, ...over, APNS_ENVIRONMENT: 'sandbox' });
      expect(logs).toContain(line);
      expect(await pushService.sendToDevice(row(IOS_TOKEN), { title: 't', body: 'b' })).toBe(false);
      expect(m.connect).not.toHaveBeenCalled();
    });
  }

  it('(8) a SEC1 "EC PRIVATE KEY" → the SEC1 line, push off, no connect (red if the SEC1 check is removed)', async () => {
    const { pushService } = await load({ ...APNS_ENV, APNS_PRIVATE_KEY: sec1Pem, APNS_ENVIRONMENT: 'sandbox' });
    expect(logs).toContain(SEC1_LINE);
    expect(logs.some((l) => l.includes('is not an EC P-256 private key'))).toBe(false);
    expect(await pushService.sendToDevice(row(IOS_TOKEN), { title: 't', body: 'b' })).toBe(false);
    expect(m.connect).not.toHaveBeenCalled();
    expect(m.requests).toHaveLength(0);
  });

  it('(9) the same SEC1 key written with literal \\n → the same SEC1 line (red if the SEC1 check runs on the repaired value)', async () => {
    const { pushService } = await load({ ...APNS_ENV, APNS_PRIVATE_KEY: sec1Pem.replace(/\n/g, '\\n'), APNS_ENVIRONMENT: 'sandbox' });
    expect(logs).toContain(SEC1_LINE);
    expect(await pushService.sendToDevice(row(IOS_TOKEN), { title: 't', body: 'b' })).toBe(false);
    expect(m.connect).not.toHaveBeenCalled();
  });

  it('(10) readApnsConfig returns no privateKeyPem; readApnsPrivateKey gives the PEM (red if the key goes back into the config)', async () => {
    const { readApnsConfig, readApnsPrivateKey } = await load({});
    const env = { ...APNS_ENV, APNS_ENVIRONMENT: 'sandbox' };
    const cfg = readApnsConfig(env);
    expect(cfg.ready).toBe(true);
    expect('privateKeyPem' in cfg).toBe(false);
    expect(JSON.stringify(cfg)).not.toContain(BODY.slice(0, 16));
    expect(readApnsPrivateKey(env)).toContain('-----BEGIN PRIVATE KEY-----');
    expect(readApnsPrivateKey({ ...env, APNS_PRIVATE_KEY: sec1Pem })).toBe('');
    expect(readApnsPrivateKey({ ...env, APNS_PRIVATE_KEY: '' })).toBe('');
  });

  it('(11) an APNS_ name with lower case or a space is not printed; one count line is (red if odd names are printed)', async () => {
    const { pushService } = await load({ ...APNS_ENV, APNS_ENVIRONMENT: 'sandbox', [ODD_NAME]: 'x', APNS_FOO: 'x' });
    expect(logs).toContain('APNs: 1 other APNS_ setting name(s) with unusual characters, not shown');
    expect(logs).toContain('APNs unknown setting name APNS_FOO');
    expect(logs.join('\n')).not.toContain('key id');
    expect(await pushService.sendToDevice(row(IOS_TOKEN), { title: 't', body: 'b' })).toBe(true);
  });
});
