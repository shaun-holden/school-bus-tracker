import jwt from "jsonwebtoken";
import http2 from "http2";
import admin from "firebase-admin";
import type { DeviceToken } from "@shared/schema";
import { storage } from "./storage";

// Push settings (names only; DeShaun sets the values on Railway, never in code):
// APNS_KEY_ID              Apple key id
// APNS_TEAM_ID             Apple developer team id
// APNS_PRIVATE_KEY         contents of the .p8 key
// APNS_BUNDLE_ID           the app's bundle id (the APNs topic)
// APNS_ENVIRONMENT         "sandbox" (Apple's test server, Xcode builds; staging)
//                          or "production" (TestFlight + App Store; production).
//                          Unset = production when NODE_ENV=production, else
//                          sandbox. Any other value turns iOS push off.
// FIREBASE_SERVICE_ACCOUNT Firebase service account JSON (Android + web push)
//
// Logging rule (S-13 / S-15): never log a device token or any part of it, a
// name, an email, or secret text. Log platform, device_tokens.id, status and
// the APNs reason / FCM code only.

export const APNS_HOSTS = {
  sandbox: "api.sandbox.push.apple.com",
  production: "api.push.apple.com",
} as const;

export const APNS_TIMEOUT_MS = 10_000;
export const FCM_TIMEOUT_MS = 10_000;
export const APNS_MAX_STREAMS = 100;
export const FCM_BATCH_SIZE = 500;
const APNS_IDLE_CLOSE_MS = 60_000;
const IOS_TOKEN_RE = /^[0-9a-f]{64,200}$/i;

// Only these responses mean the token itself is dead. Anything else (other
// 400s, 403) is a setup mistake on our side, so the token is kept.
const APNS_DEAD_TOKEN_REASONS = new Set(["BadDeviceToken", "DeviceTokenNotForTopic"]);
const FCM_DEAD_TOKEN_CODES = new Set([
  "messaging/registration-token-not-registered",
  "messaging/invalid-registration-token",
]);

/** Picks Apple's server from APNS_ENVIRONMENT (allow-list, S-22). null = APNs off. */
export function resolveApnsHost(env: NodeJS.ProcessEnv = process.env): string | null {
  const raw = env.APNS_ENVIRONMENT?.trim();
  if (!raw) {
    return env.NODE_ENV === "production" ? APNS_HOSTS.production : APNS_HOSTS.sandbox;
  }
  if (raw === "sandbox") return APNS_HOSTS.sandbox;
  if (raw === "production") return APNS_HOSTS.production;
  return null;
}

// Apple reasons and FCM codes are fixed words; anything else is logged as
// "unknown" so a log line can never echo request data.
function safeWord(v: unknown, re = /^[A-Za-z]{1,64}$/): string {
  return typeof v === "string" && re.test(v) ? v : "unknown";
}
const safeFcmCode = (v: unknown) => safeWord(v, /^[a-z0-9/_-]{1,80}$/i);

// Initialize Firebase Admin SDK (FCM: Android + web). Never log the error:
// a JSON SyntaxError message contains part of the service-account text.
function initFirebase(): boolean {
  const raw = process.env.FIREBASE_SERVICE_ACCOUNT;
  if (!raw) {
    console.log("FCM not configured; Android and web push are off");
    return false;
  }
  let serviceAccount: unknown;
  try {
    serviceAccount = JSON.parse(raw);
  } catch {
    console.error("FIREBASE_SERVICE_ACCOUNT is not valid JSON; Android and web push are off");
    return false;
  }
  try {
    if (admin.apps.length === 0) {
      admin.initializeApp({ credential: admin.credential.cert(serviceAccount as admin.ServiceAccount) });
    }
    console.log("Firebase Admin SDK initialized for FCM");
    return true;
  } catch {
    console.error("Firebase Admin SDK init failed (check FIREBASE_SERVICE_ACCOUNT); Android and web push are off");
    return false;
  }
}

const firebaseInitialized = initFirebase();

export interface PushPayload {
  title: string;
  body: string;
  /** Only sent when set: no default badge. */
  badge?: number;
  sound?: string;
  data?: Record<string, unknown>;
  category?: string;
  /** apns-collapse-id and the Android notification tag. */
  collapseId?: string;
  /** Seconds from now: apns-expiration (absolute epoch) and Android ttl. */
  expiresInSec?: number;
  /** Android notification channel. Default: bus_updates. */
  channelId?: "bus_updates" | "messages";
}
/** Old name, kept for callers. */
export type APNsPayload = PushPayload;

type ApnsResult =
  | { kind: "response"; status: number; body: string }
  | { kind: "timeout" }
  | { kind: "error"; code: string };

/**
 * One HTTP/2 session per host. Reconnects after goaway/error, closes after
 * 60 s idle, and keeps at most APNS_MAX_STREAMS requests in flight (the rest
 * wait in a queue).
 */
class ApnsConnection {
  private session: http2.ClientHttp2Session | null = null;
  private idleTimer: ReturnType<typeof setTimeout> | null = null;
  private inFlight = 0;
  private waiting: Array<() => void> = [];

  constructor(private readonly host: string) {}

  private getSession(): http2.ClientHttp2Session {
    const current = this.session;
    if (current && !current.closed && !current.destroyed) return current;

    const s = http2.connect(`https://${this.host}:443`);
    const forget = () => {
      if (this.session === s) {
        this.session = null;
        this.clearIdle();
      }
    };
    s.on("goaway", () => {
      forget();
      s.close();
    });
    s.on("error", (err: NodeJS.ErrnoException) => {
      console.error("APNs connection error", { code: safeWord(err?.code, /^[A-Z0-9_]{1,64}$/) });
      forget();
      s.destroy();
    });
    s.on("close", forget);
    this.session = s;
    return s;
  }

  private clearIdle() {
    if (this.idleTimer) {
      clearTimeout(this.idleTimer);
      this.idleTimer = null;
    }
  }

  private scheduleIdleClose() {
    this.clearIdle();
    this.idleTimer = setTimeout(() => {
      this.idleTimer = null;
      if (this.inFlight === 0) this.close();
    }, APNS_IDLE_CLOSE_MS);
    this.idleTimer.unref?.();
  }

  private async acquire(): Promise<void> {
    this.clearIdle();
    if (this.inFlight < APNS_MAX_STREAMS) {
      this.inFlight++;
      return;
    }
    // The releasing request hands its slot straight to us.
    await new Promise<void>((resolve) => this.waiting.push(resolve));
  }

  private release() {
    const next = this.waiting.shift();
    if (next) {
      next();
      return;
    }
    this.inFlight--;
    if (this.inFlight === 0) this.scheduleIdleClose();
  }

  async post(deviceToken: string, headers: Record<string, string | number>, body: string): Promise<ApnsResult> {
    await this.acquire();
    try {
      return await this.postOnce(deviceToken, headers, body);
    } finally {
      this.release();
    }
  }

  private postOnce(deviceToken: string, headers: Record<string, string | number>, body: string): Promise<ApnsResult> {
    return new Promise<ApnsResult>((resolve) => {
      let settled = false;
      let timer: ReturnType<typeof setTimeout> | undefined;
      let req: http2.ClientHttp2Stream | undefined;
      const finish = (r: ApnsResult) => {
        if (settled) return;
        settled = true;
        if (timer) clearTimeout(timer);
        resolve(r);
      };

      try {
        req = this.getSession().request({
          ":method": "POST",
          ":path": `/3/device/${deviceToken}`,
          ...headers,
        });
      } catch (err: any) {
        finish({ kind: "error", code: safeWord(err?.code, /^[A-Z0-9_]{1,64}$/) });
        return;
      }

      // S-22: never wait forever on Apple.
      timer = setTimeout(() => {
        finish({ kind: "timeout" });
        try {
          req?.close(http2.constants?.NGHTTP2_CANCEL);
        } catch {
          /* already closed */
        }
      }, APNS_TIMEOUT_MS);

      let status = 0;
      let data = "";
      req.setEncoding?.("utf8");
      req.on("response", (h: http2.IncomingHttpHeaders) => {
        status = Number(h[":status"]);
      });
      req.on("data", (chunk: string) => {
        data += chunk;
      });
      req.on("end", () => finish({ kind: "response", status, body: data }));
      req.on("error", (err: NodeJS.ErrnoException) =>
        finish({ kind: "error", code: safeWord(err?.code, /^[A-Z0-9_]{1,64}$/) }),
      );
      req.end(body);
    });
  }

  close() {
    this.clearIdle();
    const s = this.session;
    this.session = null;
    if (s && !s.closed && !s.destroyed) s.close();
  }
}

function withTimeout<T>(p: Promise<T>, ms: number): Promise<T | typeof TIMED_OUT> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<typeof TIMED_OUT>((resolve) => {
    timer = setTimeout(() => resolve(TIMED_OUT), ms);
  });
  return Promise.race([p, timeout]).finally(() => {
    if (timer) clearTimeout(timer);
  });
}
const TIMED_OUT = Symbol("timed out");

function chunk<T>(items: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size));
  return out;
}

function dedupeTokens(tokens: DeviceToken[]): DeviceToken[] {
  const seen = new Set<string>();
  return tokens.filter((t) => {
    if (seen.has(t.token)) return false;
    seen.add(t.token);
    return true;
  });
}

export class PushService {
  private readonly apnsHost: string | null;
  private readonly apnsReady: boolean;
  private readonly fcmReady: boolean;
  private apns: ApnsConnection | null = null;
  private apnsJwt: string | null = null;
  private apnsJwtExpiry = 0;

  constructor() {
    const env = process.env;
    this.apnsHost = resolveApnsHost(env);
    const hasKeys = !!(env.APNS_KEY_ID && env.APNS_TEAM_ID && env.APNS_PRIVATE_KEY && env.APNS_BUNDLE_ID);
    if (this.apnsHost === null) {
      console.error('APNS_ENVIRONMENT must be "sandbox" or "production"; iOS push is off');
    } else if (!hasKeys) {
      console.log("APNs not configured; iOS push is off");
    }
    this.apnsReady = this.apnsHost !== null && hasKeys;
    this.fcmReady = firebaseInitialized;
  }

  // JWT for APNs (valid 1 h, refreshed after 50 min).
  private getAPNsJwt(): string {
    const now = Math.floor(Date.now() / 1000);
    if (this.apnsJwt && now < this.apnsJwtExpiry) return this.apnsJwt;

    const privateKey = process.env.APNS_PRIVATE_KEY!.replace(/\\n/g, "\n");
    this.apnsJwt = jwt.sign({}, privateKey, {
      algorithm: "ES256",
      issuer: process.env.APNS_TEAM_ID!,
      expiresIn: "1h",
      header: { alg: "ES256", kid: process.env.APNS_KEY_ID! },
    });
    this.apnsJwtExpiry = now + 3000;
    return this.apnsJwt;
  }

  private deactivate(t: DeviceToken) {
    // A dead token is dead for everyone, so the by-token update is right here.
    storage.removeDeviceToken(t.token).catch(() => {
      console.error("Push: could not deactivate token", { platform: t.platform, tokenId: t.id });
    });
  }

  private async sendToAPNs(t: DeviceToken, payload: PushPayload): Promise<boolean> {
    if (!this.apnsReady || !this.apnsHost) return false;

    // Never put a malformed token into the request path.
    if (!IOS_TOKEN_RE.test(t.token)) {
      console.warn("APNs skip: token is not hex; deactivating", { platform: "ios", tokenId: t.id });
      this.deactivate(t);
      return false;
    }

    let bearer: string;
    try {
      bearer = this.getAPNsJwt();
    } catch {
      console.error("APNs config error", { platform: "ios", tokenId: t.id, reason: "JwtSignFailed" });
      return false;
    }

    const { aps: _ignored, ...extra } = payload.data ?? {};
    const aps: Record<string, unknown> = {
      alert: { title: payload.title, body: payload.body },
      sound: payload.sound ?? "default",
      "mutable-content": 1,
    };
    if (payload.badge !== undefined) aps.badge = payload.badge;
    if (payload.category) aps.category = payload.category;
    const body = JSON.stringify({ aps, ...extra });

    const headers: Record<string, string | number> = {
      authorization: `bearer ${bearer}`,
      "apns-topic": process.env.APNS_BUNDLE_ID!,
      "apns-push-type": "alert",
      "apns-priority": "10",
      "content-type": "application/json",
      "content-length": Buffer.byteLength(body),
    };
    if (payload.collapseId) headers["apns-collapse-id"] = payload.collapseId.slice(0, 64);
    if (payload.expiresInSec && payload.expiresInSec > 0) {
      // Absolute epoch seconds, never a duration and never "0".
      headers["apns-expiration"] = String(Math.floor(Date.now() / 1000) + Math.floor(payload.expiresInSec));
    }

    if (!this.apns) this.apns = new ApnsConnection(this.apnsHost);
    const result = await this.apns.post(t.token, headers, body);

    if (result.kind === "timeout") {
      console.error("APNs timeout", { platform: "ios", tokenId: t.id });
      return false;
    }
    if (result.kind === "error") {
      console.error("APNs request error", { platform: "ios", tokenId: t.id, code: result.code });
      return false;
    }
    if (result.status === 200) return true;

    let reason = "unknown";
    try {
      reason = safeWord(JSON.parse(result.body)?.reason);
    } catch {
      /* no JSON body */
    }
    const info = { platform: "ios", tokenId: t.id, status: result.status, reason };
    if (result.status === 410 || (result.status === 400 && APNS_DEAD_TOKEN_REASONS.has(reason))) {
      console.warn("APNs token rejected; deactivating", info);
      this.deactivate(t);
    } else if (result.status === 400 || result.status === 403) {
      console.error("APNs config error", info);
    } else {
      console.error("APNs send failed", info);
    }
    return false;
  }

  private fcmMessage(token: string, payload: PushPayload): admin.messaging.TokenMessage {
    const android: admin.messaging.AndroidConfig = {
      priority: "high",
      notification: {
        channelId: payload.channelId ?? "bus_updates",
        icon: "ic_stat_notify",
        color: "#1e40af",
        sound: "default",
        ...(payload.collapseId ? { tag: payload.collapseId } : {}),
      },
      ...(payload.expiresInSec && payload.expiresInSec > 0 ? { ttl: Math.floor(payload.expiresInSec) * 1000 } : {}),
    };
    return {
      token,
      notification: { title: payload.title, body: payload.body },
      data: Object.fromEntries(Object.entries(payload.data || {}).map(([k, v]) => [k, String(v)])),
      webpush: {
        notification: {
          title: payload.title,
          body: payload.body,
          icon: "/icon-192.png",
          badge: "/icon-192.png",
        },
        fcmOptions: { link: "/" },
      },
      android,
    };
  }

  // FCM (Android + web): sendEach in batches of FCM_BATCH_SIZE, each batch
  // capped at FCM_TIMEOUT_MS. Returns one boolean per token, in order.
  private async sendToFCM(tokens: DeviceToken[], payload: PushPayload): Promise<boolean[]> {
    if (tokens.length === 0) return [];
    if (!this.fcmReady) return tokens.map(() => false);

    const results: boolean[] = [];
    for (const batch of chunk(tokens, FCM_BATCH_SIZE)) {
      let res: admin.messaging.BatchResponse | typeof TIMED_OUT;
      try {
        res = await withTimeout(
          admin.messaging().sendEach(batch.map((t) => this.fcmMessage(t.token, payload))),
          FCM_TIMEOUT_MS,
        );
      } catch (err: any) {
        console.error("FCM batch failed", { count: batch.length, code: safeFcmCode(err?.code) });
        results.push(...batch.map(() => false));
        continue;
      }
      if (res === TIMED_OUT) {
        console.error("FCM timeout", { count: batch.length });
        results.push(...batch.map(() => false));
        continue;
      }
      batch.forEach((t, i) => {
        const r = res.responses[i];
        if (r?.success) {
          results.push(true);
          return;
        }
        const code = safeFcmCode(r?.error?.code);
        if (FCM_DEAD_TOKEN_CODES.has(code)) {
          console.warn("FCM token rejected; deactivating", { platform: t.platform, tokenId: t.id, code });
          this.deactivate(t);
        } else {
          console.error("FCM send failed", { platform: t.platform, tokenId: t.id, code });
        }
        results.push(false);
      });
    }
    return results;
  }

  /** Sends to the given device rows (deduped by token string). One boolean per distinct token. */
  async sendToDevices(tokens: DeviceToken[], payload: PushPayload): Promise<boolean[]> {
    const unique = dedupeTokens(tokens);
    const ios = unique.filter((t) => t.platform === "ios");
    const other = unique.filter((t) => t.platform !== "ios");
    const [iosResults, fcmResults] = await Promise.all([
      Promise.all(ios.map((t) => this.sendToAPNs(t, payload).catch(() => false))),
      this.sendToFCM(other, payload).catch(() => other.map(() => false)),
    ]);
    return [...iosResults, ...fcmResults];
  }

  /** Sends to one device row. */
  async sendToDevice(token: DeviceToken, payload: PushPayload): Promise<boolean> {
    const [ok] = await this.sendToDevices([token], payload);
    return ok ?? false;
  }

  // Send push notification to a specific user (all their devices)
  async sendToUser(userId: string, payload: PushPayload): Promise<void> {
    const tokens = await storage.getDeviceTokensForUser(userId);
    await this.sendToDevices(tokens, payload);
  }

  // Send push notification to multiple users
  async sendToUsers(userIds: string[], payload: PushPayload): Promise<void> {
    const ids = Array.from(new Set(userIds));
    if (ids.length === 0) return;
    const tokens = await storage.getDeviceTokensForUsers(ids);
    await this.sendToDevices(tokens, payload);
  }

  private alertPayload(title: string, message: string, type: string, data: Record<string, unknown>): PushPayload {
    let category = "ALERT";
    if (type === "emergency") category = "EMERGENCY";
    if (type === "delay") category = "DELAY";
    // Emergencies use the default sound on the high-importance channel.
    return { title, body: message, sound: "default", category, channelId: "bus_updates", data };
  }

  // Admin alert to every parent in the company (recipient fix is T4).
  async notifyParentsOfAlert(companyId: string, title: string, message: string, type: string): Promise<void> {
    try {
      const companyUsers = await storage.getUsersByCompanyId(companyId);
      const parentIds = companyUsers.filter((u) => u.role === "parent").map((u) => u.id);
      await this.sendToUsers(parentIds, this.alertPayload(title, message, type, { type, companyId }));
    } catch {
      console.error("Error sending push to parents", { companyId });
    }
  }

  // Admin alert to exactly these users (the caller works out who).
  async notifyUsersOfAlert(userIds: string[], title: string, message: string, type: string): Promise<void> {
    try {
      await this.sendToUsers(userIds, this.alertPayload(title, message, type, { type }));
    } catch {
      console.error("Error sending alert push", { count: userIds.length });
    }
  }

  // New message: never the message text (DeShaun's decision 3); content is ignored.
  async notifyNewMessage(
    recipientId: string,
    senderName: string,
    _content?: string,
    senderId?: string,
  ): Promise<void> {
    const data: Record<string, unknown> = { type: "message" };
    if (senderId && senderId !== recipientId) data.senderId = senderId;
    await this.sendToUser(recipientId, {
      title: "New message",
      body: `${senderName} sent you a message`,
      category: "MESSAGE",
      channelId: "messages",
      data,
    });
  }

  /** Closes the APNs connection (tests, shutdown). */
  close() {
    this.apns?.close();
    this.apns = null;
  }
}

export const pushService = new PushService();
