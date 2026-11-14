// Q50: POST /api/check-in/enable and /disable find the student in the
// parent's direct (students.parentId) AND linked (parentChildLinks) lists,
// take the company and time zone from THAT student (not linkedStudents[0]),
// and answer a student outside both lists with 404 "Student not found"
// (checklist T-2). Real HTTP + real Postgres.
//
// getLinkedStudentsByParentId has no ORDER BY; on this small table it comes
// back in insert order (studentA before studentB). The "matched student"
// case therefore links parentA (whose first linked student is studentA, in
// company A) to company B's studentB, so the old linkedStudents[0] rule
// would wrongly stamp company A.
import { describe, it, expect, beforeAll } from 'vitest';
import { and, eq } from 'drizzle-orm';
import { students, parentChildLinks, studentCheckIns } from '@shared/schema';
import { useIntegrationHarness, type Agent } from './harness';
import { insertUser, SEED_PASSWORD } from './seed';

const h = useIntegrationHarness();
const DIRECT_EMAIL = 'q50-direct-parent@sbt.test';
const NOT_FOUND = { message: 'Student not found' };

let directParent: Agent;
let parentA: Agent;
let parentB: Agent;
let directParentId: string;
let directStudentId: string;

const checkInsFor = (studentId: string) => h.db.select().from(studentCheckIns).where(eq(studentCheckIns.studentId, studentId));

beforeAll(async () => {
  // A company-A parent who is students.parentId of a new student, with NO link row.
  directParentId = await insertUser(
    { email: DIRECT_EMAIL, firstName: 'A-DirectParent', lastName: 'Seed', role: 'parent', companyId: h.ids.companyA },
    { password: true },
  );
  const [s] = await h.db
    .insert(students)
    .values({ companyId: h.ids.companyA, firstName: 'A-DirectKid', lastName: 'Seed', parentId: directParentId, schoolId: h.ids.schoolA, routeId: h.ids.routeA })
    .returning({ id: students.id });
  directStudentId = s.id;

  // 3 logins (MAX_LOGINS_PER_FILE is 8).
  const agent = h.anon();
  expect((await h.loginAttempt(DIRECT_EMAIL, SEED_PASSWORD, agent)).status).toBe(200);
  directParent = agent;
  parentA = await h.loginAs('parentA');
  parentB = await h.loginAs('parentB');
});

describe('Q50 refusal', () => {
  it('company B\'s parent on company A\'s student (no link) → 404 "Student not found" and no row (T-2)', async () => {
    const res = await parentB.post('/api/check-in/enable').send({ studentId: h.ids.studentA, deviceId: 'q50-dev' });
    expect(res.status).toBe(404);
    expect(res.body).toEqual(NOT_FOUND);
    expect(await checkInsFor(h.ids.studentA)).toHaveLength(0);
    const dis = await parentB.post('/api/check-in/disable').send({ studentId: h.ids.studentA });
    expect(dis.status).toBe(404);
    expect(dis.body).toEqual(NOT_FOUND);
  });

  it('a missing student id → the same 404 body', async () => {
    const res = await parentA.post('/api/check-in/enable').send({ studentId: 'no-such-student', deviceId: 'q50-dev' });
    expect(res.status).toBe(404);
    expect(res.body).toEqual(NOT_FOUND);
  });
});

describe('Q50 direct-only parent', () => {
  it('a parent who is only students.parentId (no link row) enables → 200 and a waiting row, then disables → 200 and it is gone (red if the lookup goes back to linked-only)', async () => {
    const en = await directParent.post('/api/check-in/enable').send({ studentId: directStudentId, deviceId: 'q50-direct' });
    expect(en.status).toBe(200);
    const rows = await checkInsFor(directStudentId);
    expect(rows).toHaveLength(1);
    expect(rows[0].status).toBe('waiting');
    expect(rows[0].companyId).toBe(h.ids.companyA);
    const dis = await directParent.post('/api/check-in/disable').send({ studentId: directStudentId });
    expect(dis.status).toBe(200);
    expect(await checkInsFor(directStudentId)).toHaveLength(0);
  });
});

describe('Q50 company comes from the matched student', () => {
  beforeAll(async () => {
    await h.db.insert(parentChildLinks).values([
      { parentId: h.ids.parentA, studentId: h.ids.studentB },
      { parentId: h.ids.parentB, studentId: h.ids.studentA },
    ]);
  });

  it('parentA (first linked student is A\'s) enabling for company B\'s studentB → the row is company B (red if the company goes back to linkedStudents[0])', async () => {
    const res = await parentA.post('/api/check-in/enable').send({ studentId: h.ids.studentB, deviceId: 'q50-a-on-b' });
    expect(res.status).toBe(200);
    const rows = await h.db.select().from(studentCheckIns).where(and(eq(studentCheckIns.studentId, h.ids.studentB), eq(studentCheckIns.parentId, h.ids.parentA)));
    expect(rows).toHaveLength(1);
    expect(rows[0].companyId).toBe(h.ids.companyB);
  });

  it('parentB linked to company A\'s studentA enabling → the row is company A', async () => {
    const res = await parentB.post('/api/check-in/enable').send({ studentId: h.ids.studentA, deviceId: 'q50-b-on-a' });
    expect(res.status).toBe(200);
    const rows = await h.db.select().from(studentCheckIns).where(and(eq(studentCheckIns.studentId, h.ids.studentA), eq(studentCheckIns.parentId, h.ids.parentB)));
    expect(rows).toHaveLength(1);
    expect(rows[0].companyId).toBe(h.ids.companyA);
  });
});
