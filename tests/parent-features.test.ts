import { describe, it, expect } from 'vitest';
import { insertParentNotificationSchema } from '@shared/schema';
import { canAccessMessaging } from '../server/tenant';

// Only tests of real code stay here (WT-4, Q49). Absence and check-in access
// are tested over HTTP in tests/integration/td2-absence-linked-parent.test.ts
// and tests/integration/wt4-checkin-linked-parent.test.ts.

describe('Parent Features - Notification Schema', () => {
  it('should accept valid delay notification', () => {
    const result = insertParentNotificationSchema.safeParse({
      companyId: 'company-1',
      routeId: 'route-1',
      type: 'delay',
      title: 'Bus Running Late',
      message: 'Bus 42 is running 15 minutes late',
      estimatedDelay: 15,
      createdById: 'admin-1',
    });
    expect(result.success).toBe(true);
  });

  it('should accept valid emergency notification', () => {
    const result = insertParentNotificationSchema.safeParse({
      companyId: 'company-1',
      type: 'emergency',
      title: 'Emergency Alert',
      message: 'All buses returning to depot due to weather',
      createdById: 'admin-1',
    });
    expect(result.success).toBe(true);
  });

  it('should accept info notification', () => {
    const result = insertParentNotificationSchema.safeParse({
      companyId: 'company-1',
      type: 'info',
      title: 'Schedule Change',
      message: 'Early dismissal on Friday',
      createdById: 'admin-1',
    });
    expect(result.success).toBe(true);
  });

  it('should accept route_change notification', () => {
    const result = insertParentNotificationSchema.safeParse({
      companyId: 'company-1',
      routeId: 'route-1',
      type: 'route_change',
      title: 'Route Modified',
      message: 'Stop at Oak St has been removed',
      createdById: 'admin-1',
    });
    expect(result.success).toBe(true);
  });
});

// The real helper (server/tenant.ts), not an inline copy.
describe('Parent Features - Messaging Access Control', () => {

  it('should allow parents to access messaging', () => {
    expect(canAccessMessaging('parent')).toBe(true);
  });

  it('should allow drivers to access messaging', () => {
    expect(canAccessMessaging('driver')).toBe(true);
  });

  it('should deny admins from messaging', () => {
    expect(canAccessMessaging('admin')).toBe(false);
  });

  it('should deny master_admin from messaging (role string)', () => {
    expect(canAccessMessaging('master_admin')).toBe(false);
  });

  it('should deny a non-impersonating master_admin user object', () => {
    expect(canAccessMessaging({ role: 'master_admin', companyId: null })).toBe(false);
  });

  it('should allow a master_admin who is impersonating a school', () => {
    expect(canAccessMessaging({ role: 'master_admin', companyId: 'company-1', _masterAdminImpersonating: true })).toBe(true);
  });

  it('should deny unknown roles from messaging', () => {
    expect(canAccessMessaging('unknown')).toBe(false);
  });
});
