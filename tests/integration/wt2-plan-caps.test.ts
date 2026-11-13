// WT-2 (Q49): the staff user cap through the real routes. Replaces the copied
// canCreateUser in tests/plan-limits.test.ts. The cap is the company row's
// staff_user_limit (NULL = unlimited); storage.canCreateUser counts the
// company's admin, driver and driver_admin users. Today inactive (archived)
// staff count toward the cap too: that is pinned here as current behaviour,
// not decided (product question for DeShaun). Real HTTP + real Postgres.
import { describe, it, expect, beforeAll } from 'vitest';
import { and, eq, inArray } from 'drizzle-orm';
import { companies, users } from '@shared/schema';
import { useIntegrationHarness, type Agent } from './harness';

const h = useIntegrationHarness();
const STAFF_ROLES = ['admin', 'driver', 'driver_admin'] as const;
const limitMessage = (n: number) =>
  `Staff user limit reached (${n}). Upgrade your plan to add more staff users.`;

let adminA: Agent;

const staffRows = (companyId: string) =>
  h.db
    .select({ id: users.id, isActive: users.isActive })
    .from(users)
    .where(and(eq(users.companyId, companyId), inArray(users.role, [...STAFF_ROLES])));

const setCap = (companyId: string, cap: number | null) =>
  h.db.update(companies).set({ staffUserLimit: cap }).where(eq(companies.id, companyId));

const createDriver = (agent: Agent, firstName: string) =>
  agent.post('/api/drivers').send({ firstName, lastName: 'Wt2', email: '' });

beforeAll(async () => {
  // 1 login (MAX_LOGINS_PER_FILE is 8).
  adminA = await h.loginAs('adminA');
});

describe('WT-2 staff cap: company A at its cap', () => {
  it('POST /api/drivers → 403 with the limit message and no new staff row (red if the route\'s canCreate.allowed check is removed, or the cap check is > instead of >=)', async () => {
    const count = (await staffRows(h.ids.companyA)).length;
    await setCap(h.ids.companyA, count);
    const res = await createDriver(adminA, 'Wt2-AtCap');
    expect(res.status).toBe(403);
    expect(res.body).toEqual({ message: limitMessage(count) });
    expect(await staffRows(h.ids.companyA)).toHaveLength(count);
  });

  it('POST /api/employees/invite (role driver) → 403 with the limit message and no user for that email (red if the invite route\'s canCreate.allowed check is removed)', async () => {
    const count = (await staffRows(h.ids.companyA)).length;
    await setCap(h.ids.companyA, count);
    const email = 'wt2-invite@sbt.test';
    const res = await adminA
      .post('/api/employees/invite')
      .send({ firstName: 'Wt2', lastName: 'Invite', email, role: 'driver' });
    expect(res.status).toBe(403);
    expect(res.body).toEqual({ message: limitMessage(count) });
    expect(await h.db.select().from(users).where(eq(users.email, email))).toHaveLength(0);
  });

  it('pins today: inactive (archived) staff count toward the cap (cap = active staff + inactive staff → 403)', async () => {
    const rows = await staffRows(h.ids.companyA);
    const inactive = rows.filter((r) => r.isActive === false).length;
    expect(inactive).toBeGreaterThan(0); // seed: driverA_archived
    const active = rows.length - inactive;
    // Room for one more if only active staff counted; none if inactive staff count too.
    await setCap(h.ids.companyA, active + inactive);
    const res = await createDriver(adminA, 'Wt2-Inactive');
    expect(res.status).toBe(403);
    expect(await staffRows(h.ids.companyA)).toHaveLength(rows.length);
  });
});

describe('WT-2 staff cap: other companies and unlimited', () => {
  it("company B's staff don't count toward A: A one under its cap, B with extra staff → A's create succeeds (red if getStaffUserCount drops eq(users.companyId, companyId))", async () => {
    await h.db.insert(users).values(
      [1, 2, 3].map((n) => ({
        email: `wt2-b-staff-${n}@sbt.test`,
        firstName: `B-Staff${n}`,
        lastName: 'Wt2',
        role: 'driver' as const,
        companyId: h.ids.companyB,
      })),
    );
    const countA = (await staffRows(h.ids.companyA)).length;
    await setCap(h.ids.companyA, countA + 1);
    const res = await createDriver(adminA, 'Wt2-UnderCap');
    expect(res.status).toBe(200);
    expect(res.body.companyId).toBe(h.ids.companyA);
    expect(await staffRows(h.ids.companyA)).toHaveLength(countA + 1);
  });

  it('a NULL cap is unlimited: create succeeds', async () => {
    await setCap(h.ids.companyA, null);
    const res = await createDriver(adminA, 'Wt2-Unlimited');
    expect(res.status).toBe(200);
  });
});
