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
  removeDeviceToken: vi.fn(async () => undefined),
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
    removeDeviceToken: m.removeDeviceToken,
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
  m.removeDeviceToken.mockClear();
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
    expect(m.removeDeviceToken).not.toHaveBeenCalled();
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
    expect(m.removeDeviceToken).not.toHaveBeenCalled();
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
      expect(await pushService.sendToDevice(row(IOS_TOKEN), { title: 't', body: 'b' })).toBe(false);
      if (dead) {
        expect(m.removeDeviceToken).toHaveBeenCalledWith(IOS_TOKEN);
      } else {
        expect(m.removeDeviceToken).not.toHaveBeenCalled();
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
      expect(await pushService.sendToDevice(row(FCM_TOKEN, 'android'), { title: 't', body: 'b' })).toBe(false);
      if (dead) expect(m.removeDeviceToken).toHaveBeenCalledWith(FCM_TOKEN);
      else expect(m.removeDeviceToken).not.toHaveBeenCalled();
      expect(logs.some((l) => l.includes(code))).toBe(true);
      expectNoTokenInLogs();
    });
  }

  it('a thrown sendEach logs only the code, never err.message', async () => {
    const { pushService } = await load({ FIREBASE_SERVICE_ACCOUNT: '{"project_id":"p"}' });
    m.sendEach.mockRejectedValue(Object.assign(new Error(`boom ${FCM_TOKEN}`), { code: 'app/network-error' }));
    expect(await pushService.sendToDevice(row(FCM_TOKEN, 'android'), { title: 't', body: 'b' })).toBe(false);
    expect(m.removeDeviceToken).not.toHaveBeenCalled();
    expectNoTokenInLogs();
  });
});

// ---- send-time checks ------------------------------------------------------
describe('send-time checks', () => {
  it('a non-hex iOS token is skipped, deactivated and never put in a request path (red if the IOS_TOKEN_RE check is removed)', async () => {
    const { pushService } = await load({ ...APNS_ENV, APNS_ENVIRONMENT: 'sandbox' });
    const bad = '../../3/device/zz' + 'q'.repeat(60);
    expect(await pushService.sendToDevice(row(bad), { title: 't', body: 'b' })).toBe(false);
    expect(m.requests).toHaveLength(0);
    expect(m.removeDeviceToken).toHaveBeenCalledWith(bad);
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

  it('notifyParentsOfAlert: an emergency uses the default sound (no "critical" branch) and still reaches the company parents', async () => {
    const { pushService } = await load({ ...APNS_ENV, APNS_ENVIRONMENT: 'sandbox' });
    m.getUsersByCompanyId.mockResolvedValue([
      { id: 'p1', role: 'parent' },
      { id: 'd1', role: 'driver' },
    ]);
    m.getDeviceTokensForUsers.mockResolvedValue([row(IOS_TOKEN, 'ios', 'p1')]);
    await pushService.notifyParentsOfAlert('company-a', 'Alert', 'Bus delayed', 'emergency');
    expect(m.getDeviceTokensForUsers).toHaveBeenCalledWith(['p1']);
    const body = JSON.parse(m.requests[0].body);
    expect(body.aps.sound).toBe('default');
    expect(body.aps.category).toBe('EMERGENCY');
  });

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
