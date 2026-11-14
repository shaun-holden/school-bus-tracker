import { describe, it, expect } from 'vitest';
// The real role-check helpers (moved out of routes.ts into server/tenant.ts).
import { isAdminRole, isDriverRole } from '../server/tenant';

describe('Role-Based Access Control - Admin Role Check', () => {
  it('should grant admin access to admin role', () => {
    expect(isAdminRole('admin')).toBe(true);
  });

  it('should grant admin access to master_admin role', () => {
    expect(isAdminRole('master_admin')).toBe(true);
  });

  it('should grant admin access to driver_admin role', () => {
    expect(isAdminRole('driver_admin')).toBe(true);
  });

  it('should deny admin access to driver role', () => {
    expect(isAdminRole('driver')).toBe(false);
  });

  it('should deny admin access to parent role', () => {
    expect(isAdminRole('parent')).toBe(false);
  });

  it('should deny admin access to undefined role', () => {
    expect(isAdminRole(undefined)).toBe(false);
  });

  it('should deny admin access to null role', () => {
    expect(isAdminRole(null)).toBe(false);
  });

  it('should deny admin access to empty string', () => {
    expect(isAdminRole('')).toBe(false);
  });

  it('should deny admin access to random string', () => {
    expect(isAdminRole('superuser')).toBe(false);
  });

  it('should be case-sensitive (Admin !== admin)', () => {
    expect(isAdminRole('Admin')).toBe(false);
    expect(isAdminRole('ADMIN')).toBe(false);
  });
});

describe('Role-Based Access Control - Driver Role Check', () => {
  it('should grant driver access to driver role', () => {
    expect(isDriverRole('driver')).toBe(true);
  });

  it('should grant driver access to driver_admin role', () => {
    expect(isDriverRole('driver_admin')).toBe(true);
  });

  it('should deny driver access to admin role', () => {
    expect(isDriverRole('admin')).toBe(false);
  });

  it('should deny driver access to parent role', () => {
    expect(isDriverRole('parent')).toBe(false);
  });

  it('should grant driver access to master_admin role', () => {
    expect(isDriverRole('master_admin')).toBe(true);
  });

  it('should deny driver access to undefined role', () => {
    expect(isDriverRole(undefined)).toBe(false);
  });

  it('should deny driver access to null role', () => {
    expect(isDriverRole(null)).toBe(false);
  });
});

describe('Role-Based Access Control - Role Hierarchy', () => {
  it('driver_admin should have both admin and driver access', () => {
    expect(isAdminRole('driver_admin')).toBe(true);
    expect(isDriverRole('driver_admin')).toBe(true);
  });

  it('admin should have admin access but not driver access', () => {
    expect(isAdminRole('admin')).toBe(true);
    expect(isDriverRole('admin')).toBe(false);
  });

  it('driver should have driver access but not admin access', () => {
    expect(isDriverRole('driver')).toBe(true);
    expect(isAdminRole('driver')).toBe(false);
  });

  it('parent should have neither admin nor driver access', () => {
    expect(isAdminRole('parent')).toBe(false);
    expect(isDriverRole('parent')).toBe(false);
  });

  it('master_admin should have both admin and driver access', () => {
    expect(isAdminRole('master_admin')).toBe(true);
    expect(isDriverRole('master_admin')).toBe(true);
  });
});

// Registration roles are tested over HTTP in tests/integration/wt1-register.test.ts.
