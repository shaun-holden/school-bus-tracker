import jwt from "jsonwebtoken";
import crypto from "crypto";
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
// 403s that mean our signing JWT is stale or rejected (setup or clock):
// drop the cached JWT so the next send signs a fresh one; keep the token.
const APNS_JWT_REJECTED_REASONS = new Set(["ExpiredProviderToken", "InvalidProviderToken"]);
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

// Q167: the five Apple push settings. Read ONCE, in the PushService constructor,
// through readApnsConfig; nothing else reads process.env.APNS_*.
const APNS_KNOWN_NAMES = ["APNS_KEY_ID", "APNS_TEAM_ID", "APNS_PRIVATE_KEY", "APNS_BUNDLE_ID", "APNS_ENVIRONMENT"] as const;
const APNS_ID_RE = /^[A-Z0-9]{10}$/;
const APNS_BUNDLE_RE = /^[A-Za-z0-9-]+(\.[A-Za-z0-9-]+)+$/;
const PEM_BEGIN = "-----BEGIN PRIVATE KEY-----";
const PEM_END = "-----END PRIVATE KEY-----";
// Q171: a converted (SEC1) key. Apple only issues PKCS8 .p8 files.
const SEC1_BEGIN = "-----BEGIN EC PRIVATE KEY-----";
// Q171: only names of this shape are printed; others are counted, never shown.
const APNS_SAFE_NAME_RE = /^APNS_[A-Z0-9_]{1,40}$/;

export interface ApnsConfig {
  ready: boolean;
  host: string | null;
  keyId: string;
  teamId: string;
  bundleId: string;
  /** Setting NAMES that are unset or empty after trimming. */
  missing: string[];
  /** "<NAME> <rule>" lines: names and rules only, never a value. */
  problems: string[];
  /** Setting NAMES whose value had whitespace at either end. */
  trimmed: string[];
  /** APNS_* names (safe shape only) that are not one of the five known names. */
  unknownNames: string[];
  /** How many other APNS_* names have unusual characters (never printed). */
  oddNameCount: number;
  /** unknown name → the known name within 2 edits, when there is one. */
  suggestions: Record<string, string>;
}

function editDistance(a: string, b: string): number {
  const prev = Array.from({ length: b.length + 1 }, (_, j) => j);
  for (let i = 1; i <= a.length; i++) {
    let diag = prev[0];
    prev[0] = i;
    for (let j = 1; j <= b.length; j++) {
      const up = prev[j];
      prev[j] = Math.min(prev[j] + 1, prev[j - 1] + 1, diag + (a[i - 1] === b[j - 1] ? 0 : 1));
      diag = up;
    }
  }
  return prev[b.length];
}

// Rebuilds a clean PKCS8 PEM from any pasted shape: literal "\n", CRLF, newlines
// turned into spaces, stray indentation, or the bare base64 body.
function repairPrivateKeyPem(value: string): string {
  const text = value.replace(/\\n/g, "\n");
  const begin = text.indexOf(PEM_BEGIN);
  const end = text.indexOf(PEM_END);
  const inner = begin !== -1 && end > begin ? text.slice(begin + PEM_BEGIN.length, end) : text;
  const body = inner.replace(/\s+/g, "");
  return `${PEM_BEGIN}\n${(body.match(/.{1,64}/g) ?? []).join("\n")}\n${PEM_END}\n`;
}

function isEcP256PrivateKey(pem: string): boolean {
  try {
    const key = crypto.createPrivateKey(pem);
    return key.asymmetricKeyType === "ec" && key.asymmetricKeyDetails?.namedCurve === "prime256v1";
  } catch {
    return false; // never log the crypto error text
  }
}

// Q171: the one key check, shared by readApnsConfig (for the problem line) and
// readApnsPrivateKey (for the PEM). The SEC1 test runs on the RAW value, before
// the repair, which would otherwise wrap a SEC1 key in a PKCS8 header.
function checkPrivateKey(rawKey: string): { pem: string; problem: string | null } {
  if (rawKey.includes(SEC1_BEGIN)) {
    return {
      pem: "",
      problem: 'APNS_PRIVATE_KEY is a SEC1 "EC PRIVATE KEY"; paste Apple\'s .p8 file (BEGIN PRIVATE KEY)',
    };
  }
  const pem = repairPrivateKeyPem(rawKey);
  if (!isEcP256PrivateKey(pem)) return { pem: "", problem: "APNS_PRIVATE_KEY is not an EC P-256 private key" };
  return { pem, problem: null };
}

/**
 * Q171: the Apple private key as a clean PEM, or "" when unset or unusable.
 * Kept out of ApnsConfig so a log of the config can never print the key.
 */
export function readApnsPrivateKey(env: NodeJS.ProcessEnv): string {
  const rawKey = (env.APNS_PRIVATE_KEY ?? "").trim();
  return rawKey ? checkPrivateKey(rawKey).pem : "";
}

/** Q167: reads, cleans and checks the Apple push settings. Pure: no logging. */
export function readApnsConfig(env: NodeJS.ProcessEnv): ApnsConfig {
  const missing: string[] = [];
  const problems: string[] = [];
  const trimmed: string[] = [];
  const read = (name: (typeof APNS_KNOWN_NAMES)[number]): string => {
    const raw = env[name] ?? "";
    const value = raw.trim();
    // A key file's own final line break is normal, not "extra spaces".
    const expected = name === "APNS_PRIVATE_KEY" ? raw.replace(/\r?\n$/, "") : raw;
    if (value && value !== expected) trimmed.push(name);
    if (!value) missing.push(name);
    return value;
  };
  const keyId = read("APNS_KEY_ID");
  const teamId = read("APNS_TEAM_ID");
  const rawKey = read("APNS_PRIVATE_KEY");
  const bundleId = read("APNS_BUNDLE_ID");

  if (keyId && !APNS_ID_RE.test(keyId)) problems.push("APNS_KEY_ID must be exactly 10 characters, A-Z or 0-9");
  if (teamId && !APNS_ID_RE.test(teamId)) problems.push("APNS_TEAM_ID must be exactly 10 characters, A-Z or 0-9");
  if (bundleId && !APNS_BUNDLE_RE.test(bundleId)) {
    problems.push("APNS_BUNDLE_ID must be dot-separated parts of letters, digits or hyphens (like com.example.app)");
  }
  if (rawKey) {
    const { problem } = checkPrivateKey(rawKey);
    if (problem) problems.push(problem);
  }

  const known = new Set<string>(APNS_KNOWN_NAMES);
  const otherNames = Object.keys(env).filter((n) => n.startsWith("APNS_") && !known.has(n));
  const unknownNames = otherNames.filter((n) => APNS_SAFE_NAME_RE.test(n)).sort();
  const oddNameCount = otherNames.length - unknownNames.length;
  const suggestions: Record<string, string> = {};
  for (const name of unknownNames) {
    let best: string | undefined;
    let bestDistance = 3;
    for (const k of APNS_KNOWN_NAMES) {
      const d = editDistance(name, k);
      if (d < bestDistance) {
        best = k;
        bestDistance = d;
      }
    }
    if (best) suggestions[name] = best;
  }

  const host = resolveApnsHost(env);
  return {
    ready: host !== null && missing.length === 0 && problems.length === 0,
    host,
    keyId,
    teamId,
    bundleId,
    missing,
    problems,
    trimmed,
    unknownNames,
    oddNameCount,
    suggestions,
  };
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
  private readonly apnsKeyId: string;
  private readonly apnsTeamId: string;
  private readonly apnsBundleId: string;
  private readonly apnsPrivateKeyPem: string;
  private readonly fcmReady: boolean;
  private apns: ApnsConnection | null = null;
  private apnsJwt: string | null = null;
  private apnsJwtExpiry = 0;

  constructor() {
    // Q167: one read of the Apple settings; startup lines carry NAMES only.
    const apns = readApnsConfig(process.env);
    this.apnsHost = apns.host;
    this.apnsKeyId = apns.keyId;
    this.apnsTeamId = apns.teamId;
    this.apnsBundleId = apns.bundleId;
    this.apnsPrivateKeyPem = readApnsPrivateKey(process.env);
    if (this.apnsHost === null) {
      console.error('APNS_ENVIRONMENT must be "sandbox" or "production"; iOS push is off');
    }
    if (apns.missing.length > 0) {
      console.log(`APNs not configured (missing: ${apns.missing.join(", ")}); iOS push is off`);
    }
    for (const problem of apns.problems) {
      console.error(`APNs setting problem: ${problem}; iOS push is off`);
    }
    if (apns.trimmed.length > 0) {
      console.log(`APNs settings had extra spaces trimmed: ${apns.trimmed.join(", ")}`);
    }
    for (const name of apns.unknownNames) {
      const known = apns.suggestions[name];
      console.log(`APNs unknown setting name ${name}${known ? ` (did you mean ${known}?)` : ""}`);
    }
    if (apns.oddNameCount > 0) {
      console.log(`APNs: ${apns.oddNameCount} other APNS_ setting name(s) with unusual characters, not shown`);
    }
    this.apnsReady = apns.ready;
    this.fcmReady = firebaseInitialized;
  }

  // JWT for APNs (valid 1 h, refreshed after 50 min).
  private getAPNsJwt(): string {
    const now = Math.floor(Date.now() / 1000);
    if (this.apnsJwt && now < this.apnsJwtExpiry) return this.apnsJwt;

    this.apnsJwt = jwt.sign({}, this.apnsPrivateKeyPem, {
      algorithm: "ES256",
      issuer: this.apnsTeamId,
      expiresIn: "1h",
      header: { alg: "ES256", kid: this.apnsKeyId },
    });
    this.apnsJwtExpiry = now + 3000;
    return this.apnsJwt;
  }

  private deactivate(t: DeviceToken) {
    // Turn off exactly the row that failed (by id). Area 1's register already
    // keeps one active owner per token, so other users' rows are not touched.
    storage.deactivateDeviceTokenById(t.id).catch(() => {
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
      "apns-topic": this.apnsBundleId,
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
      if (result.status === 403 && APNS_JWT_REJECTED_REASONS.has(reason)) {
        this.apnsJwt = null;
        this.apnsJwtExpiry = 0;
      }
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

  // Admin alert to exactly these users (the caller works out who). The admin's
  // type only picks the category; data is always exactly { type: 'alert' }.
  async notifyUsersOfAlert(userIds: string[], title: string, message: string, type: string): Promise<void> {
    try {
      await this.sendToUsers(userIds, this.alertPayload(title, message, type, { type: 'alert' }));
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
