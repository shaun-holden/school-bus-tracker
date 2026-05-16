import { createContext, useCallback, useContext, useMemo, useRef, type ReactNode } from "react";
import { Capacitor } from "@capacitor/core";
import { SplashScreen } from "@capacitor/splash-screen";

const MIN_DISPLAY_MS = 600;
const FADE_OUT_DURATION = 200;

interface SplashContextValue {
  shownAt: number | null;
  hide: () => Promise<void>;
}

const SplashContext = createContext<SplashContextValue>({
  shownAt: null,
  hide: async () => {},
});

interface SplashProviderProps {
  shownAt: number | null;
  children: ReactNode;
}

export function SplashProvider({ shownAt, children }: SplashProviderProps) {
  // Module-style idempotency guard kept in a ref so React StrictMode double-invokes
  // and re-renders never trigger a second hide() call.
  const hasHiddenRef = useRef(false);

  const hide = useCallback(async () => {
    if (!Capacitor.isNativePlatform()) return;
    if (hasHiddenRef.current) return;
    hasHiddenRef.current = true;

    try {
      const elapsed = shownAt != null ? Date.now() - shownAt : MIN_DISPLAY_MS;
      const wait = Math.max(0, MIN_DISPLAY_MS - elapsed);
      if (wait > 0) {
        await new Promise((resolve) => setTimeout(resolve, wait));
      }
      await SplashScreen.hide({ fadeOutDuration: FADE_OUT_DURATION });
    } catch (err) {
      console.warn("SplashScreen.hide failed", err);
    }
  }, [shownAt]);

  const value = useMemo<SplashContextValue>(
    () => ({ shownAt, hide }),
    [shownAt, hide],
  );

  return <SplashContext.Provider value={value}>{children}</SplashContext.Provider>;
}

export function useSplash(): SplashContextValue {
  return useContext(SplashContext);
}
