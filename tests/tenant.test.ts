import { describe, it, expect } from 'vitest';
// Unit tests for the pure helpers in server/tenant.ts that had no test of
// their own: isUnscopedMaster, isOutsideCallerTenant, hasId, isParentRole,
// canAccessMessaging and the user-object form of isDriverRole, plus the
// impersonation cases of companyScope. (isMasterAdminUser / companyScope
// are covered in tests/multi-tenant.test.ts, isAdminRole / isDriverRole string
// form in tests/role-access.test.ts.)
import {
  isUnscopedMaster,
  companyScope,
  isOutsideCallerTenant,
  hasId,
  isDriverRole,
  isParentRole,
  canAccessMessaging,
} from '../server/tenant';

describe('tenant - isOutsideCallerTenant (record-by-id 404 guard)', () => {
  it('a same-company admin is inside', () => {
    expect(isOutsideCallerTenant({ role: 'admin', companyId: 'co-1' }, 'co-1')).toBe(false);
  });

  it('another company is outside', () => {
    expect(isOutsideCallerTenant({ role: 'admin', companyId: 'co-1' }, 'co-2')).toBe(true);
    expect(isOutsideCallerTenant({ role: 'driver_admin', companyId: 'co-1' }, 'co-2')).toBe(true);
  });

  it('a record with no company is outside for a non-master caller', () => {
    expect(isOutsideCallerTenant({ role: 'admin', companyId: 'co-1' }, null)).toBe(true);
    expect(isOutsideCallerTenant({ role: 'admin', companyId: 'co-1' }, undefined)).toBe(true);
  });

  it('null never matches null: a caller with no company is outside even for a company-less record', () => {
    expect(isOutsideCallerTenant({ role: 'admin', companyId: null }, null)).toBe(true);
    expect(isOutsideCallerTenant({ role: 'admin' }, undefined)).toBe(true);
    expect(isOutsideCallerTenant({ role: 'admin', companyId: '' }, '')).toBe(true);
  });

  it('a missing caller is outside', () => {
    expect(isOutsideCallerTenant(null, 'co-1')).toBe(true);
    expect(isOutsideCallerTenant(undefined, null)).toBe(true);
  });

  it('a non-impersonating master admin is never outside', () => {
    expect(isOutsideCallerTenant({ role: 'master_admin', companyId: null }, 'co-2')).toBe(false);
    expect(isOutsideCallerTenant({ role: 'master_admin' }, null)).toBe(false);
    expect(isOutsideCallerTenant({ role: 'master_admin', _masterAdminImpersonating: false }, 'co-2')).toBe(false);
  });

  it('an impersonating master is scoped to the impersonated company (red if isOutsideCallerTenant bypasses on isMasterAdminUser instead of isUnscopedMaster)', () => {
    const imp = { role: 'master_admin', companyId: 'co-1', _masterAdminImpersonating: true };
    expect(isOutsideCallerTenant(imp, 'co-1')).toBe(false);
    expect(isOutsideCallerTenant(imp, 'co-2')).toBe(true);
    expect(isOutsideCallerTenant(imp, null)).toBe(true);
  });

  it('the impersonation flag on a non-master does not exempt', () => {
    expect(isOutsideCallerTenant({ role: 'admin', companyId: 'co-1', _masterAdminImpersonating: true }, 'co-2')).toBe(true);
    expect(isOutsideCallerTenant({ role: 'admin', companyId: 'co-1', _masterAdminImpersonating: true }, 'co-1')).toBe(false);
  });

  it('_masterAdminImpersonating: false does not exempt', () => {
    expect(isOutsideCallerTenant({ role: 'admin', companyId: 'co-1', _masterAdminImpersonating: false }, 'co-2')).toBe(true);
  });
});

describe('tenant - isUnscopedMaster (the only tenant bypass)', () => {
  it('a master admin who is not impersonating is unscoped', () => {
    expect(isUnscopedMaster({ role: 'master_admin' })).toBe(true);
    expect(isUnscopedMaster({ role: 'master_admin', companyId: null })).toBe(true);
    expect(isUnscopedMaster({ role: 'master_admin', _masterAdminImpersonating: false })).toBe(true);
  });

  it('an impersonating master admin is scoped (red if isUnscopedMaster ignores _masterAdminImpersonating)', () => {
    expect(isUnscopedMaster({ role: 'master_admin', companyId: 'co-1', _masterAdminImpersonating: true })).toBe(false);
  });

  it('no other role is unscoped, with or without the flag', () => {
    for (const role of ['admin', 'driver_admin', 'driver', 'parent', undefined]) {
      expect(isUnscopedMaster({ role })).toBe(false);
      expect(isUnscopedMaster({ role, _masterAdminImpersonating: true })).toBe(false);
    }
  });

  it('null / undefined are not unscoped', () => {
    expect(isUnscopedMaster(null)).toBe(false);
    expect(isUnscopedMaster(undefined)).toBe(false);
  });
});

describe('tenant - companyScope impersonation cases', () => {
  it('non-impersonating master: undefined (sees all)', () => {
    expect(companyScope({ role: 'master_admin', companyId: null })).toBeUndefined();
  });

  it('impersonating master: the impersonated companyId (red if companyScope bypasses on isMasterAdminUser)', () => {
    expect(companyScope({ role: 'master_admin', companyId: 'co-1', _masterAdminImpersonating: true })).toBe('co-1');
  });

  it('impersonating master with no companyId: null (sees nothing, never unscoped)', () => {
    expect(companyScope({ role: 'master_admin', companyId: null, _masterAdminImpersonating: true })).toBeNull();
  });
});

describe('tenant - hasId (FK id present in a request body)', () => {
  it('a non-empty string is an id', () => {
    expect(hasId('route-1')).toBe(true);
    expect(hasId(' ')).toBe(true);
  });

  it('null, undefined and "" mean none', () => {
    expect(hasId(null)).toBe(false);
    expect(hasId(undefined)).toBe(false);
    expect(hasId('')).toBe(false);
  });

  it('non-strings are not ids', () => {
    expect(hasId(0)).toBe(false);
    expect(hasId(123)).toBe(false);
    expect(hasId({ id: 'x' })).toBe(false);
    expect(hasId(['x'])).toBe(false);
    expect(hasId(true)).toBe(false);
  });
});

describe('tenant - isDriverRole (user-object form)', () => {
  it('driver, driver_admin and master_admin users pass', () => {
    expect(isDriverRole({ role: 'driver' })).toBe(true);
    expect(isDriverRole({ role: 'driver_admin' })).toBe(true);
    expect(isDriverRole({ role: 'master_admin' })).toBe(true);
  });

  it('admin and parent users fail', () => {
    expect(isDriverRole({ role: 'admin' })).toBe(false);
    expect(isDriverRole({ role: 'parent' })).toBe(false);
    expect(isDriverRole({})).toBe(false);
  });

  it('an impersonating master passes whatever the overlaid role', () => {
    expect(isDriverRole({ role: 'admin', _masterAdminImpersonating: true })).toBe(true);
    expect(isDriverRole({ role: 'admin', _masterAdminImpersonating: false })).toBe(false);
  });

  it('null / undefined fail', () => {
    expect(isDriverRole(null)).toBe(false);
    expect(isDriverRole(undefined)).toBe(false);
  });
});

describe('tenant - isParentRole', () => {
  it('string form: parent and master_admin pass, others fail', () => {
    expect(isParentRole('parent')).toBe(true);
    expect(isParentRole('master_admin')).toBe(true);
    expect(isParentRole('admin')).toBe(false);
    expect(isParentRole('driver')).toBe(false);
    expect(isParentRole('driver_admin')).toBe(false);
    expect(isParentRole('Parent')).toBe(false);
    expect(isParentRole('')).toBe(false);
    expect(isParentRole(null)).toBe(false);
    expect(isParentRole(undefined)).toBe(false);
  });

  it('object form: parent / master_admin / impersonating pass', () => {
    expect(isParentRole({ role: 'parent' })).toBe(true);
    expect(isParentRole({ role: 'master_admin' })).toBe(true);
    expect(isParentRole({ role: 'admin', _masterAdminImpersonating: true })).toBe(true);
    expect(isParentRole({ role: 'admin' })).toBe(false);
    expect(isParentRole({ role: 'driver' })).toBe(false);
  });
});

describe('tenant - canAccessMessaging', () => {
  it('string form: parent, driver and master_admin pass', () => {
    expect(canAccessMessaging('parent')).toBe(true);
    expect(canAccessMessaging('driver')).toBe(true);
    expect(canAccessMessaging('master_admin')).toBe(true);
  });

  it('string form: admin, driver_admin and unknown roles fail', () => {
    expect(canAccessMessaging('admin')).toBe(false);
    expect(canAccessMessaging('driver_admin')).toBe(false);
    expect(canAccessMessaging('unknown')).toBe(false);
    expect(canAccessMessaging(null)).toBe(false);
    expect(canAccessMessaging(undefined)).toBe(false);
  });

  it('object form: impersonating master passes, plain admin fails', () => {
    expect(canAccessMessaging({ role: 'driver' })).toBe(true);
    expect(canAccessMessaging({ role: 'admin', _masterAdminImpersonating: true })).toBe(true);
    expect(canAccessMessaging({ role: 'admin' })).toBe(false);
    expect(canAccessMessaging({ role: 'driver_admin' })).toBe(false);
  });
});
