// Q59: what a successful POST /api/auth/delete-account does. The user row is
// scrubbed and deactivated (never hard-deleted), links / credentials /
// sessions go, push tokens are turned off, a driver's bus and route are
// unassigned, and nothing of any OTHER user (same company or another) is
// touched. The caller can only ever delete themselves: a userId in the body
// is ignored. Real HTTP + real Postgres. 7 logins (MAX_LOGINS_PER_FILE is 8).
import { describe, it, expect, beforeAll } from 'vitest';
import { eq, sql } from 'drizzle-orm';
import {
  users,
  routes,
  buses,
  students,
  parentChildLinks,
  deviceTokens,
  passwordCredentials,
  driverShiftReports,
  companies,
} from '@shared/schema';
import { storage } from '../../server/storage';
import { useIntegrationHarness, type Agent } from './harness';
import { insertUser, EMAILS, SEED_PASSWORD } from './seed';

const h = useIntegrationHarness();
const URL = '/api/auth/delete-account';

let adminA: Agent;
let otherParentA: string;

const userRow = async (id: string) => (await h.db.select().from(users).where(eq(users.id, id)))[0];
const linksOf = (id: string) => h.db.select().from(parentChildLinks).where(eq(parentChildLinks.parentId, id));
const tokensOf = (id: string) => h.db.select().from(deviceTokens).where(eq(deviceTokens.userId, id));
const credsOf = (id: string) => h.db.select().from(passwordCredentials).where(eq(passwordCredentials.userId, id));
const sessionsOf = async (id: string) =>
  (await h.db.execute(sql`SELECT count(*)::int AS n FROM sessions WHERE sess->'passport'->>'user' = ${id}`)).rows[0] as { n: number };

beforeAll(async () => {
  // A second company-A parent (no login), linked to studentA, with a token.
  otherParentA = await insertUser(
    { email: 'q59-other-parent-a@sbt.test', firstName: 'A-OtherParent', lastName: 'Seed', role: 'parent', companyId: h.ids.companyA },
    { password: true },
  );
  await h.db.insert(parentChildLinks).values({ parentId: otherParentA, studentId: h.ids.studentA });
  await h.db.insert(deviceTokens).values({ userId: otherParentA, token: 'c'.repeat(64), platform: 'ios', isActive: true });
  adminA = await h.loginAs('adminA');
});

describe('Q59 driver deletion and the plan cap', () => {
  it('the staff cap frees up after driverA deletes (red if companyId → null is removed from the scrub)', async () => {
    const count = await storage.getStaffUserCount(h.ids.companyA);
    await h.db.update(companies).set({ staffUserLimit: count }).where(eq(companies.id, h.ids.companyA));
    expect((await storage.canCreateUser(h.ids.companyA, 'driver')).allowed).toBe(false);

    const driverA = await h.loginAs('driverA');
    const res = await driverA.post(URL).send({ password: SEED_PASSWORD });
    expect(res.status).toBe(200);
    expect((await storage.canCreateUser(h.ids.companyA, 'driver')).allowed).toBe(true);
  });

  it('driverA\'s bus and route are unassigned, the shift report says "Deleted user", and driverA is in neither of adminA\'s driver lists; reactivate → 404', async () => {
    expect((await h.db.select().from(buses).where(eq(buses.id, h.ids.busA)))[0].driverId).toBeNull();
    expect((await h.db.select().from(routes).where(eq(routes.id, h.ids.routeA)))[0].driverId).toBeNull();
    expect((await h.db.select().from(driverShiftReports).where(eq(driverShiftReports.id, h.ids.shiftA)))[0].driverName).toBe('Deleted user');
    for (const path of ['/api/drivers', '/api/drivers/archived']) {
      const list = await adminA.get(path);
      expect(list.status).toBe(200);
      expect(list.body.map((d: { id: string }) => d.id)).not.toContain(h.ids.driverA);
    }
    expect((await adminA.post(`/api/drivers/${h.ids.driverA}/reactivate`)).status).toBe(404);
  });
});

describe('Q59 parent deletion', () => {
  it('parentA (two sessions; body carries parentB\'s id) → 200; sessions gone at once; cookie expired; both sessions 401; row scrubbed; links, tokens, credentials gone; school student kept; other parents untouched', async () => {
    const a1 = await h.loginAs('parentA');
    const a2 = await h.loginAs('parentA');
    expect((await a1.post('/api/device-tokens').send({ token: 'd'.repeat(64), platform: 'ios' })).status).toBe(200);
    const parentBBefore = await userRow(h.ids.parentB);

    const res = await a1.post(URL).send({ password: SEED_PASSWORD, userId: h.ids.parentB });
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ message: 'Account deleted' });
    // Before any further request (a later request would re-save a session row).
    expect((await sessionsOf(h.ids.parentA)).n).toBe(0);
    const setCookie = ([] as string[]).concat(res.headers['set-cookie'] ?? []).join(';');
    expect(setCookie).toContain('connect.sid=');
    expect(setCookie).toContain('Expires=Thu, 01 Jan 1970');

    expect((await a1.get('/api/auth/user')).status).toBe(401);
    expect((await a2.get('/api/auth/user')).status).toBe(401);

    const row = await userRow(h.ids.parentA);
    expect(row.email).toBe(`deleted-${h.ids.parentA}@deleted.invalid`);
    expect(row.firstName).toBe('Deleted');
    expect(row.lastName).toBe('user');
    expect(row.isActive).toBe(false);
    expect(row.isOnDuty).toBe(false);
    expect(row.companyId).toBeNull();
    expect(row.phone).toBeNull();
    expect(row.address).toBeNull();
    expect(row.role).toBe('parent');

    expect(await linksOf(h.ids.parentA)).toHaveLength(0);
    expect((await tokensOf(h.ids.parentA)).every((t) => t.isActive === false)).toBe(true);
    expect(await credsOf(h.ids.parentA)).toHaveLength(0);
    const [stud] = await h.db.select().from(students).where(eq(students.id, h.ids.studentA));
    expect(stud.parentId).toBe(h.ids.parentA);

    // Same-company and cross-tenant controls.
    expect(await linksOf(otherParentA)).toHaveLength(1);
    expect((await tokensOf(otherParentA))[0].isActive).toBe(true);
    expect((await userRow(otherParentA)).email).toBe('q59-other-parent-a@sbt.test');
    const parentBAfter = await userRow(h.ids.parentB);
    expect(parentBAfter.email).toBe(parentBBefore.email);
    expect(parentBAfter.isActive).toBe(parentBBefore.isActive);
    expect(await linksOf(h.ids.parentB)).toHaveLength(1);
    expect(await credsOf(h.ids.parentB)).toHaveLength(1);
  });

  it('logging in with the original email or with the placeholder + old password → 401; registering again with the original email → 201', async () => {
    expect((await h.loginAttempt(EMAILS.parentA, SEED_PASSWORD)).status).toBe(401);
    expect((await h.loginAttempt(`deleted-${h.ids.parentA}@deleted.invalid`, SEED_PASSWORD)).status).toBe(401);
    const reg = await h.anon().post('/api/auth/register').send({ email: EMAILS.parentA, password: 'Q59-Fresh-Pass-1', firstName: 'New', lastName: 'Parent', role: 'parent' });
    expect(reg.status).toBe(201);
  });
});
