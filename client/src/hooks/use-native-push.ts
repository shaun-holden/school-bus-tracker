import { useEffect, useSyncExternalStore } from "react";
import { Capacitor, type PluginListenerHandle } from "@capacitor/core";
import { PushNotifications } from "@capacitor/push-notifications";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { toast } from "@/hooks/use-toast";
import { shouldOfferPush } from "@/lib/pushRoutes";
import { sendTokenOnce, setPushToken } from "@/lib/pushToken";

/**
 * Native (iOS/Android) push for a logged-in parent or driver (T2).
 * - permission granted: register() on every app start and login (token refresh, user switch);
 * - permission not asked yet: PushPermissionCard shows; the OS prompt only comes from its "Turn on";
 * - permission denied: the card shows a Settings hint, never a retry.
 * Tokens stay in memory (pushToken.ts) and are never logged.
 */

// ---- Card state (shared with PushPermissionCard) ----
export type PushCardState = "hidden" | "prompt" | "denied";
let cardState: PushCardState = "hidden";
let dismissedThisSession = false; // "Not now": memory only, so the card comes back next launch
const cardListeners = new Set<() => void>();

function setCardState(next: PushCardState) {
  if (cardState === next) return;
  cardState = next;
  cardListeners.forEach((fn) => fn());
}

function subscribeCard(fn: () => void) {
  cardListeners.add(fn);
  return () => {
    cardListeners.delete(fn);
  };
}

function cardSnapshot(): PushCardState {
  return dismissedThisSession ? "hidden" : cardState;
}

export function usePushCardState(): PushCardState {
  return useSyncExternalStore(subscribeCard, cardSnapshot, () => "hidden");
}

export function dismissPushCard() {
  dismissedThisSession = true;
  cardListeners.forEach((fn) => fn());
}

// ---- Registration ----
// Plain-word error codes only; anything else is logged as "unknown" (no token or response text).
function safeCode(value: unknown): string {
  return typeof value === "string" && /^[A-Za-z0-9_.-]{1,64}$/.test(value) ? value : "unknown";
}

async function createAndroidChannels() {
  if (Capacitor.getPlatform() !== "android") return;
  // Private lock-screen visibility (0): only "School Bus Tracker" shows until the phone is unlocked.
  await PushNotifications.createChannel({ id: "bus_updates", name: "Bus updates", importance: 4, visibility: 0 });
  await PushNotifications.createChannel({ id: "messages", name: "Messages", importance: 3, visibility: 0 });
}

/** Channels first (Android), then register(); the token arrives on the 'registration' listener. */
export async function registerForPush(): Promise<void> {
  await createAndroidChannels();
  await PushNotifications.register();
}

/** The card's "Turn on": the only place that shows the OS permission prompt. */
export async function turnOnPush(): Promise<void> {
  const { receive } = await PushNotifications.requestPermissions();
  if (receive === "granted") {
    setCardState("hidden");
    await registerForPush();
  } else if (receive === "denied") {
    setCardState("denied");
  }
}

const FOREGROUND_QUERY_KEYS = [
  "/api/system-notifications",
  "/api/system-notifications/unread-count",
  "/api/parent-notifications",
  "/api/parent-notifications/unread-count",
  "/api/notifications",
  "/api/messages/unread-count",
  "/api/messages/conversations",
];

type NativePushUser = { id?: string | null; role?: string | null; _masterAdminImpersonating?: boolean } | null | undefined;

export function useNativePush(user: NativePushUser) {
  const enabled = shouldOfferPush(user, Capacitor.isNativePlatform());
  const userId = enabled && user?.id ? user.id : null;

  useEffect(() => {
    if (!userId) return;
    let cancelled = false;
    const handles: Promise<PluginListenerHandle>[] = [];

    handles.push(
      PushNotifications.addListener("registration", async ({ value }) => {
        if (!value) return;
        setPushToken(value);
        // Skips a repeat, and skips entirely while logout is running.
        const result = await sendTokenOnce(userId, value, (token) =>
          apiRequest("/api/device-tokens", "POST", { token, platform: Capacitor.getPlatform() }),
        );
        if (result === "failed") console.warn("Push token could not be saved");
      }),
    );

    handles.push(
      PushNotifications.addListener("registrationError", (err) => {
        console.warn("Push registration failed:", safeCode(err?.error));
      }),
    );

    handles.push(
      PushNotifications.addListener("pushNotificationReceived", (notification) => {
        // iOS shows its own banner (presentationOptions); Android shows nothing while the app is open.
        if (Capacitor.getPlatform() === "android") {
          toast({ title: notification.title ?? "School Bus Tracker", description: notification.body });
        }
        for (const key of FOREGROUND_QUERY_KEYS) {
          void queryClient.invalidateQueries({ queryKey: [key] });
        }
      }),
    );

    (async () => {
      try {
        const { receive } = await PushNotifications.checkPermissions();
        if (cancelled) return;
        if (receive === "granted") {
          setCardState("hidden");
          await registerForPush();
        } else if (receive === "denied") {
          setCardState("denied");
        } else {
          setCardState("prompt");
        }
      } catch {
        console.warn("Push permission check failed");
      }
    })();

    return () => {
      cancelled = true;
      setCardState("hidden");
      for (const handle of handles) {
        void handle.then((h) => h.remove()).catch(() => {});
      }
    };
  }, [userId]);
}
