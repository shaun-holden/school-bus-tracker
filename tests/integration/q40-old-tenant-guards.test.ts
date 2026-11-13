// Q40: the 17 handlers that used `!isUnscopedMaster(user) && record.companyId
// !== user.companyId` now use isOutsideCallerTenant, so a no-company caller
// can't reach a no-company record (null === null used to pass). For every
// handler: (1) a no-company admin (a no-company driver for the driver-only
// route) against a no-company record → 404 with the existing not-found body
// — red if that handler's old guard comes back; (2) company A against a
// company-B record → 404, as before (regression). Plus the new
// POST /api/routes/:routeId/stops schoolId check (step 2). Real HTTP + real
// Postgres; the no-company rows are seeded so each guard is reachable.
import { describe, it, expect, beforeAll } from 'vitest';
import { and, eq } from 'drizzle-orm';
import { users, buses, routes, routeStops, schools, students, routeSchools } from '@shared/schema';
import { useIntegrationHarness, type Agent } from './harness';
import { insertUser, SEED_PASSWORD } from './seed';

const h = useIntegrationHarness();
const DRIVER_NULL_EMAIL = 'q40-driver-null@sbt.test';

let adminNull: Agent;
let adminA: Agent;
let driverNull: Agent;
let driverA: Agent;

const N = {} as { driver: string; bus: string; route: string; stop: string; school: string; student: string };

async function login(email: string): Promise<Agent> {
  const agent = h.anon();
  const res = await h.loginAttempt(email, SEED_PASSWORD, agent);
  expect(res.status).toBe(200);
  return agent;
}

beforeAll(async () => {
  N.driver = await insertUser(
    { email: DRIVER_NULL_EMAIL, firstName: 'Null-Driver', lastName: 'Seed', role: 'driver', companyId: null },
    { password: true },
  );
  const [bus] = await h.db.insert(buses).values({ companyId: null, busNumber: 'Null-300', make: 'Null-Make' }).returning({ id: buses.id });
  N.bus = bus.id;
  const [school] = await h.db.insert(schools).values({ companyId: null, name: 'Null-School', address: 'Null-1 Rd' }).returning({ id: schools.id });
  N.school = school.id;
  const [route] = await h.db.insert(routes).values({ companyId: null, name: 'Null-Route', schoolId: N.school, driverId: N.driver }).returning({ id: routes.id });
  N.route = route.id;
  await h.db.insert(routeSchools).values({ routeId: N.route, schoolId: N.school, order: 0 });
  const [stop] = await h.db.insert(routeStops).values({ routeId: N.route, name: 'Null-Stop', address: 'Null-2 Rd', order: 1 }).returning({ id: routeStops.id });
  N.stop = stop.id;
  const [student] = await h.db
    .insert(students)
    .values({ companyId: null, firstName: 'Null-Student', lastName: 'Seed', parentId: h.ids.adminNull, routeId: N.route, schoolId: N.school })
    .returning({ id: students.id });
  N.student = student.id;

  // 4 logins (MAX_LOGINS_PER_FILE is 8).
  adminNull = await h.loginAs('adminNull');
  adminA = await h.loginAs('adminA');
  driverNull = await login(DRIVER_NULL_EMAIL);
  driverA = await h.loginAs('driverA');
});

type Case = {
  name: string;
  body: { message: string };
  nullCall: () => Promise<{ status: number; body: unknown }>;
  foreignCall: () => Promise<{ status: number; body: unknown }>;
  untouched?: () => Promise<void>;
};

const cases = (): Case[] => [
  // ---- rest: admin requests, link codes
  {
    name: 'POST /api/admin-requests (driverId)',
    body: { message: 'Driver not found' },
    nullCall: () => adminNull.post('/api/admin-requests').send({ title: 'Q40', description: 'x', priority: 'low', driverId: N.driver }),
    foreignCall: () => adminA.post('/api/admin-requests').send({ title: 'Q40', description: 'x', priority: 'low', driverId: h.ids.driverB }),
  },
  {
    name: 'POST /api/link-codes (studentId)',
    body: { message: 'Student not found' },
    nullCall: () => adminNull.post('/api/link-codes').send({ studentId: N.student }),
    foreignCall: () => adminA.post('/api/link-codes').send({ studentId: h.ids.studentB }),
  },
  // ---- buses
  {
    name: 'PATCH /api/buses/:id',
    body: { message: 'Bus not found' },
    nullCall: () => adminNull.patch(`/api/buses/${N.bus}`).send({ make: 'Q40-Changed' }),
    foreignCall: () => adminA.patch(`/api/buses/${h.ids.busB}`).send({ make: 'Q40-Changed' }),
    untouched: async () => {
      expect((await h.db.select().from(buses).where(eq(buses.id, N.bus)))[0].make).toBe('Null-Make');
    },
  },
  {
    name: 'PUT /api/buses/:busId/location',
    body: { message: 'Bus not found' },
    nullCall: () => adminNull.put(`/api/buses/${N.bus}/location`).send({ latitude: 1, longitude: 1 }),
    foreignCall: () => adminA.put(`/api/buses/${h.ids.busB}/location`).send({ latitude: 1, longitude: 1 }),
  },
  {
    name: 'DELETE /api/buses/:id',
    body: { message: 'Bus not found' },
    nullCall: () => adminNull.delete(`/api/buses/${N.bus}`),
    foreignCall: () => adminA.delete(`/api/buses/${h.ids.busB}`),
    untouched: async () => {
      expect(await h.db.select().from(buses).where(eq(buses.id, N.bus))).toHaveLength(1);
    },
  },
  // ---- routes and stops
  {
    name: 'PATCH /api/routes/:id',
    body: { message: 'Route not found' },
    nullCall: () => adminNull.patch(`/api/routes/${N.route}`).send({ name: 'Q40-Changed' }),
    foreignCall: () => adminA.patch(`/api/routes/${h.ids.routeB}`).send({ name: 'Q40-Changed' }),
    untouched: async () => {
      expect((await h.db.select().from(routes).where(eq(routes.id, N.route)))[0].name).toBe('Null-Route');
    },
  },
  {
    name: 'POST /api/routes/:routeId/stops',
    body: { message: 'Route not found' },
    nullCall: () => adminNull.post(`/api/routes/${N.route}/stops`).send({ name: 'Q40 stop', address: 'Q40 Rd', order: 9 }),
    foreignCall: () => adminA.post(`/api/routes/${h.ids.routeB}/stops`).send({ name: 'Q40 stop', address: 'Q40 Rd', order: 9 }),
    untouched: async () => {
      expect(await h.db.select().from(routeStops).where(eq(routeStops.routeId, N.route))).toHaveLength(1);
    },
  },
  {
    name: 'GET /api/routes/:routeId/stops',
    body: { message: 'Route not found' },
    nullCall: () => adminNull.get(`/api/routes/${N.route}/stops`),
    foreignCall: () => adminA.get(`/api/routes/${h.ids.routeB}/stops`),
  },
  {
    name: 'DELETE /api/routes/:routeId/schools/:schoolId',
    body: { message: 'Route not found' },
    nullCall: () => adminNull.delete(`/api/routes/${N.route}/schools/${N.school}`),
    foreignCall: () => adminA.delete(`/api/routes/${h.ids.routeB}/schools/${h.ids.schoolB}`),
    untouched: async () => {
      const rows = await h.db.select().from(routeSchools).where(and(eq(routeSchools.routeId, N.route), eq(routeSchools.schoolId, N.school)));
      expect(rows).toHaveLength(1);
    },
  },
  {
    name: 'GET /api/attendance/route/:routeId',
    body: { message: 'Route not found' },
    nullCall: () => adminNull.get(`/api/attendance/route/${N.route}`),
    foreignCall: () => adminA.get(`/api/attendance/route/${h.ids.routeB}`),
  },
  {
    name: 'GET /api/routes/:routeId/completed-stops',
    body: { message: 'Route not found' },
    nullCall: () => adminNull.get(`/api/routes/${N.route}/completed-stops`),
    foreignCall: () => adminA.get(`/api/routes/${h.ids.routeB}/completed-stops`),
  },
  {
    name: 'GET /api/check-in/waiting/:routeId (driver)',
    body: { message: 'Route not found' },
    nullCall: () => driverNull.get(`/api/check-in/waiting/${N.route}`),
    foreignCall: () => driverA.get(`/api/check-in/waiting/${h.ids.routeB}`),
  },
  // ---- schools
  {
    name: 'PATCH /api/schools/:id',
    body: { message: 'School not found' },
    nullCall: () => adminNull.patch(`/api/schools/${N.school}`).send({ name: 'Q40-Changed' }),
    foreignCall: () => adminA.patch(`/api/schools/${h.ids.schoolB}`).send({ name: 'Q40-Changed' }),
    untouched: async () => {
      expect((await h.db.select().from(schools).where(eq(schools.id, N.school)))[0].name).toBe('Null-School');
    },
  },
  // ---- students
  {
    name: 'GET /api/students/:id',
    body: { message: 'Student not found' },
    nullCall: () => adminNull.get(`/api/students/${N.student}`),
    foreignCall: () => adminA.get(`/api/students/${h.ids.studentB}`),
  },
  {
    name: 'PUT /api/students/:id',
    body: { message: 'Student not found' },
    nullCall: () => adminNull.put(`/api/students/${N.student}`).send({ firstName: 'Q40-Changed' }),
    foreignCall: () => adminA.put(`/api/students/${h.ids.studentB}`).send({ firstName: 'Q40-Changed' }),
    untouched: async () => {
      expect((await h.db.select().from(students).where(eq(students.id, N.student)))[0].firstName).toBe('Null-Student');
    },
  },
  // Deletes last, so the rows above stay reachable for every earlier case.
  {
    name: 'DELETE /api/students/:id',
    body: { message: 'Student not found' },
    nullCall: () => adminNull.delete(`/api/students/${N.student}`),
    foreignCall: () => adminA.delete(`/api/students/${h.ids.studentB}`),
    untouched: async () => {
      expect(await h.db.select().from(students).where(eq(students.id, N.student))).toHaveLength(1);
    },
  },
  {
    name: 'DELETE /api/schools/:id',
    body: { message: 'School not found' },
    nullCall: () => adminNull.delete(`/api/schools/${N.school}`),
    foreignCall: () => adminA.delete(`/api/schools/${h.ids.schoolB}`),
    untouched: async () => {
      expect(await h.db.select().from(schools).where(eq(schools.id, N.school))).toHaveLength(1);
    },
  },
];

describe('Q40 no-company caller vs no-company record → 404 (red if that handler\'s old !isUnscopedMaster && !== guard comes back)', () => {
  for (const c of cases()) {
    it(`${c.name}: 404 ${JSON.stringify(c.body)}, nothing changed`, async () => {
      const res = await c.nullCall();
      expect(res.status).toBe(404);
      expect(res.body).toEqual(c.body);
      if (c.untouched) await c.untouched();
    });
  }
});

describe('Q40 company A caller vs company-B record → 404 (regression)', () => {
  for (const c of cases()) {
    it(`${c.name}: 404 ${JSON.stringify(c.body)}`, async () => {
      const res = await c.foreignCall();
      expect(res.status).toBe(404);
      expect(res.body).toEqual(c.body);
    });
  }
});

describe('Q40 step 2: POST /api/routes/:routeId/stops checks the body schoolId', () => {
  it('adminA adding a stop on routeA with company B\'s schoolId → 404 "School not found" and no stop (red if isSchoolInCompany(schoolId, route.companyId) is removed)', async () => {
    const before = (await h.db.select().from(routeStops).where(eq(routeStops.routeId, h.ids.routeA))).length;
    const res = await adminA.post(`/api/routes/${h.ids.routeA}/stops`).send({ name: 'Q40 B school stop', address: 'Q40 Rd', order: 9, schoolId: h.ids.schoolB });
    expect(res.status).toBe(404);
    expect(res.body).toEqual({ message: 'School not found' });
    expect((await h.db.select().from(routeStops).where(eq(routeStops.routeId, h.ids.routeA))).length).toBe(before);
  });

  it('adminA adding a stop on routeA with its own schoolA still works', async () => {
    const res = await adminA.post(`/api/routes/${h.ids.routeA}/stops`).send({ name: 'Q40 A school stop', address: 'Q40 Rd', order: 9, schoolId: h.ids.schoolA });
    expect([200, 201]).toContain(res.status);
  });
});

// Keep the users import used (role check on the seeded no-company driver).
describe('Q40 seed sanity', () => {
  it('the no-company driver really has no company', async () => {
    expect((await h.db.select().from(users).where(eq(users.id, N.driver)))[0].companyId).toBeNull();
  });
});
