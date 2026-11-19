// Q91: a driver who clocks off keeps their route assignments (routes.driverId),
// so their parent messaging contacts stay. DeShaun's decisions (2026-11-19):
// a route is a standing assignment that only an admin or another check-in
// changes, and a driver may hold more than one route. The current shift route
// (users.assignedRouteId) is still cleared, so off-duty drivers can't act on
// the route (attendance, stops), and the bus is still unassigned.
// Real HTTP + real Postgres; the route, its linked parent and a second
// admin-assigned route are seeded and asserted to exist (checklist X-1/X-2).
//
// Each title names the clause whose change turns it red.
import { describe, it, expect, beforeAll } from 'vitest';
import { and, eq } from 'drizzle-orm';
import { buses, parentChildLinks, parentNotifications, routes, studentCheckIns, students, systemNotifications, users } from '@shared/schema';
import { useIntegrationHarness, type Agent } from './harness';

const h = useIntegrationHarness();
const DUTY = '/api/driver/duty-status';

let driverA: Agent;
let secondRouteId: string;

const routeRow = async (id: string) => (await h.db.select().from(routes).where(eq(routes.id, id)))[0];
const userRow = async (id: string) => (await h.db.select().from(users).where(eq(users.id, id)))[0];
const contactIds = (body: Array<{ id: string }>) => body.map((c) => c.id);

beforeAll(async () => {
  // A second route the admin gave driverA as well (e.g. an afternoon run).
  const [r2] = await h.db
    .insert(routes)
    .values({ companyId: h.ids.companyA, name: 'Q91-Second-Route', driverId: h.ids.driverA, schoolId: h.ids.schoolA, busNumber: 'Q91-200' })
    .returning({ id: routes.id });
  secondRouteId = r2.id;

  // Preconditions: routeA is driverA's (both sides), and parentA reaches it via studentA.
  expect((await routeRow(h.ids.routeA)).driverId).toBe(h.ids.driverA);
  expect((await routeRow(secondRouteId)).driverId).toBe(h.ids.driverA);
  expect((await userRow(h.ids.driverA)).assignedRouteId).toBe(h.ids.routeA);
  const [student] = await h.db.select().from(students).where(eq(students.id, h.ids.studentA));
  expect(student.routeId).toBe(h.ids.routeA);
  const links = await h.db.select().from(parentChildLinks).where(eq(parentChildLinks.studentId, h.ids.studentA));
  expect(links.map((l) => l.parentId)).toContain(h.ids.parentA);
  const [bus] = await h.db.select().from(buses).where(eq(buses.id, h.ids.busA));
  expect(bus.driverId).toBe(h.ids.driverA);

  await h.db.update(users).set({ isOnDuty: false, dutyStartTime: null }).where(eq(users.id, h.ids.driverA));
  // 1 login (MAX_LOGINS_PER_FILE is 8).
  driverA = await h.loginAs('driverA');

  const contactsBefore = await driverA.get('/api/messages/contacts');
  expect(contactsBefore.status).toBe(200);
  expect(contactIds(contactsBefore.body)).toContain(h.ids.parentA);

  // On duty, then off duty: the off-transition runs the "reset on log-off" block.
  expect((await driverA.patch(DUTY).send({ isOnDuty: true })).status).toBe(200);
  const off = await driverA.patch(DUTY).send({ isOnDuty: false });
  expect(off.status).toBe(200);
  expect(off.body.isOnDuty).toBe(false);
});

describe('Q91 clock-off keeps the driver on their routes', () => {
  it('routeA.driverId is still driverA after clocking off (red if the duty-status off-reset calls storage.unassignDriverFromRoute again)', async () => {
    expect((await routeRow(h.ids.routeA)).driverId).toBe(h.ids.driverA);
  });

  it('a second admin-assigned route also keeps driverA (red if the off-reset unassigns routes; a driver may hold two routes)', async () => {
    expect((await routeRow(secondRouteId)).driverId).toBe(h.ids.driverA);
  });

  it("the off-duty driver's GET /api/messages/contacts still lists routeA's parent (red if the off-reset unassigns routes, which empties getParentsForDriver)", async () => {
    const res = await driverA.get('/api/messages/contacts');
    expect(res.status).toBe(200);
    expect(contactIds(res.body)).toContain(h.ids.parentA);
  });
});

describe('Q91 clock-off still ends the shift', () => {
  it('users.assignedRouteId is null after clocking off (red if `assignedRouteId: null` is removed from the off-reset resetData)', async () => {
    const row = await userRow(h.ids.driverA);
    expect(row.assignedRouteId).toBeNull();
    expect(row.isOnDuty).toBe(false);
    expect(row.lastCheckInTime).toBeNull();
  });

  it('GET /api/driver-route-students → [] while off duty (red if the shift route survives clock-off: route actions read assignedRouteId)', async () => {
    const res = await driverA.get('/api/driver-route-students');
    expect(res.status).toBe(200);
    expect(res.body).toEqual([]);
  });

  it('busA is unassigned from driverA (red if the off-reset stops calling storage.unassignDriverFromBus)', async () => {
    const [bus] = await h.db.select().from(buses).where(eq(buses.id, h.ids.busA));
    expect(bus.driverId).toBeNull();
  });
});

// Q91 r2 (reader-check-q91, Q91-2): the two handlers that authorized on
// routes.driverId now authorize on the active shift route (assignedRouteId).
// Runs after the clock-off above: driverA still holds routeA via routes.driverId
// but has assignedRouteId null.
const BOARDED = '/api/check-in/confirm-boarded';
const NOTICE = '/api/driver/system-notifications';
const R2_CLAUSE = '`!user.assignedRouteId || routeId !== user.assignedRouteId` 404 in POST /api/check-in/confirm-boarded';
const R2_NOTICE_CLAUSE = '`storedRouteId === user.assignedRouteId` in POST /api/driver/system-notifications';

async function waitingCheckIn(routeId: string = h.ids.routeA): Promise<string> {
  const [row] = await h.db
    .insert(studentCheckIns)
    .values({ companyId: h.ids.companyA, studentId: h.ids.studentA, parentId: h.ids.parentA, routeId, status: 'waiting' })
    .returning({ id: studentCheckIns.id });
  return row.id;
}
const checkInRow = async (id: string) => (await h.db.select().from(studentCheckIns).where(eq(studentCheckIns.id, id)))[0];
const boardedNotices = async () =>
  h.db.select().from(parentNotifications).where(and(eq(parentNotifications.targetParentId, h.ids.parentA), eq(parentNotifications.title, 'Child Boarded Bus')));
const driverNotices = async () =>
  h.db.select().from(systemNotifications).where(and(eq(systemNotifications.senderId, h.ids.driverA), eq(systemNotifications.recipientRole, 'route_parents')));
const notice = (routeId: string) => ({ title: 'Q91 r2 notice', message: 'Running late', type: 'info', routeId });

describe('Q91 r2 off duty: a route the driver still holds is not their shift route', () => {
  it(`confirm-boarded on routeA → 404, check-in still waiting, no "boarded" parent notice (red if ${R2_CLAUSE} reverts to getRoutesByDriverId)`, async () => {
    expect((await routeRow(h.ids.routeA)).driverId).toBe(h.ids.driverA);
    expect((await userRow(h.ids.driverA)).assignedRouteId).toBeNull();
    const id = await waitingCheckIn();
    const before = (await boardedNotices()).length;
    const res = await driverA.post(BOARDED).send({ checkInId: id, busId: h.ids.busA, routeId: h.ids.routeA });
    expect(res.status).toBe(404);
    expect(res.body).toEqual({ message: 'Check-in not found' });
    const row = await checkInRow(id);
    expect(row.status).toBe('waiting');
    expect(row.boardedAt).toBeNull();
    expect((await boardedNotices()).length).toBe(before);
  });

  it(`route-parents notice with routeId routeA → 404 and nothing stored (red if ${R2_NOTICE_CLAUSE} is replaced by the getRoutesByDriverId fallback)`, async () => {
    const before = (await driverNotices()).length;
    const res = await driverA.post(NOTICE).send(notice(h.ids.routeA));
    expect(res.status).toBe(404);
    expect(res.body).toEqual({ message: 'Route not found' });
    expect((await driverNotices()).length).toBe(before);
  });
});

describe('Q91 r2 on duty: the active shift route still works', () => {
  beforeAll(async () => {
    // As POST /api/driver-check-in leaves it: on duty with routeA as the shift route.
    await h.db.update(users).set({ isOnDuty: true, dutyStartTime: new Date(), assignedRouteId: h.ids.routeA }).where(eq(users.id, h.ids.driverA));
  });

  it(`confirm-boarded on the shift route routeA → 200 and a "boarded" parent notice (positive control for ${R2_CLAUSE})`, async () => {
    const id = await waitingCheckIn();
    const before = (await boardedNotices()).length;
    const res = await driverA.post(BOARDED).send({ checkInId: id, busId: h.ids.busA, routeId: h.ids.routeA });
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ id, status: 'boarded', driverId: h.ids.driverA });
    expect((await boardedNotices()).length).toBe(before + 1);
  });

  it(`confirm-boarded on the held second route (not the shift route) → 404 (red if ${R2_CLAUSE} reverts to getRoutesByDriverId)`, async () => {
    const res = await driverA.post(BOARDED).send({ checkInId: await waitingCheckIn(secondRouteId), busId: h.ids.busA, routeId: secondRouteId });
    expect(res.status).toBe(404);
    expect(res.body).toEqual({ message: 'Check-in not found' });
  });

  it(`route-parents notice for the shift route routeA → 200, stored on routeA (positive control for ${R2_NOTICE_CLAUSE})`, async () => {
    const res = await driverA.post(NOTICE).send(notice(h.ids.routeA));
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ routeId: h.ids.routeA, recipientRole: 'route_parents', senderId: h.ids.driverA });
  });

  it(`route-parents notice for the held second route → 404 (red if ${R2_NOTICE_CLAUSE} is replaced by the getRoutesByDriverId fallback)`, async () => {
    const before = (await driverNotices()).length;
    const res = await driverA.post(NOTICE).send(notice(secondRouteId));
    expect(res.status).toBe(404);
    expect((await driverNotices()).length).toBe(before);
  });
});
