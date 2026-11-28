// Q199: a child has ONE check-in row per tenant day, shared by its linked
// parents. Enabling over today's `waiting` row moves it to the latest
// enabling parent (parentId + device) and the student's current route; a
// `boarded` row is left alone (never reset to waiting); either linked parent's
// disable removes the shared row. Real HTTP + real Postgres. Each title names
// the clause whose removal turns it red; seeds are asserted first (X-1/X-2).
import { describe, it, expect, beforeAll, beforeEach, afterAll } from 'vitest';
import { readFileSync } from 'fs';
import { resolve } from 'path';
import { and, eq } from 'drizzle-orm';
import { parentChildLinks, routes, studentCheckIns, students } from '@shared/schema';
import { useIntegrationHarness, type Agent } from './harness';
import { insertUser, SEED_PASSWORD } from './seed';

const h = useIntegrationHarness();
const SECOND_EMAIL = 'q199-second-parent-a@sbt.test';
const UNLINKED_EMAIL = 'q199-unlinked-parent-a@sbt.test';

let parentA: Agent;
let secondParent: Agent;
let secondParentId: string;
let unlinkedParent: Agent;
let unlinkedParentId: string;
let otherRouteId: string;

const rowsForStudentA = () => h.db.select().from(studentCheckIns).where(eq(studentCheckIns.studentId, h.ids.studentA));
const linkExists = async (parentId: string, studentId: string) =>
  (await h.db.select().from(parentChildLinks)
    .where(and(eq(parentChildLinks.parentId, parentId), eq(parentChildLinks.studentId, studentId)))).length > 0;

beforeAll(async () => {
  // A second company-A parent, linked to studentA alongside parentA.
  secondParentId = await insertUser(
    { email: SECOND_EMAIL, firstName: 'Q199-Second', lastName: 'Seed', role: 'parent', companyId: h.ids.companyA },
    { password: true },
  );
  await h.db.insert(parentChildLinks).values({ parentId: secondParentId, studentId: h.ids.studentA });
  // Q201 X-1: a company-A parent with NO link to studentA.
  unlinkedParentId = await insertUser(
    { email: UNLINKED_EMAIL, firstName: 'Q199-Unlinked', lastName: 'Seed', role: 'parent', companyId: h.ids.companyA },
    { password: true },
  );
  // Another company-A route for the route-change case.
  const [r] = await h.db.insert(routes)
    .values({ companyId: h.ids.companyA, name: 'Q199-Route', schoolId: h.ids.schoolA, busNumber: 'Q199-1' })
    .returning({ id: routes.id });
  otherRouteId = r.id;

  // 3 logins (MAX_LOGINS_PER_FILE is 8).
  parentA = await h.loginAs('parentA');
  const agent = h.anon();
  expect((await h.loginAttempt(SECOND_EMAIL, SEED_PASSWORD, agent)).status).toBe(200);
  secondParent = agent;
  const unlinked = h.anon();
  expect((await h.loginAttempt(UNLINKED_EMAIL, SEED_PASSWORD, unlinked)).status).toBe(200);
  unlinkedParent = unlinked;
});

beforeEach(async () => {
  await h.db.delete(studentCheckIns).where(eq(studentCheckIns.studentId, h.ids.studentA));
});

afterAll(async () => {
  await h.db.delete(studentCheckIns).where(eq(studentCheckIns.studentId, h.ids.studentA));
  await h.db.delete(parentChildLinks).where(eq(parentChildLinks.parentId, secondParentId));
  await h.db.delete(routes).where(eq(routes.id, otherRouteId));
});

describe('Q199 one shared check-in row per child per day', () => {
  it('seed: parentA and the second parent are both linked to studentA (company A, routeA); no check-in row yet', async () => {
    expect(await linkExists(h.ids.parentA, h.ids.studentA)).toBe(true);
    expect(await linkExists(secondParentId, h.ids.studentA)).toBe(true);
    const [s] = await h.db.select().from(students).where(eq(students.id, h.ids.studentA));
    expect(s).toMatchObject({ companyId: h.ids.companyA, routeId: h.ids.routeA });
    const [r] = await h.db.select().from(routes).where(eq(routes.id, otherRouteId));
    expect(r.companyId).toBe(h.ids.companyA);
    expect(await rowsForStudentA()).toHaveLength(0);
  });

  it('parentA enables (device X), then the second parent enables (device Y) → 1 row, parentId = the second parent, deviceId Y, waiting (red if the update keeps the first parent)', async () => {
    const first = await parentA.post('/api/check-in/enable').send({ studentId: h.ids.studentA, deviceId: 'q199-device-x' });
    expect(first.status).toBe(200);
    const before = await rowsForStudentA();
    expect(before).toHaveLength(1);
    expect(before[0]).toMatchObject({ parentId: h.ids.parentA, deviceId: 'q199-device-x', status: 'waiting' });

    const second = await secondParent.post('/api/check-in/enable').send({ studentId: h.ids.studentA, deviceId: 'q199-device-y' });
    expect(second.status).toBe(200);
    const after = await rowsForStudentA();
    expect(after).toHaveLength(1);
    expect(after[0]).toMatchObject({ id: before[0].id, parentId: secondParentId, deviceId: 'q199-device-y', status: 'waiting' });
  });

  it('a boarded row today stays boarded, with its driverId and boardedAt, when a parent enables again; still 1 row (red if the boarded guard is removed)', async () => {
    const boardedAt = new Date();
    const [seeded] = await h.db.insert(studentCheckIns).values({
      companyId: h.ids.companyA, studentId: h.ids.studentA, parentId: h.ids.parentA, routeId: h.ids.routeA,
      deviceId: 'q199-device-x', status: 'boarded', driverId: h.ids.driverA, boardedAt, checkInDate: new Date(),
    }).returning();
    expect(seeded).toMatchObject({ status: 'boarded', driverId: h.ids.driverA });

    const res = await secondParent.post('/api/check-in/enable').send({ studentId: h.ids.studentA, deviceId: 'q199-device-y' });
    expect(res.status).toBe(200);
    const rows = await rowsForStudentA();
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ id: seeded.id, status: 'boarded', driverId: h.ids.driverA, parentId: h.ids.parentA, deviceId: 'q199-device-x' });
    expect(rows[0].boardedAt?.getTime()).toBe(seeded.boardedAt?.getTime());
  });

  it('after studentA moves to another route, enabling over its waiting row sets the row\'s routeId to the new route (red if the update keeps the old routeId)', async () => {
    const first = await parentA.post('/api/check-in/enable').send({ studentId: h.ids.studentA, deviceId: 'q199-device-x' });
    expect(first.status).toBe(200);
    const [before] = await rowsForStudentA();
    expect(before.routeId).toBe(h.ids.routeA);
    const [orig] = await h.db.select().from(students).where(eq(students.id, h.ids.studentA));
    try {
      await h.db.update(students).set({ routeId: otherRouteId, stopId: null }).where(eq(students.id, h.ids.studentA));
      const res = await secondParent.post('/api/check-in/enable').send({ studentId: h.ids.studentA, deviceId: 'q199-device-y' });
      expect(res.status).toBe(200);
      const rows = await rowsForStudentA();
      expect(rows).toHaveLength(1);
      expect(rows[0]).toMatchObject({ id: before.id, routeId: otherRouteId, status: 'waiting' });
    } finally {
      await h.db.update(students).set({ routeId: orig.routeId, stopId: orig.stopId }).where(eq(students.id, h.ids.studentA));
    }
    const [s] = await h.db.select().from(students).where(eq(students.id, h.ids.studentA));
    expect(s).toMatchObject({ routeId: orig.routeId, stopId: orig.stopId });
  });

  it('the second parent\'s disable removes the shared row parentA turned on → 0 rows (pins the one-row rule)', async () => {
    const on = await parentA.post('/api/check-in/enable').send({ studentId: h.ids.studentA, deviceId: 'q199-device-x' });
    expect(on.status).toBe(200);
    const rows = await rowsForStudentA();
    expect(rows).toHaveLength(1);
    expect(rows[0].parentId).toBe(h.ids.parentA);
    const off = await secondParent.post('/api/check-in/disable').send({ studentId: h.ids.studentA });
    expect(off.status).toBe(200);
    expect(await rowsForStudentA()).toHaveLength(0);
  });

  it('enabling over a waiting row keeps its stored companyId (seeded as company B, a marker) while parentId and deviceId move to the caller (red if the update writes companyId)', async () => {
    const [seeded] = await h.db.insert(studentCheckIns).values({
      companyId: h.ids.companyB, studentId: h.ids.studentA, parentId: h.ids.parentA, routeId: h.ids.routeA,
      deviceId: 'q199-device-x', status: 'waiting', checkInDate: new Date(),
    }).returning();
    expect(seeded).toMatchObject({ companyId: h.ids.companyB, status: 'waiting', parentId: h.ids.parentA });

    const res = await secondParent.post('/api/check-in/enable').send({ studentId: h.ids.studentA, deviceId: 'q199-device-y' });
    expect(res.status).toBe(200);
    const rows = await rowsForStudentA();
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ id: seeded.id, companyId: h.ids.companyB, parentId: secondParentId, deviceId: 'q199-device-y', status: 'waiting' });
  });

  it('enabling after today\'s row is dropped_off inserts a new waiting row and leaves the old one unchanged (red if a dropped_off row is updated instead)', async () => {
    const [old] = await h.db.insert(studentCheckIns).values({
      companyId: h.ids.companyA, studentId: h.ids.studentA, parentId: h.ids.parentA, routeId: h.ids.routeA,
      deviceId: 'q199-device-x', status: 'dropped_off', driverId: h.ids.driverA, checkInDate: new Date(),
    }).returning();
    expect(old).toMatchObject({ status: 'dropped_off', parentId: h.ids.parentA });

    const res = await secondParent.post('/api/check-in/enable').send({ studentId: h.ids.studentA, deviceId: 'q199-device-y' });
    expect(res.status).toBe(200);
    const rows = await rowsForStudentA();
    expect(rows).toHaveLength(2);
    const kept = rows.find((r) => r.id === old.id);
    expect(kept).toMatchObject({ status: 'dropped_off', parentId: h.ids.parentA, deviceId: 'q199-device-x', driverId: h.ids.driverA });
    const fresh = rows.find((r) => r.id !== old.id);
    expect(fresh).toMatchObject({ status: 'waiting', parentId: secondParentId, deviceId: 'q199-device-y' });
  });

  it('an unlinked company-A parent enabling studentA over parentA\'s waiting row → 404 "Student not found", the row unchanged (red if the route\'s link check is skipped)', async () => {
    expect(await h.db.select().from(parentChildLinks).where(eq(parentChildLinks.parentId, unlinkedParentId))).toHaveLength(0);
    const on = await parentA.post('/api/check-in/enable').send({ studentId: h.ids.studentA, deviceId: 'q199-device-x' });
    expect(on.status).toBe(200);
    const [before] = await rowsForStudentA();
    expect(before).toMatchObject({ parentId: h.ids.parentA, deviceId: 'q199-device-x', status: 'waiting' });

    const res = await unlinkedParent.post('/api/check-in/enable').send({ studentId: h.ids.studentA, deviceId: 'q199-device-z' });
    expect(res.status).toBe(404);
    expect(res.body).toEqual({ message: 'Student not found' });
    const rows = await rowsForStudentA();
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ id: before.id, parentId: h.ids.parentA, deviceId: 'q199-device-x', status: 'waiting' });
  });
});

// Q202: the read-then-update race (a driver's boarding between enable's
// select and its update) can't be forced over HTTP, so pin the guard in the
// source.
describe('Q202 enableStudentCheckIn race guard (source scan)', () => {
  const src = readFileSync(resolve(__dirname, '../../server/storage.ts'), 'utf8');
  const start = src.indexOf('async enableStudentCheckIn(');
  const end = src.indexOf('\n  async ', start + 1);
  const method = src.slice(start, end);

  it('the method is found', () => {
    expect(start).toBeGreaterThan(-1);
    expect(end).toBeGreaterThan(start);
  });

  it('the update only matches a row that is still waiting (red if eq(studentCheckIns.status, \'waiting\') is dropped from the update .where)', () => {
    const upd = method.indexOf('.update(studentCheckIns)');
    expect(upd).toBeGreaterThan(-1);
    const whereAt = method.indexOf('.where(', upd);
    const whereEnd = method.indexOf('.returning()', whereAt);
    expect(whereAt).toBeGreaterThan(upd);
    expect(method.slice(whereAt, whereEnd)).toContain("eq(studentCheckIns.status, 'waiting')");
  });

  it('a lost race re-reads the row (red if the getCheckInById(current.id) fallback is dropped)', () => {
    const upd = method.indexOf('.update(studentCheckIns)');
    expect(method.indexOf('this.getCheckInById(current.id)', upd)).toBeGreaterThan(upd);
  });

  it('the fallback returns the re-read row only when it is not dropped_off (red if the fallback returns a dropped_off row instead of inserting)', () => {
    const fb = method.indexOf('this.getCheckInById(current.id)');
    expect(fb).toBeGreaterThan(-1);
    const ret = method.slice(fb, method.indexOf('\n    }', fb));
    expect(ret).toMatch(/if \(fresh && fresh\.status !== 'dropped_off'\) return fresh;/);
    // ...and the insert is still reached after it.
    expect(method.indexOf('.insert(studentCheckIns)', fb)).toBeGreaterThan(fb);
  });
});
