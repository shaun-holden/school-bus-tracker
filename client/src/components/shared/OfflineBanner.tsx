import { useEffect, useState } from "react";
import { WifiOff } from "lucide-react";

/**
 * Passive offline indicator: shows a fixed banner across the top of the app
 * whenever the browser reports that we are offline. React Query handles
 * refetch on window focus and reconnect automatically (see queryClient
 * defaults: refetchOnWindowFocus, refetchInterval), so this component does
 * not invalidate caches itself.
 */
export function OfflineBanner() {
  const getInitialOnline = () =>
    typeof navigator !== "undefined" ? navigator.onLine : true;

  const [isOnline, setIsOnline] = useState<boolean>(getInitialOnline);

  useEffect(() => {
    const handleOnline = () => setIsOnline(true);
    const handleOffline = () => setIsOnline(false);

    window.addEventListener("online", handleOnline);
    window.addEventListener("offline", handleOffline);

    // Sync state in case the value changed before the listeners were attached.
    setIsOnline(getInitialOnline());

    return () => {
      window.removeEventListener("online", handleOnline);
      window.removeEventListener("offline", handleOffline);
    };
  }, []);

  if (isOnline) return null;

  return (
    <div
      role="status"
      aria-live="polite"
      className="fixed top-0 left-0 right-0 z-[100] bg-amber-500 text-amber-950 shadow-md"
      data-testid="offline-banner"
    >
      <div className="mx-auto flex max-w-screen-xl items-center justify-between gap-3 px-4 py-2">
        <div className="flex items-center gap-2 text-sm font-medium">
          <WifiOff className="h-4 w-4" aria-hidden="true" />
          <span>You are offline. Some features may be unavailable.</span>
        </div>
      </div>
    </div>
  );
}

export default OfflineBanner;
