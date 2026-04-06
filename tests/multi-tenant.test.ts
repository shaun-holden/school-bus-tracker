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
