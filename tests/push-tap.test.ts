// Q92: the early native push-tap listener (client/src/lib/pushTap.ts).
import { describe, it, expect, vi, beforeEach } from "vitest";

const state = vi.hoisted(() => ({
  native: true,
  listeners: [] as Array<{ event: string; fn: (a: any) => void }>,
}));

vi.mock("@capacitor/core", () => ({
  Capacitor: { isNativePlatform: () => state.native },
}));
vi.mock("@capacitor/push-notifications", () => ({
  PushNotifications: {
    addListener: vi.fn((event: string, fn: (a: any) => void) => {
      state.listeners.push({ event, fn });
      return Promise.resolve({ remove: async () => {} });
    }),
  },
}));

async function load() {
  vi.resetModules();
  return import("../client/src/lib/pushTap");
}

beforeEach(() => {
  state.native = true;
  state.listeners = [];
  vi.spyOn(console, "log").mockImplementation(() => {});
});

describe("pushTap (Q92)", () => {
  it("web: attaches no listener", async () => {
    state.native = false;
    const m = await load();
    m.initPushTap();
    expect(state.listeners).toHaveLength(0);
  });

  it("native: one listener even if init runs twice", async () => {
    const m = await load();
    m.initPushTap();
    m.initPushTap();
    expect(state.listeners.map((l) => l.event)).toEqual(["pushNotificationActionPerformed"]);
  });

  it("keeps only the tapped type until taken, and wakes subscribers", async () => {
    const m = await load();
    m.initPushTap();
    const woke = vi.fn();
    const unsub = m.subscribePushTap(woke);
    expect(m.hasPendingPushTap()).toBe(false);

    state.listeners[0].fn({
      actionId: "tap",
      notification: { data: { type: "stop_arrival", url: "https://evil.example/x" } },
    });
    expect(woke).toHaveBeenCalledTimes(1);
    expect(m.hasPendingPushTap()).toBe(true);
    expect(m.takePendingPushTap()).toEqual({ type: "stop_arrival" });
    expect(m.takePendingPushTap()).toBeNull();

    unsub();
    state.listeners[0].fn({ notification: { data: { type: "message" } } });
    expect(woke).toHaveBeenCalledTimes(1);
    expect(m.takePendingPushTap()).toEqual({ type: "message" });
  });

  it("a tap before anyone subscribes (cold start) is still held", async () => {
    const m = await load();
    m.initPushTap();
    state.listeners[0].fn({ notification: { data: { type: "boarded" } } });
    expect(m.takePendingPushTap()).toEqual({ type: "boarded" });
  });

  it("a malformed action keeps an undefined type (pushRoutes then returns null)", async () => {
    const m = await load();
    m.initPushTap();
    state.listeners[0].fn(undefined);
    expect(m.takePendingPushTap()).toEqual({ type: undefined });
  });
});
