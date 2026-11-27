// Q88: GET /api/parent-notifications merges the parent's system notices (the
// per-parent bus-event rows and the broadcasts they may see) with their
// parent_notifications rows, with real isRead, capped; the badge counts both;
// both mark-read endpoints accept either kind but only for rows the caller can
// see; mark-all never touches broadcasts; admins no longer see, mark read or
// delete the per-parent copies; NULL-company parents see their rows fenced to
// their children's companies. Real HTTP + real Postgres; every foreign row is
// seeded and asserted to exist (checklist X-1/X-2/X-3).
//
// Tests run in order on one seeded DB. Each title names the clause whose
// deletion turns it red.
import { describe, it, expect, beforeAll } from 'vitest';
import { and, eq, inArray } from 'drizzle-orm';
import { notificationReads, parentChildLinks, parentNotifications, students, systemNotifications } from '@shared/schema';
import { useIntegrationHarness, type Agent } from './harness';
import { insertUser, SEED_PASSWORD } from './seed';

const h = useIntegrationHarness();
const CAP = 200;

const EMAIL_A2 = 'q88-parent-a2@sbt.test';
const EMAIL_NULL_LINKED = 'q88-null-linked@sbt.test';
const EMAIL_NULL_NO_KIDS = 'q88-null-no-kids@sbt.test';
const EMAIL_DIRECT_ONLY = 'q88-direct-only@sbt.test';
const EMAIL_CAP = 'q88-cap@sbt.test';

let parentA: Agent;
let adminA: Agent;
let impersonator: Agent; // master admin impersonating company A
let nullLinked: Agent;
let nullNoKids: Agent;
let directOnly: Agent;
let capParent: Agent;

let parentA2Id: string;
let nullLinkedId: string;
let nullNoKidsId: string;
let directOnlyId: string;
let capParentId: string;

// system_notifications ids
let sysDropA: string; // per-parent "Dropped Off" → parentA
let sysDepartA: string; // per-parent "Bus Departed" → parentA
let sysArriveA: string; // per-parent "Bus Arrived at Stop" → parentA (left for mark-all)
let sysA2: string; // per-parent → parentA2 (same school)
let sysBToParentA: string; // per-parent in company B addressed to parentA
let broadcastA: string; // all_parents, company A
let broadcastB: string; // all_parents, company B
let routeMsgA: string; // driver route_parents on routeA
let nullLinkedOwnA: string; // per-parent A row → nullLinked
let nullNoKidsOwnA: string; // per-parent A row → nullNoKids
let capSystemIds: string[];
// parent_notifications ids
let alertA: string; // global A admin alert
let alertA2: string; // second global A alert (left for mark-all)
let targetedA2: string; // targeted at parentA2
let capOldest: string; // targeted at capParent, older than its 200 system rows

const base = Date.now() - 60 * 60 * 1000;
const at = (minutes: number) => new Date(base + minutes * 60 * 1000);

async function login(email: string): Promise<Agent> {
  const agent = h.anon();
  const res = await h.loginAttempt(email, SEED_PASSWORD, agent);
  expect(res.status).toBe(200);
  return agent;
}

async function sysNotice(values: Partial<typeof systemNotifications.$inferInsert> & { title: string }) {
  const [row] = await h.db
    .insert(systemNotifications)
    .values({
      companyId: h.ids.companyA,
      senderId: h.ids.driverA,
      senderRole: 'driver',
      recipientRole: 'parent',
      message: `${values.title} message`,
      type: 'info',
      ...values,
    })
    .returning({ id: systemNotifications.id });
  return row.id;
}

async function parentNotice(values: Partial<typeof parentNotifications.$inferInsert> & { title: string }) {
  const [row] = await h.db
    .insert(parentNotifications)
    .values({ companyId: h.ids.companyA, createdById: h.ids.adminA, message: `${values.title} message`, type: 'info', ...values })
    .returning({ id: parentNotifications.id });
  return row.id;
}

const sysRow = async (id: string) => (await h.db.select().from(systemNotifications).where(eq(systemNotifications.id, id)))[0];
const readRow = async (notificationId: string, parentId: string) =>
  (await h.db.select().from(notificationReads).where(and(eq(notificationReads.notificationId, notificationId), eq(notificationReads.parentId, parentId))))[0];

type Item = { id: string; source: 'parent' | 'system'; isRead: boolean; createdAt: string | null; title: string; message: string; type: string };
const list = async (agent: Agent): Promise<Item[]> => {
  const res = await agent.get('/api/parent-notifications');
  expect(res.status).toBe(200);
  return res.body;
};
const badge = async (agent: Agent): Promise<number> => {
  const res = await agent.get('/api/parent-notifications/unread-count');
  expect(res.status).toBe(200);
  expect(Object.keys(res.body)).toEqual(['unreadCount']);
  return res.body.unreadCount;
};
const find = (items: Item[], id: string) => items.find((n) => n.id === id);

beforeAll(async () => {
  parentA2Id = await insertUser(
    { email: EMAIL_A2, firstName: 'Q88-A2', lastName: 'Seed', role: 'parent', companyId: h.ids.companyA },
    { password: false },
  );
  nullLinkedId = await insertUser(
    { email: EMAIL_NULL_LINKED, firstName: 'Q88-NullLinked', lastName: 'Seed', role: 'parent', companyId: null },
    { password: true },
  );
  await h.db.insert(parentChildLinks).values({ parentId: nullLinkedId, studentId: h.ids.studentA });
  nullNoKidsId = await insertUser(
    { email: EMAIL_NULL_NO_KIDS, firstName: 'Q88-NullNoKids', lastName: 'Seed', role: 'parent', companyId: null },
    { password: true },
  );
  directOnlyId = await insertUser(
    { email: EMAIL_DIRECT_ONLY, firstName: 'Q88-DirectOnly', lastName: 'Seed', role: 'parent', companyId: h.ids.companyA },
    { password: true },
  );
  await h.db.insert(students).values({
    companyId: h.ids.companyA, firstName: 'Q88-DirectKid', lastName: 'Seed', parentId: directOnlyId,
    schoolId: h.ids.schoolA, routeId: h.ids.routeA, stopId: h.ids.stopA1,
  });
  capParentId = await insertUser(
    { email: EMAIL_CAP, firstName: 'Q88-Cap', lastName: 'Seed', role: 'parent', companyId: h.ids.companyA },
    { password: true },
  );

  sysDropA = await sysNotice({ title: 'Dropped Off', recipientId: h.ids.parentA, routeId: h.ids.routeA, createdAt: at(10) });
  sysDepartA = await sysNotice({ title: 'Bus Departed from School', recipientId: h.ids.parentA, routeId: h.ids.routeA, createdAt: at(5) });
  sysArriveA = await sysNotice({ title: 'Bus Arrived at Stop', recipientId: h.ids.parentA, routeId: h.ids.routeA, createdAt: at(3) });
  sysA2 = await sysNotice({ title: 'Q88 A2 bus event', recipientId: parentA2Id, routeId: h.ids.routeA, createdAt: at(4) });
  sysBToParentA = await sysNotice({ title: 'Q88 B row to parentA', companyId: h.ids.companyB, senderId: h.ids.driverB, recipientId: h.ids.parentA, createdAt: at(6) });
  broadcastA = await sysNotice({ title: 'Q88 A broadcast', senderId: h.ids.adminA, senderRole: 'admin', recipientRole: 'all_parents', createdAt: at(2) });
  broadcastB = await sysNotice({ title: 'Q88 B broadcast', companyId: h.ids.companyB, senderId: h.ids.adminB, senderRole: 'admin', recipientRole: 'all_parents', createdAt: at(2) });
  routeMsgA = await sysNotice({ title: 'Q88 route message', recipientRole: 'route_parents', routeId: h.ids.routeA, createdAt: at(1) });
  nullLinkedOwnA = await sysNotice({ title: 'Q88 null-linked own', recipientId: nullLinkedId, routeId: h.ids.routeA, createdAt: at(7) });
  nullNoKidsOwnA = await sysNotice({ title: 'Q88 null-no-kids own', recipientId: nullNoKidsId, createdAt: at(7) });

  alertA = await parentNotice({ title: 'Q88 admin alert', isGlobal: true, createdAt: at(8) });
  alertA2 = await parentNotice({ title: 'Q88 admin alert 2', isGlobal: true, createdAt: at(9) });
  targetedA2 = await parentNotice({ title: 'Q88 targeted A2', targetParentId: parentA2Id, createdAt: at(9) });

  // A12: capParent gets CAP + 1 items, all newer than anything above; the
  // OLDEST of them is a parent_notifications row.
  const future = Date.now() + 24 * 60 * 60 * 1000;
  capOldest = await parentNotice({ title: 'Q88 cap oldest', targetParentId: capParentId, createdAt: new Date(future) });
  const capRows = await h.db
    .insert(systemNotifications)
    .values(Array.from({ length: CAP }, (_, i) => ({
      companyId: h.ids.companyA, senderId: h.ids.driverA, senderRole: 'driver' as const, recipientRole: 'parent' as const,
      recipientId: capParentId, title: `Q88 cap ${i}`, message: 'cap', type: 'info' as const,
      createdAt: new Date(future + (i + 1) * 1000),
    })))
    .returning({ id: systemNotifications.id });
  capSystemIds = capRows.map((r) => r.id);

  // X-3: every row landed as written.
  const sys = await h.db.select().from(systemNotifications).where(inArray(systemNotifications.id, [
    sysDropA, sysDepartA, sysArriveA, sysA2, sysBToParentA, broadcastA, broadcastB, routeMsgA, nullLinkedOwnA, nullNoKidsOwnA,
  ]));
  const byId = new Map(sys.map((r) => [r.id, r]));
  expect(byId.size).toBe(10);
  expect(byId.get(sysBToParentA)).toMatchObject({ companyId: h.ids.companyB, recipientId: h.ids.parentA, recipientRole: 'parent' });
  expect(byId.get(broadcastB)).toMatchObject({ companyId: h.ids.companyB, recipientId: null, recipientRole: 'all_parents' });
  expect(byId.get(broadcastA)).toMatchObject({ companyId: h.ids.companyA, recipientId: null, recipientRole: 'all_parents' });
  expect(byId.get(routeMsgA)).toMatchObject({ companyId: h.ids.companyA, recipientId: null, recipientRole: 'route_parents', routeId: h.ids.routeA });
  expect(byId.get(sysA2)).toMatchObject({ companyId: h.ids.companyA, recipientId: parentA2Id });
  expect(byId.get(nullLinkedOwnA)).toMatchObject({ companyId: h.ids.companyA, recipientId: nullLinkedId });
  expect(byId.get(nullNoKidsOwnA)).toMatchObject({ companyId: h.ids.companyA, recipientId: nullNoKidsId });
  for (const r of sys) expect(r.isRead).toBe(false);
  expect(capSystemIds).toHaveLength(CAP);
  const [tA2] = await h.db.select().from(parentNotifications).where(eq(parentNotifications.id, targetedA2));
  expect(tA2.targetParentId).toBe(parentA2Id);

  // 7 logins (MAX_LOGINS_PER_FILE is 8).
  parentA = await h.loginAs('parentA');
  adminA = await h.loginAs('adminA');
  impersonator = await h.loginAs('master');
  nullLinked = await login(EMAIL_NULL_LINKED);
  nullNoKids = await login(EMAIL_NULL_NO_KIDS);
  directOnly = await login(EMAIL_DIRECT_ONLY);
  capParent = await login(EMAIL_CAP);

  const imp = await impersonator.post(`/api/master-admin/impersonate/${h.ids.companyA}`).send({});
  expect(imp.status).toBe(200);
  const me = await impersonator.get('/api/auth/user');
  expect(me.body).toMatchObject({ role: 'master_admin', companyId: h.ids.companyA, _masterAdminImpersonating: true });
});

describe('Q88 merged parent list, read state and badge', () => {
  it('A1 system rows merged into GET /api/parent-notifications (source system + parent), newest first', async () => {
    const items = await list(parentA);
    const drop = find(items, sysDropA);
    expect(drop).toMatchObject({ source: 'system', title: 'Dropped Off', type: 'info', isRead: false });
    expect(drop).toHaveProperty('message');
    const alert = find(items, alertA);
    expect(alert).toMatchObject({ source: 'parent', title: 'Q88 admin alert', isRead: false });
    expect(alert).toHaveProperty('estimatedDelay');
    expect(find(items, routeMsgA)?.source).toBe('system');
    const times = items.map((n) => (n.createdAt ? new Date(n.createdAt).getTime() : 0));
    expect([...times].sort((a, b) => b - a)).toEqual(times);
    expect(items.findIndex((n) => n.id === sysDropA)).toBeLessThan(items.findIndex((n) => n.id === alertA));
  });

  it('A2 parent rows carry real isRead (notification_reads for the caller): false, then true after POST read', async () => {
    expect(find(await list(parentA), alertA)?.isRead).toBe(false);
    const res = await parentA.post(`/api/notifications/${alertA}/read`).send({});
    expect(res.status).toBe(200);
    expect(find(await list(parentA), alertA)?.isRead).toBe(true);
  });

  it('A3 POST /api/notifications/<system id>/read marks the system row (was a 500)', async () => {
    const res = await parentA.post(`/api/notifications/${sysDropA}/read`).send({});
    expect(res.status).toBe(200);
    expect((await sysRow(sysDropA)).isRead).toBe(true);
    expect(find(await list(parentA), sysDropA)?.isRead).toBe(true);
  });

  it('A4 POST read visibility check: another parent\'s rows and another school\'s row → 404, nothing written', async () => {
    for (const id of [targetedA2, sysA2, sysBToParentA]) {
      const res = await parentA.post(`/api/notifications/${id}/read`).send({});
      expect(res.status).toBe(404);
      expect(res.body).toEqual({ message: 'Notification not found' });
    }
    expect(await readRow(targetedA2, h.ids.parentA)).toBeUndefined();
    expect((await sysRow(sysA2)).isRead).toBe(false);
    expect((await sysRow(sysBToParentA)).isRead).toBe(false);
  });

  it('A4b step-0 role gate: an impersonating master gets no system rows and can\'t mark one read', async () => {
    const items = await list(impersonator);
    expect(items.filter((n) => n.source === 'system')).toEqual([]);
    const res = await impersonator.post(`/api/notifications/${broadcastA}/read`).send({});
    expect(res.status).toBe(404);
    expect((await sysRow(broadcastA)).isRead).toBe(false);
  });

  it('A5 badge = parent unread + system unread; drops by 1 after a system read', async () => {
    const before = await badge(parentA);
    const items = await list(parentA);
    expect(items.length).toBeLessThan(CAP);
    expect(before).toBe(items.filter((n) => !n.isRead).length);
    expect(items.some((n) => n.source === 'system' && !n.isRead)).toBe(true);
    const res = await parentA.post(`/api/notifications/${sysDepartA}/read`).send({});
    expect(res.status).toBe(200);
    expect(await badge(parentA)).toBe(before - 1);
  });

  it('A6 mark-all marks only recipient_id = parent AND recipient_role = parent rows (+ parent rows); broadcasts and others stay unread', async () => {
    expect((await sysRow(sysArriveA)).isRead).toBe(false);
    expect(await readRow(alertA2, h.ids.parentA)).toBeUndefined();
    const res = await parentA.post('/api/notifications/mark-all-read').send({});
    expect(res.status).toBe(200);
    expect((await sysRow(sysArriveA)).isRead).toBe(true);
    expect(await readRow(alertA2, h.ids.parentA)).toBeDefined();
    expect((await sysRow(broadcastA)).isRead).toBe(false);
    expect((await sysRow(routeMsgA)).isRead).toBe(false);
    expect((await sysRow(sysA2)).isRead).toBe(false);
    expect(await readRow(targetedA2, parentA2Id)).toBeUndefined();
    const items = await list(parentA);
    expect(items.filter((n) => !n.isRead).map((n) => n.id).sort()).toEqual([broadcastA, routeMsgA].sort());
  });

  it('A6b mark-all company_id IN (allowed): a company-B row addressed to parentA stays unread', async () => {
    const row = await sysRow(sysBToParentA);
    expect(row).toMatchObject({ companyId: h.ids.companyB, recipientId: h.ids.parentA });
    expect(row.isRead).toBe(false);
  });
});

describe('Q88 admin no longer sees per-parent copies', () => {
  it('A7 admin list excludes per-parent copies (keeps the driver route_parents row); count matches', async () => {
    const res = await adminA.get('/api/system-notifications');
    expect(res.status).toBe(200);
    const ids = (res.body as Array<{ id: string }>).map((n) => n.id);
    expect(ids).not.toContain(sysA2);
    expect(ids).not.toContain(sysArriveA);
    expect(ids).toContain(routeMsgA);
    expect(ids).toContain(broadcastA);
    const count = await adminA.get('/api/system-notifications/unread-count');
    expect(count.status).toBe(200);
    expect(count.body.count).toBe((res.body as Array<{ isRead: boolean | null }>).filter((n) => n.isRead !== true).length);
  });

  it('A8 admin PATCH read and DELETE on a per-parent copy → 404, row unchanged and still there', async () => {
    const patch = await adminA.patch(`/api/system-notifications/${sysA2}/read`).send({});
    expect(patch.status).toBe(404);
    const del = await adminA.delete(`/api/system-notifications/${sysA2}`);
    expect(del.status).toBe(404);
    expect(del.body).toEqual({ message: 'Notification not found' });
    const row = await sysRow(sysA2);
    expect(row).toBeDefined();
    expect(row.isRead).toBe(false);
  });
});

describe('Q88 NULL-company and direct parents', () => {
  it('A9 NULL-company parent: company_id IN (child companies); own A row + A broadcast listed, B broadcast not; reads work', async () => {
    const items = await list(nullLinked);
    const ids = items.map((n) => n.id);
    expect(ids).toContain(nullLinkedOwnA);
    expect(ids).toContain(broadcastA);
    expect(ids).not.toContain(broadcastB);
    expect(await badge(nullLinked)).toBe(items.filter((n) => !n.isRead).length);

    const sysCount = await nullLinked.get('/api/system-notifications/unread-count');
    expect(sysCount.status).toBe(200);
    expect(sysCount.body.count).toBe(items.filter((n) => n.source === 'system' && !n.isRead).length);

    const patch = await nullLinked.patch(`/api/system-notifications/${nullLinkedOwnA}/read`).send({});
    expect(patch.status).toBe(200);
    const post = await nullLinked.post(`/api/notifications/${nullLinkedOwnA}/read`).send({});
    expect(post.status).toBe(200);
    expect((await sysRow(nullLinkedOwnA)).isRead).toBe(true);
  });

  it('A10 NULL-company parent with no children: no child companies → no rows (never unfiltered)', async () => {
    expect((await sysRow(nullNoKidsOwnA)).recipientId).toBe(nullNoKidsId);
    expect((await sysRow(broadcastA)).recipientRole).toBe('all_parents');
    expect(await list(nullNoKids)).toEqual([]);
    expect(await badge(nullNoKids)).toBe(0);
  });

  // Q192: students.parentId grants nothing, so a direct-only parent (no link)
  // gets no route rows; only their company's broadcasts and global alerts.
  it('A11 a direct-only parent (students.parentId, no link) does not see the routeA driver message (still sees company-wide rows), and the badge counts only what it lists (red if getParentChildScope reads students.parentId again)', async () => {
    const [kid] = await h.db.select().from(students).where(eq(students.parentId, directOnlyId));
    expect(kid).toMatchObject({ companyId: h.ids.companyA, routeId: h.ids.routeA });
    expect(await h.db.select().from(parentChildLinks).where(eq(parentChildLinks.parentId, directOnlyId))).toHaveLength(0);
    const items = await list(directOnly);
    expect(find(items, routeMsgA)).toBeUndefined();
    expect(items.map((n) => n.id)).toEqual(expect.arrayContaining([alertA, alertA2, broadcastA]));
    expect(await badge(directOnly)).toBe(items.filter((n) => !n.isRead).length);
  });

  it('A12 PARENT_NOTICE_LIST_CAP: CAP + 1 items → CAP returned, the oldest dropped', async () => {
    const items = await list(capParent);
    expect(items).toHaveLength(CAP);
    expect(items.map((n) => n.id).sort()).toEqual([...capSystemIds].sort());
    expect(find(items, capOldest)).toBeUndefined();
  });
});
