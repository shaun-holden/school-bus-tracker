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

// The staff cap itself (canCreateUser) is tested over HTTP in tests/integration/wt2-plan-caps.test.ts.
