// HF2 tenant guards (SEC-1..5, 11, 12, 14, 15, 17, 20), reached over real
// HTTP against a real Postgres. Each title names the route string and the
// guard clause whose deletion turns the test red. The foreign row is always
// seeded in company B, so the query would find it without the guard. Where a
// guard must refuse a write, the DB is re-read directly. Line numbers are
// deliberately not cited.
//
// Describes run in order and share one seeded DB: refusals are asserted before
// the positive check-ins, and the driver_admin self-role test runs last.
import { describe, it, expect, beforeAll, beforeEach } from 'vitest';
import crypto from 'crypto';
import { and, eq } from 'drizzle-orm';
import {
  users,
  routes,
  routeStops,
  students,
  buses,
  busJourneys,
  linkCodes,
  driverInvitations,
} from '@shared/schema';
import { sendDriverInvitationEmail } from '../../server/emailService';
import { useIntegrationHarness, type Agent } from './harness';

const h = useIntegrationHarness();
let adminA: Agent;
let driverA: Agent;
let driverAdminA: Agent;
let parentA: Agent;
let parentNull: Agent;
let master: Agent;

beforeAll(async () => {
  // 6 logins (MAX_LOGINS_PER_FILE is 8).
  adminA = await h.loginAs('adminA');
  driverA = await h.loginAs('driverA');
  driverAdminA = await h.loginAs('driverAdminA');
  parentA = await h.loginAs('parentA');
  parentNull = await h.loginAs('parentNull');
  master = await h.loginAs('master');
});

const getUser = async (id: string) => (await h.db.select().from(users).where(eq(users.id, id)))[0];
const getRoute = async (id: string) => (await h.db.select().from(routes).where(eq(routes.id, id)))[0];
const getBus = async (id: string) => (await h.db.select().from(buses).where(eq(buses.id, id)))[0];
const getStudent = async (id: string) => (await h.db.select().from(students).where(eq(students.id, id)))[0];

describe('SEC-1 PATCH /api/drivers/:id', () => {
  it('body companyId/isActive/assignedRouteId (B route) are stripped and driverA keeps company A, isActive and routeA (red if the updateDriverProfileSchema `.pick({...})` allow-list is reverted to an .omit() deny-list)', async () => {
    const res = await adminA.patch(`/api/drivers/${h.ids.driverA}`).send({
      phone: '5555550101',
      companyId: h.ids.companyB,
      isActive: false,
      assignedRouteId: h.ids.routeB,
    });
    expect(res.status).toBe(200);
    const row = await getUser(h.ids.driverA);
    expect(row.phone).toBe('5555550101');
    expect(row.companyId).toBe(h.ids.companyA);
    expect(row.isActive).toBe(true);
    expect(row.assignedRouteId).toBe(h.ids.routeA);
  });

  it("adminA patching company B's driverB gets 404 and driverB is unchanged (red if `if (!isMasterAdminUser(user) && targetDriver.companyId !== user.companyId)` 404 is removed)", async () => {
    const res = await adminA.patch(`/api/drivers/${h.ids.driverB}`).send({ phone: '5555550199' });
    expect(res.status).toBe(404);
    expect(res.body).toEqual({ message: 'Driver not found' });
    const row = await getUser(h.ids.driverB);
    expect(row.phone).not.toBe('5555550199');
  });

  it("adminA patching its own company's parentA gets 404 (red if `if (targetDriver.role !== 'driver' && targetDriver.role !== 'driver_admin')` 404 is removed)", async () => {
    const res = await adminA.patch(`/api/drivers/${h.ids.parentA}`).send({ phone: '5555550188' });
    expect(res.status).toBe(404);
    expect(res.body).toEqual({ message: 'Driver not found' });
    const row = await getUser(h.ids.parentA);
    expect(row.phone).not.toBe('5555550188');
  });
});

describe('SEC-2 PUT /api/driver/profile', () => {
  it('driverA sending companyId/role/isActive/assignedRouteId changes none of them (red if the updateDriverProfileSchema `.pick({...})` allow-list is reverted to an .omit() deny-list)', async () => {
    const res = await driverA.put('/api/driver/profile').send({
      firstName: 'A-Driver',
      companyId: h.ids.companyB,
      role: 'admin',
      isActive: false,
      assignedRouteId: h.ids.routeB,
    });
    expect(res.status).toBe(200);
    const row = await getUser(h.ids.driverA);
    expect(row.firstName).toBe('A-Driver');
    expect(row.companyId).toBe(h.ids.companyA);
    expect(row.role).toBe('driver');
    expect(row.isActive).toBe(true);
    expect(row.assignedRouteId).toBe(h.ids.routeA);
  });
});

describe('SEC-3 PATCH /api/users/:id/role', () => {
  it("adminA changing company B's driverB2 gets 404 and the role is unchanged (red if `if (!callerIsMaster && (!requestingUser.companyId || existingUser.companyId !== requestingUser.companyId))` 404 is removed)", async () => {
    const res = await adminA.patch(`/api/users/${h.ids.driverB2}/role`).send({ role: 'parent' });
    expect(res.status).toBe(404);
    expect(res.body).toEqual({ message: 'User not found' });
    expect((await getUser(h.ids.driverB2)).role).toBe('driver');
  });

  it("adminA targeting the company-less master gets 404, not the master_admin 403 (red if `if (!callerIsMaster && (!requestingUser.companyId || existingUser.companyId !== requestingUser.companyId))` 404 is removed)", async () => {
    const res = await adminA.patch(`/api/users/${h.ids.master}/role`).send({ role: 'parent' });
    expect(res.status).toBe(404);
    expect(res.body).toEqual({ message: 'User not found' });
    expect((await getUser(h.ids.master)).role).toBe('master_admin');
  });

  it("adminA cannot grant master_admin to driverA2: 400 Invalid role (red if `!['parent', 'driver', 'admin', 'driver_admin'].includes(role)` admits master_admin)", async () => {
    const res = await adminA.patch(`/api/users/${h.ids.driverA2}/role`).send({ role: 'master_admin' });
    expect(res.status).toBe(400);
    expect(res.body).toEqual({ message: 'Invalid role' });
    expect((await getUser(h.ids.driverA2)).role).toBe('driver');
  });

  it('adminA changing its own role stays allowed (200) (red if the self-change rule `existingUser.id === requestingUser.id && !callerIsFullAdmin` drops the `!callerIsFullAdmin` exemption)', async () => {
    const res = await adminA.patch(`/api/users/${h.ids.adminA}/role`).send({ role: 'admin' });
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ id: h.ids.adminA, role: 'admin' });
    expect((await getUser(h.ids.adminA)).role).toBe('admin');
  });
});

describe('SEC-4 POST /api/driver-check-in', () => {
  const body = (driverId: string, routeId: string, busId: string) => ({
    driverId, routeId, busId, fuelLevel: 'Full', interiorClean: true, exteriorClean: true,
  });

  const expectNoCheckInWritten = async () => {
    const dA = await getUser(h.ids.driverA);
    const dB = await getUser(h.ids.driverB);
    expect(dA.isOnDuty).toBe(false);
    expect(dA.lastCheckInTime).toBeNull();
    expect(dA.assignedRouteId).toBe(h.ids.routeA);
    expect(dB.isOnDuty).toBe(false);
    expect(dB.lastCheckInTime).toBeNull();
    expect(dB.assignedRouteId).toBe(h.ids.routeB);
    expect((await getRoute(h.ids.routeA)).driverId).toBe(h.ids.driverA);
    expect((await getRoute(h.ids.routeB)).driverId).toBe(h.ids.driverB);
    const bA = await getBus(h.ids.busA);
    const bB = await getBus(h.ids.busB);
    expect(bA.driverId).toBe(h.ids.driverA);
    expect(bA.fuelLevel).toBeNull();
    expect(bB.driverId).toBe(h.ids.driverB);
    expect(bB.fuelLevel).toBeNull();
    expect(bB.status).not.toBe('on_route');
    expect(await h.db.select().from(busJourneys)).toHaveLength(0);
  };

  it("driver_adminA checking in company B's driverB on B's route and bus gets 404 and nothing is written (red if the non-master `selectedDriver.companyId !== user.companyId || checkInRoute.companyId !== user.companyId || checkInBus.companyId !== user.companyId` 404 is removed)", async () => {
    const res = await driverAdminA.post('/api/driver-check-in').send(body(h.ids.driverB, h.ids.routeB, h.ids.busB));
    expect(res.status).toBe(404);
    expect(res.body).toEqual({ message: 'Not found' });
    await expectNoCheckInWritten();
  });

  it("driver_adminA checking in driverA with B's route gets 404 and nothing is written (red if both the non-master `checkInRoute.companyId !== user.companyId` 404 and the every-caller same-company 404 `selectedDriver.companyId !== checkInRoute.companyId || checkInRoute.companyId !== checkInBus.companyId` are removed; either one alone still refuses it)", async () => {
    const res = await driverAdminA.post('/api/driver-check-in').send(body(h.ids.driverA, h.ids.routeB, h.ids.busA));
    expect(res.status).toBe(404);
    expect(res.body).toEqual({ message: 'Not found' });
    await expectNoCheckInWritten();
  });

  it("driver_adminA checking in driverA with B's bus gets 404 and nothing is written (red if both the non-master `checkInBus.companyId !== user.companyId` 404 and the every-caller same-company 404 `checkInRoute.companyId !== checkInBus.companyId` are removed; either one alone still refuses it)", async () => {
    const res = await driverAdminA.post('/api/driver-check-in').send(body(h.ids.driverA, h.ids.routeA, h.ids.busB));
    expect(res.status).toBe(404);
    expect(res.body).toEqual({ message: 'Not found' });
    await expectNoCheckInWritten();
  });

  it("master checking in driverA with B's route and bus gets 404 and nothing is written (red if the every-caller `selectedDriver.companyId !== checkInRoute.companyId || checkInRoute.companyId !== checkInBus.companyId` 404 is removed)", async () => {
    const res = await master.post('/api/driver-check-in').send(body(h.ids.driverA, h.ids.routeB, h.ids.busB));
    expect(res.status).toBe(404);
    expect(res.body).toEqual({ message: 'Not found' });
    await expectNoCheckInWritten();
  });

  it('plain driverA checking in coworker driverA2 gets 403 and driverA2 is not checked in (red if `if (!isSelf && !isSameCompanyDriverAdmin && !isMasterAdminUser(user))` 403 is removed)', async () => {
    const res = await driverA.post('/api/driver-check-in').send(body(h.ids.driverA2, h.ids.routeA, h.ids.busA));
    expect(res.status).toBe(403);
    expect(res.body).toEqual({ message: 'You can only check yourself in' });
    const dA2 = await getUser(h.ids.driverA2);
    expect(dA2.isOnDuty).toBe(false);
    expect(dA2.lastCheckInTime).toBeNull();
    await expectNoCheckInWritten();
  });

  it('driverA checking in itself on routeA + busA is OK and the response is trimmed (positive control for `isSelf`)', async () => {
    const res = await driverA.post('/api/driver-check-in').send(body(h.ids.driverA, h.ids.routeA, h.ids.busA));
    expect(res.status).toBe(200);
    expect(Object.keys(res.body).sort()).toEqual(['assignedRouteId', 'firstName', 'id', 'isOnDuty', 'lastName']);
    expect(res.body).toMatchObject({ id: h.ids.driverA, assignedRouteId: h.ids.routeA, isOnDuty: true });
    const dA = await getUser(h.ids.driverA);
    expect(dA.isOnDuty).toBe(true);
    expect(dA.lastCheckInTime).not.toBeNull();
  });

  it('driver_adminA checking in same-company driverA is OK (red if `isSameCompanyDriverAdmin` stops admitting a same-company driver_admin)', async () => {
    await h.db.update(users).set({ lastCheckInFuelLevel: null }).where(eq(users.id, h.ids.driverA));
    const res = await driverAdminA.post('/api/driver-check-in').send({ ...body(h.ids.driverA, h.ids.routeA, h.ids.busA), fuelLevel: '3/4' });
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ id: h.ids.driverA, isOnDuty: true });
    expect((await getUser(h.ids.driverA)).lastCheckInFuelLevel).toBe('3/4');
    // Company B untouched throughout.
    expect((await getBus(h.ids.busB)).driverId).toBe(h.ids.driverB);
    expect((await getRoute(h.ids.routeB)).driverId).toBe(h.ids.driverB);
  });
});

describe('SEC-5 POST /api/students/:studentId/regenerate-code', () => {
  it("adminA on studentB gets 404 and B's code is not revoked or replaced (red if `|| isOutsideCallerTenant(user, student.companyId)` is removed from regenerate-code)", async () => {
    const res = await adminA.post(`/api/students/${h.ids.studentB}/regenerate-code`).send({});
    expect(res.status).toBe(404);
    expect(res.body).toEqual({ message: 'Student not found' });
    const codes = await h.db.select().from(linkCodes).where(eq(linkCodes.studentId, h.ids.studentB));
    expect(codes).toHaveLength(1);
    expect(codes[0]).toMatchObject({ id: h.ids.linkCodeB, status: 'active' });
  });

  it('on studentA the new link code row has companyId A (red if regenerate-code stops passing `student.companyId` to storage.regenerateLinkCode)', async () => {
    const res = await adminA.post(`/api/students/${h.ids.studentA}/regenerate-code`).send({});
    expect(res.status).toBe(200);
    expect(res.body.companyId).toBe(h.ids.companyA);
    const [row] = await h.db.select().from(linkCodes).where(eq(linkCodes.id, res.body.id));
    expect(row).toMatchObject({ studentId: h.ids.studentA, companyId: h.ids.companyA, status: 'active' });
    const [old] = await h.db.select().from(linkCodes).where(eq(linkCodes.id, h.ids.linkCodeA));
    expect(old.status).toBe('revoked');
  });
});

describe('SEC-11 GET /api/students/:studentId/link-codes', () => {
  it("adminA on studentB gets 404 with no B code in the body (red if `|| isOutsideCallerTenant(user, student.companyId)` is removed from GET link-codes)", async () => {
    const res = await adminA.get(`/api/students/${h.ids.studentB}/link-codes`);
    expect(res.status).toBe(404);
    expect(res.body).toEqual({ message: 'Student not found' });
    expect(JSON.stringify(res.body)).not.toMatch(/B-LINK/);
  });

  it("positive control: adminA lists studentA's codes", async () => {
    const res = await adminA.get(`/api/students/${h.ids.studentA}/link-codes`);
    expect(res.status).toBe(200);
    expect(res.body.map((c: { id: string }) => c.id)).toContain(h.ids.linkCodeA);
    expect(res.body.every((c: { studentId: string }) => c.studentId === h.ids.studentA)).toBe(true);
  });
});

describe('SEC-12 GET /api/students/:studentId/linked-parents', () => {
  it("adminA on studentB gets 404 with no B parent in the body (red if `|| isOutsideCallerTenant(user, student.companyId)` is removed from GET linked-parents)", async () => {
    const res = await adminA.get(`/api/students/${h.ids.studentB}/linked-parents`);
    expect(res.status).toBe(404);
    expect(res.body).toEqual({ message: 'Student not found' });
    expect(JSON.stringify(res.body)).not.toMatch(/B-Parent|parent-b@/);
  });

  it('on studentA each parent has exactly id, firstName, lastName, email (red if storage getLinkedParentsByStudentId stops projecting `{ id, firstName, lastName, email }`)', async () => {
    const res = await adminA.get(`/api/students/${h.ids.studentA}/linked-parents`);
    expect(res.status).toBe(200);
    expect(res.body).toEqual([
      { id: h.ids.parentA, firstName: 'A-Parent', lastName: 'Seed', email: 'parent-a@sbt.test' },
    ]);
    for (const p of res.body) {
      expect(Object.keys(p).sort()).toEqual(['email', 'firstName', 'id', 'lastName']);
    }
  });
});

describe('SEC-14 POST /api/routes + PATCH /api/routes/:id', () => {
  it("POST with company B's driverId gets 404 and no route is written (red if POST `hasId(validatedData.driverId) && !(await isDriverInCompany(...))` 404 is removed)", async () => {
    const res = await adminA.post('/api/routes').send({ name: 'A-Route-ForeignDriver', driverId: h.ids.driverB });
    expect(res.status).toBe(404);
    expect(res.body).toEqual({ message: 'Driver not found' });
    expect(await h.db.select().from(routes).where(eq(routes.name, 'A-Route-ForeignDriver'))).toHaveLength(0);
  });

  it("POST with company B's schoolId gets 404 and no route or stop is written (red if POST `hasId(validatedData.schoolId) && !(await isSchoolInCompany(...))` 404 is removed)", async () => {
    const res = await adminA.post('/api/routes').send({ name: 'A-Route-ForeignSchool', schoolId: h.ids.schoolB });
    expect(res.status).toBe(404);
    expect(res.body).toEqual({ message: 'School not found' });
    expect(await h.db.select().from(routes).where(eq(routes.name, 'A-Route-ForeignSchool'))).toHaveLength(0);
    const bStops = await h.db.select().from(routeStops).where(eq(routeStops.schoolId, h.ids.schoolB));
    expect(bStops.every((s) => s.routeId === h.ids.routeB)).toBe(true);
  });

  it('POST positive control: own driverA2 + schoolA is created in company A', async () => {
    const res = await adminA.post('/api/routes').send({
      name: 'A-Route-Own', driverId: h.ids.driverA2, schoolId: h.ids.schoolA, companyId: h.ids.companyB,
    });
    expect(res.status).toBe(200);
    const row = await getRoute(res.body.id);
    expect(row).toMatchObject({ companyId: h.ids.companyA, driverId: h.ids.driverA2, schoolId: h.ids.schoolA });
  });

  it("PATCH routeA with company B's driverId gets 404 and routeA is unchanged (red if PATCH `hasId(validatedData.driverId) && !(await isDriverInCompany(validatedData.driverId, existingRoute.companyId))` 404 is removed)", async () => {
    const res = await adminA.patch(`/api/routes/${h.ids.routeA}`).send({ driverId: h.ids.driverB });
    expect(res.status).toBe(404);
    expect(res.body).toEqual({ message: 'Driver not found' });
    expect((await getRoute(h.ids.routeA)).driverId).toBe(h.ids.driverA);
  });

  it("PATCH routeA with company B's schoolId gets 404, routeA keeps schoolA and gets no B stop (red if PATCH `hasId(validatedData.schoolId) && !(await isSchoolInCompany(validatedData.schoolId, existingRoute.companyId))` 404 is removed)", async () => {
    const res = await adminA.patch(`/api/routes/${h.ids.routeA}`).send({ schoolId: h.ids.schoolB });
    expect(res.status).toBe(404);
    expect(res.body).toEqual({ message: 'School not found' });
    expect((await getRoute(h.ids.routeA)).schoolId).toBe(h.ids.schoolA);
    const stops = await h.db.select().from(routeStops).where(eq(routeStops.routeId, h.ids.routeA));
    expect(stops.some((s) => s.schoolId === h.ids.schoolB)).toBe(false);
    expect(stops.map((s) => s.id).sort()).toEqual([h.ids.stopA1, h.ids.stopA2].sort());
  });

  it('PATCH routeA with a body companyId keeps company A (red if updateRouteSchema drops `.omit({ companyId: true })`)', async () => {
    const res = await adminA.patch(`/api/routes/${h.ids.routeA}`).send({ description: 'A-desc', companyId: h.ids.companyB });
    expect(res.status).toBe(200);
    const row = await getRoute(h.ids.routeA);
    expect(row.description).toBe('A-desc');
    expect(row.companyId).toBe(h.ids.companyA);
  });
});

describe('SEC-15 POST /api/students + GET /api/parent/children-buses', () => {
  it("adminA creating a student for parentA with company B's routeId gets 404 and no student is written (red if POST /api/students drops the `checkStudentForeignKeys(validatedData.companyId, ...)` 404)", async () => {
    const res = await adminA.post('/api/students').send({
      firstName: 'A-Smuggled', lastName: 'Seed', parentId: h.ids.parentA, routeId: h.ids.routeB,
    });
    expect(res.status).toBe(404);
    expect(res.body).toEqual({ message: 'Route not found' });
    expect(await h.db.select().from(students).where(eq(students.firstName, 'A-Smuggled'))).toHaveLength(0);
  });

  it("parentA's children-buses never contains B's bus or GPS (red if POST /api/students drops the `checkStudentForeignKeys(validatedData.companyId, ...)` 404)", async () => {
    const [bB] = await h.db.select().from(buses).where(eq(buses.id, h.ids.busB));
    const res = await parentA.get('/api/parent/children-buses');
    expect(res.status).toBe(200);
    const text = JSON.stringify(res.body);
    expect(text).not.toContain(h.ids.busB);
    expect(text).not.toContain('B-100');
    expect(text).not.toContain(String(bB.currentLatitude));
    // Positive control: parentA does see busA for studentA.
    const busIds = res.body.map((c: { bus: { id: string } | null }) => c.bus?.id);
    expect(busIds).toContain(h.ids.busA);
  });
});

describe('SEC-15 PUT /api/students/:id', () => {
  it('a body companyId is ignored: studentA stays in company A (red if `validatedData.companyId = existingStudent.companyId` is removed from PUT /api/students/:id)', async () => {
    const res = await adminA.put(`/api/students/${h.ids.studentA}`).send({ grade: '5', companyId: h.ids.companyB });
    expect(res.status).toBe(200);
    const row = await getStudent(h.ids.studentA);
    expect(row.grade).toBe('5');
    expect(row.companyId).toBe(h.ids.companyA);
  });

  it("company B's routeId gets 404 and studentA keeps routeA (red if PUT /api/students/:id drops the `checkStudentForeignKeys(existingStudent.companyId, ...)` 404)", async () => {
    const res = await adminA.put(`/api/students/${h.ids.studentA}`).send({ routeId: h.ids.routeB });
    expect(res.status).toBe(404);
    expect(res.body).toEqual({ message: 'Route not found' });
    expect((await getStudent(h.ids.studentA)).routeId).toBe(h.ids.routeA);
  });

  it("company B's schoolId gets 404 and studentA keeps schoolA (red if PUT /api/students/:id drops the `checkStudentForeignKeys(existingStudent.companyId, ...)` 404)", async () => {
    const res = await adminA.put(`/api/students/${h.ids.studentA}`).send({ schoolId: h.ids.schoolB });
    expect(res.status).toBe(404);
    expect(res.body).toEqual({ message: 'School not found' });
    expect((await getStudent(h.ids.studentA)).schoolId).toBe(h.ids.schoolA);
  });

  it('adminA on studentB gets 404 and studentB is unchanged (red if the admin-path `if (!isMasterAdminUser(user) && existingStudent.companyId !== user.companyId)` 404 is removed from PUT /api/students/:id)', async () => {
    const res = await adminA.put(`/api/students/${h.ids.studentB}`).send({ grade: '9' });
    expect(res.status).toBe(404);
    expect(res.body).toEqual({ message: 'Student not found' });
    const row = await getStudent(h.ids.studentB);
    expect(row.grade).not.toBe('9');
    expect(row.companyId).toBe(h.ids.companyB);
  });
});

describe('SEC-17 GET /api/students/:id (admin path)', () => {
  it("adminA on studentB gets 404 with no B student in the body (red if the admin-path `else if (!isMasterAdminUser(user) && student.companyId !== user.companyId)` 404 is removed from GET /api/students/:id)", async () => {
    const res = await adminA.get(`/api/students/${h.ids.studentB}`);
    expect(res.status).toBe(404);
    expect(res.body).toEqual({ message: 'Student not found' });
    expect(JSON.stringify(res.body)).not.toMatch(/B-Student/);
  });

  it('positive control: adminA gets studentA', async () => {
    const res = await adminA.get(`/api/students/${h.ids.studentA}`);
    expect(res.status).toBe(200);
    expect(res.body.id).toBe(h.ids.studentA);
  });
});

describe('SEC-20 GET /api/parent-notifications', () => {
  it("the company-less parentNull gets [] and never B's global notice (red if storage getNotificationsForParent drops the `if (!parentCompanyId)` branch and falls back to `sql`1=1``)", async () => {
    const res = await parentNull.get('/api/parent-notifications');
    expect(res.status).toBe(200);
    expect(res.body).toEqual([]);
  });

  it("positive control: parentA sees A's global notice and not B's", async () => {
    const res = await parentA.get('/api/parent-notifications');
    expect(res.status).toBe(200);
    const got = res.body.map((n: { id: string }) => n.id);
    expect(got).toContain(h.ids.noticeA);
    expect(got).not.toContain(h.ids.noticeB);
  });
});

describe('Invitation token: POST /api/drivers/:id/send-invitation stores only the hash', () => {
  beforeEach(() => {
    vi.mocked(sendDriverInvitationEmail).mockClear();
  });

  it('the emailed 64-hex token hashes (sha256) to the stored tokenHash and the raw token is never stored (red if createDriverInvitation is passed `token` instead of `tokenHash`)', async () => {
    const res = await adminA.post(`/api/drivers/${h.ids.driverA2}/send-invitation`).send({});
    expect(res.status).toBe(200);
    expect(sendDriverInvitationEmail).toHaveBeenCalledTimes(1);
    const url = String(vi.mocked(sendDriverInvitationEmail).mock.calls[0][3]);
    const m = url.match(/[?&]token=([0-9a-f]{64})$/);
    expect(m, url).not.toBeNull();
    const token = m![1];

    const rows = await h.db.select().from(driverInvitations).where(eq(driverInvitations.driverId, h.ids.driverA2));
    expect(rows).toHaveLength(1);
    expect(rows[0].tokenHash).toBe(crypto.createHash('sha256').update(token).digest('hex'));
    expect(rows[0].tokenHash).not.toBe(token);
    expect(JSON.stringify(rows[0])).not.toContain(token);

    // The raw token works only through the hash lookup.
    const verify = await h.anon().get('/api/driver-invitation/verify').query({ token });
    expect(verify.status).toBe(200);
    const byRaw = await h.db.select().from(driverInvitations).where(and(
      eq(driverInvitations.driverId, h.ids.driverA2), eq(driverInvitations.tokenHash, token),
    ));
    expect(byRaw).toHaveLength(0);
  });
});

describe('SEC-3 PATCH /api/users/:id/role (driver_admin self change, runs last)', () => {
  it('driver_adminA changing its own role gets 400 and stays driver_admin (red if `if (existingUser.id === requestingUser.id && !callerIsFullAdmin)` 400 is removed)', async () => {
    const res = await driverAdminA.patch(`/api/users/${h.ids.driverAdminA}/role`).send({ role: 'driver' });
    expect(res.status).toBe(400);
    expect(res.body).toEqual({ message: 'You cannot change your own role' });
    expect((await getUser(h.ids.driverAdminA)).role).toBe('driver_admin');
  });
});
