// Q199: a child has ONE check-in row per tenant day, shared by its linked
// parents. Enabling over today's `waiting` row moves it to the latest
// enabling parent (parentId + device) and the student's current route; a
// `boarded` row is left alone (never reset to waiting); either linked parent's
// disable removes the shared row. Real HTTP + real Postgres. Each title names
// the clause whose removal turns it red; seeds are asserted first (X-1/X-2).
import { describe, it, expect, beforeAll, beforeEach, afterAll } from 'vitest';
import { and, eq } from 'drizzle-orm';
import { parentChildLinks, routes, studentCheckIns, students } from '@shared/schema';
import { useIntegrationHarness, type Agent } from './harness';
import { insertUser, SEED_PASSWORD } from './seed';

const h = useIntegrationHarness();
const SECOND_EMAIL = 'q199-second-parent-a@sbt.test';

let parentA: Agent;
let secondParent: Agent;
let secondParentId: string;
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
  // Another company-A route for the route-change case.
  const [r] = await h.db.insert(routes)
    .values({ companyId: h.ids.companyA, name: 'Q199-Route', schoolId: h.ids.schoolA, busNumber: 'Q199-1' })
    .returning({ id: routes.id });
  otherRouteId = r.id;

  // 2 logins (MAX_LOGINS_PER_FILE is 8).
  parentA = await h.loginAs('parentA');
  const agent = h.anon();
  expect((await h.loginAttempt(SECOND_EMAIL, SEED_PASSWORD, agent)).status).toBe(200);
  secondParent = agent;
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
});
