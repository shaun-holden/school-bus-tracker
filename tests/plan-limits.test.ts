import { describe, it, expect } from 'vitest';
import { PLAN_CONFIGS } from '@shared/schema';
import type { PlanType } from '@shared/schema';

describe('Plan Configuration - Starter Plan', () => {
  const plan = PLAN_CONFIGS.starter;

  it('should allow 3 staff users', () => {
    expect(plan.staffUserLimit).toBe(3);
  });

  it('should not allow parent users', () => {
    expect(plan.parentUserLimit).toBe(0);
  });

  it('should not enable parent portal', () => {
    expect(plan.parentPortalEnabled).toBe(false);
  });

  it('should not enable GPS tracking', () => {
    expect(plan.gpsEnabled).toBe(false);
  });
});

describe('Plan Configuration - Professional Plan', () => {
  const plan = PLAN_CONFIGS.professional;

  it('should allow 5 staff users', () => {
    expect(plan.staffUserLimit).toBe(5);
  });

  it('should allow unlimited parent users', () => {
    expect(plan.parentUserLimit).toBeNull();
  });

  it('should enable parent portal', () => {
    expect(plan.parentPortalEnabled).toBe(true);
  });

  it('should enable GPS tracking', () => {
    expect(plan.gpsEnabled).toBe(true);
  });
});

describe('Plan Configuration - Enterprise Plan', () => {
  const plan = PLAN_CONFIGS.enterprise;

  it('should allow unlimited staff users', () => {
    expect(plan.staffUserLimit).toBeNull();
  });

  it('should allow unlimited parent users', () => {
    expect(plan.parentUserLimit).toBeNull();
  });

  it('should enable parent portal', () => {
    expect(plan.parentPortalEnabled).toBe(true);
  });

  it('should enable GPS tracking', () => {
    expect(plan.gpsEnabled).toBe(true);
  });
});

describe('Plan Configuration - Plan Hierarchy', () => {
  it('professional should have higher staff limit than starter', () => {
    expect(PLAN_CONFIGS.professional.staffUserLimit).toBeGreaterThan(
      PLAN_CONFIGS.starter.staffUserLimit!
    );
  });

  it('starter should be the most restrictive plan', () => {
    expect(PLAN_CONFIGS.starter.parentPortalEnabled).toBe(false);
    expect(PLAN_CONFIGS.starter.gpsEnabled).toBe(false);
    expect(PLAN_CONFIGS.starter.parentUserLimit).toBe(0);
  });

  it('enterprise should be the least restrictive plan', () => {
    expect(PLAN_CONFIGS.enterprise.staffUserLimit).toBeNull();
    expect(PLAN_CONFIGS.enterprise.parentUserLimit).toBeNull();
    expect(PLAN_CONFIGS.enterprise.parentPortalEnabled).toBe(true);
    expect(PLAN_CONFIGS.enterprise.gpsEnabled).toBe(true);
  });

  it('all plan types should exist', () => {
    const planTypes: PlanType[] = ['starter', 'professional', 'enterprise'];
    planTypes.forEach(type => {
      expect(PLAN_CONFIGS[type]).toBeDefined();
    });
  });
});

describe('Plan Limit Enforcement Logic', () => {
  // Replicates the canCreateUser logic
  function canCreateUser(
    planType: PlanType,
    currentStaffCount: number,
    currentParentCount: number,
    requestedRole: string
  ): { allowed: boolean; reason?: string } {
    const config = PLAN_CONFIGS[planType];
    const isStaffRole = requestedRole !== 'parent';

    if (isStaffRole) {
      if (config.staffUserLimit !== null && currentStaffCount >= config.staffUserLimit) {
        return { allowed: false, reason: `Staff user limit (${config.staffUserLimit}) reached for ${planType} plan` };
      }
    } else {
      if (config.parentUserLimit === 0) {
        return { allowed: false, reason: 'Parent accounts are not available on the starter plan' };
      }
      if (config.parentUserLimit !== null && currentParentCount >= config.parentUserLimit) {
        return { allowed: false, reason: `Parent user limit reached for ${planType} plan` };
      }
    }

    return { allowed: true };
  }

  it('should allow creating staff on starter when under limit', () => {
    const result = canCreateUser('starter', 2, 0, 'driver');
    expect(result.allowed).toBe(true);
  });

  it('should reject staff on starter when at limit', () => {
    const result = canCreateUser('starter', 3, 0, 'driver');
    expect(result.allowed).toBe(false);
  });

  it('should reject parents on starter plan', () => {
    const result = canCreateUser('starter', 0, 0, 'parent');
    expect(result.allowed).toBe(false);
  });

  it('should allow parents on professional plan', () => {
    const result = canCreateUser('professional', 0, 50, 'parent');
    expect(result.allowed).toBe(true);
  });

  it('should allow unlimited staff on enterprise plan', () => {
    const result = canCreateUser('enterprise', 100, 0, 'admin');
    expect(result.allowed).toBe(true);
  });

  it('should allow unlimited parents on enterprise plan', () => {
    const result = canCreateUser('enterprise', 0, 500, 'parent');
    expect(result.allowed).toBe(true);
  });

  it('should reject staff on professional when at limit', () => {
    const result = canCreateUser('professional', 5, 0, 'driver');
    expect(result.allowed).toBe(false);
  });

  it('should allow first staff on starter plan', () => {
    const result = canCreateUser('starter', 0, 0, 'admin');
    expect(result.allowed).toBe(true);
  });
});
