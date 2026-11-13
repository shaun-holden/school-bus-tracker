import { describe, it, expect } from "vitest";
import {
  pushRoutes,
  PUSH_TYPES,
  PARENT_NOTICE_PUSH_TYPES,
  LEGACY_ALERT_PUSH_TYPES,
  parseInitialTab,
  DRIVER_TABS,
  shouldOfferPush,
  backButtonAction,
} from "../client/src/lib/pushRoutes";
import { logoutBody, getPushToken, setPushToken, clearPushToken } from "../client/src/lib/pushToken";

describe("pushRoutes: fixed allow-list of type → path (S-21)", () => {
  it("parent + every bus/alert type → /parent/notifications", () => {
    for (const type of [...PARENT_NOTICE_PUSH_TYPES, ...LEGACY_ALERT_PUSH_TYPES]) {
      expect(pushRoutes(type, "parent")).toBe("/parent/notifications");
    }
  });

  it("parent + message → /parent; driver + message → /?tab=messages", () => {
    expect(pushRoutes("message", "parent")).toBe("/parent");
    expect(pushRoutes("message", "driver")).toBe("/?tab=messages");
  });

  it("the type list T4b must use is exactly these strings", () => {
    expect([...PUSH_TYPES]).toEqual([
      "stop_arrival", "school_arrival", "school_departure", "boarded", "dropped_off", "alert",
      "delay", "emergency", "info", "route_change",
      "message",
    ]);
  });

  it("never navigates to a url/path carried in the payload (no data.url / data.path read)", () => {
    const data: Record<string, unknown> = { type: "message", url: "https://evil.example/x", path: "/admin" };
    expect(pushRoutes(data.type, "parent")).toBe("/parent");
    const bogus: Record<string, unknown> = { type: "unknown_type", url: "https://evil.example/x", path: "/admin" };
    expect(pushRoutes(bogus.type, "parent")).toBeNull();
    // A whole payload object passed as the type is not a string → null.
    expect(pushRoutes(data as unknown, "parent")).toBeNull();
  });

  it("unknown or non-string type → null (no fallback route for unknown types)", () => {
    for (const role of ["parent", "driver"]) {
      expect(pushRoutes("unknown_type", role)).toBeNull();
      expect(pushRoutes("", role)).toBeNull();
      expect(pushRoutes("/admin", role)).toBeNull();
      expect(pushRoutes(undefined, role)).toBeNull();
      expect(pushRoutes(42, role)).toBeNull();
    }
    // A driver only routes messages; bus notices for parents are not driver routes.
    expect(pushRoutes("stop_arrival", "driver")).toBeNull();
  });

  it("master_admin / driver_admin / admin / no user → null for every type (role allow-list)", () => {
    for (const type of PUSH_TYPES) {
      for (const role of ["master_admin", "driver_admin", "admin", "", null, undefined]) {
        expect(pushRoutes(type, role)).toBeNull();
      }
    }
  });
});

describe("parseInitialTab: allow-list of driver tabs", () => {
  it("accepts every existing driver tab", () => {
    for (const tab of DRIVER_TABS) expect(parseInitialTab(`?tab=${tab}`)).toBe(tab);
    expect(parseInitialTab("?x=1&tab=messages")).toBe("messages");
  });

  it("unknown or crafted values → null", () => {
    for (const s of ["", "?", "?tab=", "?tab=admin", "?tab=Messages", "?tab=messages%00", "?tab=<script>", "?tab=__proto__", "?tab=constructor", "?other=messages"]) {
      expect(parseInitialTab(s)).toBeNull();
    }
    expect(parseInitialTab(null)).toBeNull();
    expect(parseInitialTab(undefined)).toBeNull();
  });
});

describe("shouldOfferPush: parent/driver on native only", () => {
  it("parent and driver on native → true", () => {
    expect(shouldOfferPush({ role: "parent" }, true)).toBe(true);
    expect(shouldOfferPush({ role: "driver" }, true)).toBe(true);
  });

  it("web → false even for parent/driver (isNative check)", () => {
    expect(shouldOfferPush({ role: "parent" }, false)).toBe(false);
    expect(shouldOfferPush({ role: "driver" }, false)).toBe(false);
  });

  it("driver_admin, admin, master_admin, no role, no user → false (role allow-list)", () => {
    for (const role of ["driver_admin", "admin", "master_admin", null, undefined, ""]) {
      expect(shouldOfferPush({ role }, true)).toBe(false);
    }
    expect(shouldOfferPush(null, true)).toBe(false);
    expect(shouldOfferPush(undefined, true)).toBe(false);
  });

  it("an impersonating master (overlay role parent/driver) → false (impersonation check)", () => {
    expect(shouldOfferPush({ role: "parent", _masterAdminImpersonating: true }, true)).toBe(false);
    expect(shouldOfferPush({ role: "driver", _masterAdminImpersonating: true }, true)).toBe(false);
  });
});

describe("logoutBody / pushToken", () => {
  it("carries this phone's token when one is set", () => {
    expect(logoutBody("abc123")).toEqual({ deviceToken: "abc123" });
  });

  it("empty body when there is no token", () => {
    expect(logoutBody(null)).toEqual({});
    expect(logoutBody(undefined)).toEqual({});
    expect(logoutBody("")).toEqual({});
  });

  it("the in-memory holder sets, reads and clears", () => {
    clearPushToken();
    expect(getPushToken()).toBeNull();
    setPushToken("tok-1");
    expect(getPushToken()).toBe("tok-1");
    expect(logoutBody(getPushToken())).toEqual({ deviceToken: "tok-1" });
    clearPushToken();
    expect(getPushToken()).toBeNull();
  });
});

describe("backButtonAction (Q46 Android back)", () => {
  it("goes back when the WebView can go back", () => {
    expect(backButtonAction(true)).toBe("back");
  });

  it("minimises at the root instead of doing nothing or exiting to a blank page", () => {
    expect(backButtonAction(false)).toBe("minimize");
  });
});

describe("DRIVER_TABS matches the driver dashboard's tabs", () => {
  it("every <TabsTrigger value> in driver-dashboard.tsx is in the allow-list and vice versa", async () => {
    const { readFileSync } = await import("node:fs");
    const src = readFileSync(new URL("../client/src/pages/driver-dashboard.tsx", import.meta.url), "utf8");
    const values = [...src.matchAll(/<TabsTrigger\s+value="([^"]+)"/g)].map((m) => m[1]);
    expect(new Set(values)).toEqual(new Set(DRIVER_TABS));
  });
});
