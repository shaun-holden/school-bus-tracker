// companyScope(user) through a real list read: GET /api/schools.
import { describe, it, expect, beforeAll } from 'vitest';
import { useIntegrationHarness, type Agent } from './harness';

const h = useIntegrationHarness();
let adminA: Agent;
let adminNull: Agent;
let master: Agent;

beforeAll(async () => {
  adminA = await h.loginAs('adminA');
  adminNull = await h.loginAs('adminNull');
  master = await h.loginAs('master');
});

const ids = (rows: Array<{ id: string }>) => rows.map((r) => r.id).sort();

describe('S1 companyScope via GET /api/schools', () => {
  it('S1 adminA sees only schoolA (red if GET /api/schools stops passing `storage.getAllSchools(scope)`, or getAllSchools drops `eq(schools.companyId, companyId)`)', async () => {
    const res = await adminA.get('/api/schools');
    expect(res.status).toBe(200);
    expect(ids(res.body)).toEqual([h.ids.schoolA]);
  });

  it('S1 admin with no company gets [] (red if `if (scope === null) return res.json([])` is removed from GET /api/schools)', async () => {
    const res = await adminNull.get('/api/schools');
    expect(res.status).toBe(200);
    expect(res.body).toEqual([]);
  });

  it('S1 master_admin sees both schools (positive control: B is reachable; red if companyScope stops returning undefined for master)', async () => {
    const res = await master.get('/api/schools');
    expect(res.status).toBe(200);
    expect(ids(res.body)).toEqual([h.ids.schoolA, h.ids.schoolB].sort());
  });
});

describe('SEC-45 / DUP-2 impersonation', () => {
  let impersonator: Agent;

  beforeAll(async () => {
    impersonator = await h.loginAs('master');
    const imp = await impersonator.post(`/api/master-admin/impersonate/${h.ids.companyA}`).send({});
    expect(imp.status).toBe(200);
    const me = await impersonator.get('/api/auth/user');
    expect(me.body).toMatchObject({ role: 'master_admin', companyId: h.ids.companyA, _masterAdminImpersonating: true });
  });

  it('SEC-45/DUP-2: master impersonating A sees only A schools (red if companyScope bypasses on isMasterAdminUser instead of isUnscopedMaster, or if GET /api/schools re-fetches with storage.getUser instead of getCaller(req))', async () => {
    const res = await impersonator.get('/api/schools');
    expect(res.status).toBe(200);
    expect(ids(res.body)).toEqual([h.ids.schoolA]);
  });
});
