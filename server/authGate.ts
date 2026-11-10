// Pure auth-gate decisions (HF3: SEC-7, SEC-18, SEC-19).
//
// This module must import NOTHING from server code (no storage, no db, no
// index). Tests import it on its own, because importing index.ts or
// customAuth.ts boots the server and needs DATABASE_URL. customAuth.ts and
// index.ts wrap these functions in Express middleware.

export type SessionDecision = 'allow' | 'reject';

export interface GateUserLike {
  role?: string | null;
  isActive?: boolean | null;
}

export interface GateCompanyLike {
  status?: string | null;
  isActive?: boolean | null;
}

/**
 * Decide whether a user may hold a session (login and every deserialize).
 * - master_admin is always allowed.
 * - An archived user (`isActive === false`; null counts as active) is rejected.
 * - A suspended or rejected company is rejected.
 * - pending_approval (even with company.isActive false) is ALLOWED here: those
 *   admins must log in to reach onboarding. The company gate blocks the rest.
 * - No company row (or no company at all) is allowed here; the gate handles it.
 */
export function sessionDecision(
  user: GateUserLike,
  company: GateCompanyLike | null | undefined,
): SessionDecision {
  if (user.role === 'master_admin') return 'allow';
  if (user.isActive === false) return 'reject';
  if (company && (company.status === 'suspended' || company.status === 'rejected')) {
    return 'reject';
  }
  return 'allow';
}

export interface CompanyGateUser {
  role?: string | null;
  companyId?: string | null;
  companyStatus?: string | null;
  companyIsActive?: boolean | null;
}

// Paths a user of a not-yet-active company may still call (onboarding + billing).
// Compared lowercased. `/api/auth/` is a prefix (with the trailing slash, so
// `/api/authx` does not match); the rest are exact.
export const COMPANY_GATE_PREFIX_ALLOW = ['/api/auth/'];
export const COMPANY_GATE_EXACT_ALLOW = [
  '/api/business/status',
  '/api/business/create-checkout-session',
  '/api/subscription-plans',
  '/api/stripe/publishable-key',
];

function isApiPath(lowerPath: string): boolean {
  return lowerPath === '/api' || lowerPath.startsWith('/api/');
}

/**
 * True if the request may proceed past the company gate.
 * Applies only to /api paths with a logged-in, non-master_admin user whose
 * companyId is set. Such a user passes only if their company is approved and
 * not inactive, or the path is on the onboarding/billing allow-list.
 * Matching is case-insensitive because Express routes match `/API/drivers` too.
 */
export function isCompanyGateAllowed(
  path: string,
  user: CompanyGateUser | null | undefined,
): boolean {
  const lowerPath = (path || '').toLowerCase();
  if (!isApiPath(lowerPath)) return true;
  if (!user) return true;
  if (user.role === 'master_admin') return true;
  if (!user.companyId) return true;
  if (user.companyStatus === 'approved' && user.companyIsActive !== false) return true;

  if (COMPANY_GATE_PREFIX_ALLOW.some((p) => lowerPath.startsWith(p))) return true;
  // Express treats a single trailing slash as the same route, so do the same.
  const exactPath = lowerPath.length > 1 && lowerPath.endsWith('/') ? lowerPath.slice(0, -1) : lowerPath;
  return COMPANY_GATE_EXACT_ALLOW.includes(exactPath);
}

const SAFE_METHODS = ['GET', 'HEAD', 'OPTIONS'];

function hostOf(origin: string): string | null {
  try {
    return new URL(origin).host;
  } catch {
    return null;
  }
}

/**
 * True if a state-changing /api request must be rejected as cross-site.
 * - Only /api paths (case-insensitive) and methods other than GET/HEAD/OPTIONS.
 * - No Origin header → allowed (same-origin navigations, native/non-browser clients).
 * - Origin in allowedOrigins, or with the same host as the request → allowed.
 * - Anything else, including `Origin: null` and unparseable values → blocked.
 */
export function isCrossSiteWriteBlocked(
  method: string,
  path: string,
  origin: string | null | undefined,
  selfOrigin: string,
  allowedOrigins: readonly string[],
): boolean {
  if (!isApiPath((path || '').toLowerCase())) return false;
  if (SAFE_METHODS.includes((method || '').toUpperCase())) return false;
  if (origin === undefined || origin === null || origin === '') return false;
  if (allowedOrigins.includes(origin)) return false;

  const originHost = hostOf(origin);
  const selfHost = hostOf(selfOrigin);
  if (originHost && selfHost && originHost === selfHost) return false;
  return true;
}
