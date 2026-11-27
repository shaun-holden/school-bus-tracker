// Q175: an admin route change (or "No route") with no stop in the body clears
// a stop that isn't on the new route, so a stale stop on an archived route no
// longer blocks reactivation.
// Q187: a parent's DELETE /api/students/:id only removes their own link (link
// AND company, same 404 as PUT/GET); an admin delete of a student with
// history is a 409, not a 500.
// Q173-1: every parent "my children" read applies the company rule
// (getParentChildren): a linked child of another company is left out, and a
// by-id parent site gives 404 for it.
// Real HTTP + real Postgres. Each title names the clause whose deletion turns
// it red, and each guard test asserts its seeded rows first (X-1/X-2).
// Seed + seedQ8Extras: parentB (company B) is linked to studentA4 (company A,
// by mistake) and to studentBx (company B); parentNull (NULL company) is
// linked to studentA and studentBx. parentA and parentNull are never linked
// to studentA4 here (q173 (3b)/(3c)/(9d)/(9e) need them unlinked).
import crypto from 'crypto';
import { describe, it, expect, beforeAll, afterAll, afterEach } from 'vitest';
import { and, eq, inArray } from 'drizzle-orm';
import { attendance, parentChildLinks, routeStops, routes, studentAttendance, studentCheckIns, students, users } from '@shared/schema';
import { useIntegrationHarness, type Agent } from './harness';
import { seedQ8Extras, type Q8Ids } from './seed';

const h = useIntegrationHarness();
const url = (id: string) => `/api/students/${id}`;
const NOT_FOUND = { message: 'Student not found' };
const HAS_HISTORY = { message: "Students with attendance records can't be deleted; mark them inactive instead." };

let adminA: Agent;
let parentNull: Agent;
let parentB: Agent;
let master: Agent;
let q8: Q8Ids;

const freshStudents: string[] = [];
const freshRoutes: string[] = [];

const studentRow = async (id: string) => (await h.db.select().from(students).where(eq(students.id, id)))[0];
const userRow = async (id: string) => (await h.db.select().from(users).where(eq(users.id, id)))[0];
const linkExists = async (parentId: string, studentId: string) =>
  (await h.db.select().from(parentChildLinks)
    .where(and(eq(parentChildLinks.parentId, parentId), eq(parentChildLinks.studentId, studentId)))).length > 0;
const ensureLink = async (parentId: string, studentId: string) => {
  if (!(await linkExists(parentId, studentId))) await h.db.insert(parentChildLinks).values({ parentId, studentId });
};

// A fresh company-A student (parentId parentA), removed in afterAll.
const mkStudent = async (values: Partial<typeof students.$inferInsert> = {}) => {
  const [s] = await h.db.insert(students)
    .values({ companyId: h.ids.companyA, firstName: 'Q175-Student', lastName: 'Seed', parentId: h.ids.parentA, schoolId: h.ids.schoolA, ...values })
    .returning();
  freshStudents.push(s.id);
  return s;
};

beforeAll(async () => {
  q8 = await seedQ8Extras(h.ids);
  // 4 logins (MAX_LOGINS_PER_FILE is 8).
  adminA = await h.loginAs('adminA');
  parentNull = await h.loginAs('parentNull');
  parentB = await h.loginAs('parentB');
  master = await h.loginAs('master');
});

afterEach(async () => {
  // A red run of (6) would remove the seeded cross-company link: put it back.
  await ensureLink(h.ids.parentB, q8.studentA4);
});

afterAll(async () => {
  if (freshStudents.length) {
    await h.db.delete(attendance).where(inArray(attendance.studentId, freshStudents));
    await h.db.delete(parentChildLinks).where(inArray(parentChildLinks.studentId, freshStudents));
    await h.db.delete(students).where(inArray(students.id, freshStudents));
  }
  if (freshRoutes.length) {
    await h.db.delete(routeStops).where(inArray(routeStops.routeId, freshRoutes));
    await h.db.delete(routes).where(inArray(routes.id, freshRoutes));
  }
});

describe('Q175 admin route change clears a stale stop', () => {
  it('(1) inactive student on an archived route with a stop on it; PUT {routeId: routeA, isActive: true} → 200, stop null, active (red if the stale-stop clear is removed)', async () => {
    const [r] = await h.db.insert(routes).values({ companyId: h.ids.companyA, name: 'A-Q175-Archived', schoolId: h.ids.schoolA, isActive: false }).returning();
    freshRoutes.push(r.id);
    const [stop] = await h.db.insert(routeStops)
      .values({ routeId: r.id, schoolId: h.ids.schoolA, name: 'A-Q175-Stop', address: 'A-75 Stop St', order: 1 }).returning();
    const s = await mkStudent({ routeId: r.id, stopId: stop.id, isActive: false });
    expect(r.isActive).toBe(false);
    expect(s.stopId).toBe(stop.id);
    const [routeA] = await h.db.select().from(routes).where(eq(routes.id, h.ids.routeA));
    expect(routeA.isActive).not.toBe(false);

    const res = await adminA.put(url(s.id)).send({ routeId: h.ids.routeA, isActive: true });
    expect(res.status).toBe(200);
    const row = await studentRow(s.id);
    expect(row.routeId).toBe(h.ids.routeA);
    expect(row.stopId).toBeNull();
    expect(row.isActive).toBe(true);
  });

  it('(2) PUT {routeId: null} on a student with a stop → stop null (red if the stale-stop clear is removed)', async () => {
    const s = await mkStudent({ routeId: h.ids.routeA, stopId: h.ids.stopA1 });
    const res = await adminA.put(url(s.id)).send({ routeId: null });
    expect(res.status).toBe(200);
    const row = await studentRow(s.id);
    expect(row.routeId).toBeNull();
    expect(row.stopId).toBeNull();
  });

  it('(2b) route already null + leftover stop, PUT {routeId: null} → stop null (red if the clear only runs when the route changes)', async () => {
    const s = await mkStudent({ routeId: null, stopId: h.ids.stopA1 });
    expect(s.routeId).toBeNull();
    const res = await adminA.put(url(s.id)).send({ routeId: null });
    expect(res.status).toBe(200);
    expect((await studentRow(s.id)).stopId).toBeNull();
  });

  it('(3) PUT {routeId: routeA2, stopId: stopA2x} → the body stop is kept', async () => {
    const s = await mkStudent({ routeId: h.ids.routeA, stopId: h.ids.stopA1 });
    const res = await adminA.put(url(s.id)).send({ routeId: q8.routeA2, stopId: q8.stopA2x });
    expect(res.status).toBe(200);
    const row = await studentRow(s.id);
    expect(row.routeId).toBe(q8.routeA2);
    expect(row.stopId).toBe(q8.stopA2x);
  });

  it('(3b) PUT {routeId: routeA2} when the old stop is on routeA2 → stop kept (red if the clear ignores the stop\'s route)', async () => {
    const s = await mkStudent({ routeId: h.ids.routeA, stopId: q8.stopA2x });
    const [stop] = await h.db.select().from(routeStops).where(eq(routeStops.id, q8.stopA2x));
    expect(stop.routeId).toBe(q8.routeA2);
    const res = await adminA.put(url(s.id)).send({ routeId: q8.routeA2 });
    expect(res.status).toBe(200);
    expect((await studentRow(s.id)).stopId).toBe(q8.stopA2x);
  });

  it('(3c) PUT {firstName} only → stop kept (red if the clear runs without routeId in the body)', async () => {
    const s = await mkStudent({ routeId: h.ids.routeA, stopId: h.ids.stopA1 });
    const res = await adminA.put(url(s.id)).send({ firstName: 'Q175-Renamed' });
    expect(res.status).toBe(200);
    const row = await studentRow(s.id);
    expect(row.firstName).toBe('Q175-Renamed');
    expect(row.stopId).toBe(h.ids.stopA1);
  });
});

describe('Q187 DELETE /api/students/:id', () => {
  it('(4) parentNull DELETE a student linked to parentNull and parentA → 200 {success: true}, only parentNull\'s link is gone, the student stays (red if the parent path still calls deleteStudent)', async () => {
    const s = await mkStudent();
    await h.db.insert(parentChildLinks).values([
      { parentId: h.ids.parentNull, studentId: s.id },
      { parentId: h.ids.parentA, studentId: s.id },
    ]);
    expect((await userRow(h.ids.parentNull)).companyId).toBeNull();
    expect(await linkExists(h.ids.parentNull, s.id)).toBe(true);
    expect(await linkExists(h.ids.parentA, s.id)).toBe(true);

    const res = await parentNull.delete(url(s.id));
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ success: true });
    expect(await linkExists(h.ids.parentNull, s.id)).toBe(false);
    expect(await linkExists(h.ids.parentA, s.id)).toBe(true);
    expect(await studentRow(s.id)).toBeDefined();
  });

  it('(5) parentB DELETE studentA (not linked) → 404 "Student not found", nothing changed (red if the parent DELETE skips the link check)', async () => {
    expect(await linkExists(h.ids.parentB, h.ids.studentA)).toBe(false);
    expect(await linkExists(h.ids.parentA, h.ids.studentA)).toBe(true);
    const res = await parentB.delete(url(h.ids.studentA));
    expect(res.status).toBe(404);
    expect(res.body).toEqual(NOT_FOUND);
    expect(await studentRow(h.ids.studentA)).toBeDefined();
    expect(await linkExists(h.ids.parentA, h.ids.studentA)).toBe(true);
  });

  it('(6) parentB DELETE studentA4 (linked, other company) → 404 and the link stays (red if the parent DELETE skips the company match)', async () => {
    expect(await linkExists(h.ids.parentB, q8.studentA4)).toBe(true);
    expect((await userRow(h.ids.parentB)).companyId).toBe(h.ids.companyB);
    expect((await studentRow(q8.studentA4)).companyId).toBe(h.ids.companyA);

    const res = await parentB.delete(url(q8.studentA4));
    expect(res.status).toBe(404);
    expect(res.body).toEqual(NOT_FOUND);
    expect(await linkExists(h.ids.parentB, q8.studentA4)).toBe(true);
    expect(await studentRow(q8.studentA4)).toBeDefined();
  });

  it('(7) parentB DELETE a random uuid → 404 with the same body', async () => {
    const res = await parentB.delete(url(crypto.randomUUID()));
    expect(res.status).toBe(404);
    expect(res.body).toEqual(NOT_FOUND);
  });

  it('(8) adminA DELETE a student with an attendance row → 409 with the history message, the student stays (red if the 23503 catch is removed)', async () => {
    const s = await mkStudent({ routeId: h.ids.routeA });
    await h.db.insert(attendance).values({ companyId: h.ids.companyA, studentId: s.id, routeId: h.ids.routeA, date: new Date(), isPresent: true });
    expect((await h.db.select().from(attendance).where(eq(attendance.studentId, s.id)))).toHaveLength(1);

    const res = await adminA.delete(url(s.id));
    expect(res.status).toBe(409);
    expect(res.body).toEqual(HAS_HISTORY);
    expect(await studentRow(s.id)).toBeDefined();
  });

  it('(8b) adminA DELETE a student with no history → 200 (control)', async () => {
    const s = await mkStudent();
    const res = await adminA.delete(url(s.id));
    expect(res.status).toBe(200);
    expect(await studentRow(s.id)).toBeUndefined();
  });
});

describe('Q173-1 parent reads apply the company rule', () => {
  const ids = (body: any[]) => body.map((r: any) => r.student?.id ?? r.studentId ?? r.id);
  let seededAttendance: string[] = [];
  let seededCheckIns: string[] = [];

  beforeAll(async () => {
    // Today's rows (UTC wall time, as drizzle writes) so the today-only reads
    // have a studentA4 row to leave out and a studentBx row to keep.
    const now = new Date();
    seededAttendance = (await h.db.insert(studentAttendance).values([
      { companyId: h.ids.companyA, studentId: q8.studentA4, driverId: h.ids.driverA, routeId: h.ids.routeA, attendanceDate: now, status: 'present' },
      { companyId: h.ids.companyB, studentId: q8.studentBx, driverId: h.ids.driverA, routeId: h.ids.routeA, attendanceDate: now, status: 'present' },
    ]).returning({ id: studentAttendance.id })).map((r) => r.id);
    seededCheckIns = (await h.db.insert(studentCheckIns).values([
      { companyId: h.ids.companyA, studentId: q8.studentA4, parentId: h.ids.parentB, deviceId: 'q173b-a4', status: 'waiting', checkInDate: now },
      { companyId: h.ids.companyB, studentId: q8.studentBx, parentId: h.ids.parentB, deviceId: 'q173b-bx', status: 'waiting', checkInDate: now },
    ]).returning({ id: studentCheckIns.id })).map((r) => r.id);
  });

  afterAll(async () => {
    // Q193: delete only the rows beforeAll inserted, by id.
    await h.db.delete(studentAttendance).where(inArray(studentAttendance.id, seededAttendance));
    await h.db.delete(studentCheckIns).where(inArray(studentCheckIns.id, seededCheckIns));
  });

  it('seed: parentB (company B) is linked to studentA4 (company A) and studentBx (company B)', async () => {
    expect((await userRow(h.ids.parentB)).companyId).toBe(h.ids.companyB);
    expect(await linkExists(h.ids.parentB, q8.studentA4)).toBe(true);
    expect(await linkExists(h.ids.parentB, q8.studentBx)).toBe(true);
    expect((await studentRow(q8.studentA4)).companyId).toBe(h.ids.companyA);
    expect((await studentRow(q8.studentBx)).companyId).toBe(h.ids.companyB);
    expect(seededAttendance).toHaveLength(2);
    expect(seededCheckIns).toHaveLength(2);
  });

  const lists = [
    { name: 'GET /api/students', url: '/api/students' },
    { name: 'GET /api/my-children', url: '/api/my-children' },
    { name: 'GET /api/parent/children-buses', url: '/api/parent/children-buses' },
    { name: 'GET /api/parent/children-attendance', url: '/api/parent/children-attendance' },
    { name: 'GET /api/check-in/status', url: '/api/check-in/status' },
  ] as const;

  for (const site of lists) {
    it(`(9) parentB ${site.name} leaves out studentA4 and keeps studentBx (red if ${site.name} skips the company match)`, async () => {
      const res = await parentB.get(site.url);
      expect(res.status).toBe(200);
      expect(ids(res.body)).toContain(q8.studentBx);
      expect(ids(res.body)).not.toContain(q8.studentA4);
    });
  }

  it('(9) parentNull GET /api/students still lists studentA (NULL company through the link; positive control)', async () => {
    expect(await linkExists(h.ids.parentNull, h.ids.studentA)).toBe(true);
    const res = await parentNull.get('/api/students');
    expect(res.status).toBe(200);
    expect(ids(res.body)).toContain(h.ids.studentA);
  });

  it('(9) parentB POST /api/students/studentA4/absence → 404, while studentBx gets the 400 for the bad date (red if absence skips the company match)', async () => {
    const a4 = await parentB.post(`/api/students/${q8.studentA4}/absence`).send({ date: 'not-a-date' });
    expect(a4.status).toBe(404);
    expect(a4.body).toEqual(NOT_FOUND);
    const bx = await parentB.post(`/api/students/${q8.studentBx}/absence`).send({ date: 'not-a-date' });
    expect(bx.status).toBe(400);
  });

  it('(9) parentB GET /api/parent/stop-progress/studentA4 → 404 "Student not found"; studentBx → 200 (red if stop-progress skips the company match or returns 403 again)', async () => {
    const a4 = await parentB.get(`/api/parent/stop-progress/${q8.studentA4}`);
    expect(a4.status).toBe(404);
    expect(a4.body).toEqual(NOT_FOUND);
    const bx = await parentB.get(`/api/parent/stop-progress/${q8.studentBx}`);
    expect(bx.status).toBe(200);
  });

  it('(9) parentB POST /api/check-in/enable for studentA4 → 404, no new check-in (red if check-in enable skips the company match)', async () => {
    try {
      const res = await parentB.post('/api/check-in/enable').send({ studentId: q8.studentA4, deviceId: 'q173b-enable' });
      expect(res.status).toBe(404);
      expect(res.body).toEqual(NOT_FOUND);
      const rows = await h.db.select().from(studentCheckIns).where(eq(studentCheckIns.studentId, q8.studentA4));
      expect(rows.map((r) => r.deviceId)).toEqual(['q173b-a4']);
    } finally {
      await h.db.delete(studentCheckIns).where(and(eq(studentCheckIns.studentId, q8.studentA4), eq(studentCheckIns.deviceId, 'q173b-enable')));
    }
  });

  it('(9) parentB POST /api/check-in/disable for studentA4 → 404, its check-in still waiting (red if check-in disable skips the company match)', async () => {
    const res = await parentB.post('/api/check-in/disable').send({ studentId: q8.studentA4 });
    expect(res.status).toBe(404);
    expect(res.body).toEqual(NOT_FOUND);
    const [row] = await h.db.select().from(studentCheckIns).where(eq(studentCheckIns.id, seededCheckIns[0]));
    expect(row.studentId).toBe(q8.studentA4);
    expect(row.status).toBe('waiting');
  });

  it('(9) parentB POST /api/parent/set-check-in for studentA4 → 404 "Student not found", its check-in still waiting (red if set-check-in skips the company match or returns 403 again)', async () => {
    const res = await parentB.post('/api/parent/set-check-in').send({ studentId: q8.studentA4, status: 'not_riding' });
    expect(res.status).toBe(404);
    expect(res.body).toEqual(NOT_FOUND);
    const [row] = await h.db.select().from(studentCheckIns).where(eq(studentCheckIns.id, seededCheckIns[0]));
    expect(row.status).toBe('waiting');
  });

  it('(9) a master impersonating company B, linked to studentA4 and studentBx, gets only studentBx from GET /api/my-children (red if getParentChildren drops the company filter)', async () => {
    await h.db.insert(parentChildLinks).values([
      { parentId: h.ids.master, studentId: q8.studentA4 },
      { parentId: h.ids.master, studentId: q8.studentBx },
    ]);
    try {
      const imp = await master.post(`/api/master-admin/impersonate/${h.ids.companyB}`).send({});
      expect(imp.status).toBe(200);
      const me = await master.get('/api/auth/user');
      expect(me.body).toMatchObject({ role: 'master_admin', companyId: h.ids.companyB, _masterAdminImpersonating: true });

      const res = await master.get('/api/my-children');
      expect(res.status).toBe(200);
      expect(ids(res.body)).toContain(q8.studentBx);
      expect(ids(res.body)).not.toContain(q8.studentA4);
    } finally {
      await master.post('/api/master-admin/stop-impersonating').send({});
      await h.db.delete(parentChildLinks).where(and(
        eq(parentChildLinks.parentId, h.ids.master),
        inArray(parentChildLinks.studentId, [q8.studentA4, q8.studentBx]),
      ));
    }
  });
});
