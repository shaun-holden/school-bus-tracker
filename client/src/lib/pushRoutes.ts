// Pure helpers for native push (T2). No imports from Capacitor or React, so
// they run in plain unit tests.

// The `data.type` strings the server puts on a push. The server (T4b) must use
// exactly these strings: any other type opens the app without navigating.
export const PARENT_NOTICE_PUSH_TYPES = [
  "stop_arrival", // E1 bus arrived at stop
  "school_arrival", // E2 bus arrived at school
  "school_departure", // E3 bus left school
  "boarded", // E4 child on the bus
  "dropped_off", // E5 child off the bus
  "alert", // E7 admin alert
] as const;
// Admin alert types already sent by today's live web push (POST /api/notifications).
export const LEGACY_ALERT_PUSH_TYPES = ["delay", "emergency", "info", "route_change"] as const;
export const MESSAGE_PUSH_TYPE = "message"; // E6 new message

export const PUSH_TYPES = [
  ...PARENT_NOTICE_PUSH_TYPES,
  ...LEGACY_ALERT_PUSH_TYPES,
  MESSAGE_PUSH_TYPE,
] as const;

const PARENT_NOTICE_SET: ReadonlySet<string> = new Set<string>([
  ...PARENT_NOTICE_PUSH_TYPES,
  ...LEGACY_ALERT_PUSH_TYPES,
]);

/**
 * Maps a push `type` and the logged-in user's role to a fixed in-app path, or
 * null (just open the app). Never reads a URL or path from the payload (S-21).
 */
export function pushRoutes(type: unknown, role: string | null | undefined): string | null {
  if (typeof type !== "string") return null;
  if (role === "parent") {
    if (PARENT_NOTICE_SET.has(type)) return "/parent/notifications";
    if (type === MESSAGE_PUSH_TYPE) return "/parent";
    return null;
  }
  if (role === "driver") {
    if (type === MESSAGE_PUSH_TYPE) return "/?tab=messages";
    return null;
  }
  return null;
}

// The driver dashboard's tab values (driver-dashboard.tsx <TabsTrigger value=…>).
export const DRIVER_TABS = [
  "overview",
  "admin-requests",
  "students",
  "messages",
  "routes",
  "assignments",
  "tasks",
] as const;
export type DriverTab = (typeof DRIVER_TABS)[number];

/** Reads `?tab=` from a search string; only an existing driver tab is accepted. */
export function parseInitialTab(search: string | null | undefined): DriverTab | null {
  if (!search) return null;
  const tab = new URLSearchParams(search).get("tab");
  return (DRIVER_TABS as readonly string[]).includes(tab ?? "") ? (tab as DriverTab) : null;
}

type PushUser = { role?: string | null; _masterAdminImpersonating?: boolean } | null | undefined;

/** Only a parent or driver (never an impersonating master) on a native app gets push. */
export function shouldOfferPush(user: PushUser, isNative: boolean): boolean {
  if (!isNative || !user) return false;
  if (user._masterAdminImpersonating === true) return false;
  return user.role === "parent" || user.role === "driver";
}

/** Android back button: go back inside the app when possible, else minimise (never exit to a blank page). */
export function backButtonAction(canGoBack: boolean): "back" | "minimize" {
  return canGoBack ? "back" : "minimize";
}
