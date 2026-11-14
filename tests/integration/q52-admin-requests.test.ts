// Q52: admin requests are tasks from admins to drivers; the driver dashboard
// is the only screen using them. Rule: same company, and admin OR the driver
// the request is for (driverId NULL = all drivers). Anything else is the
// same 404 as a missing id (no row change); a non-admin non-driver can't
// list them (403); a driver lists only their own and "all drivers" rows.
// Real HTTP + real Postgres; foreign rows are seeded so each guard is
// reachable. Titles name the clause whose removal turns them red.
import { describe, it, expect, beforeAll } from 'vitest';
import { eq } from 'drizzle-orm';
import { adminRequests } from '@shared/schema';
import { useIntegrationHarness, type Agent } from './harness';

const h = useIntegrationHarness();
const NOT_FOUND = { message: 'Request not found' };

let adminA: Agent;
let adminB: Agent;
let parentA: Agent;
let driverA: Agent;

async function newRequest(driverId: string | null, title: string) {
  const [r] = await h.db
    .insert(adminRequests)
    .values({ companyId: h.ids.companyA, title, description: `${title} body`, driverId })
    .returning({ id: adminRequests.id });
  return r.id;
}
const rowOf = async (id: string) => (await h.db.select().from(adminRequests).where(eq(adminRequests.id, id)))[0];
async function expectUnchanged(id: string) {
  const r = await rowOf(id);
  expect(r.status).toBe('pending');
  expect(r.acknowledgedAt).toBeNull();
  expect(r.completedAt).toBeNull();
}

beforeAll(async () => {
  // 4 logins (MAX_LOGINS_PER_FILE is 8).
  adminA = await h.loginAs('adminA');
  adminB = await h.loginAs('adminB');
  parentA = await h.loginAs('parentA');
  driverA = await h.loginAs('driverA');
});

describe('Q52 acknowledge / complete refusals (404, row unchanged)', () => {
  it('company B\'s admin on company A\'s request → 404 (red if the isOutsideCallerTenant(user, row.companyId) check is removed)', async () => {
    const id = await newRequest(null, 'Q52-tenant');
    for (const step of ['acknowledge', 'complete']) {
      const res = await adminB.patch(`/api/admin-requests/${id}/${step}`);
      expect(res.status).toBe(404);
      expect(res.body).toEqual(NOT_FOUND);
    }
    await expectUnchanged(id);
  });

  it('parentA on a company-A "all drivers" request → 404 (red if the admin-or-driver condition is removed)', async () => {
    const id = await newRequest(null, 'Q52-parent');
    for (const step of ['acknowledge', 'complete']) {
      const res = await parentA.patch(`/api/admin-requests/${id}/${step}`);
      expect(res.status).toBe(404);
      expect(res.body).toEqual(NOT_FOUND);
    }
    await expectUnchanged(id);
  });

  it('driverA on a request addressed to driverA2 → 404 (red if row.driverId === user.id is dropped)', async () => {
    const id = await newRequest(h.ids.driverA2, 'Q52-other-driver');
    for (const step of ['acknowledge', 'complete']) {
      const res = await driverA.patch(`/api/admin-requests/${id}/${step}`);
      expect(res.status).toBe(404);
      expect(res.body).toEqual(NOT_FOUND);
    }
    await expectUnchanged(id);
  });

  it('a missing id → the same 404 body', async () => {
    const res = await adminA.patch('/api/admin-requests/no-such-request/acknowledge');
    expect(res.status).toBe(404);
    expect(res.body).toEqual(NOT_FOUND);
  });
});

describe('Q52 driver control: the driver dashboard keeps working', () => {
  for (const [label, who] of [['an "all drivers" request', 'null'], ['their own request', 'self']] as const) {
    it(`driverA acknowledges then completes ${label} → 200 each (red if the rule becomes admin-only)`, async () => {
      const id = await newRequest(who === 'null' ? null : h.ids.driverA, `Q52-control-${who}`);
      const ack = await driverA.patch(`/api/admin-requests/${id}/acknowledge`);
      expect(ack.status).toBe(200);
      expect((await rowOf(id)).status).toBe('acknowledged');
      const done = await driverA.patch(`/api/admin-requests/${id}/complete`);
      expect(done.status).toBe(200);
      expect((await rowOf(id)).status).toBe('completed');
    });
  }

  it('adminA acknowledges a request addressed to driverA2 → 200 (admins unchanged)', async () => {
    const id = await newRequest(h.ids.driverA2, 'Q52-admin-ok');
    expect((await adminA.patch(`/api/admin-requests/${id}/acknowledge`)).status).toBe(200);
  });
});

describe('Q52 GET /api/admin-requests', () => {
  let reqNull: string;
  let reqOwn: string;
  let reqOther: string;
  beforeAll(async () => {
    reqNull = await newRequest(null, 'Q52-list-all');
    reqOwn = await newRequest(h.ids.driverA, 'Q52-list-own');
    reqOther = await newRequest(h.ids.driverA2, 'Q52-list-other');
  });
  const ids = (body: Array<{ id: string }>) => body.map((r) => r.id);

  it('a parent gets 403 (red if the admin-or-driver role check on the list is removed)', async () => {
    const res = await parentA.get('/api/admin-requests');
    expect(res.status).toBe(403);
  });

  it('driverA sees "all drivers" and their own requests, not driverA2\'s (red if the driver filter is removed)', async () => {
    const res = await driverA.get('/api/admin-requests');
    expect(res.status).toBe(200);
    expect(ids(res.body)).toEqual(expect.arrayContaining([reqNull, reqOwn]));
    expect(ids(res.body)).not.toContain(reqOther);
  });

  it('adminA still sees all three', async () => {
    const res = await adminA.get('/api/admin-requests');
    expect(ids(res.body)).toEqual(expect.arrayContaining([reqNull, reqOwn, reqOther]));
  });
});
