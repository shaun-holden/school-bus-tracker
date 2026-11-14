// T4b E4b (child on the bus) and E5 (child dropped off). Decision 1A: E4b
// pushes on each change to present (not present -> present), so present,
// present again = 1 push and present -> absent -> present = 2 pushes. E5 is
// the new POST /api/driver/student-dropoff: 404 for a child off the driver's
// route or in another company, 409 unless today's mark is present, and a
// second drop-off is a 200 with no second push (dropped_off_at IS NULL).
// pushService is mocked, so assertions read pushService.sendToUsers calls.
// Real HTTP + real Postgres. Each "no push" test sits next to a positive one.
import { describe, it, expect, beforeAll, beforeEach, vi } from 'vitest';
import { eq } from 'drizzle-orm';
import { routes, students, studentAttendance, systemNotifications } from '@shared/schema';
import { pushService } from '../../server/pushService';
import { useIntegrationHarness, type Agent } from './harness';
import { insertUser, SEED_PASSWORD } from './seed';

const h = useIntegrationHarness();
const DROP = '/api/driver/student-dropoff';
const MARK = '/api/student-attendance';

let driverA: Agent;
let parentA: Agent;
let otherRouteStudent: string;
let driverOnB: Agent;

const send = () => vi.mocked(pushService.sendToUsers);
const pushesOfType = (type: string) =>
  send().mock.calls.filter((c) => (c[1] as { data?: { type?: string } }).data?.type === type);
const noticesFor = async (title: string) =>
  (await h.db.select().from(systemNotifications).where(eq(systemNotifications.recipientId, h.ids.parentA))).filter((r) => r.title === title);

beforeAll(async () => {
  const [r2] = await h.db.insert(routes).values({ companyId: h.ids.companyA, name: 'A-Route2', schoolId: h.ids.schoolA }).returning({ id: routes.id });
  const [s] = await h.db
    .insert(students)
    .values({ companyId: h.ids.companyA, firstName: 'A-OtherRoute', lastName: 'Seed', parentId: h.ids.parentA, schoolId: h.ids.schoolA, routeId: r2.id })
    .returning({ id: students.id });
  otherRouteStudent = s.id;
  const [sb] = await h.db.select().from(students).where(eq(students.id, h.ids.studentB));
  expect(sb.companyId).toBe(h.ids.companyB);
  // A company-A driver wrongly assigned to company B's route (bad data):
  // only the route tenant check can stop it.
  await insertUser(
    { email: 't4b-driver-on-b@sbt.test', firstName: 'A-DriverOnB', lastName: 'Seed', role: 'driver', companyId: h.ids.companyA, assignedRouteId: h.ids.routeB },
    { password: true },
  );
  // 3 logins (MAX_LOGINS_PER_FILE is 8).
  const agent = h.anon();
  expect((await h.loginAttempt('t4b-driver-on-b@sbt.test', SEED_PASSWORD, agent)).status).toBe(200);
  driverOnB = agent;
  driverA = await h.loginAs('driverA');
  parentA = await h.loginAs('parentA');
});

beforeEach(async () => {
  await h.db.delete(studentAttendance);
  await h.db.delete(systemNotifications);
  send().mockClear();
});

describe('T4b E4b on the bus (decision 1A)', () => {
  it('present pushes "boarded" to the linked parent with an in-app notice; present again pushes nothing more (red if the previousStatus !== present guard is removed)', async () => {
    expect((await driverA.post(MARK).send({ studentId: h.ids.studentA, status: 'present' })).status).toBe(200);
    expect(pushesOfType('boarded')).toHaveLength(1);
    const [ids, payload] = pushesOfType('boarded')[0] as [string[], { body: string }];
    expect(ids).toEqual([h.ids.parentA]);
    expect(payload.body).toBe('A-Student is on the bus.');
    expect(await noticesFor('On the Bus')).toHaveLength(1);
    expect((await driverA.post(MARK).send({ studentId: h.ids.studentA, status: 'present' })).status).toBe(200);
    expect(pushesOfType('boarded')).toHaveLength(1);
    expect(await noticesFor('On the Bus')).toHaveLength(1);
  });

  it('present -> absent -> present gives 2 pushes, by design (1A)', async () => {
    for (const status of ['present', 'absent', 'present']) {
      expect((await driverA.post(MARK).send({ studentId: h.ids.studentA, status })).status).toBe(200);
    }
    expect(pushesOfType('boarded')).toHaveLength(2);
  });

  it('marking absent pushes nothing', async () => {
    expect((await driverA.post(MARK).send({ studentId: h.ids.studentA, status: 'absent' })).status).toBe(200);
    expect(send()).not.toHaveBeenCalled();
  });
});

describe('T4b E5 drop-off endpoint', () => {
  it('present today, then drop-off → 200, dropped_off_at set, "dropped_off" push and in-app notice; a second drop-off → 200, no second push (red if dropped_off_at IS NULL is removed)', async () => {
    await driverA.post(MARK).send({ studentId: h.ids.studentA, status: 'present' });
    send().mockClear();
    const res = await driverA.post(DROP).send({ studentId: h.ids.studentA });
    expect(res.status).toBe(200);
    const [row] = await h.db.select().from(studentAttendance).where(eq(studentAttendance.studentId, h.ids.studentA));
    expect(row.droppedOffAt).not.toBeNull();
    expect(row.status).toBe('present');
    expect(pushesOfType('dropped_off')).toHaveLength(1);
    expect((pushesOfType('dropped_off')[0][1] as { body: string }).body).toBe('A-Student has been dropped off.');
    expect(await noticesFor('Dropped Off')).toHaveLength(1);
    const again = await driverA.post(DROP).send({ studentId: h.ids.studentA });
    expect(again.status).toBe(200);
    expect(pushesOfType('dropped_off')).toHaveLength(1);
    expect(await noticesFor('Dropped Off')).toHaveLength(1);
  });

  it('a child on another route of the same company → 404 "Student not found", no push (red if the assignedRouteId check is removed)', async () => {
    const res = await driverA.post(DROP).send({ studentId: otherRouteStudent });
    expect(res.status).toBe(404);
    expect(res.body).toEqual({ message: 'Student not found' });
    expect(send()).not.toHaveBeenCalled();
  });

  it('company B\'s child → 404 with the same body as a missing id, no push', async () => {
    const missing = await driverA.post(DROP).send({ studentId: 'no-such-student' });
    const foreign = await driverA.post(DROP).send({ studentId: h.ids.studentB });
    expect(missing.status).toBe(404);
    expect(foreign.status).toBe(404);
    expect(foreign.body).toEqual(missing.body);
    expect(send()).not.toHaveBeenCalled();
  });

  it('a company-A driver assigned (bad data) to company B\'s route, dropping off B\'s child on it → 404 (red if isOutsideCallerTenant(user, route.companyId) is removed)', async () => {
    const res = await driverOnB.post(DROP).send({ studentId: h.ids.studentB });
    expect(res.status).toBe(404);
    expect(res.body).toEqual({ message: 'Student not found' });
    expect(send()).not.toHaveBeenCalled();
  });

  it('marked absent today → 409, no push (red if the status = present check is removed)', async () => {
    await driverA.post(MARK).send({ studentId: h.ids.studentA, status: 'absent' });
    const res = await driverA.post(DROP).send({ studentId: h.ids.studentA });
    expect(res.status).toBe(409);
    expect(send()).not.toHaveBeenCalled();
  });

  it('no mark today → 409, no push', async () => {
    const res = await driverA.post(DROP).send({ studentId: h.ids.studentA });
    expect(res.status).toBe(409);
    expect(send()).not.toHaveBeenCalled();
  });

  it('a bad body → 400; a parent → 403', async () => {
    expect((await driverA.post(DROP).send({})).status).toBe(400);
    expect((await driverA.post(DROP).send({ studentId: h.ids.studentA, extra: 1 })).status).toBe(400);
    expect((await parentA.post(DROP).send({ studentId: h.ids.studentA })).status).toBe(403);
  });
});
