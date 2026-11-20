// Q114 / Q102: isOnDuty is the authoritative off-duty block on every driver
// shift write/push and route read. The clock-off reset of assignedRouteId sits
// in a swallowed try/catch, so each test simulates it failing: driverA is OFF
// duty with assignedRouteId still routeA (stale but set). Each handler must
// refuse with its existing masking status (or [] for the reads), and the SAME
// request on duty must succeed. Real HTTP + real Postgres; every row the
// request needs is seeded so only the duty check can stop it (checklist X-1/X-2).
//
// Each title names the clause whose deletion turns it red.
import { describe, it, expect, beforeAll } from 'vitest';
import { and, eq } from 'drizzle-orm';
import {
  busJourneys,
  routeSchools,
  routeStopCompletions,
  routes,
  schoolVisits,
  studentAttendance,
  studentCheckIns,
  users,
} from '@shared/schema';
import { useIntegrationHarness, type Agent } from './harness';

const h = useIntegrationHarness();

let driverA: Agent;

// Stale shift: off duty, but the shift route was never cleared.
const offDuty = () =>
  h.db.update(users).set({ isOnDuty: false, dutyStartTime: null, assignedRouteId: h.ids.routeA }).where(eq(users.id, h.ids.driverA));
const onDuty = () =>
  h.db.update(users).set({ isOnDuty: true, dutyStartTime: new Date(), assignedRouteId: h.ids.routeA }).where(eq(users.id, h.ids.driverA));

const markRow = async () =>
  (await h.db.select().from(studentAttendance).where(and(eq(studentAttendance.studentId, h.ids.studentA), eq(studentAttendance.driverId, h.ids.driverA))))[0];
const completions = () =>
  h.db.select().from(routeStopCompletions).where(eq(routeStopCompletions.routeStopId, h.ids.stopA1));
const visits = () =>
  h.db.select().from(schoolVisits).where(and(eq(schoolVisits.driverId, h.ids.driverA), eq(schoolVisits.schoolId, h.ids.schoolA)));

let journeyId: string;

beforeAll(async () => {
  // Preconditions: routeA is driverA's shift route, and schoolA is its school.
  const [route] = await h.db.select().from(routes).where(eq(routes.id, h.ids.routeA));
  expect(route.schoolId).toBe(h.ids.schoolA);
  expect(route.companyId).toBe(h.ids.companyA);

  // driver-route-schools reads routeSchools; link schoolA so the on-duty read is non-empty.
  await h.db.insert(routeSchools).values({ routeId: h.ids.routeA, schoolId: h.ids.schoolA, order: 0 });
  // arrive-homebase needs today's journey for busA (driverA's bus).
  const [j] = await h.db
    .insert(busJourneys)
    .values({ companyId: h.ids.companyA, busId: h.ids.busA, driverId: h.ids.driverA, routeId: h.ids.routeA, journeyDate: new Date() })
    .returning({ id: busJourneys.id });
  journeyId = j.id;

  // 1 login (MAX_LOGINS_PER_FILE is 8).
  driverA = await h.loginAs('driverA');
});

describe('Q114 route reads: off duty → []', () => {
  const READS: Array<[string, string, (body: Array<{ id: string }>) => boolean]> = [
    ['/api/driver-route-students', 'driver-route-students', (b) => b.some((s) => s.id === h.ids.studentA)],
    ['/api/driver-route-stops', 'driver-route-stops', (b) => b.some((s) => s.id === h.ids.stopA1)],
    ['/api/driver-route-schools', 'driver-route-schools', (b) => b.some((s) => s.id === h.ids.schoolA)],
  ];

  for (const [path, name, hasRow] of READS) {
    it(`GET ${name} off duty with a stale assignedRouteId → [] (red if \`!user.isOnDuty ||\` is dropped from the ${name} [] guard)`, async () => {
      await offDuty();
      const res = await driverA.get(path);
      expect(res.status).toBe(200);
      expect(res.body).toEqual([]);
    });

    it(`GET ${name} on duty → routeA's rows (positive control)`, async () => {
      await onDuty();
      const res = await driverA.get(path);
      expect(res.status).toBe(200);
      expect(hasRow(res.body)).toBe(true);
    });
  }
});

describe('Q114 POST /api/student-attendance', () => {
  const MARK = '/api/student-attendance';

  it('off duty with a stale assignedRouteId → 400 "No route assigned to driver", no mark written (red if `!user.isOnDuty ||` is dropped from the student-attendance route guard)', async () => {
    await offDuty();
    const res = await driverA.post(MARK).send({ studentId: h.ids.studentA, status: 'present' });
    expect(res.status).toBe(400);
    expect(res.body).toEqual({ message: 'No route assigned to driver' });
    expect(await markRow()).toBeUndefined();
  });

  it('on duty → 200 and studentA marked present (positive control)', async () => {
    await onDuty();
    const res = await driverA.post(MARK).send({ studentId: h.ids.studentA, status: 'present' });
    expect(res.status).toBe(200);
    expect((await markRow()).status).toBe('present');
  });
});

describe('Q114 POST /api/driver/student-dropoff (E5 push)', () => {
  const DROP = '/api/driver/student-dropoff';

  it('off duty with a stale assignedRouteId and studentA present → 404 "Student not found", dropped_off_at stays NULL (red if `!user.isOnDuty ||` is dropped from the student-dropoff guard)', async () => {
    expect((await markRow()).status).toBe('present');
    await offDuty();
    const res = await driverA.post(DROP).send({ studentId: h.ids.studentA });
    expect(res.status).toBe(404);
    expect(res.body).toEqual({ message: 'Student not found' });
    expect((await markRow()).droppedOffAt).toBeNull();
  });

  it('on duty → 200 and dropped_off_at set (positive control)', async () => {
    await onDuty();
    const res = await driverA.post(DROP).send({ studentId: h.ids.studentA });
    expect(res.status).toBe(200);
    expect((await markRow()).droppedOffAt).not.toBeNull();
  });
});

describe('Q114 POST /api/driver/mark-stop-completed', () => {
  const STOP = '/api/driver/mark-stop-completed';

  it('off duty with a stale assignedRouteId → 404 "Route not found", no completion (red if `!user.isOnDuty ||` is dropped from the mark-stop-completed route guard)', async () => {
    await offDuty();
    const res = await driverA.post(STOP).send({ routeStopId: h.ids.stopA1, routeId: h.ids.routeA });
    expect(res.status).toBe(404);
    expect(res.body).toEqual({ message: 'Route not found' });
    expect(await completions()).toHaveLength(0);
  });

  it('on duty → 200 and one completion (positive control)', async () => {
    await onDuty();
    const res = await driverA.post(STOP).send({ routeStopId: h.ids.stopA1, routeId: h.ids.routeA });
    expect(res.status).toBe(200);
    expect(await completions()).toHaveLength(1);
  });
});

describe('Q114 school arrival and departure', () => {
  const ARRIVE = '/api/driver-school-arrival';
  const DEPART = '/api/driver-school-departure';
  let visitId: string;

  it('arrival off duty with a stale assignedRouteId → 400 "No route assigned to driver", no visit (red if `!user.isOnDuty ||` is dropped from the driver-school-arrival route guard)', async () => {
    await offDuty();
    const res = await driverA.post(ARRIVE).send({ schoolId: h.ids.schoolA });
    expect(res.status).toBe(400);
    expect(res.body).toEqual({ message: 'No route assigned to driver' });
    expect(await visits()).toHaveLength(0);
  });

  it('arrival on duty → 200 and a visit (positive control)', async () => {
    await onDuty();
    const res = await driverA.post(ARRIVE).send({ schoolId: h.ids.schoolA });
    expect(res.status).toBe(200);
    const rows = await visits();
    expect(rows).toHaveLength(1);
    visitId = rows[0].id;
    expect(res.body.id).toBe(visitId);
  });

  it('departure of driverA\'s own visit off duty → 404 "Visit not found", departedAt stays NULL (red if `!user.isOnDuty ||` is dropped from the driver-school-departure visit guard)', async () => {
    await offDuty();
    const res = await driverA.post(DEPART).send({ visitId });
    expect(res.status).toBe(404);
    expect(res.body).toEqual({ message: 'Visit not found' });
    expect((await visits())[0].departedAt).toBeNull();
  });

  it('departure on duty → 200 and departedAt set (positive control)', async () => {
    await onDuty();
    const res = await driverA.post(DEPART).send({ visitId });
    expect(res.status).toBe(200);
    expect((await visits())[0].departedAt).not.toBeNull();
  });
});

describe('Q114 POST /api/driver/arrive-homebase', () => {
  const HOME = '/api/driver/arrive-homebase';
  const journey = async () => (await h.db.select().from(busJourneys).where(eq(busJourneys.id, journeyId)))[0];

  it('off duty with today\'s journey on busA → 404 "No active journey for today", arriveHomebaseAt stays NULL (red if `!user.isOnDuty ||` is dropped from the arrive-homebase journey guard)', async () => {
    await offDuty();
    const res = await driverA.post(HOME).send({});
    expect(res.status).toBe(404);
    expect(res.body).toEqual({ message: 'No active journey for today' });
    expect((await journey()).arriveHomebaseAt).toBeNull();
  });

  it('on duty → 200 and arriveHomebaseAt stamped (positive control)', async () => {
    await onDuty();
    const res = await driverA.post(HOME).send({});
    expect(res.status).toBe(200);
    expect((await journey()).arriveHomebaseAt).not.toBeNull();
  });
});

describe('Q102 POST /api/check-in/confirm-dropoff', () => {
  const DROPOFF = '/api/check-in/confirm-dropoff';
  let checkInId: string;
  const checkIn = async () => (await h.db.select().from(studentCheckIns).where(eq(studentCheckIns.id, checkInId)))[0];

  beforeAll(async () => {
    // Boarded by driverA on routeA, company A: only the duty check stands in the way.
    const [row] = await h.db
      .insert(studentCheckIns)
      .values({ companyId: h.ids.companyA, studentId: h.ids.studentA, parentId: h.ids.parentA, routeId: h.ids.routeA, status: 'boarded', driverId: h.ids.driverA, boardedAt: new Date() })
      .returning({ id: studentCheckIns.id });
    checkInId = row.id;
  });

  it('off duty, driverA\'s own boarded check-in → 404 "Check-in not found", still boarded (red if the Q102 `if (!user.isOnDuty)` guard is removed from confirm-dropoff)', async () => {
    await offDuty();
    const res = await driverA.post(DROPOFF).send({ checkInId });
    expect(res.status).toBe(404);
    expect(res.body).toEqual({ message: 'Check-in not found' });
    expect((await checkIn()).status).toBe('boarded');
  });

  it('on duty → 200 and the check-in is no longer boarded (positive control)', async () => {
    await onDuty();
    const res = await driverA.post(DROPOFF).send({ checkInId });
    expect(res.status).toBe(200);
    expect((await checkIn()).status).not.toBe('boarded');
  });
});
