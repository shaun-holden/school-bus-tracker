// Q8 Part A3: POST /api/driver-school-departure only accepts the caller's own
// visit on a route in the caller's company, and notifies the parents of the
// VISIT's route + school (not the driver's current assignment). Real HTTP +
// real Postgres. Visits are inserted directly so the foreign ones are
// reachable; each title names the clause whose deletion turns it red.
import { describe, it, expect, beforeAll } from 'vitest';
import { eq } from 'drizzle-orm';
import { systemNotifications, schoolVisits } from '@shared/schema';
import { useIntegrationHarness, type Agent } from './harness';
import { seedQ8Extras, Q8_EMAILS, SEED_PASSWORD, type Q8Ids } from './seed';

const h = useIntegrationHarness();
const TITLE = 'Bus Departed from School';

let q8: Q8Ids;
let driverA: Agent;
let parentA: Agent;
let parentA3: Agent;

async function login(email: string): Promise<Agent> {
  const agent = h.anon();
  const res = await h.loginAttempt(email, SEED_PASSWORD, agent);
  expect(res.status).toBe(200);
  return agent;
}

// Legacy shape by default: companyId NULL.
async function insertVisit(values: { driverId: string; routeId: string; schoolId: string; companyId?: string | null }) {
  const [row] = await h.db
    .insert(schoolVisits)
    .values({ companyId: null, arrivedAt: new Date(), visitDate: new Date(), ...values })
    .returning({ id: schoolVisits.id });
  return row.id;
}

const getVisit = async (id: string) => (await h.db.select().from(schoolVisits).where(eq(schoolVisits.id, id)))[0];
const departureRows = () => h.db.select().from(systemNotifications).where(eq(systemNotifications.title, TITLE));

beforeAll(async () => {
  q8 = await seedQ8Extras(h.ids);
  // 3 logins (MAX_LOGINS_PER_FILE is 8).
  driverA = await h.loginAs('driverA');
  parentA = await h.loginAs('parentA');
  parentA3 = await login(Q8_EMAILS.parentA3);
});

describe('Q8 A3 refusals (departedAt unchanged, no notices)', () => {
  it('another company-A driver\'s visit on routeA gives 404 and departedAt stays NULL (red if the visit.driverId === user.id check is deleted)', async () => {
    const visitId = await insertVisit({ driverId: h.ids.driverA2, routeId: h.ids.routeA, schoolId: h.ids.schoolA, companyId: h.ids.companyA });
    const res = await driverA.post('/api/driver-school-departure').send({ visitId });
    expect(res.status).toBe(404);
    expect((await getVisit(visitId)).departedAt).toBeNull();
    expect(await departureRows()).toHaveLength(0);
  });

  it('driverA\'s own visit whose routeId is company B\'s route (legacy companyId NULL) gives 404 and departedAt stays NULL (red if the isOutsideCallerTenant(user, route.companyId) check is deleted)', async () => {
    const visitId = await insertVisit({ driverId: h.ids.driverA, routeId: h.ids.routeB, schoolId: h.ids.schoolB });
    const res = await driverA.post('/api/driver-school-departure').send({ visitId });
    expect(res.status).toBe(404);
    expect((await getVisit(visitId)).departedAt).toBeNull();
    expect(await departureRows()).toHaveLength(0);
  });

  it('an unknown visitId gives 404; a missing one gives 400', async () => {
    expect((await driverA.post('/api/driver-school-departure').send({ visitId: 'no-such-visit' })).status).toBe(404);
    expect((await driverA.post('/api/driver-school-departure').send({})).status).toBe(400);
  });
});

describe('Q8 A3 recipients', () => {
  it('driverA\'s legacy visit (companyId NULL) on routeA at schoolA departs: 200, departedAt set, rows only for parentA and parentNull with companyId A', async () => {
    const visitId = await insertVisit({ driverId: h.ids.driverA, routeId: h.ids.routeA, schoolId: h.ids.schoolA });
    const res = await driverA.post('/api/driver-school-departure').send({ visitId });
    expect(res.status).toBe(200);
    expect((await getVisit(visitId)).departedAt).not.toBeNull();

    const rows = await departureRows();
    expect(rows.map((r) => r.recipientId).sort()).toEqual([h.ids.parentA, h.ids.parentNull].sort());
    expect(rows.every((r) => r.companyId === h.ids.companyA)).toBe(true);

    const a = await parentA.get('/api/system-notifications');
    expect(a.body.filter((n: { title: string }) => n.title === TITLE)).toHaveLength(1);
    const a3 = await parentA3.get('/api/system-notifications');
    expect(a3.body.filter((n: { title: string }) => n.title === TITLE)).toHaveLength(0);
  });

  it('a visit on routeA2 (driverA is assigned routeA) notifies only parentA3 (red if recipients use user.assignedRouteId instead of visit.routeId)', async () => {
    await h.db.delete(systemNotifications).where(eq(systemNotifications.title, TITLE));
    const visitId = await insertVisit({ driverId: h.ids.driverA, routeId: q8.routeA2, schoolId: h.ids.schoolA, companyId: h.ids.companyA });
    const res = await driverA.post('/api/driver-school-departure').send({ visitId });
    expect(res.status).toBe(200);
    const rows = await departureRows();
    expect(rows.map((r) => r.recipientId)).toEqual([q8.parentA3]);
    expect(rows[0].message).toBe('The bus has departed from A-School. A-Student3 is on the way.');
  });
});
