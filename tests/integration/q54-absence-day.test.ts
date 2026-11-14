// Q54: POST /api/students/:studentId/absence stores the student's company and
// the reported day as the UTC wall time of LOCAL NOON in that company's zone,
// so onLocalDay(attendance.date, tz, day) returns the reported day (a
// midnight-UTC value read as the previous day in US zones). Order of checks:
// ownership (404 "Student not found", same as a missing id), then the date
// (400), then the route (400). Real HTTP + real Postgres. Company A is
// America/Chicago, so 2026-12-01 must be stored as 2026-12-01 18:00:00.
// Note: no screen shows attendance rows today, so this is data correctness.
import { describe, it, expect, beforeAll, beforeEach } from 'vitest';
import { eq, sql } from 'drizzle-orm';
import { attendance, students } from '@shared/schema';
import { useIntegrationHarness, type Agent } from './harness';
import { insertUser, SEED_PASSWORD } from './seed';

const h = useIntegrationHarness();
const NOT_FOUND = { message: 'Student not found' };
const OTHER_PARENT_EMAIL = 'q54-other-parent-a@sbt.test';

let parentA: Agent;
let parentB: Agent;
let adminA: Agent;
let otherParentA: Agent;
let noRouteOwn: string;
let noRouteForeign: string;

const url = (studentId: string) => `/api/students/${studentId}/absence`;
const rowsFor = (studentId: string) => h.db.select().from(attendance).where(eq(attendance.studentId, studentId));

beforeAll(async () => {
  // parentA's own child with no route yet, and a company-B child with no route.
  const [own] = await h.db
    .insert(students)
    .values({ companyId: h.ids.companyA, firstName: 'A-NoRoute', lastName: 'Seed', parentId: h.ids.parentA, schoolId: h.ids.schoolA })
    .returning({ id: students.id });
  noRouteOwn = own.id;
  const [foreign] = await h.db
    .insert(students)
    .values({ companyId: h.ids.companyB, firstName: 'B-NoRoute', lastName: 'Seed', parentId: h.ids.parentB, schoolId: h.ids.schoolB })
    .returning({ id: students.id });
  noRouteForeign = foreign.id;
  // A company-A parent who doesn't own studentA.
  await insertUser(
    { email: OTHER_PARENT_EMAIL, firstName: 'A-OtherParent', lastName: 'Seed', role: 'parent', companyId: h.ids.companyA },
    { password: true },
  );

  // 4 logins (MAX_LOGINS_PER_FILE is 8).
  parentA = await h.loginAs('parentA');
  parentB = await h.loginAs('parentB');
  adminA = await h.loginAs('adminA');
  const agent = h.anon();
  expect((await h.loginAttempt(OTHER_PARENT_EMAIL, SEED_PASSWORD, agent)).status).toBe(200);
  otherParentA = agent;
});

beforeEach(async () => {
  await h.db.delete(attendance);
});

describe('Q54 stored day and company', () => {
  it('2026-12-01 is stored with company A as exactly 2026-12-01 18:00 UTC (Chicago noon), and onLocalDay gives 12-01 (red if the date goes back to new Date(date))', async () => {
    const res = await parentA.post(url(h.ids.studentA)).send({ date: '2026-12-01', notes: 'Dentist' });
    expect(res.status).toBe(200);
    const [row] = await rowsFor(h.ids.studentA);
    expect(row.companyId).toBe(h.ids.companyA);
    expect(row.isAbsent).toBe(true);
    expect(row.date.toISOString()).toBe('2026-12-01T18:00:00.000Z');
    const local = await h.db.execute(
      sql`SELECT ((${attendance.date} AT TIME ZONE 'UTC') AT TIME ZONE 'America/Chicago')::date::text AS d FROM ${attendance} WHERE ${attendance.id} = ${row.id}`,
    );
    expect((local.rows[0] as { d: string }).d).toBe('2026-12-01');
  });

  it('adminA\'s GET /api/attendance?date=2026-12-01 includes it and ?date=2026-11-30 does not (red if companyId is dropped from the insert)', async () => {
    const res = await parentA.post(url(h.ids.studentA)).send({ date: '2026-12-01' });
    expect(res.status).toBe(200);
    const id = res.body.id;
    const day = await adminA.get('/api/attendance?date=2026-12-01');
    expect(day.status).toBe(200);
    expect(day.body.map((r: { id: string }) => r.id)).toContain(id);
    const before = await adminA.get('/api/attendance?date=2026-11-30');
    expect(before.body.map((r: { id: string }) => r.id)).not.toContain(id);
  });
});

describe('Q54 validation and order of checks', () => {
  it('a bad date ("tomorrow") → 400 "Invalid date" and no row (red if the YYYY-MM-DD check is removed)', async () => {
    const res = await parentA.post(url(h.ids.studentA)).send({ date: 'tomorrow' });
    expect(res.status).toBe(400);
    expect(res.body).toEqual({ message: 'Invalid date' });
    expect(await rowsFor(h.ids.studentA)).toHaveLength(0);
  });

  it('an impossible calendar day (2026-02-30) → 400 "Invalid date" and no row, never a 500 (red if the real-calendar-day check is removed)', async () => {
    for (const date of ['2026-02-30', '2026-13-01', '2026-04-31']) {
      const res = await parentA.post(url(h.ids.studentA)).send({ date });
      expect(res.status).toBe(400);
      expect(res.body).toEqual({ message: 'Invalid date' });
    }
    expect(await rowsFor(h.ids.studentA)).toHaveLength(0);
  });

  it('the parent\'s own child with no route → 400 "This student isn\'t on a route yet", not a 500', async () => {
    const res = await parentA.post(url(noRouteOwn)).send({ date: '2026-12-01' });
    expect(res.status).toBe(400);
    expect(res.body).toEqual({ message: "This student isn't on a route yet" });
  });

  it('company B\'s parent on studentA, and a company-A parent who doesn\'t own studentA → 404 with the same body as a missing id (red if the ownership refusal goes back to 403)', async () => {
    const missing = await parentA.post(url('no-such-student')).send({ date: '2026-12-01' });
    expect(missing.status).toBe(404);
    expect(missing.body).toEqual(NOT_FOUND);
    for (const agent of [parentB, otherParentA]) {
      const res = await agent.post(url(h.ids.studentA)).send({ date: '2026-12-01' });
      expect(res.status).toBe(404);
      expect(res.body).toEqual(missing.body);
    }
    expect(await rowsFor(h.ids.studentA)).toHaveLength(0);
  });

  it('a foreign student with no route → still 404, never the no-route 400; a foreign student with a bad date → 404, never the date 400 (order: ownership first)', async () => {
    const noRoute = await parentA.post(url(noRouteForeign)).send({ date: '2026-12-01' });
    expect(noRoute.status).toBe(404);
    expect(noRoute.body).toEqual(NOT_FOUND);
    const badDate = await parentA.post(url(h.ids.studentB)).send({ date: 'tomorrow' });
    expect(badDate.status).toBe(404);
    expect(badDate.body).toEqual(NOT_FOUND);
  });
});
