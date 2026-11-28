// Q196: the admin Add Student form no longer sends a Parent ID, so
// POST /api/students always stores the caller's own id as students.parentId
// (`insertStudentSchema.parse({ ...req.body, parentId: userId })`). A body
// parentId is ignored. The parent 403 and the admin gate are unchanged.
// Real HTTP + real Postgres. Each title names the clause whose change turns
// it red, and each test asserts its seed first (X-1/X-2).
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { eq, inArray } from 'drizzle-orm';
import { students, users } from '@shared/schema';
import { useIntegrationHarness, type Agent } from './harness';

const h = useIntegrationHarness();

let adminA: Agent;
let parentA: Agent;
let master: Agent;
const created: string[] = [];

const studentRow = async (id: string) => (await h.db.select().from(students).where(eq(students.id, id)))[0];
const userRow = async (id: string) => (await h.db.select().from(users).where(eq(users.id, id)))[0];

beforeAll(async () => {
  // 3 logins (MAX_LOGINS_PER_FILE is 8).
  adminA = await h.loginAs('adminA');
  parentA = await h.loginAs('parentA');
  master = await h.loginAs('master');
});

afterAll(async () => {
  if (created.length) await h.db.delete(students).where(inArray(students.id, created));
});

describe('Q196 POST /api/students: parentId is always the caller', () => {
  it('seed: adminA is an admin of company A; parentA is a different user, a parent of company A', async () => {
    expect(await userRow(h.ids.adminA)).toMatchObject({ role: 'admin', companyId: h.ids.companyA });
    expect(await userRow(h.ids.parentA)).toMatchObject({ role: 'parent', companyId: h.ids.companyA });
    expect(h.ids.parentA).not.toBe(h.ids.adminA);
  });

  it('an admin POST with no parentId → 201 and the stored parentId is the admin (red if the parse no longer fills parentId: 400)', async () => {
    const res = await adminA.post('/api/students').send({ firstName: 'Q196-NoParent', lastName: 'Seed', schoolId: h.ids.schoolA });
    expect(res.status).toBe(201);
    created.push(res.body.id);
    expect(await studentRow(res.body.id)).toMatchObject({
      companyId: h.ids.companyA, firstName: 'Q196-NoParent', parentId: h.ids.adminA,
    });
  });

  it('an admin POST with parentId: parentA → 201 and the stored parentId is the admin (red if the body parentId is used)', async () => {
    const res = await adminA.post('/api/students').send({
      firstName: 'Q196-BodyParent', lastName: 'Seed', schoolId: h.ids.schoolA, parentId: h.ids.parentA,
    });
    expect(res.status).toBe(201);
    created.push(res.body.id);
    const row = await studentRow(res.body.id);
    expect(row).toMatchObject({ companyId: h.ids.companyA, firstName: 'Q196-BodyParent', parentId: h.ids.adminA });
    expect(row.parentId).not.toBe(h.ids.parentA);
  });

  it("an impersonating master POST with no parentId → 201 in the impersonated school, parentId = the master's own id (red if userId is swapped for a getCaller field)", async () => {
    expect(await userRow(h.ids.master)).toMatchObject({ role: 'master_admin', companyId: null });
    const imp = await master.post(`/api/master-admin/impersonate/${h.ids.companyA}`).send({});
    expect(imp.status).toBe(200);
    try {
      const me = await master.get('/api/auth/user');
      expect(me.body).toMatchObject({ role: 'master_admin', companyId: h.ids.companyA, _masterAdminImpersonating: true });
      const res = await master.post('/api/students').send({ firstName: 'Q196-ImpAdd', lastName: 'Seed', schoolId: h.ids.schoolA });
      expect(res.status).toBe(201);
      created.push(res.body.id);
      expect(await studentRow(res.body.id)).toMatchObject({
        companyId: h.ids.companyA, firstName: 'Q196-ImpAdd', parentId: h.ids.master,
      });
    } finally {
      expect((await master.post('/api/master-admin/stop-impersonating').send({})).status).toBe(200);
    }
  });

  it("a parent POST still → 403 and no row (red if the parent 403 is dropped)", async () => {
    const res = await parentA.post('/api/students').send({ firstName: 'Q196-ParentAdd', lastName: 'Seed' });
    expect(res.status).toBe(403);
    expect(res.body).toEqual({ message: "Parents can't add students" });
    expect(await h.db.select().from(students).where(eq(students.firstName, 'Q196-ParentAdd'))).toHaveLength(0);
  });
});
