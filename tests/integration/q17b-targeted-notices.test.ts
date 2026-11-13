// Q17b: targeted parent notifications ("Child Boarded Bus" / "Child Arrived
// Safely", written with targetParentId by confirm-boarded / confirm-dropoff)
// reach the target parent in every branch of getNotificationsForParent, and
// no other parent, even one on the same route. Real HTTP + real Postgres.
// Rows are inserted in the exact shape those handlers write (isGlobal false,
// routeId NULL, targetParentId set) plus route/global variants that must not
// leak. Each title names the clause whose deletion turns it red.
//
// Branches: normal (parent in a company, child on a route), no routes (parent
// in a company, no child), no company (SEC-20: parentNull linked to studentA).
import { describe, it, expect, beforeAll } from 'vitest';
import { parentNotifications, parentChildLinks } from '@shared/schema';
import { useIntegrationHarness, type Agent } from './harness';
import { insertUser, SEED_PASSWORD } from './seed';

const h = useIntegrationHarness();
const URL = '/api/parent-notifications';

const PARENT_A2_EMAIL = 'q17b-parent-a2@sbt.test';
const PARENT_NOKIDS_EMAIL = 'q17b-parent-nokids@sbt.test';

let parentA: Agent;      // normal branch (studentA on routeA)
let parentA2: Agent;     // normal branch, same route as parentA
let parentNoKids: Agent; // no-routes branch
let parentNull: Agent;   // no-company branch
let parentA2Id: string;
let parentNoKidsId: string;

async function login(email: string): Promise<Agent> {
  const agent = h.anon();
  const res = await h.loginAttempt(email, SEED_PASSWORD, agent);
  expect(res.status).toBe(200);
  return agent;
}

async function insertNotice(values: Partial<typeof parentNotifications.$inferInsert> & { title: string }) {
  const [row] = await h.db
    .insert(parentNotifications)
    .values({
      companyId: h.ids.companyA,
      createdById: h.ids.driverA,
      message: `${values.title} message`,
      type: 'info',
      isGlobal: false,
      routeId: null,
      ...values,
    })
    .returning({ id: parentNotifications.id });
  return row.id;
}

const ids = (res: { body: Array<{ id: string }> }) => res.body.map((n) => n.id);

beforeAll(async () => {
  parentA2Id = await insertUser(
    { email: PARENT_A2_EMAIL, firstName: 'A-Parent2', lastName: 'Seed', role: 'parent', companyId: h.ids.companyA },
    { password: true },
  );
  await h.db.insert(parentChildLinks).values({ parentId: parentA2Id, studentId: h.ids.studentA });
  parentNoKidsId = await insertUser(
    { email: PARENT_NOKIDS_EMAIL, firstName: 'A-ParentNoKids', lastName: 'Seed', role: 'parent', companyId: h.ids.companyA },
    { password: true },
  );
  // parentNull (no company) linked to studentA: childCompanyIds = [A], routeIds = [routeA].
  await h.db.insert(parentChildLinks).values({ parentId: h.ids.parentNull, studentId: h.ids.studentA });

  // 4 logins (MAX_LOGINS_PER_FILE is 8).
  parentA = await h.loginAs('parentA');
  parentA2 = await login(PARENT_A2_EMAIL);
  parentNoKids = await login(PARENT_NOKIDS_EMAIL);
  parentNull = await h.loginAs('parentNull');
});

describe('Q17b normal branch (parent with a child on a route)', () => {
  it('"Child Boarded Bus" targeted at parentA (company A, no route, not global) is shown to parentA (red if targetParentId = parentId is missing from the normal branch)', async () => {
    const id = await insertNotice({ title: 'Child Boarded Bus', targetParentId: h.ids.parentA });
    const res = await parentA.get(URL);
    expect(res.status).toBe(200);
    expect(ids(res)).toContain(id);
    expect(ids(await parentA2.get(URL))).not.toContain(id);
  });

  it('"Child Arrived Safely" targeted at parentA carrying routeA is not shown to parentA2 on the same route (red if targetParentId IS NULL is dropped from the route clause)', async () => {
    const id = await insertNotice({ title: 'Child Arrived Safely', targetParentId: h.ids.parentA, routeId: h.ids.routeA });
    expect(ids(await parentA2.get(URL))).not.toContain(id);
    expect(ids(await parentA.get(URL))).toContain(id);
  });

  it('a global row targeted at parentA is not shown to parentA2 (red if targetParentId IS NULL is dropped from the global clause)', async () => {
    const id = await insertNotice({ title: 'Q17b-global-to-A', targetParentId: h.ids.parentA, isGlobal: true });
    expect(ids(await parentA2.get(URL))).not.toContain(id);
  });

  it('a row targeted at parentA with companyId B is not shown to parentA (companyId = parent\'s company)', async () => {
    const id = await insertNotice({ title: 'Child Boarded Bus', targetParentId: h.ids.parentA, companyId: h.ids.companyB, createdById: h.ids.driverB });
    expect(ids(await parentA.get(URL))).not.toContain(id);
  });

  it('untargeted route and global rows still reach both route parents', async () => {
    const route = await insertNotice({ title: 'Q17b-route-bcast', routeId: h.ids.routeA });
    const global = await insertNotice({ title: 'Q17b-global-bcast', isGlobal: true });
    for (const agent of [parentA, parentA2]) {
      expect(ids(await agent.get(URL))).toEqual(expect.arrayContaining([route, global]));
    }
  });
});

describe('Q17b no-routes branch (parent in a company, no child)', () => {
  it('a row targeted at parentNoKids is shown to them (red if targetParentId = parentId is missing from the no-routes branch)', async () => {
    const id = await insertNotice({ title: 'Child Arrived Safely', targetParentId: parentNoKidsId });
    expect(ids(await parentNoKids.get(URL))).toContain(id);
    expect(ids(await parentA.get(URL))).not.toContain(id);
  });

  it('a global row targeted at parentA is not shown to parentNoKids (red if targetParentId IS NULL is dropped from the no-routes global clause)', async () => {
    const id = await insertNotice({ title: 'Q17b-global-to-A-2', targetParentId: h.ids.parentA, isGlobal: true });
    expect(ids(await parentNoKids.get(URL))).not.toContain(id);
  });

  it('a row targeted at parentNoKids with companyId B is not shown to them', async () => {
    const id = await insertNotice({ title: 'Child Boarded Bus', targetParentId: parentNoKidsId, companyId: h.ids.companyB, createdById: h.ids.driverB });
    expect(ids(await parentNoKids.get(URL))).not.toContain(id);
  });

  it('the seeded global company-A notice still reaches parentNoKids', async () => {
    expect(ids(await parentNoKids.get(URL))).toContain(h.ids.noticeA);
  });
});

describe('Q17b no-company branch (SEC-20: parentNull linked to studentA)', () => {
  it('a row targeted at parentNull with companyId A (a child\'s company) is shown to them (red if targetParentId = parentId is missing from the no-company branch)', async () => {
    const id = await insertNotice({ title: 'Child Boarded Bus', targetParentId: h.ids.parentNull });
    expect(ids(await parentNull.get(URL))).toContain(id);
    expect(ids(await parentA.get(URL))).not.toContain(id);
  });

  it('a row targeted at parentNull with companyId B (no child there) is not shown (red if companyId IN childCompanyIds is dropped from the targeted clause)', async () => {
    const id = await insertNotice({ title: 'Child Arrived Safely', targetParentId: h.ids.parentNull, companyId: h.ids.companyB, createdById: h.ids.driverB });
    expect(ids(await parentNull.get(URL))).not.toContain(id);
  });

  it('a routeA row targeted at parentA is not shown to parentNull, who is also on routeA (red if targetParentId IS NULL is dropped from the no-company route clause)', async () => {
    const id = await insertNotice({ title: 'Child Boarded Bus', targetParentId: h.ids.parentA, routeId: h.ids.routeA });
    expect(ids(await parentNull.get(URL))).not.toContain(id);
  });

  it('a global company-A row targeted at parentA is not shown to parentNull (red if targetParentId IS NULL is dropped from the no-company global clause)', async () => {
    const id = await insertNotice({ title: 'Q17b-global-to-A-3', targetParentId: h.ids.parentA, isGlobal: true });
    expect(ids(await parentNull.get(URL))).not.toContain(id);
  });
});

describe('Q17b unread count follows the same rule', () => {
  it('parentA2\'s unread count equals the rows parentA2 can list', async () => {
    const list = await parentA2.get(URL);
    const count = await parentA2.get('/api/parent-notifications/unread-count');
    expect(count.status).toBe(200);
    expect(count.body.unreadCount).toBe(list.body.length);
  });
});
