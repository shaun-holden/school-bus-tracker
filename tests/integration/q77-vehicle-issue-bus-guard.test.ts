// Q77: POST /api/vehicle-issues loads the bus named in the body and refuses
// one outside the caller's company (CLAUDE.md "Cross-tenant IDs in request
// bodies"). Missing and foreign buses get the same 404; an unscoped master is
// refused; an impersonating master is scoped to the impersonated school; the
// body can't set isResolved; bad input is 400, not 500. Real HTTP + real
// Postgres; the foreign and NULL-company buses are seeded and asserted to land
// so each clause is reachable (checklist X-1/X-2/X-3).
//
// Each title names the clause whose deletion turns it red.
import { describe, it, expect, beforeAll } from 'vitest';
import { randomUUID } from 'crypto';
import { eq } from 'drizzle-orm';
import { buses, passwordCredentials, users, vehicleIssues } from '@shared/schema';
import { useIntegrationHarness, type Agent } from './harness';

const h = useIntegrationHarness();
const URL = '/api/vehicle-issues';

let driverA: Agent;
let driverA2: Agent;
let master: Agent; // master admin, NOT impersonating
let impersonator: Agent; // master admin impersonating company A
let nullBusId: string;

const rowsWith = (description: string) =>
  h.db.select().from(vehicleIssues).where(eq(vehicleIssues.description, description));

const body = (busId: unknown, description: string, extra: Record<string, unknown> = {}) => ({
  busId,
  issueType: 'mechanical',
  description,
  severity: 'normal',
  ...extra,
});

beforeAll(async () => {
  // The seed gives driverA2 no password (send-invitation target). This file
  // needs a second company A driver who can log in and is not busA.driverId,
  // so copy driverA's seeded hash onto driverA2 (test DB only; TRUNCATEd per file).
  const [credA] = await h.db.select().from(passwordCredentials).where(eq(passwordCredentials.userId, h.ids.driverA));
  await h.db.insert(passwordCredentials).values({ userId: h.ids.driverA2, passwordHash: credA.passwordHash });

  // 4 logins (MAX_LOGINS_PER_FILE is 8).
  driverA = await h.loginAs('driverA');
  driverA2 = await h.loginAs('driverA2');
  master = await h.loginAs('master');
  impersonator = await h.loginAs('master');

  const imp = await impersonator.post(`/api/master-admin/impersonate/${h.ids.companyA}`).send({});
  expect(imp.status).toBe(200);
  const me = await impersonator.get('/api/auth/user');
  expect(me.body).toMatchObject({ role: 'master_admin', companyId: h.ids.companyA, _masterAdminImpersonating: true });

  const [nullBus] = await h.db
    .insert(buses)
    .values({ companyId: null, busNumber: 'Q77-NULL' })
    .returning({ id: buses.id });
  nullBusId = nullBus.id;

  // X-3: the seeded rows are what the tests assume.
  const [busA] = await h.db.select().from(buses).where(eq(buses.id, h.ids.busA));
  const [busB] = await h.db.select().from(buses).where(eq(buses.id, h.ids.busB));
  const [nb] = await h.db.select().from(buses).where(eq(buses.id, nullBusId));
  const [a2] = await h.db.select().from(users).where(eq(users.id, h.ids.driverA2));
  expect(busB.companyId).toBe(h.ids.companyB);
  expect(busA.companyId).toBe(h.ids.companyA);
  expect(busA.driverId).toBe(h.ids.driverA);
  expect(nb.companyId).toBeNull();
  expect(a2.companyId).toBe(h.ids.companyA);
  expect(a2.role).toBe('driver');
  expect(busA.driverId).not.toBe(h.ids.driverA2);
});

describe('Q77 POST /api/vehicle-issues bus guard', () => {
  it('isOutsideCallerTenant(user, bus.companyId) bus guard: other company\'s bus → 404, no row', async () => {
    const d = 'Q77 test foreign bus';
    const res = await driverA.post(URL).send(body(h.ids.busB, d));
    expect(res.status).toBe(404);
    expect(res.body.message).toBe('Bus not found');
    expect(await rowsWith(d)).toHaveLength(0);
  });

  it('isOutsideCallerTenant refuses a NULL-company bus → 404, no row', async () => {
    const d = 'Q77 test null-company bus';
    const res = await driverA.post(URL).send(body(nullBusId, d));
    expect(res.status).toBe(404);
    expect(res.body.message).toBe('Bus not found');
    expect(await rowsWith(d)).toHaveLength(0);
  });

  it('!bus check: a bus id that does not exist → 404, not 500, no row', async () => {
    const d = 'Q77 test missing bus';
    const res = await driverA.post(URL).send(body(randomUUID(), d));
    expect(res.status).toBe(404);
    expect(res.body.message).toBe('Bus not found');
    expect(await rowsWith(d)).toHaveLength(0);
  });

  it('hasId(busId) check: empty busId → 400, no row', async () => {
    const d = 'Q77 test empty busId';
    const res = await driverA.post(URL).send(body('', d));
    expect(res.status).toBe(400);
    expect(await rowsWith(d)).toHaveLength(0);
  });

  it('ZodError → 400 in the catch: missing busId, then a wrong issueType, no row', async () => {
    const d1 = 'Q77 test no busId';
    const { busId: _omit, ...noBus } = body(undefined, d1);
    const res1 = await driverA.post(URL).send(noBus);
    expect(res1.status).toBe(400);
    expect(await rowsWith(d1)).toHaveLength(0);

    const d2 = 'Q77 test bad issueType';
    const res2 = await driverA.post(URL).send(body(h.ids.busA, d2, { issueType: 123 }));
    expect(res2.status).toBe(400);
    expect(await rowsWith(d2)).toHaveLength(0);
  });

  it('isResolved = false forced: body isResolved true is saved as false', async () => {
    const d = 'Q77 test isResolved';
    const res = await driverA.post(URL).send(body(h.ids.busA, d, { isResolved: true }));
    expect(res.status).toBe(200);
    const rows = await rowsWith(d);
    expect(rows).toHaveLength(1);
    expect(rows[0].isResolved).toBe(false);
    expect(rows[0].companyId).toBe(h.ids.companyA);
    expect(rows[0].driverId).toBe(h.ids.driverA);
  });

  it('control: any company bus is allowed (DeShaun Q-1), driverA2 on busA → 200', async () => {
    const d = 'Q77 test other driver same company';
    const res = await driverA2.post(URL).send(body(h.ids.busA, d));
    expect(res.status).toBe(200);
    const rows = await rowsWith(d);
    expect(rows).toHaveLength(1);
    expect(rows[0].companyId).toBe(h.ids.companyA);
    expect(rows[0].driverId).toBe(h.ids.driverA2);
  });

  it('isUnscopedMaster refusal: unscoped master → 403, no row', async () => {
    const d = 'Q77 test unscoped master';
    const res = await master.post(URL).send(body(h.ids.busA, d));
    expect(res.status).toBe(403);
    expect(await rowsWith(d)).toHaveLength(0);
  });

  it('impersonation is scoped by isOutsideCallerTenant: busB → 404, busA → 200 in company A', async () => {
    const d1 = 'Q77 test impersonator foreign bus';
    const res1 = await impersonator.post(URL).send(body(h.ids.busB, d1));
    expect(res1.status).toBe(404);
    expect(res1.body.message).toBe('Bus not found');
    expect(await rowsWith(d1)).toHaveLength(0);

    const d2 = 'Q77 test impersonator own bus';
    const res2 = await impersonator.post(URL).send(body(h.ids.busA, d2));
    expect(res2.status).toBe(200);
    const rows = await rowsWith(d2);
    expect(rows).toHaveLength(1);
    expect(rows[0].companyId).toBe(h.ids.companyA);
  });
});
