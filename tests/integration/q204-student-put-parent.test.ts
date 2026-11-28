// Q204: an admin can't change a student's parentId through the API. PUT
// /api/students/:id strips a body parentId (200, the stored one is kept),
// the same as POST, which sets the caller, and before the foreign-key check
// (a foreign parentId never reaches it). POST also never trusts a body
// companyId (it lands in the caller's company, or the impersonated one).
// Real HTTP + real Postgres. Each title names the clause whose removal turns
// it red; seeds are asserted first (X-1/X-2).
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { eq, inArray } from 'drizzle-orm';
import { companies, students, users } from '@shared/schema';
import { useIntegrationHarness, type Agent } from './harness';
import { insertUser } from './seed';

const h = useIntegrationHarness();

let adminA: Agent;
let master: Agent;
let otherParentId: string;
let origStudentA: typeof students.$inferSelect;
const created: string[] = [];

const studentRow = async (id: string) => (await h.db.select().from(students).where(eq(students.id, id)))[0];

beforeAll(async () => {
  otherParentId = await insertUser(
    { email: 'q204-other-parent-a@sbt.test', firstName: 'Q204-Other', lastName: 'Seed', role: 'parent', companyId: h.ids.companyA },
    { password: false },
  );
  origStudentA = await studentRow(h.ids.studentA);
  // 2 logins (MAX_LOGINS_PER_FILE is 8).
  adminA = await h.loginAs('adminA');
  master = await h.loginAs('master');
});

afterAll(async () => {
  await h.db.update(students).set({ grade: origStudentA.grade, parentId: origStudentA.parentId }).where(eq(students.id, h.ids.studentA));
  if (created.length) await h.db.delete(students).where(inArray(students.id, created));
  // Q206: the file's own users only.
  await h.db.delete(users).where(eq(users.id, otherParentId));
});

describe('Q204 PUT /api/students/:id ignores a body parentId', () => {
  it('adminA PUT studentA with { grade, parentId: another company-A parent } → 200, grade saved, parentId unchanged (red if the PUT accepts parentId again)', async () => {
    expect(origStudentA).toMatchObject({ companyId: h.ids.companyA });
    expect(origStudentA.parentId).not.toBe(otherParentId);
    const [other] = await h.db.select().from(users).where(eq(users.id, otherParentId));
    expect(other).toMatchObject({ role: 'parent', companyId: h.ids.companyA });

    const res = await adminA.put(`/api/students/${h.ids.studentA}`).send({ grade: '7', parentId: otherParentId });
    expect(res.status).toBe(200);
    const after = await studentRow(h.ids.studentA);
    expect(after.grade).toBe('7');
    expect(after.parentId).toBe(origStudentA.parentId);
  });

  it('adminA PUT studentA with { grade, parentId: company B\'s parentB } → 200, grade saved, parentId unchanged (red if parentId is stripped only after checkStudentForeignKeys, which answers 404 "Parent not found")', async () => {
    const [stored] = await h.db.select().from(students).where(eq(students.id, h.ids.studentA));
    expect(stored.parentId).toBe(origStudentA.parentId);
    const [pB] = await h.db.select().from(users).where(eq(users.id, h.ids.parentB));
    expect(pB).toMatchObject({ role: 'parent', companyId: h.ids.companyB });

    const res = await adminA.put(`/api/students/${h.ids.studentA}`).send({ grade: '8', parentId: h.ids.parentB });
    expect(res.status).toBe(200);
    const after = await studentRow(h.ids.studentA);
    expect(after.grade).toBe('8');
    expect(after.parentId).toBe(stored.parentId);
  });
});

describe('Q204 POST /api/students never trusts a body companyId', () => {
  // Q206: no schoolId (or other FK id), so a dropped force would reach the
  // insert with company B and fail on the stored company, not on a 404.
  it('company B exists (seed)', async () => {
    const [b] = await h.db.select().from(companies).where(eq(companies.id, h.ids.companyB));
    expect(b).toBeDefined();
  });

  it('adminA POST with a body companyId of company B (no FK ids) → 201, stored in company A (red if the POST company force is dropped)', async () => {
    const res = await adminA.post('/api/students').send({
      firstName: 'Q204-ForeignCo', lastName: 'Seed', parentId: h.ids.adminA, companyId: h.ids.companyB,
    });
    expect(res.status).toBe(201);
    created.push(res.body.id);
    expect(await studentRow(res.body.id)).toMatchObject({ companyId: h.ids.companyA, firstName: 'Q204-ForeignCo' });
  });

  it('a master impersonating company A POSTs with a body companyId of company B (no FK ids) → 201, stored in company A (red if the POST company force is dropped)', async () => {
    const imp = await master.post(`/api/master-admin/impersonate/${h.ids.companyA}`).send({});
    expect(imp.status).toBe(200);
    try {
      const me = await master.get('/api/auth/user');
      expect(me.body).toMatchObject({ role: 'master_admin', companyId: h.ids.companyA, _masterAdminImpersonating: true });
      const res = await master.post('/api/students').send({
        firstName: 'Q204-ImpForeignCo', lastName: 'Seed', parentId: h.ids.master, companyId: h.ids.companyB,
      });
      expect(res.status).toBe(201);
      created.push(res.body.id);
      expect(await studentRow(res.body.id)).toMatchObject({ companyId: h.ids.companyA, firstName: 'Q204-ImpForeignCo' });
    } finally {
      expect((await master.post('/api/master-admin/stop-impersonating').send({})).status).toBe(200);
    }
  });
});
