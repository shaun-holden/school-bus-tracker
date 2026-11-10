import { describe, it, expect } from 'vitest';
// Imports ONLY the pure decision module. Importing server/index.ts or
// server/customAuth.ts would boot the server and need DATABASE_URL.
import {
  sessionDecision,
  isCompanyGateAllowed,
  isCrossSiteWriteBlocked,
} from '../server/authGate';

// Each test names the condition in server/authGate.ts whose deletion turns it red.

describe('sessionDecision (SEC-19: archived users, suspended/rejected companies)', () => {
  const approved = { status: 'approved', isActive: true };

  it('rejects an archived user [user.isActive === false]', () => {
    expect(sessionDecision({ role: 'driver', isActive: false }, approved)).toBe('reject');
  });

  it('treats isActive null as active [=== false, not falsy]', () => {
    expect(sessionDecision({ role: 'driver', isActive: null }, approved)).toBe('allow');
  });

  it('rejects a suspended company [status === suspended]', () => {
    expect(sessionDecision({ role: 'admin', isActive: true }, { status: 'suspended', isActive: false })).toBe('reject');
  });

  it('rejects a rejected company [status === rejected]', () => {
    expect(sessionDecision({ role: 'admin', isActive: true }, { status: 'rejected', isActive: true })).toBe('reject');
  });

  it('allows a pending company, even when isActive is false [no pending_approval / company.isActive rejection]', () => {
    expect(sessionDecision({ role: 'admin', isActive: true }, { status: 'pending_approval', isActive: false })).toBe('allow');
  });

  it('allows a missing company row (the company gate blocks it) [company null-guard]', () => {
    expect(sessionDecision({ role: 'admin', isActive: true }, null)).toBe('allow');
  });

  it('allows master_admin even if archived or suspended [master_admin exemption]', () => {
    expect(sessionDecision({ role: 'master_admin', isActive: false }, { status: 'suspended' })).toBe('allow');
  });
});

describe('isCompanyGateAllowed (SEC-7: unapproved companies)', () => {
  const pendingAdmin = {
    role: 'admin',
    companyId: 'co-1',
    companyStatus: 'pending_approval',
    companyIsActive: false,
  };

  it('blocks a pending admin on /api/drivers [approved+active requirement]', () => {
    expect(isCompanyGateAllowed('/api/drivers', pendingAdmin)).toBe(false);
  });

  it('blocks a pending admin on /API/drivers [case-insensitive /api match]', () => {
    expect(isCompanyGateAllowed('/API/drivers', pendingAdmin)).toBe(false);
  });

  it('allows a pending admin on /api/AUTH/login [/api/auth/ prefix, lowercased]', () => {
    expect(isCompanyGateAllowed('/api/AUTH/login', pendingAdmin)).toBe(true);
  });

  it('blocks /api/authx [prefix keeps its trailing slash]', () => {
    expect(isCompanyGateAllowed('/api/authx', pendingAdmin)).toBe(false);
  });

  it('allows each onboarding/billing path for a pending admin [exact allow-list]', () => {
    for (const p of [
      '/api/business/status',
      '/api/business/create-checkout-session',
      '/api/subscription-plans',
      '/api/stripe/publishable-key',
      '/API/Business/Status',
    ]) {
      expect(isCompanyGateAllowed(p, pendingAdmin)).toBe(true);
    }
  });

  it('blocks a near-miss of an exact allow-list path [exact, not prefix]', () => {
    expect(isCompanyGateAllowed('/api/business/status-history', pendingAdmin)).toBe(false);
  });

  it('allows an approved, active company [approved+active pass]', () => {
    expect(isCompanyGateAllowed('/api/drivers', {
      role: 'admin', companyId: 'co-1', companyStatus: 'approved', companyIsActive: true,
    })).toBe(true);
  });

  it('blocks an approved company with isActive false [companyIsActive !== false]', () => {
    expect(isCompanyGateAllowed('/api/drivers', {
      role: 'admin', companyId: 'co-1', companyStatus: 'approved', companyIsActive: false,
    })).toBe(false);
  });

  it('blocks a missing company row (companyId set, no status) [approved requirement]', () => {
    expect(isCompanyGateAllowed('/api/drivers', {
      role: 'admin', companyId: 'co-gone', companyStatus: null, companyIsActive: null,
    })).toBe(false);
  });

  it('allows a user with no company, e.g. a parent before linking [companyId check]', () => {
    expect(isCompanyGateAllowed('/api/link-child', {
      role: 'parent', companyId: null, companyStatus: null, companyIsActive: null,
    })).toBe(true);
  });

  it('allows master_admin with a pending company [master_admin exemption]', () => {
    expect(isCompanyGateAllowed('/api/drivers', {
      role: 'master_admin', companyId: 'co-1', companyStatus: 'pending_approval', companyIsActive: false,
    })).toBe(true);
  });

  it('allows anonymous requests (the route decides) [no-user check]', () => {
    expect(isCompanyGateAllowed('/api/drivers', undefined)).toBe(true);
  });

  it('ignores non-/api paths [/api scope]', () => {
    expect(isCompanyGateAllowed('/admin', pendingAdmin)).toBe(true);
  });
});

describe('isCrossSiteWriteBlocked (SEC-18: cross-site writes)', () => {
  const allowed = ['capacitor://localhost', 'https://www.schoolbustracker.org'];
  const self = 'https://www.schoolbustracker.org';

  it('blocks a POST from a foreign Origin [allow-list / same-host check]', () => {
    expect(isCrossSiteWriteBlocked('POST', '/api/employees/invite', 'https://evil.example', self, allowed)).toBe(true);
  });

  it('blocks Origin: null [present-but-unparseable Origin is blocked]', () => {
    expect(isCrossSiteWriteBlocked('POST', '/api/messages', 'null', self, allowed)).toBe(true);
  });

  it('blocks on /API paths too [case-insensitive /api match]', () => {
    expect(isCrossSiteWriteBlocked('POST', '/API/messages', 'https://evil.example', self, allowed)).toBe(true);
  });

  it('allows an allowed origin [ALLOWED_ORIGINS check]', () => {
    expect(isCrossSiteWriteBlocked('POST', '/api/messages', 'capacitor://localhost', self, allowed)).toBe(false);
  });

  it('allows same-origin http://localhost:5001 [own-host check]', () => {
    expect(isCrossSiteWriteBlocked('POST', '/api/messages', 'http://localhost:5001', 'http://localhost:5001', allowed)).toBe(false);
  });

  it('blocks a different port on the same hostname [host includes port]', () => {
    expect(isCrossSiteWriteBlocked('POST', '/api/messages', 'http://localhost:6666', 'http://localhost:5001', allowed)).toBe(true);
  });

  it('allows a write with no Origin header [missing-Origin pass]', () => {
    expect(isCrossSiteWriteBlocked('POST', '/api/messages', undefined, self, allowed)).toBe(false);
  });

  it('allows GET from a foreign Origin [safe-method pass]', () => {
    expect(isCrossSiteWriteBlocked('GET', '/api/buses', 'https://evil.example', self, allowed)).toBe(false);
  });

  it('blocks PATCH and DELETE from a foreign Origin [only GET/HEAD/OPTIONS are safe]', () => {
    expect(isCrossSiteWriteBlocked('PATCH', '/api/users/1/role', 'https://evil.example', self, allowed)).toBe(true);
    expect(isCrossSiteWriteBlocked('delete', '/api/x', 'https://evil.example', self, allowed)).toBe(true);
  });

  it('ignores non-/api paths [/api scope]', () => {
    expect(isCrossSiteWriteBlocked('POST', '/somewhere', 'https://evil.example', self, allowed)).toBe(false);
  });
});
