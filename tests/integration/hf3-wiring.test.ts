// HF3 wiring: the guards are pure functions in server/authGate.ts (unit-tested
// in tests/auth-gate.test.ts); these tests prove they are actually registered
// in the middleware chain that createApp() builds. Each title names the
// registration whose removal turns it red.
import { describe, it, expect, beforeAll } from 'vitest';
import { eq } from 'drizzle-orm';
import { companies } from '@shared/schema';
import { EMAILS } from './seed';
import { useIntegrationHarness, type Agent } from './harness';

const h = useIntegrationHarness();
const DEACTIVATED = 'This account has been deactivated. Contact your administrator.';

describe('H1 Origin guard (server/app.ts app.use with isCrossSiteWriteBlocked)', () => {
  it('H1 anonymous POST /api/auth/logout with Origin https://evil.example is 403 Cross-site request blocked (red if the isCrossSiteWriteBlocked app.use is removed from createApp)', async () => {
    const res = await h.anon().post('/api/auth/logout').set('Origin', 'https://evil.example').send({});
    expect(res.status).toBe(403);
    expect(res.body).toEqual({ message: 'Cross-site request blocked' });
  });

  it('H1 control: the same POST /api/auth/logout with Origin capacitor://localhost is not blocked', async () => {
    const res = await h.anon().post('/api/auth/logout').set('Origin', 'capacitor://localhost').send({});
    expect(res.status).not.toBe(403);
    expect(res.status).toBe(200);
  });
});

describe('H2 company gate (customAuth.ts app.use with isCompanyGateAllowed)', () => {
  let adminC: Agent;
  beforeAll(async () => {
    // pending_approval is allowed a session (sessionDecision) so it can onboard.
    adminC = await h.loginAs('adminC');
  });

  it('H2 pending company admin gets 403 COMPANY_NOT_ACTIVE on GET /api/schools (red if the isCompanyGateAllowed app.use is removed from setupCustomAuth)', async () => {
    const res = await adminC.get('/api/schools');
    expect(res.status).toBe(403);
    expect(res.body).toMatchObject({ code: 'COMPANY_NOT_ACTIVE' });
  });

  it('H2 control: the allow-listed GET /api/business/status is not blocked for the pending admin', async () => {
    const res = await adminC.get('/api/business/status');
    expect(res.status).not.toBe(403);
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ status: 'pending_approval' });
  });
});

describe('H3 sessionDecision at login (LocalStrategy `if (sessionDecision(user, company) === \'reject\')`)', () => {
  it("H3 admin of a suspended company gets 401 at POST /api/auth/login (red if the LocalStrategy `sessionDecision(user, company) === 'reject'` check is removed)", async () => {
    const res = await h.loginAttempt(EMAILS.adminD);
    expect(res.status).toBe(401);
    expect(res.body).toEqual({ message: DEACTIVATED });
  });

  it("H3 an archived driver (isActive false) gets 401 at POST /api/auth/login (red if the LocalStrategy `sessionDecision(user, company) === 'reject'` check is removed)", async () => {
    const res = await h.loginAttempt(EMAILS.driverA_archived);
    expect(res.status).toBe(401);
    expect(res.body).toEqual({ message: DEACTIVATED });
  });
});

describe('H4 sessionDecision on every request (deserializeUser)', () => {
  it("H4 adminA2's live session ends with 401 once companyA2 is suspended (red if the deserializeUser `sessionDecision(user, company) === 'reject'` check is removed)", async () => {
    const adminA2 = await h.loginAs('adminA2');
    const before = await adminA2.get('/api/auth/user');
    expect(before.status).toBe(200);

    await h.db.update(companies).set({ status: 'suspended' }).where(eq(companies.id, h.ids.companyA2));

    const after = await adminA2.get('/api/auth/user');
    expect(after.status).toBe(401);
  });
});
