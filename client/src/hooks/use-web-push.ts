import { useEffect } from "react";
import { Capacitor } from "@capacitor/core";
import { apiRequest } from "@/lib/queryClient";
import { askWebPushPermission, getWebPushToken, onForegroundMessage } from "@/lib/firebase";
import { shouldOfferWebPush } from "@/lib/pushRoutes";
import { setPushCardState } from "@/hooks/use-native-push";
import { useToast } from "@/hooks/use-toast";

/**
 * Web push via Firebase Cloud Messaging (Q61, PL-3), for a logged-in parent or
 * driver in a browser. The browser prompt is never shown on load:
 * - permission 'granted': get the token and POST it once per user + token;
 * - permission 'default': PushPermissionCard shows; its "Turn on" (a tap) asks;
 * - permission 'denied': the card shows the site-settings hint.
 * Staff, masters and an impersonating master get nothing (no card, no POST).
 * The phone app uses native push (use-native-push.ts); the two never both run.
 */

type WebPushUser = { id?: string | null; role?: string | null; _masterAdminImpersonating?: boolean } | null | undefined;

// The user the hook is running for, so the card's "Turn on" knows whom to register.
let activeUserId: string | null = null;
// Starts the foreground toast listener once permission is granted from a tap.
let startForegroundListener: (() => void) | null = null;
// The last (userId, token) sent this page session, so a remount doesn't POST again.
let lastSentKey: string | null = null;

async function sendWebTokenOnce(userId: string, token: string): Promise<void> {
  const key = `${userId}:${token}`;
  if (lastSentKey === key) return;
  try {
    await apiRequest("/api/device-tokens", "POST", { token, platform: "web" });
    lastSentKey = key;
  } catch {
    console.warn("Web push token could not be saved");
  }
}

/** The card's "Turn on" on web: the only place that shows the browser prompt. */
export async function turnOnWebPush(): Promise<void> {
  const userId = activeUserId;
  if (!userId) return;
  const token = await askWebPushPermission();
  const permission = typeof Notification === "undefined" ? "denied" : Notification.permission;
  if (permission === "granted") {
    setPushCardState("hidden");
    startForegroundListener?.();
    if (token && activeUserId === userId) await sendWebTokenOnce(userId, token);
  } else if (permission === "denied") {
    setPushCardState("denied");
  }
  // 'default' (the prompt was closed without a choice): the card stays, the browser can ask again.
}

export function useWebPush(user: WebPushUser) {
  const { toast } = useToast();
  const userId = shouldOfferWebPush(user) && user?.id ? user.id : null;

  useEffect(() => {
    if (Capacitor.isNativePlatform()) return;
    if (!userId) return;
    if (typeof window === "undefined" || !("Notification" in window)) return;

    activeUserId = userId;
    let unsubscribe: (() => void) | null = null;
    const listen = () => {
      if (unsubscribe) return;
      unsubscribe = onForegroundMessage((title, body) => {
        toast({ title, description: body });
      });
    };
    startForegroundListener = listen;

    const permission = Notification.permission;
    if (permission === "granted") {
      setPushCardState("hidden");
      listen();
      void (async () => {
        const token = await getWebPushToken();
        if (token && activeUserId === userId) await sendWebTokenOnce(userId, token);
      })();
    } else if (permission === "denied") {
      setPushCardState("denied");
    } else {
      setPushCardState("prompt");
    }

    return () => {
      if (activeUserId === userId) activeUserId = null;
      if (startForegroundListener === listen) startForegroundListener = null;
      setPushCardState("hidden");
      unsubscribe?.();
    };
  }, [userId, toast]);
}
