// Q121 / Q123 / Q125: the rest of the off-duty gating family, plus the zod
// body checks (Q125c) and an impersonating-master sweep (Q125e). As in Q114,
// the off-duty cases seed isOnDuty false with a STALE assignedRouteId (routeA,
// as a skipped/swallowed clock-off reset leaves it), so only the new
// `!user.isOnDuty` term can refuse; each has an on-duty positive control.
// Real HTTP + real Postgres; every row the request needs is seeded
// (checklist X-1/X-2).
//
// Each title names the clause whose deletion turns it red.
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { and, eq } from 'drizzle-orm';
import {
  buses,
  parentNotifications,
  routeSchools,
  routeStopCompletions,
  routeStops,
  routes,
  schoolVisits,
  studentAttendance,
  studentCheckIns,
  students,
  users,
} from '@shared/schema';
import { useIntegrationHarness, type Agent } from './harness';

const h = useIntegrationHarness();

let driverA: Agent;
let master: Agent;
let routeA2: string;

const offDuty = () =>
  h.db.update(users).set({ isOnDuty: false, dutyStartTime: null, assignedRouteId: h.ids.routeA }).where(eq(users.id, h.ids.driverA));
const onDuty = () =>
  h.db.update(users).set({ isOnDuty: true, dutyStartTime: new Date(), assignedRouteId: h.ids.routeA }).where(eq(users.id, h.ids.driverA));

const busRow = async () => (await h.db.select().from(buses).where(eq(buses.id, h.ids.busA)))[0];
const resetBus = () =>
  h.db.update(buses).set({ status: 'idle', currentLatitude: null, currentLongitude: null, speed: null }).where(eq(buses.id, h.ids.busA));

async function waitingCheckIn(routeId: string = h.ids.routeA): Promise<string> {
  const [row] = await h.db
    .insert(studentCheckIns)
    .values({ companyId: h.ids.companyA, studentId: h.ids.studentA, parentId: h.ids.parentA, routeId, status: 'waiting' })
    .returning({ id: studentCheckIns.id });
  return row.id;
}

beforeAll(async () => {
  // Preconditions: busA is driverA's bus, routeA their (seeded) shift route.
  expect((await busRow()).driverId).toBe(h.ids.driverA);
  expect((await h.db.select().from(users).where(eq(users.id, h.ids.driverA)))[0].assignedRouteId).toBe(h.ids.routeA);
  // A second company-A route that is NOT driverA's shift route.
  const [r2] = await h.db.insert(routes).values({ companyId: h.ids.companyA, name: 'Q125-Route2', schoolId: h.ids.schoolA }).returning({ id: routes.id });
  routeA2 = r2.id;

  // 2 logins (MAX_LOGINS_PER_FILE is 8).
  driverA = await h.loginAs('driverA');
  master = await h.loginAs('master');
});

describe('Q121b POST /api/driver/update-location', () => {
  const LOC = '/api/driver/update-location';
  const body = { latitude: 40.1234, longitude: -75.5678, speed: 20 };

  it('off duty with a stale assignedRouteId → 403 "Not on duty", bus location and status unchanged (red if the Q121 `if (!user.isOnDuty)` guard is removed from update-location)', async () => {
    await resetBus();
    await offDuty();
    const res = await driverA.post(LOC).send(body);
    expect(res.status).toBe(403);
    expect(res.body).toEqual({ message: 'Not on duty' });
    const bus = await busRow();
    expect(bus.currentLatitude).toBeNull();
    expect(bus.status).toBe('idle');
  });

  it('on duty → 200, location stored and the bus is on_route (positive control)', async () => {
    await resetBus();
    await onDuty();
    const res = await driverA.post(LOC).send(body);
    expect(res.status).toBe(200);
    const bus = await busRow();
    expect(Number(bus.currentLatitude)).toBeCloseTo(40.1234, 3);
    expect(bus.status).toBe('on_route');
  });
});

describe('Q129a update-location body: zod, 0 is a real coordinate, 400 not 500', () => {
  const LOC = '/api/driver/update-location';
  const REQUIRED = { message: 'Latitude and longitude are required' };

  it('on duty, latitude 0 / longitude 0 → 200 and 0,0 is stored (red if the old `!latitude || !longitude` check is restored)', async () => {
    await resetBus();
    await onDuty();
    const res = await driverA.post(LOC).send({ latitude: 0, longitude: 0, speed: 0 });
    expect(res.status).toBe(200);
    const bus = await busRow();
    expect(bus.currentLatitude).not.toBeNull();
    expect(Number(bus.currentLatitude)).toBe(0);
    expect(Number(bus.currentLongitude)).toBe(0);
  });

  it('on duty, a missing / null / string coordinate → 400 "Latitude and longitude are required", bus untouched (red if updateLocationBodySchema.safeParse is dropped: string coords were stored)', async () => {
    await resetBus();
    await onDuty();
    for (const body of [{}, { latitude: 40.1 }, { longitude: -75.1 }, { latitude: null, longitude: -75.1 }, { latitude: '40.1', longitude: '-75.1' }, { latitude: 40.1, longitude: -75.1, speed: 'fast' }]) {
      const res = await driverA.post(LOC).send(body);
      expect(res.status, JSON.stringify(body)).toBe(400);
      expect(res.body, JSON.stringify(body)).toEqual(REQUIRED);
    }
    const bus = await busRow();
    expect(bus.currentLatitude).toBeNull();
    expect(bus.status).toBe('idle');
  });

  it('off duty with a bad body → still 403 "Not on duty" (red if the body parse is moved before the Q121 `if (!user.isOnDuty)` guard)', async () => {
    await offDuty();
    const res = await driverA.post(LOC).send({});
    expect(res.status).toBe(403);
    expect(res.body).toEqual({ message: 'Not on duty' });
  });
});

describe('Q125b activate-route gated, deactivate-route deliberately not', () => {
  it('activate-route off duty → 403 "Not on duty", bus stays idle (red if the Q125 `if (!user.isOnDuty)` guard is removed from activate-route)', async () => {
    await resetBus();
    await offDuty();
    const res = await driverA.post('/api/driver/activate-route').send({});
    expect(res.status).toBe(403);
    expect(res.body).toEqual({ message: 'Not on duty' });
    expect((await busRow()).status).toBe('idle');
  });

  it('activate-route on duty → 200 and the bus is on_route (positive control)', async () => {
    await resetBus();
    await onDuty();
    const res = await driverA.post('/api/driver/activate-route').send({});
    expect(res.status).toBe(200);
    expect((await busRow()).status).toBe('on_route');
  });

  it('deactivate-route off duty → 200 and the bus goes idle (pins the Q125 decision: the safe direction stays ungated, the dashboard calls it after going off duty)', async () => {
    await h.db.update(buses).set({ status: 'on_route' }).where(eq(buses.id, h.ids.busA));
    await offDuty();
    const res = await driverA.post('/api/driver/deactivate-route').send({});
    expect(res.status).toBe(200);
    expect((await busRow()).status).toBe('idle');
  });
});

describe('Q123 driver reads off duty → []', () => {
  beforeAll(async () => {
    // Today's rows for driverA on routeA, written through the on-duty handlers.
    await onDuty();
    expect((await driverA.post('/api/student-attendance').send({ studentId: h.ids.studentA, status: 'present' })).status).toBe(200);
    expect((await driverA.post('/api/driver-school-arrival').send({ schoolId: h.ids.schoolA })).status).toBe(200);
  });

  it('GET driver-school-visits off duty with a stale assignedRouteId → [] (red if `!user.isOnDuty ||` is dropped from the driver-school-visits [] guard)', async () => {
    await offDuty();
    const res = await driverA.get('/api/driver-school-visits');
    expect(res.status).toBe(200);
    expect(res.body).toEqual([]);
  });

  it('GET driver-school-visits on duty → today\'s schoolA visit (positive control)', async () => {
    await onDuty();
    const res = await driverA.get('/api/driver-school-visits');
    expect(res.status).toBe(200);
    expect(res.body.map((v: { schoolId: string }) => v.schoolId)).toContain(h.ids.schoolA);
  });

  it('GET student-attendance (driver branch) off duty with a stale assignedRouteId → [] (red if `!user.isOnDuty ||` is dropped from the driver-branch [] guard)', async () => {
    await offDuty();
    const res = await driverA.get('/api/student-attendance');
    expect(res.status).toBe(200);
    expect(res.body).toEqual([]);
  });

  it('GET student-attendance (driver branch) on duty → today\'s studentA mark (positive control)', async () => {
    await onDuty();
    const res = await driverA.get('/api/student-attendance');
    expect(res.status).toBe(200);
    expect(res.body.map((a: { studentId: string }) => a.studentId)).toContain(h.ids.studentA);
  });
});

describe('Q125a GET /api/check-in/waiting/:routeId', () => {
  const NOT_FOUND = { message: 'Route not found' };
  let waitingId: string;
  let waitingA2Id: string;

  beforeAll(async () => {
    waitingId = await waitingCheckIn();
    waitingA2Id = await waitingCheckIn(routeA2);
  });
  afterAll(async () => {
    for (const id of [waitingId, waitingA2Id]) {
      if (id) await h.db.delete(studentCheckIns).where(eq(studentCheckIns.id, id));
    }
  });

  it('off duty, routeA (the stale shift route) → 404 "Route not found" (red if `!user.isOnDuty ||` is dropped from the Q125 waiting-list gate)', async () => {
    await offDuty();
    const res = await driverA.get(`/api/check-in/waiting/${h.ids.routeA}`);
    expect(res.status).toBe(404);
    expect(res.body).toEqual(NOT_FOUND);
  });

  it('on duty, a company-A route that is not the shift route (routeA2) → 404 "Route not found" (red if `routeId !== user.assignedRouteId` is dropped from the Q125 waiting-list gate)', async () => {
    await onDuty();
    const res = await driverA.get(`/api/check-in/waiting/${routeA2}`);
    expect(res.status).toBe(404);
    expect(res.body).toEqual(NOT_FOUND);
  });

  it('on duty, the shift route routeA → 200 with its waiting check-in (positive control)', async () => {
    await onDuty();
    const res = await driverA.get(`/api/check-in/waiting/${h.ids.routeA}`);
    expect(res.status).toBe(200);
    expect(res.body.map((c: { id: string }) => c.id)).toContain(waitingId);
  });
});

describe('Q125c zod bodies: invalid input is a 400, never a 500', () => {
  beforeAll(async () => {
    await onDuty();
  });
  afterAll(async () => {
    await offDuty();
  });

  it('student-attendance: missing fields / non-string studentId → 400 "Student ID and status are required"; a bad status → 400 "Status must be ..." (red if studentAttendanceBodySchema.safeParse is dropped: a numeric studentId reached the student lookup)', async () => {
    for (const body of [{}, { studentId: h.ids.studentA }, { status: 'present' }, { studentId: 12345, status: 'present' }]) {
      const res = await driverA.post('/api/student-attendance').send(body);
      expect(res.status).toBe(400);
      expect(res.body).toEqual({ message: 'Student ID and status are required' });
    }
    const bad = await driverA.post('/api/student-attendance').send({ studentId: h.ids.studentA, status: 'late' });
    expect(bad.status).toBe(400);
    expect(bad.body).toEqual({ message: "Status must be 'present' or 'absent'" });
  });

  it('confirm-dropoff: missing or non-string checkInId → 400 "Check-in ID is required" (red if confirmDropoffBodySchema.safeParse is dropped: a numeric checkInId reached the check-in lookup)', async () => {
    for (const body of [{}, { checkInId: '' }, { checkInId: 12345 }, { checkInId: { id: 'x' } }]) {
      const res = await driverA.post('/api/check-in/confirm-dropoff').send(body);
      expect(res.status).toBe(400);
      expect(res.body).toEqual({ message: 'Check-in ID is required' });
    }
  });
});

// Q125e: an impersonating master has master powers but no driver shift. Even
// with a stale assignedRouteId on routeA (the impersonated company's route),
// every hardened handler refuses with the same status an off-duty driver gets,
// and nothing is written.
describe('Q125e impersonating master admin hits the off-duty refusals', () => {
  beforeAll(async () => {
    const imp = await master.post(`/api/master-admin/impersonate/${h.ids.companyA}`).send({});
    expect(imp.status).toBe(200);
    const me = await master.get('/api/auth/user');
    expect(me.body).toMatchObject({ role: 'master_admin', companyId: h.ids.companyA, _masterAdminImpersonating: true });
    await h.db.update(users).set({ isOnDuty: false, assignedRouteId: h.ids.routeA }).where(eq(users.id, h.ids.master));
    await resetBus();
  });
  afterAll(async () => {
    await h.db.update(users).set({ isOnDuty: false, dutyStartTime: null, assignedRouteId: null }).where(eq(users.id, h.ids.master));
    await master.post('/api/master-admin/stop-impersonating').send({});
  });

  it('route reads, school visits and the waiting list → [] / 404 though routeA has students, stops, schools, a waiting check-in and the master has a visit today (red if `!user.isOnDuty ||` is dropped from any of those guards)', async () => {
    // This test seeds its own waiting check-in (it must pass when run alone
    // with -t, which skips the other describes' beforeAll).
    const waitingId = await waitingCheckIn();
    // Preconditions: every read would return a row if its duty term were gone.
    expect((await h.db.select().from(students).where(eq(students.routeId, h.ids.routeA))).length).toBeGreaterThan(0);
    expect((await h.db.select().from(routeStops).where(eq(routeStops.routeId, h.ids.routeA))).length).toBeGreaterThan(0);
    expect((await h.db.select().from(studentCheckIns).where(and(eq(studentCheckIns.id, waitingId), eq(studentCheckIns.routeId, h.ids.routeA), eq(studentCheckIns.status, 'waiting')))).length).toBe(1);
    // The base seed has no routeSchools link for routeA, so add one; and
    // getTodaysSchoolVisits keys on the caller's id, so seed the master's own visit today.
    const [link] = await h.db.insert(routeSchools).values({ routeId: h.ids.routeA, schoolId: h.ids.schoolA, order: 0 }).returning({ id: routeSchools.id });
    const [visit] = await h.db
      .insert(schoolVisits)
      .values({ companyId: h.ids.companyA, driverId: h.ids.master, schoolId: h.ids.schoolA, routeId: h.ids.routeA, arrivedAt: new Date(), visitDate: new Date() })
      .returning({ id: schoolVisits.id });
    try {
      for (const path of ['/api/driver-route-students', '/api/driver-route-stops', '/api/driver-route-schools', '/api/driver-school-visits']) {
        const res = await master.get(path);
        expect(res.status, path).toBe(200);
        expect(res.body, path).toEqual([]);
      }
      const waiting = await master.get(`/api/check-in/waiting/${h.ids.routeA}`);
      expect(waiting.status).toBe(404);
      expect(waiting.body).toEqual({ message: 'Route not found' });
    } finally {
      await h.db.delete(schoolVisits).where(eq(schoolVisits.id, visit.id));
      await h.db.delete(routeSchools).where(eq(routeSchools.id, link.id));
      await h.db.delete(studentCheckIns).where(eq(studentCheckIns.id, waitingId));
    }
  });

  it('update-location and activate-route → 403 "Not on duty" before the bus lookup (red if the Q121/Q125 `if (!user.isOnDuty)` guards are removed: the master, who drives no bus, then gets the no-bus 400/404); busA stays idle with no location', async () => {
    for (const path of ['/api/driver/update-location', '/api/driver/activate-route']) {
      const res = await master.post(path).send({ latitude: 40.1, longitude: -75.1 });
      expect(res.status, path).toBe(403);
      expect(res.body, path).toEqual({ message: 'Not on duty' });
    }
    const bus = await busRow();
    expect(bus.status).toBe('idle');
    expect(bus.currentLatitude).toBeNull();
    expect(bus.currentLongitude).toBeNull();
  });

  it('attendance, drop-off, stop completed and school arrival → the handlers\' own 400/404, nothing written (red if `!user.isOnDuty ||` is dropped from any Q114 write guard)', async () => {
    const marksBefore = (await h.db.select().from(studentAttendance).where(eq(studentAttendance.driverId, h.ids.master))).length;
    const mark = await master.post('/api/student-attendance').send({ studentId: h.ids.studentA, status: 'present' });
    expect(mark.status).toBe(400);
    expect(mark.body).toEqual({ message: 'No route assigned to driver' });
    const drop = await master.post('/api/driver/student-dropoff').send({ studentId: h.ids.studentA });
    expect(drop.status).toBe(404);
    expect(drop.body).toEqual({ message: 'Student not found' });
    const stop = await master.post('/api/driver/mark-stop-completed').send({ routeStopId: h.ids.stopA1, routeId: h.ids.routeA });
    expect(stop.status).toBe(404);
    expect(stop.body).toEqual({ message: 'Route not found' });
    const arrive = await master.post('/api/driver-school-arrival').send({ schoolId: h.ids.schoolA });
    expect(arrive.status).toBe(400);
    expect(arrive.body).toEqual({ message: 'No route assigned to driver' });

    expect((await h.db.select().from(studentAttendance).where(eq(studentAttendance.driverId, h.ids.master))).length).toBe(marksBefore);
    expect(await h.db.select().from(routeStopCompletions).where(eq(routeStopCompletions.driverId, h.ids.master))).toHaveLength(0);
    expect(await h.db.select().from(schoolVisits).where(eq(schoolVisits.driverId, h.ids.master))).toHaveLength(0);
  });

  it('confirm-boarded and confirm-dropoff → 404 "Check-in not found", check-ins unchanged, no parent notice (red if the isOnDuty term is dropped from either gate)', async () => {
    const boardId = await waitingCheckIn();
    const [dropRow] = await h.db
      .insert(studentCheckIns)
      .values({ companyId: h.ids.companyA, studentId: h.ids.studentA, parentId: h.ids.parentA, routeId: h.ids.routeA, status: 'boarded', driverId: h.ids.master, boardedAt: new Date() })
      .returning({ id: studentCheckIns.id });
    try {
      const noticesBefore = (await h.db.select().from(parentNotifications).where(eq(parentNotifications.createdById, h.ids.master))).length;

      const board = await master.post('/api/check-in/confirm-boarded').send({ checkInId: boardId, busId: h.ids.busA, routeId: h.ids.routeA });
      expect(board.status).toBe(404);
      expect(board.body).toEqual({ message: 'Check-in not found' });
      const drop = await master.post('/api/check-in/confirm-dropoff').send({ checkInId: dropRow.id });
      expect(drop.status).toBe(404);
      expect(drop.body).toEqual({ message: 'Check-in not found' });

      const rows = await h.db.select().from(studentCheckIns).where(and(eq(studentCheckIns.routeId, h.ids.routeA), eq(studentCheckIns.studentId, h.ids.studentA)));
      expect(rows.find((r) => r.id === boardId)?.status).toBe('waiting');
      expect(rows.find((r) => r.id === dropRow.id)?.status).toBe('boarded');
      expect((await h.db.select().from(parentNotifications).where(eq(parentNotifications.createdById, h.ids.master))).length).toBe(noticesBefore);
    } finally {
      await h.db.delete(studentCheckIns).where(eq(studentCheckIns.id, boardId));
      await h.db.delete(studentCheckIns).where(eq(studentCheckIns.id, dropRow.id));
    }
  });
});
