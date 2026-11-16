// Q78 (READER SC-1, SC-2, SC-3, SC-15): body FK ids in POST /api/driver-tasks
// and POST /api/buses must name a driver of the caller's school; a driver's
// task list is company-filtered; completing a task needs the assignee or an
// admin of the task's school (unscoped master refused, impersonating master
// scoped); POST /api/attendance is removed. Real HTTP + real Postgres; the
// foreign drivers and tasks are seeded and asserted to land so each clause is
// reachable (checklist X-1/X-2/X-3).
//
// Each title names the clause whose deletion turns it red.
import { describe, it, expect, beforeAll } from 'vitest';
import { randomUUID } from 'crypto';
import { and, eq } from 'drizzle-orm';
import { attendance, buses, driverTasks, users } from '@shared/schema';
import { useIntegrationHarness, type Agent } from './harness';

const h = useIntegrationHarness();
const TASKS = '/api/driver-tasks';
const complete = (id: string) => `/api/driver-tasks/${id}/complete`;

let adminA: Agent;
let driverA: Agent;
let driverAdminA: Agent;
let driverB: Agent;
let master: Agent; // master admin, NOT impersonating
let impersonator: Agent; // master admin impersonating company A

let taskA: string;
let taskB: string;
let taskNull: string;
let taskA2: string;

const taskRow = async (id: string) => (await h.db.select().from(driverTasks).where(eq(driverTasks.id, id)))[0];
const tasksTitled = (title: string) => h.db.select().from(driverTasks).where(eq(driverTasks.title, title));
const busesNumbered = (busNumber: string) => h.db.select().from(buses).where(eq(buses.busNumber, busNumber));
// Each test that changes taskA sets the starting state it needs itself.
const setTask = (id: string, isCompleted: boolean) =>
  h.db.update(driverTasks).set({ isCompleted, completedAt: null }).where(eq(driverTasks.id, id));

beforeAll(async () => {
  // 6 logins (MAX_LOGINS_PER_FILE is 8).
  adminA = await h.loginAs('adminA');
  driverA = await h.loginAs('driverA');
  driverAdminA = await h.loginAs('driverAdminA');
  driverB = await h.loginAs('driverB');
  master = await h.loginAs('master');
  impersonator = await h.loginAs('master');

  const imp = await impersonator.post(`/api/master-admin/impersonate/${h.ids.companyA}`).send({});
  expect(imp.status).toBe(200);
  const me = await impersonator.get('/api/auth/user');
  expect(me.body).toMatchObject({ role: 'master_admin', companyId: h.ids.companyA, _masterAdminImpersonating: true });
  const plain = await master.get('/api/auth/user');
  expect(plain.body.role).toBe('master_admin');
  expect(plain.body._masterAdminImpersonating).toBeUndefined();

  const insertTask = async (values: typeof driverTasks.$inferInsert) =>
    (await h.db.insert(driverTasks).values(values).returning({ id: driverTasks.id }))[0].id;
  taskA = await insertTask({ companyId: h.ids.companyA, title: 'Q78 taskA', assignedToId: h.ids.driverA, assignedById: h.ids.adminA, isCompleted: false });
  taskB = await insertTask({ companyId: h.ids.companyB, title: 'Q78 taskB', assignedToId: h.ids.driverB, assignedById: h.ids.adminB, isCompleted: false });
  taskNull = await insertTask({ companyId: null, title: 'Q78 taskNull', assignedToId: h.ids.driverA, assignedById: h.ids.adminA, isCompleted: false });
  taskA2 = await insertTask({ companyId: h.ids.companyA, title: 'Q78 taskA2', assignedToId: h.ids.driverA2, assignedById: h.ids.adminA, isCompleted: false });

  // X-3: the seeded rows are what the tests assume.
  const expected: Array<[string, string | null, string]> = [
    [taskA, h.ids.companyA, h.ids.driverA],
    [taskB, h.ids.companyB, h.ids.driverB],
    [taskNull, null, h.ids.driverA],
    [taskA2, h.ids.companyA, h.ids.driverA2],
  ];
  for (const [id, companyId, assignedToId] of expected) {
    const row = await taskRow(id);
    expect(row.companyId).toBe(companyId);
    expect(row.assignedToId).toBe(assignedToId);
    expect(row.isCompleted).toBe(false);
  }
  for (const [id, companyId] of [[h.ids.driverB2, h.ids.companyB], [h.ids.driverA2, h.ids.companyA]] as const) {
    const [u] = await h.db.select().from(users).where(eq(users.id, id));
    expect(u.companyId).toBe(companyId);
    expect(u.role).toBe('driver');
    expect(await h.db.select().from(buses).where(eq(buses.driverId, id))).toHaveLength(0);
  }
  const [busA] = await h.db.select().from(buses).where(eq(buses.id, h.ids.busA));
  expect(busA.driverId).toBe(h.ids.driverA);
});

describe('Q78 POST /api/driver-tasks', () => {
  it('1. isDriverInCompany(assignedToId): another school\'s driver → 404, no row', async () => {
    const title = 'Q78 test 1 foreign driver';
    const res = await adminA.post(TASKS).send({ title, assignedToId: h.ids.driverB2 });
    expect(res.status).toBe(404);
    expect(res.body).toEqual({ message: 'Driver not found' });
    expect(await tasksTitled(title)).toHaveLength(0);
  });

  it('2. control + isCompleted = false forced: own driver with isCompleted true → 200, saved false', async () => {
    const title = 'Q78 test 2 own driver';
    const res = await adminA.post(TASKS).send({ title, assignedToId: h.ids.driverA2, isCompleted: true });
    expect(res.status).toBe(200);
    const rows = await tasksTitled(title);
    expect(rows).toHaveLength(1);
    expect(rows[0].companyId).toBe(h.ids.companyA);
    expect(rows[0].assignedToId).toBe(h.ids.driverA2);
    expect(rows[0].assignedById).toBe(h.ids.adminA);
    expect(rows[0].isCompleted).toBe(false);
  });

  it('3. ZodError → 400: no title', async () => {
    const res = await adminA.post(TASKS).send({ assignedToId: h.ids.driverA2, description: 'Q78 test 3 no title' });
    expect(res.status).toBe(400);
    expect(await h.db.select().from(driverTasks).where(eq(driverTasks.description, 'Q78 test 3 no title'))).toHaveLength(0);
  });
});

describe('Q78 GET /api/driver-tasks (driver)', () => {
  it('4. getTasksByDriverId company filter: a company A task assigned to driverB is not in driverB\'s list', async () => {
    const [leak] = await h.db
      .insert(driverTasks)
      .values({ companyId: h.ids.companyA, title: 'Q78 test 4 SC-1 leftover', assignedToId: h.ids.driverB, assignedById: h.ids.adminA })
      .returning({ id: driverTasks.id });
    const res = await driverB.get(TASKS);
    expect(res.status).toBe(200);
    const ids = (res.body as Array<{ id: string }>).map((t) => t.id);
    expect(ids).toContain(taskB);
    expect(ids).not.toContain(leak.id);
  });
});

describe('Q78 PUT /api/driver-tasks/:taskId/complete', () => {
  it('5. assignee/school-admin guard: driverA on company B\'s task → 404, row unchanged', async () => {
    const res = await driverA.put(complete(taskB)).send({ isCompleted: true });
    expect(res.status).toBe(404);
    expect(res.body).toEqual({ message: 'Task not found' });
    expect((await taskRow(taskB)).isCompleted).toBe(false);
  });

  it('5b. task.assignedToId === user.id: a plain driver can\'t complete a same-school task of another driver', async () => {
    const res = await driverA.put(complete(taskA2)).send({ isCompleted: true });
    expect(res.status).toBe(404);
    expect(res.body).toEqual({ message: 'Task not found' });
    expect((await taskRow(taskA2)).isCompleted).toBe(false);
  });

  it('6. missing isCompleted = true (live "Complete" button sends {})', async () => {
    await setTask(taskA, false);
    const res = await driverA.put(complete(taskA)).send({});
    expect(res.status).toBe(200);
    const row = await taskRow(taskA);
    expect(row.isCompleted).toBe(true);
    expect(row.completedAt).not.toBeNull();
  });

  it('7. boolean check: isCompleted "yes" → 400, row unchanged', async () => {
    await setTask(taskA, false);
    const res = await driverA.put(complete(taskA)).send({ isCompleted: 'yes' });
    expect(res.status).toBe(400);
    expect((await taskRow(taskA)).isCompleted).toBe(false);
  });

  it('8. same-school admin allowed (DeShaun): driverAdminA sets taskA false → 200', async () => {
    await setTask(taskA, true);
    const res = await driverAdminA.put(complete(taskA)).send({ isCompleted: false });
    expect(res.status).toBe(200);
    expect((await taskRow(taskA)).isCompleted).toBe(false);
  });

  it('9. plain admin gate widened (DeShaun): adminA completes taskA → 200', async () => {
    await setTask(taskA, false);
    const res = await adminA.put(complete(taskA)).send({ isCompleted: true });
    expect(res.status).toBe(200);
    expect((await taskRow(taskA)).isCompleted).toBe(true);
  });

  it('10. isOutsideCallerTenant(user, task.companyId) in the admin half: driverAdminA on company B\'s task → 404', async () => {
    const res = await driverAdminA.put(complete(taskB)).send({ isCompleted: true });
    expect(res.status).toBe(404);
    expect(res.body).toEqual({ message: 'Task not found' });
    expect((await taskRow(taskB)).isCompleted).toBe(false);
  });

  it('11. NULL-company task: only the assignee (driverAdminA 404, driverA 200)', async () => {
    await setTask(taskNull, false);
    const refused = await driverAdminA.put(complete(taskNull)).send({ isCompleted: true });
    expect(refused.status).toBe(404);
    expect((await taskRow(taskNull)).isCompleted).toBe(false);
    const ok = await driverA.put(complete(taskNull)).send({ isCompleted: true });
    expect(ok.status).toBe(200);
    expect((await taskRow(taskNull)).isCompleted).toBe(true);
  });

  it('12. isUnscopedMaster refusal: unscoped master → 403, row unchanged', async () => {
    await setTask(taskA, false);
    const res = await master.put(complete(taskA)).send({ isCompleted: true });
    expect(res.status).toBe(403);
    expect((await taskRow(taskA)).isCompleted).toBe(false);
  });

  it('13. impersonation scoped: impersonating master completes taskA (200), company B\'s task 404', async () => {
    await setTask(taskA, false);
    const ok = await impersonator.put(complete(taskA)).send({ isCompleted: true });
    expect(ok.status).toBe(200);
    expect((await taskRow(taskA)).isCompleted).toBe(true);
    const refused = await impersonator.put(complete(taskB)).send({ isCompleted: true });
    expect(refused.status).toBe(404);
    expect((await taskRow(taskB)).isCompleted).toBe(false);
  });

  it('14. !task: a task id that does not exist → 404', async () => {
    const res = await adminA.put(complete(randomUUID())).send({ isCompleted: true });
    expect(res.status).toBe(404);
    expect(res.body).toEqual({ message: 'Task not found' });
  });
});

describe('Q78 POST /api/buses', () => {
  it('15. isDriverInCompany(driverId) in POST /api/buses: another school\'s driver → 404, no bus', async () => {
    const res = await adminA.post('/api/buses').send({ busNumber: 'Q78-15', driverId: h.ids.driverB2 });
    expect(res.status).toBe(404);
    expect(res.body).toEqual({ message: 'Driver not found' });
    expect(await busesNumbered('Q78-15')).toHaveLength(0);
  });

  it('16. duplicate-driver check: a driver who already has a bus → 400', async () => {
    const res = await adminA.post('/api/buses').send({ busNumber: 'Q78-16', driverId: h.ids.driverA });
    expect(res.status).toBe(400);
    expect(res.body.message).toMatch(/^Driver is already assigned to Bus #/);
    expect(await busesNumbered('Q78-16')).toHaveLength(0);
  });

  it('17. omit({ currentRouteId: true }): own driver + a body route → 201, no route saved', async () => {
    const res = await adminA.post('/api/buses').send({ busNumber: 'Q78-17', driverId: h.ids.driverA2, currentRouteId: h.ids.routeB });
    expect(res.status).toBe(201);
    const rows = await busesNumbered('Q78-17');
    expect(rows).toHaveLength(1);
    expect(rows[0].companyId).toBe(h.ids.companyA);
    expect(rows[0].driverId).toBe(h.ids.driverA2);
    expect(rows[0].currentRouteId).toBeNull();
  });
});

describe('Q78 POST /api/attendance', () => {
  it('18. route removed (SC-15): → exactly 404 { message: "Not found" }, no row', async () => {
    const before = await h.db
      .select()
      .from(attendance)
      .where(and(eq(attendance.studentId, h.ids.studentA), eq(attendance.routeId, h.ids.routeA)));
    const res = await driverA
      .post('/api/attendance')
      .send({ studentId: h.ids.studentA, routeId: h.ids.routeA, date: new Date().toISOString(), isPresent: true });
    expect(res.status).toBe(404);
    expect(res.body).toEqual({ message: 'Not found' });
    const after = await h.db
      .select()
      .from(attendance)
      .where(and(eq(attendance.studentId, h.ids.studentA), eq(attendance.routeId, h.ids.routeA)));
    expect(after).toHaveLength(before.length);
  });
});
