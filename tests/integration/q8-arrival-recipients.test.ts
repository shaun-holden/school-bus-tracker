// Q8 Parts A2 + A5: POST /api/driver-school-arrival writes "Bus Arrived at
// School" only for parents whose child rides THAT route in THAT company, and
// refuses a schoolId that is not on the driver's route / in the route's
// company. Real HTTP + real Postgres. Each title names the clause whose
// deletion turns it red; the foreign rows (seedQ8Extras) are reachable.
import { describe, it, expect, beforeAll } from 'vitest';
import { and, eq } from 'drizzle-orm';
import { systemNotifications, schoolVisits, routeSchools } from '@shared/schema';
import { useIntegrationHarness, type Agent } from './harness';
import { seedQ8Extras, Q8_EMAILS, SEED_PASSWORD, type Q8Ids } from './seed';

const h = useIntegrationHarness();
const TITLE = 'Bus Arrived at School';

let q8: Q8Ids;
let driverA: Agent;
let driverX: Agent;
let parentA: Agent;
let parentA3: Agent;

async function login(email: string): Promise<Agent> {
  const agent = h.anon();
  const res = await h.loginAttempt(email, SEED_PASSWORD, agent);
  expect(res.status).toBe(200);
  return agent;
}

const arrivalRows = () =>
  h.db.select().from(systemNotifications).where(eq(systemNotifications.title, TITLE));

const visitsFor = (driverId: string, schoolId: string) =>
  h.db.select().from(schoolVisits).where(and(eq(schoolVisits.driverId, driverId), eq(schoolVisits.schoolId, schoolId)));

beforeAll(async () => {
  q8 = await seedQ8Extras(h.ids);
  // 4 logins (MAX_LOGINS_PER_FILE is 8).
  driverA = await h.loginAs('driverA');
  driverX = await login(Q8_EMAILS.driverX);
  parentA = await h.loginAs('parentA');
  parentA3 = await login(Q8_EMAILS.parentA3);
});

describe('Q8 A2 refusals (nothing written)', () => {
  it('a company-B schoolId gives 404 and no visit row', async () => {
    const res = await driverA.post('/api/driver-school-arrival').send({ schoolId: h.ids.schoolB });
    expect(res.status).toBe(404);
    expect(await visitsFor(h.ids.driverA, h.ids.schoolB)).toHaveLength(0);
    expect(await arrivalRows()).toHaveLength(0);
  });

  it('a company-A school that is on no stop / routeSchools / routes.schoolId of routeA gives 404 and no visit (red if the school-on-route check is deleted)', async () => {
    const res = await driverA.post('/api/driver-school-arrival').send({ schoolId: q8.schoolA3 });
    expect(res.status).toBe(404);
    expect(await visitsFor(h.ids.driverA, q8.schoolA3)).toHaveLength(0);
    expect(await arrivalRows()).toHaveLength(0);
  });

  it('company B\'s school wrongly listed in routeA\'s routeSchools still gives 404 and no visit (red if isSchoolInCompany(schoolId, route.companyId) is deleted)', async () => {
    const [bad] = await h.db.insert(routeSchools).values({ routeId: h.ids.routeA, schoolId: h.ids.schoolB, order: 9 }).returning({ id: routeSchools.id });
    try {
      const res = await driverA.post('/api/driver-school-arrival').send({ schoolId: h.ids.schoolB });
      expect(res.status).toBe(404);
      expect(await visitsFor(h.ids.driverA, h.ids.schoolB)).toHaveLength(0);
      expect(await arrivalRows()).toHaveLength(0);
    } finally {
      await h.db.delete(routeSchools).where(eq(routeSchools.id, bad.id));
    }
  });

  it('a company-A driver whose assignedRouteId is company B\'s route gives 404 at B\'s own school, no visit and no B notices (red if the isOutsideCallerTenant(user, route.companyId) check is deleted)', async () => {
    const res = await driverX.post('/api/driver-school-arrival').send({ schoolId: h.ids.schoolB });
    expect(res.status).toBe(404);
    expect(await visitsFor(q8.driverX, h.ids.schoolB)).toHaveLength(0);
    expect(await arrivalRows()).toHaveLength(0);
  });

  it('a missing or empty schoolId gives 400 (local Zod body schema)', async () => {
    expect((await driverA.post('/api/driver-school-arrival').send({})).status).toBe(400);
    expect((await driverA.post('/api/driver-school-arrival').send({ schoolId: '' })).status).toBe(400);
    expect((await driverA.post('/api/driver-school-arrival').send({ schoolId: 42 })).status).toBe(400);
  });
});

describe('Q8 A2 + A5 recipients of an arrival at schoolA on routeA', () => {
  beforeAll(async () => {
    const res = await driverA.post('/api/driver-school-arrival').send({ schoolId: h.ids.schoolA });
    expect(res.status).toBe(200);
    expect(res.body.companyId).toBe(h.ids.companyA);
  });

  it('writes exactly the right (parent, student) rows, all with companyId A', async () => {
    const rows = await arrivalRows();
    const pairs = rows.map((r) => `${r.recipientId}|${r.message}`).sort();
    expect(pairs).toEqual(
      [
        `${h.ids.parentA}|The bus has arrived at A-School for A-Student`,
        `${h.ids.parentNull}|The bus has arrived at A-School for A-Student`,
      ].sort(),
    );
    expect(rows.every((r) => r.companyId === h.ids.companyA && r.recipientRole === 'parent')).toBe(true);
  });

  it('parentA is both students.parentId and a linked parent of studentA and gets 1 row, not 2 (red if the (parent, student) dedupe is removed)', async () => {
    const rows = (await arrivalRows()).filter((r) => r.recipientId === h.ids.parentA);
    expect(rows).toHaveLength(1);
  });

  it('parentA3, whose child rides routeA2 to the same school, gets 0 rows in the DB and 0 in GET /api/system-notifications (red if the students.routeId = routeId filter is removed)', async () => {
    expect((await arrivalRows()).filter((r) => r.recipientId === q8.parentA3)).toHaveLength(0);
    const res = await parentA3.get('/api/system-notifications');
    expect(res.status).toBe(200);
    expect(res.body.filter((n: { title: string }) => n.title === TITLE)).toHaveLength(0);
  });

  it('parentA sees exactly 1 arrival notice in GET /api/system-notifications', async () => {
    const res = await parentA.get('/api/system-notifications');
    expect(res.body.filter((n: { title: string }) => n.title === TITLE)).toHaveLength(1);
  });

  it('company-B parentB gets 0 rows for B-StudentX (a company-B student on routeA/schoolA) or A-Student4 (linked by mistake) (red if users.companyId = companyId is dropped from the link query)', async () => {
    expect((await arrivalRows()).filter((r) => r.recipientId === h.ids.parentB)).toHaveLength(0);
  });

  it('null-company parentNull gets a row for A-Student but none for B-StudentX (red if students.companyId = companyId is removed)', async () => {
    const rows = (await arrivalRows()).filter((r) => r.recipientId === h.ids.parentNull);
    expect(rows.map((r) => r.message)).toEqual(['The bus has arrived at A-School for A-Student']);
  });

  it('adminA, the students.parentId of A-Student4, gets 0 rows (red if users.role = \'parent\' is dropped from the shortcut query)', async () => {
    expect((await arrivalRows()).filter((r) => r.recipientId === h.ids.adminA)).toHaveLength(0);
  });
});

describe('Q8 A2 positive: routeSchools-only school', () => {
  it('a school linked to routeA only through routeSchools gives 200 and a visit row stamped with company A', async () => {
    const res = await driverA.post('/api/driver-school-arrival').send({ schoolId: q8.schoolA2 });
    expect(res.status).toBe(200);
    const visits = await visitsFor(h.ids.driverA, q8.schoolA2);
    expect(visits).toHaveLength(1);
    expect(visits[0].companyId).toBe(h.ids.companyA);
    expect(visits[0].routeId).toBe(h.ids.routeA);
  });
});
