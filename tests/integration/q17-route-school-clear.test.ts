// Q17a / Q17c over real HTTP against a real Postgres. Rows the tests need
// are seeded inline here (the shared seed is not changed). Each title names
// the clause whose deletion turns it red.
import { describe, it, expect, beforeAll } from 'vitest';
import { eq } from 'drizzle-orm';
import { users, routes, routeStops, schools } from '@shared/schema';
import { useIntegrationHarness, type Agent } from './harness';

const h = useIntegrationHarness();
let adminA: Agent;
let routeId: string;
let schoolId: string;

beforeAll(async () => {
  adminA = await h.loginAs('adminA');

  // A company-A route that has a school and the school's stop.
  const [school] = await h.db
    .insert(schools)
    .values({ companyId: h.ids.companyA, name: 'Q17 School', address: '1 Test St' })
    .returning();
  schoolId = school.id;
  const [route] = await h.db
    .insert(routes)
    .values({ companyId: h.ids.companyA, name: 'Q17 Route', schoolId, driverId: h.ids.driverA2 })
    .returning();
  routeId = route.id;
  await h.db.insert(routeStops).values({
    routeId,
    schoolId,
    name: school.name,
    address: school.address,
    order: 1,
  });

  // driverA2 starts with its emergency contact filled in.
  await h.db
    .update(users)
    .set({ emergencyContactName: 'Q17 Contact', emergencyContactPhone: '5555550177' })
    .where(eq(users.id, h.ids.driverA2));
});

const getRoute = async (id: string) => (await h.db.select().from(routes).where(eq(routes.id, id)))[0];
const getUser = async (id: string) => (await h.db.select().from(users).where(eq(users.id, id)))[0];

describe('Q17c PATCH /api/routes/:id with schoolId ""', () => {
  it("clears the school (null), not a 500, and removes the old school stop (red if the preprocess('' → null) on updateRouteSchema.schoolId is removed)", async () => {
    const res = await adminA.patch(`/api/routes/${routeId}`).send({ schoolId: '' });
    expect(res.status).toBe(200);
    const row = await getRoute(routeId);
    expect(row.schoolId).toBeNull();
    const stops = await h.db.select().from(routeStops).where(eq(routeStops.routeId, routeId));
    expect(stops.filter((s) => s.schoolId === schoolId)).toHaveLength(0);
  });

  it("driverId \"\" clears the driver (null), not a 500 (red if the preprocess('' → null) on updateRouteSchema.driverId is removed)", async () => {
    const res = await adminA.patch(`/api/routes/${routeId}`).send({ driverId: '' });
    expect(res.status).toBe(200);
    const row = await getRoute(routeId);
    expect(row.driverId).toBeNull();
  });
});

describe('Q17a PATCH /api/drivers/:id with blank emergency fields', () => {
  it("blank emergency fields save (200) and are cleared to null (red if the preprocess('' → null) on emergencyContactName/emergencyContactPhone is removed)", async () => {
    const res = await adminA
      .patch(`/api/drivers/${h.ids.driverA2}`)
      .send({ emergencyContactName: '', emergencyContactPhone: '' });
    expect(res.status).toBe(200);
    const row = await getUser(h.ids.driverA2);
    expect(row.emergencyContactName).toBeNull();
    expect(row.emergencyContactPhone).toBeNull();
  });

  it('a too-short emergency phone is still a 400 and the row is unchanged (red if .min(10) on emergencyContactPhone is removed)', async () => {
    const res = await adminA.patch(`/api/drivers/${h.ids.driverA2}`).send({ emergencyContactPhone: '555' });
    expect(res.status).toBe(400);
    const row = await getUser(h.ids.driverA2);
    expect(row.emergencyContactPhone).toBeNull();
  });
});
