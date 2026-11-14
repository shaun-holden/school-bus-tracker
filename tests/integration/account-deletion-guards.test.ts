// Q59: POST /api/auth/delete-account refusals. Only a parent or a driver may
// delete their OWN account, with their password, and a driver must be off
// duty. Every refusal here leaves the rows unchanged. No successful deletion
// in this file (limiter budget: 8 of authLimiter's 10; 5 logins of 8).
// Also the storage-level on-duty gate (inside the transaction's row lock).
// Real HTTP + real Postgres. Titles name the clause whose removal turns them red.
import { describe, it, expect, beforeAll } from 'vitest';
import { eq } from 'drizzle-orm';
import { users, routes, buses } from '@shared/schema';
import { storage } from '../../server/storage';
import { useIntegrationHarness, type Agent } from './harness';
import { EMAILS } from './seed';

const h = useIntegrationHarness();
const URL = '/api/auth/delete-account';

let adminA: Agent;
let driverAdminA: Agent;
let master: Agent;
let parentA: Agent;
let driverA: Agent;

const userRow = async (id: string) => (await h.db.select().from(users).where(eq(users.id, id)))[0];

beforeAll(async () => {
  // 5 logins (MAX_LOGINS_PER_FILE is 8).
  adminA = await h.loginAs('adminA');
  driverAdminA = await h.loginAs('driverAdminA');
  master = await h.loginAs('master');
  parentA = await h.loginAs('parentA');
  driverA = await h.loginAs('driverA');
});

describe('Q59 delete-account refusals', () => {
  it('no session → 401', async () => {
    expect((await h.anon().post(URL).send({ password: 'whatever' })).status).toBe(401);
  });

  it('adminA and driver_admin → 403 CONTACT_SUPPORT, rows unchanged (red if the parent/driver role allow-list is removed)', async () => {
    for (const [agent, id, email] of [[adminA, h.ids.adminA, EMAILS.adminA], [driverAdminA, h.ids.driverAdminA, EMAILS.driverAdminA]] as const) {
      const res = await agent.post(URL).send({ password: 'integration-Pass-123' });
      expect(res.status).toBe(403);
      expect(res.body.code).toBe('CONTACT_SUPPORT');
      const row = await userRow(id);
      expect(row.email).toBe(email);
      expect(row.isActive).not.toBe(false);
    }
  });

  it('a master admin, impersonating or not → 403 CONTACT_SUPPORT, master row unchanged', async () => {
    const plain = await master.post(URL).send({ password: 'integration-Pass-123' });
    expect(plain.status).toBe(403);
    expect(plain.body.code).toBe('CONTACT_SUPPORT');
    expect((await master.post(`/api/master-admin/impersonate/${h.ids.companyA}`).send({})).status).toBe(200);
    const imp = await master.post(URL).send({ password: 'integration-Pass-123' });
    expect(imp.status).toBe(403);
    expect(imp.body.code).toBe('CONTACT_SUPPORT');
    const row = await userRow(h.ids.master);
    expect(row.email).toBe(EMAILS.master);
    expect(row.role).toBe('master_admin');
  });

  it('parentA with a wrong password → 400 BAD_PASSWORD, nothing changed, still logged in (red if the password compare is removed)', async () => {
    const res = await parentA.post(URL).send({ password: 'not-the-password' });
    expect(res.status).toBe(400);
    expect(res.body.code).toBe('BAD_PASSWORD');
    const row = await userRow(h.ids.parentA);
    expect(row.email).toBe(EMAILS.parentA);
    expect(row.isActive).not.toBe(false);
    expect((await parentA.get('/api/auth/user')).status).toBe(200);
  });

  it('driverA on duty → 409 ON_DUTY; route and bus still assigned (red if the on-duty check is removed)', async () => {
    await h.db.update(users).set({ isOnDuty: true }).where(eq(users.id, h.ids.driverA));
    try {
      const res = await driverA.post(URL).send({ password: 'integration-Pass-123' });
      expect(res.status).toBe(409);
      expect(res.body.code).toBe('ON_DUTY');
      expect((await h.db.select().from(routes).where(eq(routes.id, h.ids.routeA)))[0].driverId).toBe(h.ids.driverA);
      expect((await h.db.select().from(buses).where(eq(buses.id, h.ids.busA)))[0].driverId).toBe(h.ids.driverA);
      expect((await userRow(h.ids.driverA)).email).toBe(EMAILS.driverA);
    } finally {
      await h.db.update(users).set({ isOnDuty: false }).where(eq(users.id, h.ids.driverA));
    }
  });

  it('a body without a password → 400', async () => {
    expect((await parentA.post(URL).send({})).status).toBe(400);
  });
});

describe('Q59 storage.deleteOwnAccount on-duty gate', () => {
  it('a driver on duty → "on_duty" and no row changed (red if the in-transaction on-duty check is removed)', async () => {
    await h.db.update(users).set({ isOnDuty: true }).where(eq(users.id, h.ids.driverA));
    try {
      expect(await storage.deleteOwnAccount(h.ids.driverA)).toBe('on_duty');
      const row = await userRow(h.ids.driverA);
      expect(row.email).toBe(EMAILS.driverA);
      expect(row.companyId).toBe(h.ids.companyA);
      expect((await h.db.select().from(routes).where(eq(routes.id, h.ids.routeA)))[0].driverId).toBe(h.ids.driverA);
    } finally {
      await h.db.update(users).set({ isOnDuty: false }).where(eq(users.id, h.ids.driverA));
    }
  });

  it('an unknown id → "not_found"', async () => {
    expect(await storage.deleteOwnAccount('no-such-user')).toBe('not_found');
  });
});
