// "Has master powers": true for a master admin, impersonating or not. Use it
// for power checks (master-only actions, role rules), NOT for tenant bypass.
export function isMasterAdminUser(user: any): boolean {
  return user?.role === 'master_admin' || user?._masterAdminImpersonating === true;
}

// True only for a master admin who is NOT impersonating. This is the one
// caller that skips tenant scoping. An impersonating master is acting as the
// impersonated school, so it is scoped to that company like its admins
// (SEC-45/DUP-2). Use this (not isMasterAdminUser) for tenant bypass.
export function isUnscopedMaster(user: any): boolean {
  return user?.role === 'master_admin' && user?._masterAdminImpersonating !== true;
}

// Returns the companyId filter to apply on list/read endpoints:
//   undefined → caller should see everything (master-admin, not impersonating;
//               an impersonating master is scoped to the impersonated company)
//   string    → caller should be scoped to that companyId
//   null      → caller should see nothing (authenticated but no company);
//               handler should short-circuit with an empty list.
// Keep these three states distinct — conflating null and undefined would
// silently give unprivileged users an unscoped read.
export function companyScope(user: any): string | undefined | null {
  // isUnscopedMaster, not isMasterAdminUser: impersonation scopes to the school.
  if (isUnscopedMaster(user)) return undefined;
  return user?.companyId ?? null;
}

// Record-by-id tenant guard: true when the caller must get a 404 for a record
// owned by `recordCompanyId`. Only a non-impersonating master is exempt; an
// impersonating master is checked against the impersonated company
// (impersonation scopes to the school). A scoped caller with no company
// matches nothing (so null === null never grants access).
export function isOutsideCallerTenant(user: any, recordCompanyId: string | null | undefined): boolean {
  if (isUnscopedMaster(user)) return false;
  return !user?.companyId || recordCompanyId !== user.companyId;
}

// Foreign-key ids from a request body: null, undefined and "" all mean "none".
export function hasId(value: unknown): value is string {
  return typeof value === 'string' && value !== '';
}

export function isAdminRole(role: string | undefined | null): boolean {
  return role === 'admin' || role === 'master_admin' || role === 'driver_admin';
}

export function isDriverRole(roleOrUser: any): boolean {
  // Accept either a role string (legacy) or a user object
  if (typeof roleOrUser === 'string' || roleOrUser == null) {
    return roleOrUser === 'driver' || roleOrUser === 'driver_admin' || roleOrUser === 'master_admin';
  }
  // User object
  const role = roleOrUser.role;
  return role === 'driver' || role === 'driver_admin' || role === 'master_admin' || roleOrUser._masterAdminImpersonating === true;
}

export function isParentRole(roleOrUser: any): boolean {
  if (typeof roleOrUser === 'string' || roleOrUser == null) {
    return roleOrUser === 'parent' || roleOrUser === 'master_admin';
  }
  const role = roleOrUser.role;
  return role === 'parent' || role === 'master_admin' || roleOrUser._masterAdminImpersonating === true;
}

// Messaging is for parents and drivers. A master admin has no messaging,
// except while impersonating a school (Q19). A bare role string can't carry
// the impersonation flag, so 'master_admin' as a string is always false.
export function canAccessMessaging(roleOrUser: any): boolean {
  if (typeof roleOrUser === 'string' || roleOrUser == null) {
    return roleOrUser === 'parent' || roleOrUser === 'driver';
  }
  const role = roleOrUser.role;
  if (role === 'parent' || role === 'driver') return true;
  return role === 'master_admin' && roleOrUser._masterAdminImpersonating === true;
}
