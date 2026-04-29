import { describe, it, expect } from 'vitest';
import { insertCompanySchema } from '@shared/schema';

describe('Multi-Tenant - Company Schema Validation', () => {
  it('should accept valid company data', () => {
    const result = insertCompanySchema.safeParse({
      name: 'ABC Transport',
      slug: 'abc-transport',
      contactEmail: 'info@abctransport.com',
    });
    expect(result.success).toBe(true);
  });

  it('should require company name', () => {
    const result = insertCompanySchema.safeParse({
      slug: 'test-company',
    });
    expect(result.success).toBe(false);
  });

  it('should require slug', () => {
    const result = insertCompanySchema.safeParse({
      name: 'Test Company',
    });
    expect(result.success).toBe(false);
  });

  it('should accept company with all optional fields', () => {
    const result = insertCompanySchema.safeParse({
      name: 'Full Company',
      slug: 'full-company',
      logo: 'https://example.com/logo.png',
      primaryColor: '#ff0000',
      secondaryColor: '#0000ff',
      contactEmail: 'contact@test.com',
      contactPhone: '555-0100',
    });
    expect(result.success).toBe(true);
  });
});

describe('Multi-Tenant - Company Status Workflow', () => {
  const VALID_STATUSES = ['pending_approval', 'approved', 'suspended', 'rejected', 'cancelled'] as const;
  type CompanyStatus = typeof VALID_STATUSES[number];

  function canAccessPlatform(status: CompanyStatus): boolean {
    return status === 'approved';
  }

  function canApprove(status: CompanyStatus): boolean {
    return status === 'pending_approval';
  }

  function canSuspend(status: CompanyStatus): boolean {
    return status === 'approved';
  }

  function canReject(status: CompanyStatus): boolean {
    return status === 'pending_approval';
  }

  it('should have 5 valid company statuses', () => {
    expect(VALID_STATUSES).toHaveLength(5);
  });

  it('only approved companies should access platform', () => {
    expect(canAccessPlatform('approved')).toBe(true);
    expect(canAccessPlatform('pending_approval')).toBe(false);
    expect(canAccessPlatform('suspended')).toBe(false);
    expect(canAccessPlatform('rejected')).toBe(false);
    expect(canAccessPlatform('cancelled')).toBe(false);
  });

  it('only pending companies can be approved', () => {
    expect(canApprove('pending_approval')).toBe(true);
    expect(canApprove('approved')).toBe(false);
    expect(canApprove('suspended')).toBe(false);
  });

  it('only approved companies can be suspended', () => {
    expect(canSuspend('approved')).toBe(true);
    expect(canSuspend('pending_approval')).toBe(false);
    expect(canSuspend('suspended')).toBe(false);
  });

  it('only pending companies can be rejected', () => {
    expect(canReject('pending_approval')).toBe(true);
    expect(canReject('approved')).toBe(false);
  });
});

describe('Multi-Tenant - Slug Validation', () => {
  function isValidSlug(slug: string): boolean {
    return /^[a-z0-9]+(-[a-z0-9]+)*$/.test(slug);
  }

  it('should accept lowercase alphanumeric slugs', () => {
    expect(isValidSlug('abc-transport')).toBe(true);
  });

  it('should accept single word slugs', () => {
    expect(isValidSlug('transport')).toBe(true);
  });

  it('should accept slugs with numbers', () => {
    expect(isValidSlug('bus-company-123')).toBe(true);
  });

  it('should reject slugs with spaces', () => {
    expect(isValidSlug('abc transport')).toBe(false);
  });

  it('should reject slugs with uppercase', () => {
    expect(isValidSlug('ABC-Transport')).toBe(false);
  });

  it('should reject slugs with special characters', () => {
    expect(isValidSlug('abc_transport')).toBe(false);
    expect(isValidSlug('abc@transport')).toBe(false);
  });

  it('should reject empty slugs', () => {
    expect(isValidSlug('')).toBe(false);
  });

  it('should reject slugs starting with hyphen', () => {
    expect(isValidSlug('-abc')).toBe(false);
  });

  it('should reject slugs ending with hyphen', () => {
    expect(isValidSlug('abc-')).toBe(false);
  });
});

describe('Multi-Tenant - Billing Status', () => {
  const VALID_BILLING_STATUSES = ['none', 'trialing', 'active', 'past_due', 'canceled', 'unpaid'] as const;
  type BillingStatus = typeof VALID_BILLING_STATUSES[number];

  function isActiveSubscription(status: BillingStatus): boolean {
    return status === 'active' || status === 'trialing';
  }

  function requiresPaymentAction(status: BillingStatus): boolean {
    return status === 'past_due' || status === 'unpaid';
  }

  it('should have 6 valid billing statuses', () => {
    expect(VALID_BILLING_STATUSES).toHaveLength(6);
  });

  it('active and trialing should be considered active subscriptions', () => {
    expect(isActiveSubscription('active')).toBe(true);
    expect(isActiveSubscription('trialing')).toBe(true);
  });

  it('canceled and none should not be active', () => {
    expect(isActiveSubscription('canceled')).toBe(false);
    expect(isActiveSubscription('none')).toBe(false);
  });

  it('past_due and unpaid should require payment action', () => {
    expect(requiresPaymentAction('past_due')).toBe(true);
    expect(requiresPaymentAction('unpaid')).toBe(true);
  });

  it('active subscriptions should not require payment action', () => {
    expect(requiresPaymentAction('active')).toBe(false);
    expect(requiresPaymentAction('trialing')).toBe(false);
  });
});

describe('Multi-Tenant - Company Modules', () => {
  const AVAILABLE_MODULES = [
    'fleet_management',
    'route_planning',
    'attendance_tracking',
    'parent_notifications',
    'driver_tasks',
    'shift_reports',
    'live_tracking',
    'maintenance',
  ] as const;

  it('should have 8 available modules', () => {
    expect(AVAILABLE_MODULES).toHaveLength(8);
  });

  it('should include fleet management module', () => {
    expect(AVAILABLE_MODULES).toContain('fleet_management');
  });

  it('should include route planning module', () => {
    expect(AVAILABLE_MODULES).toContain('route_planning');
  });

  it('should include attendance tracking module', () => {
    expect(AVAILABLE_MODULES).toContain('attendance_tracking');
  });

  it('should include parent notifications module', () => {
    expect(AVAILABLE_MODULES).toContain('parent_notifications');
  });

  it('should include live tracking module', () => {
    expect(AVAILABLE_MODULES).toContain('live_tracking');
  });

  it('should include maintenance module', () => {
    expect(AVAILABLE_MODULES).toContain('maintenance');
  });
});

// Policy-shape tests for the tenant-isolation helpers and enforcement
// patterns documented in CLAUDE.md. These mirror the helpers inline (same
// pattern as tests/role-access.test.ts) because the originals are declared
// inside registerRoutes and not exported. If the policy changes in
// routes.ts, update both places.

type TestUser = {
  role?: string;
  companyId?: string | null;
  _masterAdminImpersonating?: boolean;
};

function isMasterAdminUser(user: TestUser | null | undefined): boolean {
  if (!user) return false;
  return user.role === 'master_admin' || user._masterAdminImpersonating === true;
}

function companyScope(user: TestUser | null | undefined): string | null | undefined {
  if (isMasterAdminUser(user)) return undefined;
  if (!user) return null;
  return user.companyId ?? null;
}

describe('Multi-Tenant - isMasterAdminUser', () => {
  it('grants master access to master_admin role', () => {
    expect(isMasterAdminUser({ role: 'master_admin' })).toBe(true);
  });

  it('grants master access to impersonating session regardless of role', () => {
    expect(isMasterAdminUser({ role: 'admin', _masterAdminImpersonating: true })).toBe(true);
    expect(isMasterAdminUser({ role: 'driver', _masterAdminImpersonating: true })).toBe(true);
  });

  it('denies for tenant admin', () => {
    expect(isMasterAdminUser({ role: 'admin' })).toBe(false);
  });

  it('denies for driver, driver_admin, parent', () => {
    expect(isMasterAdminUser({ role: 'driver' })).toBe(false);
    expect(isMasterAdminUser({ role: 'driver_admin' })).toBe(false);
    expect(isMasterAdminUser({ role: 'parent' })).toBe(false);
  });

  it('denies for falsy user', () => {
    expect(isMasterAdminUser(null)).toBe(false);
    expect(isMasterAdminUser(undefined)).toBe(false);
  });

  it('does not treat _masterAdminImpersonating: false as master', () => {
    expect(isMasterAdminUser({ role: 'admin', _masterAdminImpersonating: false })).toBe(false);
  });
});

describe('Multi-Tenant - companyScope', () => {
  it('returns undefined for master_admin (no filter, sees all tenants)', () => {
    expect(companyScope({ role: 'master_admin' })).toBeUndefined();
  });

  it('returns undefined for impersonating session (still treated as master)', () => {
    // Important: impersonation rewrites user.companyId at the session layer
    // but the master flag survives, so storage queries remain unscoped.
    expect(companyScope({ role: 'admin', companyId: 'co-1', _masterAdminImpersonating: true })).toBeUndefined();
  });

  it('returns the user companyId for tenant admin', () => {
    expect(companyScope({ role: 'admin', companyId: 'co-42' })).toBe('co-42');
  });

  it('returns the user companyId for driver and parent', () => {
    expect(companyScope({ role: 'driver', companyId: 'co-42' })).toBe('co-42');
    expect(companyScope({ role: 'parent', companyId: 'co-42' })).toBe('co-42');
  });

  it('returns null when a non-master user has no companyId (caller must short-circuit [])', () => {
    expect(companyScope({ role: 'admin' })).toBeNull();
    expect(companyScope({ role: 'admin', companyId: null })).toBeNull();
  });
});

describe('Multi-Tenant - Record-by-id Guard', () => {
  // Mirrors the standard "fetch record, 404 if missing, 404 if cross-tenant"
  // shape from CLAUDE.md. Returns true if the request should proceed, false
  // if it should 404 (whether due to missing or cross-tenant).
  function canAccessRecord(
    user: TestUser,
    record: { companyId?: string | null } | null | undefined,
  ): boolean {
    if (!record) return false;
    if (isMasterAdminUser(user)) return true;
    return record.companyId === user.companyId;
  }

  it('master admin can access any tenant record', () => {
    expect(canAccessRecord({ role: 'master_admin' }, { companyId: 'co-1' })).toBe(true);
    expect(canAccessRecord({ role: 'master_admin' }, { companyId: 'co-2' })).toBe(true);
  });

  it('admin can access own tenant record', () => {
    expect(canAccessRecord({ role: 'admin', companyId: 'co-1' }, { companyId: 'co-1' })).toBe(true);
  });

  it('admin cannot access another tenant record (must 404, not 403)', () => {
    expect(canAccessRecord({ role: 'admin', companyId: 'co-1' }, { companyId: 'co-2' })).toBe(false);
  });

  it('driver cannot access another tenant record', () => {
    expect(canAccessRecord({ role: 'driver', companyId: 'co-1' }, { companyId: 'co-2' })).toBe(false);
  });

  it('missing record reports as not found regardless of role', () => {
    expect(canAccessRecord({ role: 'master_admin' }, null)).toBe(false);
    expect(canAccessRecord({ role: 'admin', companyId: 'co-1' }, undefined)).toBe(false);
  });

  it('record with null companyId is not accessible to a tenant admin', () => {
    // Defensive: a record with companyId=null shouldn't accidentally match
    // an admin whose companyId is also null/undefined and leak across tenants.
    expect(canAccessRecord({ role: 'admin', companyId: 'co-1' }, { companyId: null })).toBe(false);
  });
});

describe('Multi-Tenant - Create Tenant Stamping', () => {
  // POST handlers must force validatedData.companyId = user.companyId ?? null
  // AFTER zod parse so a malicious body cannot place a row in another tenant.
  function stampCompanyId<T extends { companyId?: string | null }>(
    user: TestUser,
    validatedBody: T,
  ): T {
    return { ...validatedBody, companyId: user.companyId ?? null };
  }

  it('overwrites a body-supplied companyId with the user companyId', () => {
    const body = { name: 'New Bus', companyId: 'co-attacker' };
    const result = stampCompanyId({ role: 'admin', companyId: 'co-victim' }, body);
    expect(result.companyId).toBe('co-victim');
  });

  it('falls back to null when the user has no companyId', () => {
    const body = { name: 'New Bus', companyId: 'co-attacker' };
    const result = stampCompanyId({ role: 'admin' }, body);
    expect(result.companyId).toBeNull();
  });

  it('preserves other fields untouched', () => {
    const body = { name: 'New Bus', busNumber: '7', companyId: 'co-attacker' };
    const result = stampCompanyId({ role: 'admin', companyId: 'co-1' }, body);
    expect(result).toEqual({ name: 'New Bus', busNumber: '7', companyId: 'co-1' });
  });

  it('master admin still gets stamped (their companyId is the impersonation target)', () => {
    // Without an active impersonation, master_admin.companyId is null and
    // the stamp lands null — POSTs from a non-impersonating master should
    // be a deliberate no-op rather than silently land in some tenant.
    const body = { name: 'New Bus', companyId: 'co-anywhere' };
    expect(stampCompanyId({ role: 'master_admin' }, body).companyId).toBeNull();
    expect(stampCompanyId({ role: 'master_admin', companyId: 'co-impersonated' }, body).companyId).toBe('co-impersonated');
  });
});
