// Q50: POST /api/check-in/enable and /disable find the student in the
// parent's linked (parentChildLinks) list only (Q192: students.parentId
// grants nothing), take the company and time zone from THAT student (not
// linkedStudents[0]), and answer a student outside the list with 404
// "Student not found" (checklist T-2). Real HTTP + real Postgres.
//
// getLinkedStudentsByParentId has no ORDER BY, so the "matched student" case
// is order-free: parentNull (NULL company) is linked to company A's studentA
// and company B's studentB and enables for BOTH. Whatever order the read
// returns, a linkedStudents[0] rule stamps the wrong company on one of them.
import { describe, it, expect, beforeAll } from 'vitest';
import { and, eq } from 'drizzle-orm';
import { students, parentChildLinks, studentCheckIns } from '@shared/schema';
import { useIntegrationHarness, type Agent } from './harness';
import { storage } from '../../server/storage';
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
    const res = await parentB.post('/api/check-in/enable').send({ studentId: h.ids.studentA, deviceId: 'q50-refusal-dev' });
    expect(res.status).toBe(404);
    expect(res.body).toEqual(NOT_FOUND);
    // Q198: only parentB's rows, so this holds in any test order.
    const rows = await h.db.select().from(studentCheckIns).where(and(eq(studentCheckIns.studentId, h.ids.studentA), eq(studentCheckIns.parentId, h.ids.parentB)));
    expect(rows).toHaveLength(0);
    // Q201: and no row anywhere carries this request's device (a wrongly
    // allowed update of another parent's row would).
    expect(await h.db.select().from(studentCheckIns).where(eq(studentCheckIns.deviceId, 'q50-refusal-dev'))).toHaveLength(0);
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
  it('a parent who is only students.parentId (no link row) → enable 404 "Student not found" and no row; disable 404 (red if the `parentId` shortcut comes back)', async () => {
    const [kid] = await h.db.select().from(students).where(eq(students.id, directStudentId));
    expect(kid.parentId).toBe(directParentId);
    expect(await h.db.select().from(parentChildLinks).where(eq(parentChildLinks.parentId, directParentId))).toHaveLength(0);
    const en = await directParent.post('/api/check-in/enable').send({ studentId: directStudentId, deviceId: 'q50-direct' });
    expect(en.status).toBe(404);
    expect(en.body).toEqual(NOT_FOUND);
    expect(await checkInsFor(directStudentId)).toHaveLength(0);
    const dis = await directParent.post('/api/check-in/disable').send({ studentId: directStudentId });
    expect(dis.status).toBe(404);
    expect(dis.body).toEqual(NOT_FOUND);
  });
});

// Q173-1 (DeShaun 2026-11-26): a parent with a company no longer reaches a
// linked child of another company, so the "matched student" case runs as
// parentNull (NULL company), linked to company A's studentA and company B's
// studentB (in any order). The two cross-company links are now refused.
describe('Q50 company comes from the matched student', () => {
  let parentNull: Agent;

  beforeAll(async () => {
    await h.db.insert(parentChildLinks).values({ parentId: h.ids.parentNull, studentId: h.ids.studentA });
    await h.db.insert(parentChildLinks).values({ parentId: h.ids.parentNull, studentId: h.ids.studentB });
    await h.db.insert(parentChildLinks).values([
      { parentId: h.ids.parentA, studentId: h.ids.studentB },
      { parentId: h.ids.parentB, studentId: h.ids.studentA },
    ]);
    // 4th login (MAX_LOGINS_PER_FILE is 8).
    parentNull = await h.loginAs('parentNull');
  });

  it('parentNull, linked to company A\'s studentA and company B\'s studentB, enabling for each → studentB\'s row is company B and studentA\'s row is company A, in any link order (red if the company goes back to linkedStudents[0])', async () => {
    // Premise through the server's own read, order-free (Q192 r2).
    const linked = await storage.getLinkedStudentsByParentId(h.ids.parentNull);
    const linkedIds = linked.map((st) => st.id);
    expect(linkedIds).toHaveLength(2);
    expect(linkedIds).toEqual(expect.arrayContaining([h.ids.studentA, h.ids.studentB]));
    const [sA] = await h.db.select().from(students).where(eq(students.id, h.ids.studentA));
    const [sB] = await h.db.select().from(students).where(eq(students.id, h.ids.studentB));
    expect(sA.companyId).toBe(h.ids.companyA);
    expect(sB.companyId).toBe(h.ids.companyB);
    expect(h.ids.companyA).not.toBe(h.ids.companyB);

    for (const [studentId, companyId, deviceId] of [
      [h.ids.studentB, h.ids.companyB, 'q50-null-on-b'],
      [h.ids.studentA, h.ids.companyA, 'q50-null-on-a'],
    ] as const) {
      const res = await parentNull.post('/api/check-in/enable').send({ studentId, deviceId });
      expect(res.status).toBe(200);
      const rows = await h.db.select().from(studentCheckIns).where(and(eq(studentCheckIns.studentId, studentId), eq(studentCheckIns.parentId, h.ids.parentNull)));
      expect(rows).toHaveLength(1);
      expect(rows[0].companyId).toBe(companyId);
    }
  });

  it('parentA linked to company B\'s studentB enabling → 404 "Student not found" and no row (red if check-in enable skips the company match)', async () => {
    expect(await storage.getParentChildLink(h.ids.parentA, h.ids.studentB)).toBeTruthy();
    const res = await parentA.post('/api/check-in/enable').send({ studentId: h.ids.studentB, deviceId: 'q50-a-on-b' });
    expect(res.status).toBe(404);
    expect(res.body).toEqual(NOT_FOUND);
    const rows = await h.db.select().from(studentCheckIns).where(and(eq(studentCheckIns.studentId, h.ids.studentB), eq(studentCheckIns.parentId, h.ids.parentA)));
    expect(rows).toHaveLength(0);
  });

  it('parentB linked to company A\'s studentA enabling → 404 "Student not found" and no row (red if check-in enable skips the company match)', async () => {
    expect(await storage.getParentChildLink(h.ids.parentB, h.ids.studentA)).toBeTruthy();
    const res = await parentB.post('/api/check-in/enable').send({ studentId: h.ids.studentA, deviceId: 'q50-b-on-a' });
    expect(res.status).toBe(404);
    expect(res.body).toEqual(NOT_FOUND);
    const rows = await h.db.select().from(studentCheckIns).where(and(eq(studentCheckIns.studentId, h.ids.studentA), eq(studentCheckIns.parentId, h.ids.parentB)));
    expect(rows).toHaveLength(0);
  });
});
