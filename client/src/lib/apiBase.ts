import { Capacitor } from "@capacitor/core";

/**
 * Default API base used by the native iOS/Android shells when no
 * VITE_API_BASE_URL is provided at build time.
 */
const DEFAULT_NATIVE_API_BASE = "https://www.schoolbustracker.org";

/**
 * Returns the API base URL for the current runtime.
 *
 * - On native (Capacitor) platforms, the WebView serves files from
 *   capacitor://localhost (or similar), so relative URLs like
 *   "/api/foo" do not point at our backend. We need to prefix them
 *   with an absolute origin.
 * - On the web, we return an empty string so existing relative URLs
 *   continue to work unchanged.
 */
export function getApiBase(): string {
  if (
    typeof Capacitor !== "undefined" &&
    typeof Capacitor.isNativePlatform === "function" &&
    Capacitor.isNativePlatform()
  ) {
    const envBase = (import.meta as any)?.env?.VITE_API_BASE_URL as
      | string
      | undefined;
    const base = (envBase && envBase.trim()) || DEFAULT_NATIVE_API_BASE;
    return base.replace(/\/+$/, "");
  }
  return "";
}

/**
 * Wraps a relative API path (e.g. "/api/foo") with the appropriate
 * base for the current platform. Absolute URLs are returned unchanged.
 */
export function apiUrl(path: string): string {
  if (!path) return path;
  // Already absolute -- return as-is.
  if (/^https?:\/\//i.test(path)) return path;

  const base = getApiBase();
  if (!base) return path;

  // Strip any leading slashes from the path and always join with exactly one,
  // so inputs like "/api/foo", "//api/foo", and "api/foo" all yield the same URL.
  const trimmedPath = path.replace(/^\/+/, "");
  return `${base}/${trimmedPath}`;
}
