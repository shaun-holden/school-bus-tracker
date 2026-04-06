import { useEffect } from "react";
import { apiRequest } from "@/lib/queryClient";
import { requestNotificationPermission, onForegroundMessage } from "@/lib/firebase";
import { useToast } from "@/hooks/use-toast";

/**
 * Registers the browser for web push notifications via Firebase Cloud Messaging.
 * Call this hook once when a user is authenticated.
 */
export function useWebPush(enabled: boolean) {
  const { toast } = useToast();

  useEffect(() => {
    if (!enabled) return;
    let cancelled = false;

    (async () => {
      // Only register if the user has already granted permission OR
      // we haven't asked them yet. Don't re-prompt if denied.
      if (typeof window === "undefined" || !("Notification" in window)) return;
      if (Notification.permission === "denied") return;

      const token = await requestNotificationPermission();
      if (cancelled || !token) return;

      try {
        await apiRequest("/api/device-tokens", "POST", {
          token,
          platform: "web",
        });
      } catch (err) {
        console.error("Failed to register web push token:", err);
      }
    })();

    // Listen for foreground messages and show a toast
    const unsubscribe = onForegroundMessage((title, body) => {
      toast({ title, description: body });
    });

    return () => {
      cancelled = true;
      unsubscribe();
    };
  }, [enabled, toast]);
}
