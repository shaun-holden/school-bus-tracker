// Q192: a parent reaches a child only through a parent_child_links row, on
// every path. students.parentId grants nothing: a parent who is only a
// student's parentId (no link) gets 404 or "not listed" on the parent
// screens, and is left out of route notices, alert recipients and the push
// fence. Q192 (2A): a parent can't add a student (POST /api/students → 403);
// admin and master creates are unchanged.
// Real HTTP + real Postgres. Each title names the clause whose deletion (or
// return) turns it red, and each guard asserts its seed first (X-1/X-2).
// Fixtures:
//   directParent  role parent, company A; students.parentId of directKid
//                 (company A, routeA), NO link row.
//   linkedParent  role parent, company A; linked to linkedKid (company A,
//                 routeA). The positive control on every site.
//   nullDirect    role parent, company NULL; students.parentId of
//                 nullDirectKid (company A, routeA), NO link row.
//   nullLinked    role parent, company NULL; linked to linkedKid (control).
//   masterKid     company A, students.parentId = master, NO link row.
//   masterLinkedKid company A, linked to master (the master's control).
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { eq, inArray, sql } from 'drizzle-orm';
import { attendance, parentChildLinks, studentAttendance, studentCheckIns, students, systemNotifications, users } from '@shared/schema';
import { useIntegrationHarness, type Agent } from './harness';
import { insertUser, SEED_PASSWORD } from './seed';
import { storage } from '../../server/storage';

const h = useIntegrationHarness();
const NOT_FOUND = { message: 'Student not found' };
const DIRECT_EMAIL = 'q192-direct-parent@sbt.test';
const LINKED_EMAIL = 'q192-linked-parent@sbt.test';
const SHORTCUT = 'red if the parentId shortcut comes back in getParentChildren';

let directParent: Agent;
let linkedParent: Agent;
let adminA: Agent;
let master: Agent;
let directParentId: string;
let linkedParentId: string;
let nullDirectId: string;
let nullLinkedId: string;
let directKid: string;
let linkedKid: string;
let nullDirectKid: string;
let masterKid: string;
let routeNotice: string;
const directCheckIns: string[] = [];
const seededAttendance: string[] = [];
const seededCheckIns: string[] = [];
const createdStudents: string[] = [];

const ids = (body: any[]) => body.map((r: any) => r.student?.id ?? r.studentId ?? r.id);
const linksOf = (parentId: string) => h.db.select().from(parentChildLinks).where(eq(parentChildLinks.parentId, parentId));
const studentRow = async (id: string) => (await h.db.select().from(students).where(eq(students.id, id)))[0];
const studentCount = async () => Number((await h.db.select({ n: sql<number>`count(*)` }).from(students))[0].n);

async function login(email: string): Promise<Agent> {
  const agent = h.anon();
  expect((await h.loginAttempt(email, SEED_PASSWORD, agent)).status).toBe(200);
  return agent;
}

async function mkKid(firstName: string, parentId: string) {
  const [s] = await h.db.insert(students).values({
    companyId: h.ids.companyA, firstName, lastName: 'Seed', parentId,
    schoolId: h.ids.schoolA, routeId: h.ids.routeA, stopId: h.ids.stopA1,
  }).returning({ id: students.id });
  return s.id;
}

beforeAll(async () => {
  directParentId = await insertUser(
    { email: DIRECT_EMAIL, firstName: 'Q192-Direct', lastName: 'Seed', role: 'parent', companyId: h.ids.companyA },
    { password: true },
  );
  linkedParentId = await insertUser(
    { email: LINKED_EMAIL, firstName: 'Q192-Linked', lastName: 'Seed', role: 'parent', companyId: h.ids.companyA },
    { password: true },
  );
  nullDirectId = await insertUser(
    { email: 'q192-null-direct@sbt.test', firstName: 'Q192-NullDirect', lastName: 'Seed', role: 'parent', companyId: null },
    { password: false },
  );
  nullLinkedId = await insertUser(
    { email: 'q192-null-linked@sbt.test', firstName: 'Q192-NullLinked', lastName: 'Seed', role: 'parent', companyId: null },
    { password: false },
  );
  directKid = await mkKid('Q192-DirectKid', directParentId);
  // linkedKid's parentId is adminA (as the admin form fills it); the link grants access.
  linkedKid = await mkKid('Q192-LinkedKid', h.ids.adminA);
  await h.db.insert(parentChildLinks).values([
    { parentId: linkedParentId, studentId: linkedKid },
    { parentId: nullLinkedId, studentId: linkedKid },
  ]);
  nullDirectKid = await mkKid('Q192-NullDirectKid', nullDirectId);
  masterKid = await mkKid('Q192-MasterKid', h.ids.master);

  // Today's rows (UTC wall time, as drizzle writes) so the today-only reads
  // have a directKid row to leave out and a linkedKid row to keep.
  const now = new Date();
  seededAttendance.push(...(await h.db.insert(studentAttendance).values([
    { companyId: h.ids.companyA, studentId: directKid, driverId: h.ids.driverA, routeId: h.ids.routeA, attendanceDate: now, status: 'present' },
    { companyId: h.ids.companyA, studentId: linkedKid, driverId: h.ids.driverA, routeId: h.ids.routeA, attendanceDate: now, status: 'present' },
  ]).returning({ id: studentAttendance.id })).map((r) => r.id));
  const [dci] = await h.db.insert(studentCheckIns).values(
    { companyId: h.ids.companyA, studentId: directKid, parentId: directParentId, deviceId: 'q192-direct', status: 'waiting', checkInDate: now },
  ).returning({ id: studentCheckIns.id });
  directCheckIns.push(dci.id);
  seededCheckIns.push(...(await h.db.insert(studentCheckIns).values(
    { companyId: h.ids.companyA, studentId: linkedKid, parentId: linkedParentId, deviceId: 'q192-linked', status: 'waiting', checkInDate: now },
  ).returning({ id: studentCheckIns.id })).map((r) => r.id));

  const [notice] = await h.db.insert(systemNotifications).values({
    companyId: h.ids.companyA, senderId: h.ids.driverA, senderRole: 'driver', recipientRole: 'route_parents',
    routeId: h.ids.routeA, title: 'Q192 route message', message: 'Q192 route message', type: 'info',
  }).returning({ id: systemNotifications.id });
  routeNotice = notice.id;

  // 4 logins (MAX_LOGINS_PER_FILE is 8).
  directParent = await login(DIRECT_EMAIL);
  linkedParent = await login(LINKED_EMAIL);
  adminA = await h.loginAs('adminA');
  master = await h.loginAs('master');
});

afterAll(async () => {
  const kids = [directKid, linkedKid, nullDirectKid, masterKid, ...createdStudents];
  await h.db.delete(studentAttendance).where(inArray(studentAttendance.studentId, kids));
  await h.db.delete(studentCheckIns).where(inArray(studentCheckIns.studentId, kids));
  await h.db.delete(attendance).where(inArray(attendance.studentId, kids));
  await h.db.delete(systemNotifications).where(eq(systemNotifications.id, routeNotice));
  await h.db.delete(parentChildLinks).where(inArray(parentChildLinks.studentId, kids));
  await h.db.delete(students).where(inArray(students.id, kids));
});

describe('Q192 seed', () => {
  it('seed: the direct-only parents are students.parentId with NO link; the controls are linked', async () => {
    expect(await studentRow(directKid)).toMatchObject({ companyId: h.ids.companyA, routeId: h.ids.routeA, parentId: directParentId });
    expect(await linksOf(directParentId)).toHaveLength(0);
    expect(await studentRow(nullDirectKid)).toMatchObject({ companyId: h.ids.companyA, routeId: h.ids.routeA, parentId: nullDirectId });
    expect(await linksOf(nullDirectId)).toHaveLength(0);
    const [nd] = await h.db.select().from(users).where(eq(users.id, nullDirectId));
    expect(nd).toMatchObject({ role: 'parent', companyId: null });
    expect(await studentRow(masterKid)).toMatchObject({ companyId: h.ids.companyA, parentId: h.ids.master });
    expect(await linksOf(h.ids.master)).toHaveLength(0);
    expect((await linksOf(linkedParentId)).map((l) => l.studentId)).toEqual([linkedKid]);
    expect((await linksOf(nullLinkedId)).map((l) => l.studentId)).toEqual([linkedKid]);
    const [nl] = await h.db.select().from(users).where(eq(users.id, nullLinkedId));
    expect(nl).toMatchObject({ role: 'parent', companyId: null });
    expect(seededAttendance).toHaveLength(2);
    expect(directCheckIns).toHaveLength(1);
    expect(seededCheckIns).toHaveLength(1);
  });
});

describe('Q192 parent screens use links only', () => {
  const lists = [
    { name: 'GET /api/parent/children-buses', url: '/api/parent/children-buses', former: true },
    { name: 'GET /api/check-in/status', url: '/api/check-in/status', former: true },
    { name: 'GET /api/parent/children-attendance', url: '/api/parent/children-attendance', former: true },
    { name: 'GET /api/students', url: '/api/students', former: false },
    { name: 'GET /api/my-children', url: '/api/my-children', former: false },
  ] as const;

  for (const site of lists) {
    const why = site.former ? SHORTCUT : 'red if `getParentChildren` reads `students.parentId` again';
    it(`a direct-only parent's ${site.name} leaves out the child; the linked parent's lists it (${why})`, async () => {
      const direct = await directParent.get(site.url);
      expect(direct.status).toBe(200);
      expect(ids(direct.body)).not.toContain(directKid);
      const linked = await linkedParent.get(site.url);
      expect(linked.status).toBe(200);
      expect(ids(linked.body)).toContain(linkedKid);
    });
  }

  describe('a master on GET /api/parent/children-buses', () => {
    let masterLinkedKid: string;

    beforeAll(async () => {
      // Q198 positive control: the master is linked to a second student.
      masterLinkedKid = await mkKid('Q192-MasterLinkedKid', h.ids.adminA);
      createdStudents.push(masterLinkedKid);
      await h.db.insert(parentChildLinks).values({ parentId: h.ids.master, studentId: masterLinkedKid });
    });

    it(`a master who is students.parentId of a student (no link) doesn't get it, but does get its linked student (${SHORTCUT})`, async () => {
      expect((await linksOf(h.ids.master)).map((l) => l.studentId)).toEqual([masterLinkedKid]);
      expect(await studentRow(masterKid)).toMatchObject({ companyId: h.ids.companyA, parentId: h.ids.master });
      const me = await master.get('/api/auth/user');
      expect(me.body).toMatchObject({ role: 'master_admin', companyId: null });
      const res = await master.get('/api/parent/children-buses');
      expect(res.status).toBe(200);
      expect(ids(res.body)).toContain(masterLinkedKid);
      expect(ids(res.body)).not.toContain(masterKid);
    });
  });

  it(`a direct-only parent: POST absence → 404 "Student not found", no row; the linked parent → 200 (${SHORTCUT})`, async () => {
    const res = await directParent.post(`/api/students/${directKid}/absence`).send({ date: '2026-12-01' });
    expect(res.status).toBe(404);
    expect(res.body).toEqual(NOT_FOUND);
    expect(await h.db.select().from(attendance).where(eq(attendance.studentId, directKid))).toHaveLength(0);
    const ok = await linkedParent.post(`/api/students/${linkedKid}/absence`).send({ date: '2026-12-01' });
    expect(ok.status).toBe(200);
  });

  it(`a direct-only parent: check-in enable → 404, no new row; the linked parent → 200 (${SHORTCUT})`, async () => {
    const res = await directParent.post('/api/check-in/enable').send({ studentId: directKid, deviceId: 'q192-enable' });
    expect(res.status).toBe(404);
    expect(res.body).toEqual(NOT_FOUND);
    const rows = await h.db.select().from(studentCheckIns).where(eq(studentCheckIns.studentId, directKid));
    expect(rows.map((r) => r.id)).toEqual(directCheckIns);
    const ok = await linkedParent.post('/api/check-in/enable').send({ studentId: linkedKid, deviceId: 'q192-linked' });
    expect(ok.status).toBe(200);
  });

  it(`a direct-only parent: check-in disable → 404, the waiting row unchanged; the linked parent → 200 (${SHORTCUT})`, async () => {
    const res = await directParent.post('/api/check-in/disable').send({ studentId: directKid });
    expect(res.status).toBe(404);
    expect(res.body).toEqual(NOT_FOUND);
    const [row] = await h.db.select().from(studentCheckIns).where(eq(studentCheckIns.id, directCheckIns[0]));
    expect(row).toMatchObject({ studentId: directKid, status: 'waiting' });
    const ok = await linkedParent.post('/api/check-in/disable').send({ studentId: linkedKid });
    expect(ok.status).toBe(200);
  });

  it(`a direct-only parent: set-check-in → 404, the waiting row unchanged; the linked parent → 200 (${SHORTCUT})`, async () => {
    const res = await directParent.post('/api/parent/set-check-in').send({ studentId: directKid, status: 'not_riding' });
    expect(res.status).toBe(404);
    expect(res.body).toEqual(NOT_FOUND);
    const [row] = await h.db.select().from(studentCheckIns).where(eq(studentCheckIns.id, directCheckIns[0]));
    expect(row.status).toBe('waiting');
    const ok = await linkedParent.post('/api/parent/set-check-in').send({ studentId: linkedKid, status: 'riding' });
    expect(ok.status).toBe(200);
  });
});

describe('Q192 storage paths use links only', () => {
  it('a direct-only parent does not see a route_parents system notice for its child\'s route; the linked parent does (red if getParentChildScope reads students.parentId again)', async () => {
    const [n] = await h.db.select().from(systemNotifications).where(eq(systemNotifications.id, routeNotice));
    expect(n).toMatchObject({ companyId: h.ids.companyA, recipientRole: 'route_parents', recipientId: null, routeId: h.ids.routeA });
    const direct = await directParent.get('/api/parent-notifications');
    expect(direct.status).toBe(200);
    expect(ids(direct.body)).not.toContain(routeNotice);
    const linked = await linkedParent.get('/api/parent-notifications');
    expect(linked.status).toBe(200);
    expect(ids(linked.body)).toContain(routeNotice);
  });

  it('getAlertRecipients for a routeA alert leaves out the direct-only parent and keeps the linked one (red if the students.parentId OR comes back in getAlertRecipients)', async () => {
    const recipients = await storage.getAlertRecipients(h.ids.companyA, h.ids.routeA);
    expect(recipients).not.toContain(directParentId);
    expect(recipients).toContain(linkedParentId);
  });

  it('getAlertRecipients for a global company-A alert leaves out the NULL-company direct-only parent and keeps the NULL-company linked parent (red if the students.parentId OR comes back in getAlertRecipients)', async () => {
    const recipients = await storage.getAlertRecipients(h.ids.companyA, null);
    expect(recipients).not.toContain(nullDirectId);
    expect(recipients).toContain(nullLinkedId);
  });

  it('filterPushRecipients for company A drops the NULL-company direct-only parent and keeps the NULL-company linked parent (red if the students.parentId OR comes back in filterPushRecipients)', async () => {
    const kept = await storage.filterPushRecipients([nullDirectId, nullLinkedId], h.ids.companyA);
    expect(kept).toEqual([nullLinkedId]);
  });
});

describe('Q192 route events use links only', () => {
  const TITLE = 'Bus Arrived at School';
  let driverA: Agent;

  beforeAll(async () => {
    // Q114: shift writes need the driver on duty (seeded off duty).
    await h.db.update(users).set({ isOnDuty: true, dutyStartTime: new Date() }).where(eq(users.id, h.ids.driverA));
    // 5th login (MAX_LOGINS_PER_FILE is 8).
    driverA = await h.loginAs('driverA');
  });

  afterAll(async () => {
    await h.db.delete(systemNotifications).where(eq(systemNotifications.title, TITLE));
    await h.db.update(users).set({ isOnDuty: false, dutyStartTime: null }).where(eq(users.id, h.ids.driverA));
  });

  it('a driver arrival at schoolA on routeA writes a row for the linked parent and none for the same-company direct-only parent (red if `routeParentRows` reads `students.parentId` again)', async () => {
    const [drv] = await h.db.select().from(users).where(eq(users.id, h.ids.driverA));
    expect(drv).toMatchObject({ companyId: h.ids.companyA, assignedRouteId: h.ids.routeA, isOnDuty: true });
    expect(await studentRow(directKid)).toMatchObject({ companyId: h.ids.companyA, routeId: h.ids.routeA, schoolId: h.ids.schoolA, parentId: directParentId });
    expect(await linksOf(directParentId)).toHaveLength(0);
    const [dp] = await h.db.select().from(users).where(eq(users.id, directParentId));
    expect(dp).toMatchObject({ role: 'parent', companyId: h.ids.companyA });
    expect(await studentRow(linkedKid)).toMatchObject({ companyId: h.ids.companyA, routeId: h.ids.routeA, schoolId: h.ids.schoolA });
    // Q201: the positive control's link, and no leftover arrival rows.
    expect((await linksOf(linkedParentId)).map((l) => l.studentId)).toContain(linkedKid);
    expect(await h.db.select().from(systemNotifications).where(eq(systemNotifications.title, TITLE))).toHaveLength(0);

    const res = await driverA.post('/api/driver-school-arrival').send({ schoolId: h.ids.schoolA });
    expect(res.status).toBe(200);
    const rows = await h.db.select().from(systemNotifications).where(eq(systemNotifications.title, TITLE));
    expect(rows.filter((r) => r.recipientId === linkedParentId)).toHaveLength(1);
    expect(rows.filter((r) => r.recipientId === directParentId)).toHaveLength(0);
  });
});

describe('Q192 (2A) parents can\'t add students', () => {
  const body = (parentId: string, name: string) => ({ firstName: name, lastName: 'Seed', parentId });

  it('a parent POST /api/students → 403 "Parents can\'t add students" and no new row (red if parents can create students again; the message tells it from the admin-gate 403)', async () => {
    const before = await studentCount();
    const res = await linkedParent.post('/api/students').send(body(linkedParentId, 'Q192-ParentAdd'));
    expect(res.status).toBe(403);
    expect(res.body).toEqual({ message: "Parents can't add students" });
    expect(await studentCount()).toBe(before);
    expect(await h.db.select().from(students).where(eq(students.firstName, 'Q192-ParentAdd'))).toHaveLength(0);
  });

  it('an admin POST /api/students → 201 in the admin\'s company (control)', async () => {
    const res = await adminA.post('/api/students').send({ ...body(h.ids.adminA, 'Q192-AdminAdd'), schoolId: h.ids.schoolA });
    expect(res.status).toBe(201);
    createdStudents.push(res.body.id);
    expect(await studentRow(res.body.id)).toMatchObject({ companyId: h.ids.companyA, firstName: 'Q192-AdminAdd' });
  });

  it('an unscoped master POST /api/students → 201 (red if the parent 403 catches masters)', async () => {
    const me = await master.get('/api/auth/user');
    expect(me.body).toMatchObject({ role: 'master_admin', companyId: null });
    const res = await master.post('/api/students').send(body(h.ids.master, 'Q192-MasterAdd'));
    expect(res.status).toBe(201);
    createdStudents.push(res.body.id);
    expect(await studentRow(res.body.id)).toMatchObject({ companyId: null, firstName: 'Q192-MasterAdd' });
  });

  it('an impersonating master POST /api/students → 201 in the impersonated company (red if the parent 403 catches masters)', async () => {
    const imp = await master.post(`/api/master-admin/impersonate/${h.ids.companyA}`).send({});
    expect(imp.status).toBe(200);
    try {
      const me = await master.get('/api/auth/user');
      expect(me.body).toMatchObject({ role: 'master_admin', companyId: h.ids.companyA, _masterAdminImpersonating: true });
      const res = await master.post('/api/students').send({ ...body(h.ids.master, 'Q192-ImpAdd'), schoolId: h.ids.schoolA });
      expect(res.status).toBe(201);
      createdStudents.push(res.body.id);
      expect(await studentRow(res.body.id)).toMatchObject({ companyId: h.ids.companyA, firstName: 'Q192-ImpAdd' });
    } finally {
      expect((await master.post('/api/master-admin/stop-impersonating').send({})).status).toBe(200);
    }
  });
});
