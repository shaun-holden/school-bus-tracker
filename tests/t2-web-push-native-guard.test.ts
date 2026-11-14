import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

// Web push (T2 native guard; Q61 PL-3 tap-only prompt, PL-4 one notification).
// Q61 replaced the old web "control" (which expected the prompt on load): the
// browser prompt now comes only from the card's "Turn on".

// Run effects synchronously so the hook can be called without a renderer.
vi.mock("react", async (importOriginal) => {
  const actual = await importOriginal<typeof import("react")>();
  return { ...actual, useEffect: (fn: () => void | (() => void)) => { fn(); } };
});

const isNativePlatform = vi.fn(() => false);
vi.mock("@capacitor/core", () => ({ Capacitor: { isNativePlatform: () => isNativePlatform() } }));

const getWebPushToken = vi.fn(async (): Promise<string | null> => "web-token-1");
const askWebPushPermission = vi.fn(async (): Promise<string | null> => null);
const onForegroundMessage = vi.fn(() => () => {});
vi.mock("@/lib/firebase", () => ({
  getWebPushToken: () => getWebPushToken(),
  askWebPushPermission: () => askWebPushPermission(),
  onForegroundMessage: (cb: unknown) => onForegroundMessage(cb),
}));
vi.mock("@/hooks/use-toast", () => ({ useToast: () => ({ toast: vi.fn() }) }));
const apiRequest = vi.fn(async () => ({}));
vi.mock("@/lib/queryClient", () => ({ apiRequest: (...a: unknown[]) => apiRequest(...(a as [])) }));
const setPushCardState = vi.fn();
vi.mock("@/hooks/use-native-push", () => ({ setPushCardState: (s: unknown) => setPushCardState(s) }));

import { useWebPush, turnOnWebPush } from "../client/src/hooks/use-web-push";
import { setLoggingOut } from "../client/src/lib/pushToken";

const flush = () => new Promise((r) => setTimeout(r, 0));
const requestPermission = vi.fn(async () => "granted");

function stubNotification(permission: NotificationPermission) {
  const N = { permission, requestPermission };
  vi.stubGlobal("Notification", N);
  vi.stubGlobal("window", { Notification: N });
}

describe("use-web-push (web and native push never both run; prompt only from a tap)", () => {
  beforeEach(() => {
    for (const f of [getWebPushToken, askWebPushPermission, onForegroundMessage, apiRequest, setPushCardState, requestPermission]) {
      f.mockClear();
    }
    isNativePlatform.mockReturnValue(false);
  });
  afterEach(() => {
    setLoggingOut(false);
    vi.unstubAllGlobals();
  });

  it("on the native app: no web token, no prompt, no foreground listener", async () => {
    isNativePlatform.mockReturnValue(true);
    stubNotification("granted");
    useWebPush({ id: "u-native", role: "parent" });
    await flush();
    expect(getWebPushToken).not.toHaveBeenCalled();
    expect(askWebPushPermission).not.toHaveBeenCalled();
    expect(onForegroundMessage).not.toHaveBeenCalled();
    expect(apiRequest).not.toHaveBeenCalled();
  });

  it("web + 'default': no prompt on load, no token, no POST; the card shows (prompt)", async () => {
    stubNotification("default");
    useWebPush({ id: "u-default", role: "parent" });
    await flush();
    expect(requestPermission).not.toHaveBeenCalled();
    expect(askWebPushPermission).not.toHaveBeenCalled();
    expect(getWebPushToken).not.toHaveBeenCalled();
    expect(apiRequest).not.toHaveBeenCalled();
    expect(setPushCardState).toHaveBeenLastCalledWith("prompt");
  });

  it("web + 'denied': the card shows the hint, nothing else", async () => {
    stubNotification("denied");
    useWebPush({ id: "u-denied", role: "driver" });
    await flush();
    expect(setPushCardState).toHaveBeenLastCalledWith("denied");
    expect(getWebPushToken).not.toHaveBeenCalled();
    expect(apiRequest).not.toHaveBeenCalled();
  });

  it("web + 'granted': token path once and one POST (platform web); a remount doesn't POST again", async () => {
    stubNotification("granted");
    useWebPush({ id: "u-granted", role: "parent" });
    await flush();
    expect(requestPermission).not.toHaveBeenCalled();
    expect(getWebPushToken).toHaveBeenCalledTimes(1);
    expect(apiRequest).toHaveBeenCalledTimes(1);
    expect(apiRequest).toHaveBeenCalledWith("/api/device-tokens", "POST", { token: "web-token-1", platform: "web" });
    expect(onForegroundMessage).toHaveBeenCalledTimes(1);
    expect(setPushCardState).toHaveBeenLastCalledWith("hidden");

    useWebPush({ id: "u-granted", role: "parent" });
    await flush();
    expect(apiRequest).toHaveBeenCalledTimes(1);
  });

  it("web + 'granted': logout (user → null) then the same user logs in again in the same tab → a second POST (Q61b)", async () => {
    stubNotification("granted");
    useWebPush({ id: "u-relogin", role: "parent" });
    await flush();
    expect(apiRequest).toHaveBeenCalledTimes(1);

    useWebPush(null); // logged out, no reload: the server turned this user's web tokens off
    await flush();
    expect(apiRequest).toHaveBeenCalledTimes(1);

    useWebPush({ id: "u-relogin", role: "parent" });
    await flush();
    expect(apiRequest).toHaveBeenCalledTimes(2);
    expect(apiRequest).toHaveBeenLastCalledWith("/api/device-tokens", "POST", { token: "web-token-1", platform: "web" });
  });

  it("web + 'granted' while isLoggingOut() is true: no POST (Q61b)", async () => {
    stubNotification("granted");
    setLoggingOut(true);
    useWebPush({ id: "u-loggingout", role: "parent" });
    await flush();
    expect(getWebPushToken).toHaveBeenCalledTimes(1);
    expect(apiRequest).not.toHaveBeenCalled();
  });

  it.each([
    [{ id: "u-admin", role: "admin" }],
    [{ id: "u-dadmin", role: "driver_admin" }],
    [{ id: "u-master", role: "master_admin" }],
    [{ id: "u-imp", role: "parent", _masterAdminImpersonating: true }],
    [null],
  ])("web + %o: nothing (no card, no token, no POST, no listener)", async (user) => {
    stubNotification("granted");
    useWebPush(user as never);
    await flush();
    expect(getWebPushToken).not.toHaveBeenCalled();
    expect(apiRequest).not.toHaveBeenCalled();
    expect(onForegroundMessage).not.toHaveBeenCalled();
    expect(setPushCardState).not.toHaveBeenCalled();
  });

  it("the card's web 'Turn on' asks once; on 'granted' it hides the card and POSTs the token", async () => {
    stubNotification("default");
    useWebPush({ id: "u-tap", role: "parent" });
    askWebPushPermission.mockImplementationOnce(async () => {
      (globalThis as any).Notification.permission = "granted";
      return "web-token-tap";
    });
    await turnOnWebPush();
    await flush();
    expect(askWebPushPermission).toHaveBeenCalledTimes(1);
    expect(setPushCardState).toHaveBeenLastCalledWith("hidden");
    expect(apiRequest).toHaveBeenCalledTimes(1);
    expect(apiRequest).toHaveBeenCalledWith("/api/device-tokens", "POST", { token: "web-token-tap", platform: "web" });
    expect(onForegroundMessage).toHaveBeenCalledTimes(1);
  });

  it("the card's web 'Turn on' when the user blocks: card shows 'denied', no POST", async () => {
    stubNotification("default");
    useWebPush({ id: "u-block", role: "parent" });
    askWebPushPermission.mockImplementationOnce(async () => {
      (globalThis as any).Notification.permission = "denied";
      return null;
    });
    await turnOnWebPush();
    expect(setPushCardState).toHaveBeenLastCalledWith("denied");
    expect(apiRequest).not.toHaveBeenCalled();
  });
});

describe("lib/firebase.ts: the load path never prompts", () => {
  beforeEach(() => requestPermission.mockClear());
  afterEach(() => vi.unstubAllGlobals());

  it("getWebPushToken with permission 'default' → null and no requestPermission", async () => {
    const real = await vi.importActual<typeof import("../client/src/lib/firebase")>("../client/src/lib/firebase");
    stubNotification("default");
    expect(await real.getWebPushToken()).toBeNull();
    expect(requestPermission).not.toHaveBeenCalled();
  });

  it("askWebPushPermission (the tap) calls requestPermission once", async () => {
    const real = await vi.importActual<typeof import("../client/src/lib/firebase")>("../client/src/lib/firebase");
    stubNotification("default");
    requestPermission.mockImplementationOnce(async () => "denied");
    expect(await real.askWebPushPermission()).toBeNull();
    expect(requestPermission).toHaveBeenCalledTimes(1);
  });
});

describe("source wiring", () => {
  const read = (p: string) => readFileSync(resolve(__dirname, "..", p), "utf8");

  it("PushPermissionCard: web 'Turn on' goes to turnOnWebPush, native to turnOnPush; web denied text", () => {
    const card = read("client/src/components/shared/PushPermissionCard.tsx");
    expect(card).toMatch(/if \(isNative\) await turnOnPush\(\);\s*else await turnOnWebPush\(\);/);
    expect(card).toContain("Notifications are blocked for this site. Allow them in your browser's site settings.");
  });

  it("App.tsx passes the user to useWebPush (role gate inside the hook)", () => {
    expect(read("client/src/App.tsx")).toContain("useWebPush(isAuthenticated ? user : null);");
  });

  it("firebase-messaging-sw.js: onBackgroundMessage returns first when payload.notification is set (PL-4)", () => {
    const sw = read("client/public/firebase-messaging-sw.js");
    expect(sw).toMatch(/onBackgroundMessage\(\(payload\) => \{(\s*\/\/[^\n]*)*\s*if \(payload\.notification\) return;/);
  });
});
