// Q8 Part A1: who can read a system notification. A row with a recipientId is
// visible only to that user; role broadcasts (recipientId NULL) reach every
// parent / driver of the company. Reached over real HTTP against a real
// Postgres. Each title names the clause whose deletion turns it red.
//
// Rows are inserted directly (the same shape the driver arrival / departure /
// stop handlers write: recipientRole 'parent' + recipientId).
import { describe, it, expect, beforeAll } from 'vitest';
import { systemNotifications, parentChildLinks } from '@shared/schema';
import { useIntegrationHarness, type Agent } from './harness';
import { insertUser, SEED_PASSWORD } from './seed';

const h = useIntegrationHarness();

const PARENT_A2_EMAIL = 'q8-parent-a2@sbt.test';
const DRIVER_A3_EMAIL = 'q8-driver-a3@sbt.test';

let parentA: Agent;
let parentA2: Agent;
let driverA: Agent;
let driverA3: Agent;
let parentA2Id: string;
let driverA3Id: string;

async function insertNotice(values: Partial<typeof systemNotifications.$inferInsert> & { title: string }) {
  const [row] = await h.db
    .insert(systemNotifications)
    .values({
      companyId: h.ids.companyA,
      senderId: h.ids.adminA,
      senderRole: 'admin',
      recipientRole: 'parent',
      message: `${values.title} message`,
      type: 'info',
      ...values,
    })
    .returning({ id: systemNotifications.id });
  return row.id;
}

async function login(email: string): Promise<Agent> {
  const agent = h.anon();
  const res = await h.loginAttempt(email, SEED_PASSWORD, agent);
  expect(res.status).toBe(200);
  return agent;
}

const ids = (res: { body: Array<{ id: string }> }) => res.body.map((n) => n.id);

beforeAll(async () => {
  // A second company-A parent, linked to studentA (so it is on routeA too),
  // and a second company-A driver.
  parentA2Id = await insertUser(
    { email: PARENT_A2_EMAIL, firstName: 'A-Parent2', lastName: 'Seed', role: 'parent', companyId: h.ids.companyA },
    { password: true },
  );
  await h.db.insert(parentChildLinks).values({ parentId: parentA2Id, studentId: h.ids.studentA });
  driverA3Id = await insertUser(
    { email: DRIVER_A3_EMAIL, firstName: 'A-Driver3', lastName: 'Seed', role: 'driver', companyId: h.ids.companyA },
    { password: true },
  );

  // 4 logins (MAX_LOGINS_PER_FILE is 8).
  parentA = await h.loginAs('parentA');
  parentA2 = await login(PARENT_A2_EMAIL);
  driverA = await h.loginAs('driverA');
  driverA3 = await login(DRIVER_A3_EMAIL);
});

describe('Q8 A1 GET /api/system-notifications (parent)', () => {
  it('a recipientRole=parent row with recipientId=parentA is shown to parentA but not to parentA2 of the same company (red if the bare recipientRole=\'parent\' match comes back in getSystemNotificationsForParent)', async () => {
    const direct = await insertNotice({ title: 'Q8-direct-to-A', recipientRole: 'parent', recipientId: h.ids.parentA });

    const a = await parentA.get('/api/system-notifications');
    expect(a.status).toBe(200);
    expect(ids(a)).toContain(direct);

    const a2 = await parentA2.get('/api/system-notifications');
    expect(a2.status).toBe(200);
    expect(ids(a2)).not.toContain(direct);
  });

  it('an all_parents row with recipientId=parentA is not shown to parentA2 (red if all_parents matches without recipientId IS NULL)', async () => {
    const direct = await insertNotice({ title: 'Q8-all-parents-to-A', recipientRole: 'all_parents', recipientId: h.ids.parentA });
    const a2 = await parentA2.get('/api/system-notifications');
    expect(ids(a2)).not.toContain(direct);
    const a = await parentA.get('/api/system-notifications');
    expect(ids(a)).toContain(direct);
  });

  it('a route_parents row on routeA with recipientId=parentA is not shown to parentA2, who is also on routeA (red if the route_parents branch drops recipientId IS NULL)', async () => {
    const direct = await insertNotice({
      title: 'Q8-route-to-A', recipientRole: 'route_parents', recipientId: h.ids.parentA, routeId: h.ids.routeA,
    });
    const a2 = await parentA2.get('/api/system-notifications');
    expect(ids(a2)).not.toContain(direct);
  });

  it('broadcasts with recipientId NULL (parent, all_parents, route_parents on routeA) still reach both parents', async () => {
    const p = await insertNotice({ title: 'Q8-bcast-parent', recipientRole: 'parent', recipientId: null });
    const all = await insertNotice({ title: 'Q8-bcast-all', recipientRole: 'all_parents', recipientId: null });
    const route = await insertNotice({ title: 'Q8-bcast-route', recipientRole: 'route_parents', recipientId: null, routeId: h.ids.routeA });
    for (const agent of [parentA, parentA2]) {
      const res = await agent.get('/api/system-notifications');
      expect(ids(res)).toEqual(expect.arrayContaining([p, all, route]));
    }
  });

  it('a company-B row with recipientId=parentA is not shown to parentA (companyId filter)', async () => {
    const foreign = await insertNotice({
      title: 'Q8-B-to-A', companyId: h.ids.companyB, senderId: h.ids.adminB, recipientRole: 'parent', recipientId: h.ids.parentA,
    });
    const a = await parentA.get('/api/system-notifications');
    expect(ids(a)).not.toContain(foreign);
  });

  it('parentA2\'s unread count equals the rows parentA2 can list (red if the bare recipientRole=\'parent\' match comes back in getUnreadNotificationCountForParent)', async () => {
    const list = await parentA2.get('/api/system-notifications');
    const count = await parentA2.get('/api/system-notifications/unread-count');
    expect(count.status).toBe(200);
    // Every row above is unread; parentA has at least three direct rows that
    // parentA2 must not count.
    expect(count.body.count).toBe(list.body.length);
  });
});

describe('Q8 A1 GET /api/system-notifications (driver)', () => {
  it('a recipientRole=driver row with recipientId=driverA is shown to driverA but not to driverA3 (red if the bare recipientRole=\'driver\' match comes back in getSystemNotificationsForDriver)', async () => {
    const direct = await insertNotice({ title: 'Q8-driver-direct', recipientRole: 'driver', recipientId: h.ids.driverA });
    const a = await driverA.get('/api/system-notifications');
    expect(a.status).toBe(200);
    expect(ids(a)).toContain(direct);
    const a3 = await driverA3.get('/api/system-notifications');
    expect(ids(a3)).not.toContain(direct);
  });

  it('an all_drivers broadcast with recipientId NULL reaches both drivers', async () => {
    const b = await insertNotice({ title: 'Q8-driver-bcast', recipientRole: 'all_drivers', recipientId: null });
    for (const agent of [driverA, driverA3]) {
      const res = await agent.get('/api/system-notifications');
      expect(ids(res)).toContain(b);
    }
  });

  it('driverA3\'s unread count equals the rows driverA3 can list (red if the bare recipientRole=\'driver\' match comes back in getUnreadNotificationCountForDriver)', async () => {
    const list = await driverA3.get('/api/system-notifications');
    const count = await driverA3.get('/api/system-notifications/unread-count');
    expect(count.status).toBe(200);
    expect(count.body.count).toBe(list.body.length);
    expect(driverA3Id).toBeTruthy();
  });
});
