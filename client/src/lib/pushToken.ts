// This phone's push token for the current app session. Memory only: never
// written to browser storage or to logs.
let currentToken: string | null = null;

export function getPushToken(): string | null {
  return currentToken;
}

export function setPushToken(token: string): void {
  currentToken = token;
}

export function clearPushToken(): void {
  currentToken = null;
}

/** Body for POST /api/auth/logout: this phone's token, so the server turns off only this phone (T4a). */
export function logoutBody(token: string | null | undefined): { deviceToken?: string } {
  return token ? { deviceToken: token } : {};
}

// ---- Logout ordering (T2 round 2) ----
// While logout runs (it may call register() to learn this phone's token), the
// registration listener must not re-send the token: the server could turn it
// back on after logout turned it off.
let loggingOut = false;

export function setLoggingOut(value: boolean): void {
  loggingOut = value;
}

export function isLoggingOut(): boolean {
  return loggingOut;
}

// The last (userId, token) sent to the server this session, so a repeat isn't re-sent.
let lastSentKey: string | null = null;

/**
 * Sends this phone's token to the server once per (user, token) per session.
 * Skipped while logout is running. `post` does the actual request.
 */
export async function sendTokenOnce(
  userId: string,
  token: string,
  post: (token: string) => Promise<unknown>,
): Promise<"sent" | "skipped" | "failed"> {
  if (!token || isLoggingOut()) return "skipped";
  const key = `${userId}:${token}`;
  if (lastSentKey === key) return "skipped";
  try {
    await post(token);
    lastSentKey = key;
    return "sent";
  } catch {
    return "failed";
  }
}

/**
 * Logout, then leave the page: the redirect waits until the logout request has
 * finished or failed, so a reload can't cut it off (the session must really end).
 * Web keeps its behaviour: it always ends on the redirect, even if logout fails.
 */
export async function logoutThenRedirect(logout: () => Promise<unknown>, redirect: () => void): Promise<void> {
  try {
    await logout();
  } catch {
    // Still leave the page; the server session may already be gone.
  } finally {
    redirect();
  }
}
