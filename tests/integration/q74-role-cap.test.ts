// Q74 CD-1 / CD-6: PATCH /api/users/:id/role respects the staff cap when a
// parent becomes staff (driver / admin / driver_admin), using the TARGET's
// company, checked before the write. staff → staff is not checked.
// storage.canCreateUser refuses an unknown role. CD-5: the dead
// GET /api/company/user-counts is gone. Company A's seed is already at its cap
// (5 of 5), so each test sets the cap explicitly. Real HTTP + real Postgres.
import { describe, it, expect, beforeAll } from 'vitest';
import { and, eq, inArray } from 'drizzle-orm';
import { companies, users } from '@shared/schema';
import { storage } from '../../server/storage';
import { useIntegrationHarness, type Agent } from './harness';
import { insertUser } from './seed';

const h = useIntegrationHarness();
const STAFF_ROLES = ['admin', 'driver', 'driver_admin'] as const;
const limitMessage = (n: number) =>
  `Staff user limit reached (${n}). Upgrade your plan to add more staff users.`;

let adminA: Agent;
let master: Agent;

const staffCount = async (companyId: string) =>
  (await h.db.select({ id: users.id }).from(users).where(and(eq(users.companyId, companyId), inArray(users.role, [...STAFF_ROLES])))).length;
const setCap = (companyId: string, cap: number | null) =>
  h.db.update(companies).set({ staffUserLimit: cap }).where(eq(companies.id, companyId));
const roleOf = async (id: string) => (await h.db.select().from(users).where(eq(users.id, id)))[0].role;
const patchRole = (agent: Agent, id: string, role: string) => agent.patch(`/api/users/${id}/role`).send({ role });

let parentSeq = 0;
const freshParentA = () =>
  insertUser(
    { email: `q74-parent-${++parentSeq}@sbt.test`, firstName: `Q74-Parent${parentSeq}`, lastName: 'Seed', role: 'parent', companyId: h.ids.companyA },
    { password: false },
  );

beforeAll(async () => {
  // 2 logins (MAX_LOGINS_PER_FILE is 8).
  adminA = await h.loginAs('adminA');
  master = await h.loginAs('master');
});

describe('Q74 CD-1 role change and the staff cap', () => {
  it('1. A at its cap: parentA → driver, → admin, → driver_admin are each 403 with the limit message, and parentA stays a parent (red if the cap check is deleted, or if driver_admin is missing from it)', async () => {
    const count = await staffCount(h.ids.companyA);
    await setCap(h.ids.companyA, count);
    for (const role of ['driver', 'admin', 'driver_admin']) {
      const res = await patchRole(adminA, h.ids.parentA, role);
      expect(res.status, role).toBe(403);
      expect(res.body).toEqual({ message: limitMessage(count) });
      expect(await roleOf(h.ids.parentA)).toBe('parent');
    }
  });

  it('2. A at its cap: driverA2 → admin → 200 (staff → staff takes no new seat; red if the check ignores the old role), then back to driver', async () => {
    const count = await staffCount(h.ids.companyA);
    await setCap(h.ids.companyA, count);
    expect((await patchRole(adminA, h.ids.driverA2, 'admin')).status).toBe(200);
    expect(await roleOf(h.ids.driverA2)).toBe('admin');
    expect((await patchRole(adminA, h.ids.driverA2, 'driver')).status).toBe(200);
  });

  it('3. one seat left (cap = count + 1): a fresh A parent → driver → 200 (the boundary)', async () => {
    const count = await staffCount(h.ids.companyA);
    await setCap(h.ids.companyA, count + 1);
    const id = await freshParentA();
    const res = await patchRole(adminA, id, 'driver');
    expect(res.status).toBe(200);
    expect(await roleOf(id)).toBe('driver');
  });

  it('4. an unscoped master, A at its cap: an A parent → driver → 403 with exactly the limit message, still a parent (red if the caller\'s null company is used instead of the target\'s)', async () => {
    const count = await staffCount(h.ids.companyA);
    await setCap(h.ids.companyA, count);
    const id = await freshParentA();
    const res = await patchRole(master, id, 'driver');
    expect(res.status).toBe(403);
    expect(res.body).toEqual({ message: limitMessage(count) });
    expect(await roleOf(id)).toBe('parent');
  });
});

describe('Q74 CD-6 and CD-5', () => {
  it('5. storage.canCreateUser(companyA, "bogus") → allowed false (red if the unknown-role fallthrough allows)', async () => {
    await setCap(h.ids.companyA, null);
    const res = await storage.canCreateUser(h.ids.companyA, 'bogus');
    expect(res.allowed).toBe(false);
  });

  it('6. GET /api/company/user-counts as adminA → 404 (the dead route is gone)', async () => {
    expect((await adminA.get('/api/company/user-counts')).status).toBe(404);
  });
});
