// Q173: a parent edits only first name, last name and grade of a child they
// are linked to (parent_child_links), in their own company or, for a parent
// with no company yet, any linked child. Anything else in the body is a 400
// and nothing changes. Not linked, missing or another company's child is the
// same 404 on PUT and GET /api/students/:id. A failed update never logs the
// raw DB error (it carries the bound values: names, grade).
// Real HTTP + real Postgres. Each title names the clause whose deletion turns
// it red, and each guard test asserts its seeded rows first (X-1/X-2).
// Seed + seedQ8Extras: parentA <-> studentA by parentId AND link; parentNull
// (NULL company) <-> studentA by link only; parentB (company B) <-> studentA4
// (company A) by a link made by mistake (studentA4.parentId is adminA).
// Link-but-no-student is untested by design: studentId is a notNull FK.
import crypto from 'crypto';
import { inspect } from 'util';
import { describe, it, expect, beforeAll, afterEach, vi } from 'vitest';
import { and, eq, DrizzleQueryError } from 'drizzle-orm';
import { parentChildLinks, students, users } from '@shared/schema';
import { storage } from '../../server/storage';
import { useIntegrationHarness, type Agent } from './harness';
import { seedQ8Extras, type Q8Ids } from './seed';

const h = useIntegrationHarness();
const url = (id: string) => `/api/students/${id}`;
const NOT_FOUND = { message: 'Student not found' };

let parentA: Agent;
let parentNull: Agent;
let parentB: Agent;
let q8: Q8Ids;

type StudentRow = typeof students.$inferSelect;
const saved = new Map<string, StudentRow>();
const studentRow = async (id: string) => (await h.db.select().from(students).where(eq(students.id, id)))[0];
const userRow = async (id: string) => (await h.db.select().from(users).where(eq(users.id, id)))[0];
const linkExists = async (parentId: string, studentId: string) =>
  (await h.db.select().from(parentChildLinks)
    .where(and(eq(parentChildLinks.parentId, parentId), eq(parentChildLinks.studentId, studentId)))).length > 0;

beforeAll(async () => {
  q8 = await seedQ8Extras(h.ids);
  for (const id of [h.ids.studentA, q8.studentA4]) saved.set(id, await studentRow(id));
  // 3 logins (MAX_LOGINS_PER_FILE is 8).
  parentA = await h.loginAs('parentA');
  parentNull = await h.loginAs('parentNull');
  parentB = await h.loginAs('parentB');
});

afterEach(async () => {
  vi.restoreAllMocks();
  for (const [id, row] of saved) {
    const { id: _id, createdAt: _c, ...rest } = row;
    await h.db.update(students).set(rest).where(eq(students.id, id));
  }
});

describe('Q173 parent PUT /api/students/:id: who may edit', () => {
  it('(1) parentNull (link only, NULL company) PUT studentA {grade} → 200, grade changed (red if the parent path checks students.parentId instead of getParentChildLink)', async () => {
    const pre = await studentRow(h.ids.studentA);
    expect(pre.parentId).not.toBe(h.ids.parentNull);
    expect((await userRow(h.ids.parentNull)).companyId).toBeNull();
    expect(await linkExists(h.ids.parentNull, h.ids.studentA)).toBe(true);

    const res = await parentNull.put(url(h.ids.studentA)).send({ grade: 'Q173-G1' });
    expect(res.status).toBe(200);
    expect((await studentRow(h.ids.studentA)).grade).toBe('Q173-G1');
  });

  it('(2) parentB PUT studentA (not linked) → 404 "Student not found", studentA unchanged (red if the parent link 404 is removed or returns 403)', async () => {
    expect(await linkExists(h.ids.parentB, h.ids.studentA)).toBe(false);
    const pre = await studentRow(h.ids.studentA);

    const res = await parentB.put(url(h.ids.studentA)).send({ grade: 'Q173-G2' });
    expect(res.status).toBe(404);
    expect(res.body).toEqual(NOT_FOUND);
    expect(await studentRow(h.ids.studentA)).toEqual(pre);
  });

  it('(3) parentB PUT studentA4 (linked, other company) → 404, studentA4 unchanged (red if the parent company-match check is removed)', async () => {
    expect(await linkExists(h.ids.parentB, q8.studentA4)).toBe(true);
    expect((await userRow(h.ids.parentB)).companyId).toBe(h.ids.companyB);
    const pre = await studentRow(q8.studentA4);
    expect(pre.companyId).toBe(h.ids.companyA);

    const res = await parentB.put(url(q8.studentA4)).send({ grade: 'Q173-G3' });
    expect(res.status).toBe(404);
    expect(res.body).toEqual(NOT_FOUND);
    expect(await studentRow(q8.studentA4)).toEqual(pre);
  });

  it('(4) parentA PUT a random uuid → 404 with the same body as a not-linked student', async () => {
    const res = await parentA.put(url(crypto.randomUUID())).send({ grade: 'Q173-G4' });
    expect(res.status).toBe(404);
    expect(res.body).toEqual(NOT_FOUND);
  });
});

describe('Q173 parent PUT /api/students/:id: only name and grade', () => {
  const refused: Array<[string, () => Record<string, unknown>]> = [
    ['routeId: routeA2', () => ({ routeId: q8.routeA2 })],
    ['stopId: stopA2x', () => ({ stopId: q8.stopA2x })],
    ['schoolId: schoolA2', () => ({ schoolId: q8.schoolA2 })],
    ['isActive: false', () => ({ isActive: false })],
    ['parentId: parentNull', () => ({ parentId: h.ids.parentNull })],
    ["companyId: company B's id", () => ({ companyId: h.ids.companyB })],
    ['routeId: "" (the Q172b-2 clear)', () => ({ routeId: '' })],
    ['grade plus routeId: routeA2', () => ({ grade: 'Q173-G5', routeId: q8.routeA2 })],
  ];

  it.each(refused)('(5) parentA PUT studentA {%s} → 400, studentA unchanged (red if the parent schema loses .strict() or the pick)', async (_name, body) => {
    const pre = await studentRow(h.ids.studentA);
    expect(pre.routeId).toBe(h.ids.routeA);
    expect(pre.isActive).not.toBe(false);

    const res = await parentA.put(url(h.ids.studentA)).send(body());
    expect(res.status).toBe(400);
    expect(res.body.message).toBe('Invalid student data');
    expect(await studentRow(h.ids.studentA)).toEqual(pre);
  });

  it('(6) parentA PUT studentA {} → 400 (red if the at-least-one-key refine is removed)', async () => {
    const res = await parentA.put(url(h.ids.studentA)).send({});
    expect(res.status).toBe(400);
  });

  it('(7) parentA PUT studentA {firstName, lastName, grade} → 200 and the row changed (name trimmed)', async () => {
    const pre = await studentRow(h.ids.studentA);
    const res = await parentA.put(url(h.ids.studentA)).send({ firstName: ' Q173-First ', lastName: 'Q173-Last', grade: 'Q173-G7' });
    expect(res.status).toBe(200);
    const row = await studentRow(h.ids.studentA);
    expect(row.firstName).toBe('Q173-First');
    expect(row.lastName).toBe('Q173-Last');
    expect(row.grade).toBe('Q173-G7');
    expect(row.routeId).toBe(pre.routeId);
    expect(row.companyId).toBe(pre.companyId);
  });

  it('(8) parentA PUT studentA {firstName: "  "} → 400, name unchanged (red if .trim().min(1) is removed from the parent schema)', async () => {
    const pre = await studentRow(h.ids.studentA);
    const res = await parentA.put(url(h.ids.studentA)).send({ firstName: '  ' });
    expect(res.status).toBe(400);
    expect((await studentRow(h.ids.studentA)).firstName).toBe(pre.firstName);
  });
});

describe('Q173 parent GET /api/students/:id', () => {
  it('(9) parentB GET studentA (not linked) → 404 "Student not found" (red if the GET parent path returns 403 again)', async () => {
    expect(await linkExists(h.ids.parentB, h.ids.studentA)).toBe(false);
    const res = await parentB.get(url(h.ids.studentA));
    expect(res.status).toBe(404);
    expect(res.body).toEqual(NOT_FOUND);
  });

  it('(9b) parentB GET studentA4 (linked, other company) → 404 (red if GET skips the company-match check)', async () => {
    expect(await linkExists(h.ids.parentB, q8.studentA4)).toBe(true);
    expect((await studentRow(q8.studentA4)).companyId).toBe(h.ids.companyA);
    const res = await parentB.get(url(q8.studentA4));
    expect(res.status).toBe(404);
    expect(res.body).toEqual(NOT_FOUND);
  });

  it('(9c) parentNull GET studentA (link only) → 200 (positive control)', async () => {
    const res = await parentNull.get(url(h.ids.studentA));
    expect(res.status).toBe(200);
    expect(res.body.id).toBe(h.ids.studentA);
  });
});

describe('Q173 log', () => {
  it('(10) a failed parent update → 500 and no logged arg holds the student name (red if the PUT catch logs the raw error)', async () => {
    const secretName = 'Q173-Secret-Name';
    const pgCause = Object.assign(new Error('value too long'), { code: '22001' });
    const spy = vi.spyOn(storage, 'updateStudent').mockImplementationOnce(() => {
      throw new DrizzleQueryError('update "students" set "first_name" = $1 where "students"."id" = $2', [secretName, h.ids.studentA], pgCause);
    });
    const errSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

    const res = await parentA.put(url(h.ids.studentA)).send({ firstName: secretName });
    expect(spy).toHaveBeenCalled();
    expect(res.status).toBe(500);
    expect(JSON.stringify(res.body)).not.toContain(secretName);
    expect(errSpy).toHaveBeenCalled();
    for (const call of errSpy.mock.calls) {
      for (const arg of call) expect(inspect(arg, { depth: 6 })).not.toContain(secretName);
    }
  });
});
