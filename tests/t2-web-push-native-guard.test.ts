import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

// Run effects synchronously so the hook can be called without a renderer.
vi.mock("react", async (importOriginal) => {
  const actual = await importOriginal<typeof import("react")>();
  return { ...actual, useEffect: (fn: () => void | (() => void)) => { fn(); } };
});

const isNativePlatform = vi.fn(() => false);
vi.mock("@capacitor/core", () => ({ Capacitor: { isNativePlatform: () => isNativePlatform() } }));

const requestNotificationPermission = vi.fn(async () => null);
const onForegroundMessage = vi.fn(() => () => {});
vi.mock("@/lib/firebase", () => ({
  requestNotificationPermission: () => requestNotificationPermission(),
  onForegroundMessage: (cb: unknown) => onForegroundMessage(cb),
}));
vi.mock("@/hooks/use-toast", () => ({ useToast: () => ({ toast: vi.fn() }) }));
vi.mock("@/lib/queryClient", () => ({ apiRequest: vi.fn() }));

import { useWebPush } from "../client/src/hooks/use-web-push";

describe("use-web-push native guard (web and native push never both run)", () => {
  beforeEach(() => {
    requestNotificationPermission.mockClear();
    onForegroundMessage.mockClear();
    vi.stubGlobal("window", {});
    vi.stubGlobal("Notification", { permission: "granted" });
    (globalThis as any).window.Notification = (globalThis as any).Notification;
  });
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("on the native app: no web-push permission request and no foreground listener", async () => {
    isNativePlatform.mockReturnValue(true);
    useWebPush(true);
    await Promise.resolve();
    expect(requestNotificationPermission).not.toHaveBeenCalled();
    expect(onForegroundMessage).not.toHaveBeenCalled();
  });

  it("control: on the web it still sets up web push as before", async () => {
    isNativePlatform.mockReturnValue(false);
    useWebPush(true);
    await Promise.resolve();
    expect(onForegroundMessage).toHaveBeenCalledTimes(1);
    expect(requestNotificationPermission).toHaveBeenCalledTimes(1);
  });
});
