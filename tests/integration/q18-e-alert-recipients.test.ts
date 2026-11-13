// Q18 Part E (E7, DeShaun's decisions 6 + B1): POST /api/notifications
// (admin alert) pushes exactly the parents who see the alert in the app.
// Route alert: parents of company-A students on that route. Global alert:
// company-A parents plus null-company parents linked to an A student. Never
// a company-B parent, an inactive parent or a non-parent. Foreign routeId /
// busId give 404 and an over-long title 400, with no row and no push.
// Asserts on the mocked pushService.notifyUsersOfAlert arguments (the
// integration setup mocks pushService). Real HTTP + real Postgres.
import { describe, it, expect, beforeAll, beforeEach, vi } from 'vitest';
import { eq } from 'drizzle-orm';
import { routes, students, parentChildLinks, parentNotifications } from '@shared/schema';
import { pushService } from '../../server/pushService';
import { useIntegrationHarness, type Agent } from './harness';
import { insertUser, SEED_PASSWORD } from './seed';

const h = useIntegrationHarness();
const URL = '/api/notifications';
const PARENT_A3_EMAIL = 'q18e-parent-a3@sbt.test';

let adminA: Agent;
let parentA: Agent;
let parentA3: Agent;
let parentNull: Agent;
let parentB: Agent;

let parentA3Id: string;
let parentInactiveId: string;
let routeA2: string;

const pushMock = () => vi.mocked(pushService.notifyUsersOfAlert);
const pushedIds = () => {
  expect(pushMock()).toHaveBeenCalledTimes(1);
  return [...(pushMock().mock.calls[0][0] as string[])].sort();
};
const noticeCount = async () => (await h.db.select().from(parentNotifications)).length;

async function login(email: string): Promise<Agent> {
  const agent = h.anon();
  const res = await h.loginAttempt(email, SEED_PASSWORD, agent);
  expect(res.status).toBe(200);
  return agent;
}

async function seesInApp(agent: Agent, id: string): Promise<boolean> {
  const res = await agent.get('/api/parent-notifications');
  expect(res.status).toBe(200);
  return res.body.some((n: { id: string }) => n.id === id);
}

beforeAll(async () => {
  const A = h.ids.companyA;
  const [r2] = await h.db.insert(routes).values({ companyId: A, name: 'A-Route2', schoolId: h.ids.schoolA }).returning({ id: routes.id });
  routeA2 = r2.id;

  // parentA3: company A, child on routeA2 only.
  parentA3Id = await insertUser(
    { email: PARENT_A3_EMAIL, firstName: 'A-Parent3', lastName: 'Seed', role: 'parent', companyId: A },
    { password: true },
  );
  const [s3] = await h.db
    .insert(students)
    .values({ companyId: A, firstName: 'A-Student3', lastName: 'Seed', parentId: parentA3Id, schoolId: h.ids.schoolA, routeId: routeA2 })
    .returning({ id: students.id });
  await h.db.insert(parentChildLinks).values({ parentId: parentA3Id, studentId: s3.id });

  // Inactive company-A parent of an A student on routeA.
  parentInactiveId = await insertUser(
    { email: 'q18e-parent-inactive@sbt.test', firstName: 'A-ParentOff', lastName: 'Seed', role: 'parent', companyId: A, isActive: false },
    { password: false },
  );
  await h.db.insert(parentChildLinks).values({ parentId: parentInactiveId, studentId: h.ids.studentA });

  // parentNull (no company) linked to studentA (routeA). parentB (company B)
  // linked by mistake to studentA: never an A recipient.
  await h.db.insert(parentChildLinks).values([
    { parentId: h.ids.parentNull, studentId: h.ids.studentA },
    { parentId: h.ids.parentB, studentId: h.ids.studentA },
  ]);

  // 5 logins (MAX_LOGINS_PER_FILE is 8).
  adminA = await h.loginAs('adminA');
  parentA = await h.loginAs('parentA');
  parentA3 = await login(PARENT_A3_EMAIL);
  parentNull = await h.loginAs('parentNull');
  parentB = await h.loginAs('parentB');
});

beforeEach(() => {
  pushMock().mockClear();
});

describe('E route alert', () => {
  it('a routeA alert pushes parentA and parentNull (children on routeA) but not parentA3 (child on routeA2) (red if the students.routeId = routeId clause is dropped)', async () => {
    const res = await adminA.post(URL).send({ type: 'delay', title: 'Route A late', message: 'About 10 minutes', routeId: h.ids.routeA, isGlobal: false });
    expect(res.status).toBe(200);
    expect(pushedIds()).toEqual([h.ids.parentA, h.ids.parentNull].sort());
  });

  it('the pushed set matches who sees the route alert in the app (parentA yes, parentA3 no, parentB no)', async () => {
    const res = await adminA.post(URL).send({ type: 'info', title: 'Route A note', message: 'Hello', routeId: h.ids.routeA });
    expect(res.status).toBe(200);
    const pushed = pushedIds();
    expect(await seesInApp(parentA, res.body.id)).toBe(true);
    expect(pushed).toContain(h.ids.parentA);
    expect(await seesInApp(parentA3, res.body.id)).toBe(false);
    expect(pushed).not.toContain(parentA3Id);
    expect(await seesInApp(parentB, res.body.id)).toBe(false);
    expect(pushed).not.toContain(h.ids.parentB);
  });
});

describe('E global alert', () => {
  it('a global alert pushes company-A parents and the null-company parent linked to an A student, not the company-B parent, the inactive parent or admins (red if recipients go back to getUsersByCompanyId by role)', async () => {
    const res = await adminA.post(URL).send({ type: 'emergency', title: 'Snow day', message: 'No buses today', isGlobal: true });
    expect(res.status).toBe(200);
    const pushed = pushedIds();
    expect(pushed).toEqual([h.ids.parentA, parentA3Id, h.ids.parentNull].sort());
    expect(pushed).not.toContain(h.ids.parentB);
    expect(pushed).not.toContain(parentInactiveId);
    expect(pushed).not.toContain(h.ids.adminA);
  });

  it('the pushed set matches who sees the global alert in the app', async () => {
    const res = await adminA.post(URL).send({ type: 'info', title: 'Global note', message: 'Hello all', routeId: 'all' });
    expect(res.status).toBe(200);
    const pushed = pushedIds();
    for (const [agent, id] of [[parentA, h.ids.parentA], [parentA3, parentA3Id], [parentNull, h.ids.parentNull], [parentB, h.ids.parentB]] as const) {
      expect(await seesInApp(agent, res.body.id)).toBe(pushed.includes(id));
    }
  });

  it('isGlobal true with a routeId still reaches the whole company', async () => {
    const res = await adminA.post(URL).send({ type: 'info', title: 'Global with route', message: 'Hi', routeId: routeA2, isGlobal: true });
    expect(res.status).toBe(200);
    expect(pushedIds()).toEqual([h.ids.parentA, parentA3Id, h.ids.parentNull].sort());
  });
});

describe('E refusals (no row, no push)', () => {
  it('company B\'s routeId gives 404 (red if isRouteInCompany(effectiveRouteId, user.companyId) is deleted)', async () => {
    const before = await noticeCount();
    const res = await adminA.post(URL).send({ type: 'delay', title: 'Foreign route', message: 'x', routeId: h.ids.routeB });
    expect(res.status).toBe(404);
    expect(await noticeCount()).toBe(before);
    expect(pushMock()).not.toHaveBeenCalled();
  });

  it('company B\'s busId gives 404 (red if the bus company check is deleted)', async () => {
    const before = await noticeCount();
    const res = await adminA.post(URL).send({ type: 'delay', title: 'Foreign bus', message: 'x', routeId: h.ids.routeA, busId: h.ids.busB });
    expect(res.status).toBe(404);
    expect(await noticeCount()).toBe(before);
    expect(pushMock()).not.toHaveBeenCalled();
  });

  it('a title over 100 characters gives 400 (local Zod body)', async () => {
    const before = await noticeCount();
    const res = await adminA.post(URL).send({ type: 'info', title: 'x'.repeat(101), message: 'x' });
    expect(res.status).toBe(400);
    expect(await noticeCount()).toBe(before);
    expect(pushMock()).not.toHaveBeenCalled();
  });

  it('a message over 300 characters or an unknown type gives 400', async () => {
    expect((await adminA.post(URL).send({ type: 'info', title: 'ok', message: 'x'.repeat(301) })).status).toBe(400);
    expect((await adminA.post(URL).send({ type: 'party', title: 'ok', message: 'ok' })).status).toBe(400);
    expect(pushMock()).not.toHaveBeenCalled();
  });

  it('a 100-character title and a 300-character message are accepted', async () => {
    const res = await adminA.post(URL).send({ type: 'info', title: 'x'.repeat(100), message: 'y'.repeat(300) });
    expect(res.status).toBe(200);
  });
});

describe('E row shape', () => {
  it('the routeA alert row is stored with company A, routeA and isGlobal false', async () => {
    const res = await adminA.post(URL).send({ type: 'delay', title: 'Row shape', message: 'x', routeId: h.ids.routeA });
    expect(res.status).toBe(200);
    const [row] = await h.db.select().from(parentNotifications).where(eq(parentNotifications.id, res.body.id));
    expect(row.companyId).toBe(h.ids.companyA);
    expect(row.routeId).toBe(h.ids.routeA);
    expect(row.isGlobal).toBe(false);
  });
});
