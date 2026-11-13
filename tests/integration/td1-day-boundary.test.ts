// TD-1 (Q47): every "today" query buckets rows by the company's local day
// (company A is America/Chicago), whatever the Postgres session TimeZone.
// Day columns are `timestamp without time zone` holding UTC wall time; the
// correct predicate is onLocalDay = ((col AT TIME ZONE 'UTC') AT TIME ZONE
// tz)::date. Real HTTP + real Postgres.
//
// Fixtures per family (day columns always set from JS Dates via drizzle):
//   R1 = today 13:00 Chicago, R2 = today 20:00 Chicago (next UTC day),
//   R0 = yesterday 20:00 Chicago (on today's UTC date: must NOT count).
// The old predicate (col AT TIME ZONE tz)::date matches R0 and misses R2 in
// both a UTC and a New York session, so every family asserts on R0 and R2.
// (In a New York session the old form still matches R1, so R1 alone would
// not catch it.) Accepted flake: a run that straddles Chicago midnight.
import { describe, it, expect, beforeAll, beforeEach } from 'vitest';
import { eq, sql } from 'drizzle-orm';
import {
  attendance,
  studentAttendance,
  schoolVisits,
  studentCheckIns,
  busJourneys,
  routeStopCompletions,
} from '@shared/schema';
import { onLocalDay } from '../../server/storage';
import { useIntegrationHarness, type Agent } from './harness';

const h = useIntegrationHarness();
const TZ = 'America/Chicago';

let driverA: Agent;
let adminA: Agent;
let parentA: Agent;

// ---- time helpers (no dependency) -----------------------------------------
function ymdIn(tz: string, d: Date): { y: number; m: number; d: number; s: string } {
  const s = new Intl.DateTimeFormat('en-CA', { timeZone: tz }).format(d);
  const [y, m, day] = s.split('-').map(Number);
  return { y, m, d: day, s };
}
/** The UTC instant whose wall time in `tz` is y-m-d hh:00. */
function zonedWall(tz: string, y: number, m: number, d: number, hh: number): Date {
  const target = Date.UTC(y, m - 1, d, hh, 0, 0);
  let guess = target;
  for (let i = 0; i < 3; i++) {
    const parts = Object.fromEntries(
      new Intl.DateTimeFormat('en-US', {
        timeZone: tz, hourCycle: 'h23', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit',
      }).formatToParts(new Date(guess)).map((p) => [p.type, p.value]),
    );
    const wall = Date.UTC(+parts.year, +parts.month - 1, +parts.day, +parts.hour, +parts.minute, +parts.second);
    guess -= wall - target;
  }
  return new Date(guess);
}
const today = ymdIn(TZ, new Date());
const yest = (() => {
  const u = new Date(Date.UTC(today.y, today.m - 1, today.d - 1));
  return { y: u.getUTCFullYear(), m: u.getUTCMonth() + 1, d: u.getUTCDate() };
})();
const R1 = zonedWall(TZ, today.y, today.m, today.d, 13);
const R2 = zonedWall(TZ, today.y, today.m, today.d, 20);
const R0 = zonedWall(TZ, yest.y, yest.m, yest.d, 20);

const ids = (body: Array<{ id: string }>) => body.map((r) => r.id);

beforeAll(async () => {
  // 3 logins (MAX_LOGINS_PER_FILE is 8).
  driverA = await h.loginAs('driverA');
  adminA = await h.loginAs('adminA');
  parentA = await h.loginAs('parentA');
});

beforeEach(async () => {
  for (const t of [studentAttendance, attendance, schoolVisits, studentCheckIns, busJourneys, routeStopCompletions]) {
    await h.db.delete(t);
  }
});

// ---- fixtures ---------------------------------------------------------------
async function mark(at: Date, status: 'present' | 'absent' = 'present') {
  const [r] = await h.db
    .insert(studentAttendance)
    .values({ companyId: h.ids.companyA, studentId: h.ids.studentA, driverId: h.ids.driverA, routeId: h.ids.routeA, status, attendanceDate: at })
    .returning({ id: studentAttendance.id });
  return r.id;
}
async function absenceRow(at: Date) {
  const [r] = await h.db
    .insert(attendance)
    .values({ companyId: h.ids.companyA, studentId: h.ids.studentA, routeId: h.ids.routeA, date: at, isAbsent: true })
    .returning({ id: attendance.id });
  return r.id;
}
async function visit(at: Date) {
  const [r] = await h.db
    .insert(schoolVisits)
    .values({ companyId: h.ids.companyA, driverId: h.ids.driverA, schoolId: h.ids.schoolA, routeId: h.ids.routeA, arrivedAt: at, visitDate: at })
    .returning({ id: schoolVisits.id });
  return r.id;
}
async function checkIn(at: Date, deviceId = 'dev-old') {
  const [r] = await h.db
    .insert(studentCheckIns)
    .values({ companyId: h.ids.companyA, studentId: h.ids.studentA, parentId: h.ids.parentA, routeId: h.ids.routeA, deviceId, status: 'waiting', checkInDate: at })
    .returning({ id: studentCheckIns.id });
  return r.id;
}
async function journey(at: Date) {
  const [r] = await h.db
    .insert(busJourneys)
    .values({ companyId: h.ids.companyA, busId: h.ids.busA, driverId: h.ids.driverA, routeId: h.ids.routeA, journeyDate: at })
    .returning({ id: busJourneys.id });
  return r.id;
}
async function completion(at: Date, stopId: string, seq: number) {
  const [r] = await h.db
    .insert(routeStopCompletions)
    .values({ companyId: h.ids.companyA, routeStopId: stopId, routeId: h.ids.routeA, driverId: h.ids.driverA, busId: h.ids.busA, stopSequence: seq, completionDate: at, arrivedAt: at })
    .returning({ id: routeStopCompletions.id });
  return r.id;
}

function expectToday(got: string[], r1: string, r2: string, r0: string) {
  expect(got).toContain(r1);
  expect(got).toContain(r2);
  expect(got).not.toContain(r0);
}

// ---- 1. attendance reads ------------------------------------------------------
describe('TD-1 attendance reads use the company local day', () => {
  it('driver GET /api/student-attendance (getTodaysStudentAttendance): R1 and R2, not R0 (red if onLocalDay drops the inner AT TIME ZONE \'UTC\')', async () => {
    const [r0, r1, r2] = [await mark(R0), await mark(R1), await mark(R2)];
    const res = await driverA.get('/api/student-attendance');
    expect(res.status).toBe(200);
    expectToday(ids(res.body), r1, r2, r0);
  });

  it('admin GET /api/student-attendance (getAllAttendanceData): R1 and R2, not R0', async () => {
    const [r0, r1, r2] = [await mark(R0), await mark(R1), await mark(R2)];
    const res = await adminA.get('/api/student-attendance');
    expect(res.status).toBe(200);
    expectToday(ids(res.body), r1, r2, r0);
  });

  it('admin GET /api/attendance/route/:routeId?date=<today> (getAttendanceByRoute): R1 and R2, not R0', async () => {
    const [r0, r1, r2] = [await mark(R0), await mark(R1), await mark(R2)];
    const res = await adminA.get(`/api/attendance/route/${h.ids.routeA}?date=${today.s}`);
    expect(res.status).toBe(200);
    expectToday(ids(res.body), r1, r2, r0);
  });

  it('parent GET /api/parent/children-attendance (getTodaysAttendanceForStudents): R1 and R2, not R0', async () => {
    const [r0, r1, r2] = [await mark(R0), await mark(R1), await mark(R2)];
    const res = await parentA.get('/api/parent/children-attendance');
    expect(res.status).toBe(200);
    expectToday(ids(res.body), r1, r2, r0);
  });

  it('admin GET /api/attendance?date=<today> (getAttendanceByDate, attendance table): R1 and R2, not R0 (red if getAttendanceByDate goes back to the inline predicate)', async () => {
    const [r0, r1, r2] = [await absenceRow(R0), await absenceRow(R1), await absenceRow(R2)];
    const res = await adminA.get(`/api/attendance?date=${today.s}`);
    expect(res.status).toBe(200);
    expectToday(ids(res.body), r1, r2, r0);
  });
});

// ---- 2. markStudentAttendance write ------------------------------------------
describe('TD-1 POST /api/student-attendance (markStudentAttendance)', () => {
  const todayRows = async () =>
    (await h.db.select().from(studentAttendance).where(eq(studentAttendance.studentId, h.ids.studentA)))
      .filter((r) => ymdIn(TZ, r.attendanceDate!).s === today.s);

  it('R1 (absent) today → marking present updates R1, no duplicate', async () => {
    const r1 = await mark(R1, 'absent');
    const res = await driverA.post('/api/student-attendance').send({ studentId: h.ids.studentA, status: 'present' });
    expect(res.status).toBe(200);
    const rows = await todayRows();
    expect(rows).toHaveLength(1);
    expect(rows[0].id).toBe(r1);
    expect(rows[0].status).toBe('present');
  });

  it('only R0 (yesterday evening, absent) → marking present inserts a NEW today row and leaves R0 absent (red if markStudentAttendance goes back to the inline predicate)', async () => {
    const r0 = await mark(R0, 'absent');
    const res = await driverA.post('/api/student-attendance').send({ studentId: h.ids.studentA, status: 'present' });
    expect(res.status).toBe(200);
    expect(res.body.id).not.toBe(r0);
    const [old] = await h.db.select().from(studentAttendance).where(eq(studentAttendance.id, r0));
    expect(old.status).toBe('absent');
    expect((await todayRows()).map((r) => r.status)).toEqual(['present']);
  });
});

// ---- 3. school visits ------------------------------------------------------------
describe('TD-1 school visits (getTodaysSchoolVisits, recordSchoolArrival)', () => {
  it('GET /api/driver-school-visits: R1 and R2, not R0 (red if getTodaysSchoolVisits goes back to the inline predicate)', async () => {
    const [r0, r1, r2] = [await visit(R0), await visit(R1), await visit(R2)];
    const res = await driverA.get('/api/driver-school-visits');
    expect(res.status).toBe(200);
    expectToday(ids(res.body), r1, r2, r0);
  });

  it('arrival with R1 present updates R1 (no new row)', async () => {
    const r1 = await visit(R1);
    const res = await driverA.post('/api/driver-school-arrival').send({ schoolId: h.ids.schoolA });
    expect(res.status).toBe(200);
    expect(res.body.id).toBe(r1);
    expect(await h.db.select().from(schoolVisits)).toHaveLength(1);
  });

  it('arrival with only R0 present inserts a NEW today visit and leaves R0 unchanged', async () => {
    const r0 = await visit(R0);
    const res = await driverA.post('/api/driver-school-arrival').send({ schoolId: h.ids.schoolA });
    expect(res.status).toBe(200);
    expect(res.body.id).not.toBe(r0);
    const [old] = await h.db.select().from(schoolVisits).where(eq(schoolVisits.id, r0));
    expect(old.arrivedAt!.getTime()).toBe(R0.getTime());
    expect(await h.db.select().from(schoolVisits)).toHaveLength(2);
  });
});

// ---- 4. check-ins ------------------------------------------------------------------
describe('TD-1 check-ins (getTodayCheckInsForStudents, getActiveCheckInsForRoute, enable, disable)', () => {
  it('parent GET /api/check-in/status: R1 and R2, not R0', async () => {
    const [r0, r1, r2] = [await checkIn(R0), await checkIn(R1), await checkIn(R2)];
    const res = await parentA.get('/api/check-in/status');
    expect(res.status).toBe(200);
    expectToday(ids(res.body), r1, r2, r0);
  });

  it('driver GET /api/check-in/waiting/:routeId: R1 and R2, not R0 (red if getActiveCheckInsForRoute goes back to the inline predicate)', async () => {
    const [r0, r1, r2] = [await checkIn(R0), await checkIn(R1), await checkIn(R2)];
    const res = await driverA.get(`/api/check-in/waiting/${h.ids.routeA}`);
    expect(res.status).toBe(200);
    expectToday(ids(res.body), r1, r2, r0);
  });

  it('enable with R1 waiting updates R1 (no new row)', async () => {
    const r1 = await checkIn(R1);
    const res = await parentA.post('/api/check-in/enable').send({ studentId: h.ids.studentA, deviceId: 'dev-new' });
    expect(res.status).toBe(200);
    expect(res.body.id).toBe(r1);
    expect(await h.db.select().from(studentCheckIns)).toHaveLength(1);
  });

  it('enable with only R0 inserts a NEW today check-in and leaves R0 unchanged', async () => {
    const r0 = await checkIn(R0, 'dev-old');
    const res = await parentA.post('/api/check-in/enable').send({ studentId: h.ids.studentA, deviceId: 'dev-new' });
    expect(res.status).toBe(200);
    expect(res.body.id).not.toBe(r0);
    const [old] = await h.db.select().from(studentCheckIns).where(eq(studentCheckIns.id, r0));
    expect(old.deviceId).toBe('dev-old');
    expect(old.status).toBe('waiting');
  });

  it('disable deletes R1 and R2 and leaves R0', async () => {
    const [r0] = [await checkIn(R0), await checkIn(R1), await checkIn(R2)];
    const res = await parentA.post('/api/check-in/disable').send({ studentId: h.ids.studentA });
    expect(res.status).toBe(200);
    expect(ids(await h.db.select().from(studentCheckIns))).toEqual([r0]);
  });
});

// ---- 5. bus journey -----------------------------------------------------------------
describe('TD-1 GET /api/driver/today-journey (getTodayBusJourney)', () => {
  it('with R0 and R1 journeys for bus A returns R1 (red if getTodayBusJourney goes back to the inline predicate)', async () => {
    await journey(R0);
    const r1 = await journey(R1);
    const res = await driverA.get('/api/driver/today-journey');
    expect(res.status).toBe(200);
    expect(res.body?.id).toBe(r1);
  });

  it('with only an R0 journey returns null, not 404', async () => {
    await journey(R0);
    const res = await driverA.get('/api/driver/today-journey');
    expect(res.status).toBe(200);
    expect(res.body).toBeNull();
  });

  it('with only an R2 journey (late today) returns it', async () => {
    const r2 = await journey(R2);
    const res = await driverA.get('/api/driver/today-journey');
    expect(res.body?.id).toBe(r2);
  });
});

// ---- 6. stop completions ---------------------------------------------------------------
describe('TD-1 stop completions (getTodayCompletedStops, getLastCompletedStop)', () => {
  it('GET /api/routes/:routeId/completed-stops: R1 and R2, not R0 (red if getTodayCompletedStops goes back to the inline predicate)', async () => {
    const r0 = await completion(R0, h.ids.stopA2, 2);
    const r1 = await completion(R1, h.ids.stopA1, 1);
    const r2 = await completion(R2, h.ids.stopA2, 2);
    const res = await adminA.get(`/api/routes/${h.ids.routeA}/completed-stops`);
    expect(res.status).toBe(200);
    expectToday(ids(res.body), r1, r2, r0);
  });

  it('parent stop progress: R1 completes stop 1 today, R0 completed stop 2 yesterday evening → hasArrived, 1 completed, last = stop 1', async () => {
    await completion(R0, h.ids.stopA2, 2);
    await completion(R1, h.ids.stopA1, 1);
    const res = await parentA.get(`/api/parent/stop-progress/${h.ids.studentA}`);
    expect(res.status).toBe(200);
    expect(res.body.hasArrived).toBe(true);
    expect(res.body.completedStopsCount).toBe(1);
    expect(res.body.lastCompletedStopId).toBe(h.ids.stopA1);
  });
});

// ---- 7. session independence (SQL level) ---------------------------------------------
describe('TD-1 onLocalDay never depends on the session TimeZone', () => {
  for (const zone of ['UTC', 'America/New_York', 'Asia/Tokyo']) {
    it(`session ${zone}: 2026-11-14 02:00 (UTC wall) is 2026-11-13 in Chicago; 2026-11-13 02:00 is not (red if the helper goes back to the old form)`, async () => {
      const result = await h.db.transaction(async (tx) => {
        await tx.execute(sql`SELECT set_config('TimeZone', ${zone}, true)`);
        const late = await tx.execute(
          sql`SELECT ${onLocalDay(sql`'2026-11-14 02:00'::timestamp`, 'America/Chicago', '2026-11-13')} AS ok`,
        );
        const early = await tx.execute(
          sql`SELECT ${onLocalDay(sql`'2026-11-13 02:00'::timestamp`, 'America/Chicago', '2026-11-13')} AS ok`,
        );
        return { late: (late.rows[0] as { ok: boolean }).ok, early: (early.rows[0] as { ok: boolean }).ok };
      });
      expect(result.late).toBe(true);
      expect(result.early).toBe(false);
    });
  }
});

