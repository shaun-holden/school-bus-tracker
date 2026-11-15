// Q70 (T-1): GET /api/routes/:routeId/schools and
// PUT /api/routes/:routeId/schools/reorder get the record-by-id tenant check
// (getCaller + isOutsideCallerTenant → 404 "Route not found"). An unscoped
// master keeps both; an impersonating master is scoped to the school it views.
// The reorder body is validated (400) and pre-checked against the route's
// links before reorderRouteSchool (which renumbers first): not on the route →
// 404, already at the top/bottom → 409. Real HTTP + real Postgres.
import { describe, it, expect, beforeAll, beforeEach } from 'vitest';
import { asc, eq } from 'drizzle-orm';
import { routeSchools, schools } from '@shared/schema';
import { useIntegrationHarness, type Agent } from './harness';

const h = useIntegrationHarness();

let adminA: Agent;
let adminB: Agent;
let master: Agent;
let schoolA2: string;
let schoolB2: string;
const SCHOOL_B2_NAME = 'Q70-B-School2';

const orders = async (routeId: string) =>
  (await h.db.select().from(routeSchools).where(eq(routeSchools.routeId, routeId)).orderBy(asc(routeSchools.order)))
    .map((r) => ({ schoolId: r.schoolId, order: r.order }));

const reorder = (agent: Agent, routeId: string, body: unknown) =>
  agent.put(`/api/routes/${routeId}/schools/reorder`).send(body as object);

async function asImpersonatingA<T>(fn: () => Promise<T>): Promise<T> {
  expect((await master.post(`/api/master-admin/impersonate/${h.ids.companyA}`).send({})).status).toBe(200);
  try {
    return await fn();
  } finally {
    await master.post('/api/master-admin/stop-impersonating').send({});
  }
}

beforeAll(async () => {
  const [a2] = await h.db.insert(schools).values({ companyId: h.ids.companyA, name: 'Q70-A-School2', address: 'A-70 School Rd' }).returning({ id: schools.id });
  const [b2] = await h.db.insert(schools).values({ companyId: h.ids.companyB, name: SCHOOL_B2_NAME, address: 'B-70 School Rd' }).returning({ id: schools.id });
  schoolA2 = a2.id;
  schoolB2 = b2.id;
  // 3 logins (MAX_LOGINS_PER_FILE is 8).
  adminA = await h.loginAs('adminA');
  adminB = await h.loginAs('adminB');
  master = await h.loginAs('master');
});

// A successful reorder renumbers 0/5 → 0/1, so every test starts fresh.
beforeEach(async () => {
  await h.db.delete(routeSchools);
  await h.db.insert(routeSchools).values([
    { routeId: h.ids.routeB, schoolId: h.ids.schoolB, order: 0 },
    { routeId: h.ids.routeB, schoolId: schoolB2, order: 5 },
    { routeId: h.ids.routeA, schoolId: h.ids.schoolA, order: 0 },
    { routeId: h.ids.routeA, schoolId: schoolA2, order: 1 },
  ]);
});

const B_UNTOUCHED = () => [
  { schoolId: h.ids.schoolB, order: 0 },
  { schoolId: schoolB2, order: 5 },
];

describe('Q70 cross-tenant → 404', () => {
  it('1. adminA GET /api/routes/{routeB}/schools → 404 "Route not found", no company-B school name in the body (red if the GET route check is removed)', async () => {
    const res = await adminA.get(`/api/routes/${h.ids.routeB}/schools`);
    expect(res.status).toBe(404);
    expect(res.body).toEqual({ message: 'Route not found' });
    expect(JSON.stringify(res.body)).not.toContain(SCHOOL_B2_NAME);
  });

  it('2. adminA PUT /api/routes/{routeB}/schools/reorder → 404 and routeB\'s orders stay 0/5, so the renumber never ran (red if the PUT route check is removed)', async () => {
    const res = await reorder(adminA, h.ids.routeB, { schoolId: schoolB2, direction: 'up' });
    expect(res.status).toBe(404);
    expect(res.body).toEqual({ message: 'Route not found' });
    expect(await orders(h.ids.routeB)).toEqual(B_UNTOUCHED());
  });

  it('a master impersonating A → 404 on routeB for GET and PUT, routeB untouched', async () => {
    await asImpersonatingA(async () => {
      expect((await master.get(`/api/routes/${h.ids.routeB}/schools`)).status).toBe(404);
      expect((await reorder(master, h.ids.routeB, { schoolId: schoolB2, direction: 'up' })).status).toBe(404);
    });
    expect(await orders(h.ids.routeB)).toEqual(B_UNTOUCHED());
  });
});

describe('Q70 controls', () => {
  it('adminA on routeA: GET → 200 in order; PUT down → 200 and the two schools swap', async () => {
    const list = await adminA.get(`/api/routes/${h.ids.routeA}/schools`);
    expect(list.status).toBe(200);
    expect(list.body.map((s: { id: string }) => s.id)).toEqual([h.ids.schoolA, schoolA2]);
    const res = await reorder(adminA, h.ids.routeA, { schoolId: h.ids.schoolA, direction: 'down' });
    expect(res.status).toBe(200);
    expect((await orders(h.ids.routeA)).map((r) => r.schoolId)).toEqual([schoolA2, h.ids.schoolA]);
  });

  it('adminB on its own routeB: GET → 200; PUT up → 200 and swapped', async () => {
    expect((await adminB.get(`/api/routes/${h.ids.routeB}/schools`)).status).toBe(200);
    const res = await reorder(adminB, h.ids.routeB, { schoolId: schoolB2, direction: 'up' });
    expect(res.status).toBe(200);
    expect((await orders(h.ids.routeB)).map((r) => r.schoolId)).toEqual([schoolB2, h.ids.schoolB]);
  });

  it('an unscoped master on routeB: GET → 200 and PUT → 200 (red if isRouteInCompany is swapped in for isOutsideCallerTenant)', async () => {
    const list = await master.get(`/api/routes/${h.ids.routeB}/schools`);
    expect(list.status).toBe(200);
    expect(list.body).toHaveLength(2);
    expect((await reorder(master, h.ids.routeB, { schoolId: schoolB2, direction: 'up' })).status).toBe(200);
  });
});

describe('Q70 reorder body and pre-checks', () => {
  it('direction "sideways" → 400; schoolId {} → 400', async () => {
    const bad = await reorder(adminB, h.ids.routeB, { schoolId: schoolB2, direction: 'sideways' });
    expect(bad.status).toBe(400);
    expect(bad.body).toEqual({ message: 'Invalid reorder request' });
    expect((await reorder(adminB, h.ids.routeB, { schoolId: {}, direction: 'up' })).status).toBe(400);
  });

  it('a school not on the route → 404 "School not found on this route" (not 500), and routeB\'s orders stay 0/5', async () => {
    const res = await reorder(adminB, h.ids.routeB, { schoolId: h.ids.schoolA, direction: 'up' });
    expect(res.status).toBe(404);
    expect(res.body).toEqual({ message: 'School not found on this route' });
    expect(await orders(h.ids.routeB)).toEqual(B_UNTOUCHED());
  });

  it('already at the top → 409; already at the bottom → 409; routeB untouched', async () => {
    const top = await reorder(adminB, h.ids.routeB, { schoolId: h.ids.schoolB, direction: 'up' });
    expect(top.status).toBe(409);
    expect(top.body).toEqual({ message: 'Already at the top' });
    const bottom = await reorder(adminB, h.ids.routeB, { schoolId: schoolB2, direction: 'down' });
    expect(bottom.status).toBe(409);
    expect(bottom.body).toEqual({ message: 'Already at the bottom' });
    expect(await orders(h.ids.routeB)).toEqual(B_UNTOUCHED());
  });
});
