export function isMasterAdminUser(user: any): boolean {
  return user?.role === 'master_admin' || user?._masterAdminImpersonating === true;
}

// Returns the companyId filter to apply on list/read endpoints:
//   undefined → caller should see everything (master-admin)
//   string    → caller should be scoped to that companyId
//   null      → caller should see nothing (authenticated but no company);
//               handler should short-circuit with an empty list.
// Keep these three states distinct — conflating null and undefined would
// silently give unprivileged users an unscoped read.
export function companyScope(user: any): string | undefined | null {
  if (isMasterAdminUser(user)) return undefined;
  return user?.companyId ?? null;
}

// Record-by-id tenant guard: true when a non-master caller must get a 404
// for a record owned by `recordCompanyId`. A non-master caller with no
// company matches nothing (so null === null never grants access).
export function isOutsideCallerTenant(user: any, recordCompanyId: string | null | undefined): boolean {
  if (isMasterAdminUser(user)) return false;
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

export function canAccessMessaging(roleOrUser: any): boolean {
  if (typeof roleOrUser === 'string' || roleOrUser == null) {
    return roleOrUser === 'parent' || roleOrUser === 'driver' || roleOrUser === 'master_admin';
  }
  const role = roleOrUser.role;
  return role === 'parent' || role === 'driver' || role === 'master_admin' || roleOrUser._masterAdminImpersonating === true;
}
