// Q92: native push-tap plumbing, attached at module load (before React mounts)
// so a tap that cold-starts the app is caught as early as possible. The plugin
// also retains an unconsumed tap until a listener attaches (retainUntilConsumed).
// Only the push `type` is kept; the route always comes from the pushRoutes
// allow-list (S-21), never from the payload.
import { Capacitor } from "@capacitor/core";
import { PushNotifications } from "@capacitor/push-notifications";

type PendingTap = { type: unknown };

let pending: PendingTap | null = null;
let registered = false;
const subscribers = new Set<() => void>();

/** Attach the single native tap listener. Safe to call more than once; web is a no-op. */
export function initPushTap(): void {
  if (registered || !Capacitor.isNativePlatform()) return;
  registered = true;
  void PushNotifications.addListener("pushNotificationActionPerformed", (action) => {
    const type = action?.notification?.data?.type;
    console.log("[pushtap] listener fired", { type, actionId: action?.actionId });
    pending = { type };
    for (const fn of subscribers) fn();
  }).catch(() => {
    registered = false;
    console.log("[pushtap] listener registration failed");
  });
}

/** Take (and clear) the pending tapped type, if any. */
export function takePendingPushTap(): PendingTap | null {
  const tap = pending;
  pending = null;
  return tap;
}

/** Be told when a tap arrives. Returns an unsubscribe function. */
export function subscribePushTap(fn: () => void): () => void {
  subscribers.add(fn);
  return () => {
    subscribers.delete(fn);
  };
}

/** True while a tap is waiting to be consumed. */
export function hasPendingPushTap(): boolean {
  return pending !== null;
}
