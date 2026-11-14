// Q59: account deletion helpers (App Store 5.1.1(v) / Google Play).
// Pure: the only import is the shared error-text fallback, so a Node unit test
// can import this file.
import { friendlyErrorText } from "./errorText";

export const CONTACT_SUPPORT_TEXT =
  "Staff accounts are removed by your school's administrator. To close a school account, email support@schoolbustracker.org.";

/**
 * Parents and drivers delete their own account in the app. Staff (admin,
 * driver_admin, master_admin) and an impersonating master see "contact support".
 * The server enforces the same rule (403 CONTACT_SUPPORT); this only decides
 * which card the Account page shows.
 */
export function canSelfDeleteAccount(
  user: { role?: string | null; _masterAdminImpersonating?: boolean | null } | null | undefined,
): boolean {
  if (!user) return false;
  if (user._masterAdminImpersonating === true) return false;
  return user.role === "parent" || user.role === "driver";
}

/**
 * Turns an error from apiRequest (`"<status>: <body>"`, queryClient.ts) on
 * POST /api/auth/delete-account into text shown under the password field.
 */
export function deleteAccountErrorText(err: unknown): string {
  const text = err instanceof Error ? err.message : typeof err === "string" ? err : "";
  const match = /^(\d{3}): ([\s\S]*)$/.exec(text);
  if (!match) return friendlyErrorText(err);
  const status = Number(match[1]);
  let code: string | undefined;
  try {
    const body: unknown = JSON.parse(match[2]);
    if (body !== null && typeof body === "object" && !Array.isArray(body)) {
      const c = (body as { code?: unknown }).code;
      if (typeof c === "string") code = c;
    }
  } catch {
    // not JSON: decide on the status alone
  }

  if (status === 400 && code === "BAD_PASSWORD") return "That password isn't right.";
  // A 400 without a code is the Zod shape { message, errors }: empty or too long a password.
  if (status === 400 && code === undefined) return "Enter your password.";
  if (status === 401) return "Your session ended, sign in again.";
  if (status === 403) return CONTACT_SUPPORT_TEXT;
  if (status === 409 && code === "ON_DUTY") return "Go off duty first.";
  if (status === 429) return "Too many attempts, try again in 15 minutes.";
  return friendlyErrorText(err);
}
