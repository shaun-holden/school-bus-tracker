// Q155: (1) POST /api/driver/activate-route leaves exactly one bus of the
// company on the shift route (it calls clearRouteFromOtherBuses), and links only
// when the shift route and the bus share a non-null company (this also covers
// an unscoped master). (2) The two parent bus reads, GET /api/students (parent
// branch) and GET /api/parent/children-buses, drop a bus whose company differs
// from the route's or from the child's (checklist T-9, bad data only).
// Real HTTP + real Postgres. Each title names the clause whose deletion turns
// it red, and each test asserts its foreign rows first (X-1/X-2).
// Seed + seedQ8Extras: studentA (company A, routeA) is parentA's; parentB is
// linked to studentBx (company B, rides company A's routeA: bad data) and to
// studentA4 (company A, routeA). So parentB is asserted per child, never on the
// whole body.
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { eq } from 'drizzle-orm';
import { buses, parentChildLinks, routes, students, users } from '@shared/schema';
import { useIntegrationHarness, type Agent } from './harness';
import { seedQ8Extras, type Q8Ids } from './seed';

const h = useIntegrationHarness();
const ACTIVATE = '/api/driver/activate-route';
const CHILD_BUSES = '/api/parent/children-buses';
const STUDENTS = '/api/students';

let driverA: Agent;
let parentA: Agent;
let parentB: Agent;
let parentNull: Agent; // Q173-1: (3b) runs as parentNull (linked to studentBx and studentA)
let master: Agent;
let q8: Q8Ids;

type SavedUser = { isOnDuty: boolean | null; dutyStartTime: Date | null; assignedRouteId: string | null };
type SavedBus = { driverId: string | null; status: string | null; currentRouteId: string | null };
let savedDriver: SavedUser | undefined;
let savedMaster: SavedUser | undefined;
let savedBusA: SavedBus | undefined;
let savedBusB: SavedBus | undefined;

const busRow = async (id: string) => (await h.db.select().from(buses).where(eq(buses.id, id)))[0];
const userRow = async (id: string) => (await h.db.select().from(users).where(eq(users.id, id)))[0];
const setLink = (busId: string, link: string | null) =>
  h.db.update(buses).set({ currentRouteId: link }).where(eq(buses.id, busId));
// driverA on duty, running routeA, driving busA (busA's link set to `link`).
const startState = async (link: string | null) => {
  await h.db.update(users)
    .set({ isOnDuty: true, dutyStartTime: new Date(), assignedRouteId: h.ids.routeA })
    .where(eq(users.id, h.ids.driverA));
  await h.db.update(buses)
    .set({ driverId: h.ids.driverA, status: 'idle', currentRouteId: link })
    .where(eq(buses.id, h.ids.busA));
};
const restoreBuses = async () => {
  if (savedBusA) await h.db.update(buses).set(savedBusA).where(eq(buses.id, h.ids.busA));
  if (savedBusB) await h.db.update(buses).set(savedBusB).where(eq(buses.id, h.ids.busB));
};
// children-buses rows are { student: { id }, bus }; /api/students rows are { id, bus }.
const childBus = (body: any[], studentId: string) => body.find((c) => c.student?.id === studentId)?.bus;
const studentBus = (body: any[], studentId: string) => body.find((s) => s.id === studentId)?.bus;
const READS = [
  { name: 'GET /api/parent/children-buses', url: CHILD_BUSES, busOf: childBus },
  { name: 'GET /api/students', url: STUDENTS, busOf: studentBus },
] as const;

beforeAll(async () => {
  q8 = await seedQ8Extras(h.ids);
  const pick = (u: any): SavedUser => ({ isOnDuty: u.isOnDuty, dutyStartTime: u.dutyStartTime, assignedRouteId: u.assignedRouteId });
  const pickBus = (b: any): SavedBus => ({ driverId: b.driverId, status: b.status, currentRouteId: b.currentRouteId });
  savedDriver = pick(await userRow(h.ids.driverA));
  savedMaster = pick(await userRow(h.ids.master));
  savedBusA = pickBus(await busRow(h.ids.busA));
  savedBusB = pickBus(await busRow(h.ids.busB));
  // 5 logins (MAX_LOGINS_PER_FILE is 8).
  driverA = await h.loginAs('driverA');
  parentA = await h.loginAs('parentA');
  parentB = await h.loginAs('parentB');
  parentNull = await h.loginAs('parentNull');
  master = await h.loginAs('master');
});

afterAll(async () => {
  if (savedDriver) await h.db.update(users).set(savedDriver).where(eq(users.id, h.ids.driverA));
  if (savedMaster) await h.db.update(users).set(savedMaster).where(eq(users.id, h.ids.master));
  await restoreBuses();
});

describe('Q155 activate-route keeps one bus per route', () => {
  it('(1) activate clears routeA from the other company-A bus and links busA (red if activate-route stops calling clearRouteFromOtherBuses)', async () => {
    await startState(null);
    const [extra] = await h.db.insert(buses)
      .values({ companyId: h.ids.companyA, busNumber: 'A-Q155', make: 'A-Make', currentRouteId: h.ids.routeA })
      .returning({ id: buses.id });
    try {
      const pre = await busRow(extra.id);
      expect(pre.companyId).toBe(h.ids.companyA);
      expect(pre.currentRouteId).toBe(h.ids.routeA);

      const res = await driverA.post(ACTIVATE).send({});
      expect(res.status).toBe(200);
      expect((await busRow(extra.id)).currentRouteId).toBeNull();
      expect((await busRow(h.ids.busA)).currentRouteId).toBe(h.ids.routeA);
    } finally {
      await h.db.delete(buses).where(eq(buses.id, extra.id));
    }
  });

  it("(2) activate-route never clears another company's link (regression; the company clause is pinned by q152a test (5))", async () => {
    try {
      await startState(null);
      await setLink(h.ids.busB, h.ids.routeA);
      const pre = await busRow(h.ids.busB);
      expect(pre.companyId).toBe(h.ids.companyB);
      expect(pre.currentRouteId).toBe(h.ids.routeA);

      const res = await driverA.post(ACTIVATE).send({});
      expect(res.status).toBe(200);
      expect((await busRow(h.ids.busA)).currentRouteId).toBe(h.ids.routeA);
      expect((await busRow(h.ids.busB)).currentRouteId).toBe(h.ids.routeA);
    } finally {
      await restoreBuses();
    }
  });

  it("(5) an unscoped master on duty with company A's busA and company B's routeB → no link (red if activate-route stops comparing the shift route's company with the bus's)", async () => {
    try {
      await h.db.update(users)
        .set({ isOnDuty: true, dutyStartTime: new Date(), assignedRouteId: h.ids.routeB })
        .where(eq(users.id, h.ids.master));
      await h.db.update(buses).set({ driverId: h.ids.master, currentRouteId: null }).where(eq(buses.id, h.ids.busA));
      const m = await userRow(h.ids.master);
      expect(m.role).toBe('master_admin');
      expect(m.companyId).toBeNull();
      const [rB] = await h.db.select().from(routes).where(eq(routes.id, h.ids.routeB));
      expect(rB.companyId).toBe(h.ids.companyB);
      expect((await busRow(h.ids.busA)).companyId).toBe(h.ids.companyA);

      const res = await master.post(ACTIVATE).send({});
      expect(res.status).toBe(200);
      expect(res.body.busId).toBe(h.ids.busA);
      const bus = await busRow(h.ids.busA);
      expect(bus.currentRouteId).not.toBe(h.ids.routeB);
      expect(bus.currentRouteId).toBeNull();
    } finally {
      if (savedMaster) await h.db.update(users).set(savedMaster).where(eq(users.id, h.ids.master));
      await restoreBuses();
    }
  });

  it('(5b) an unscoped master with a no-company bus on a no-company route → no link (red if the driverBus.companyId && NULL guard is dropped from activate-route)', async () => {
    const [nullRoute] = await h.db.insert(routes)
      .values({ companyId: null, name: 'Null-Q155-Route' })
      .returning({ id: routes.id });
    const [nullBus] = await h.db.insert(buses)
      .values({ companyId: null, busNumber: 'NULL-Q155', make: 'Null-Make', driverId: h.ids.master })
      .returning({ id: buses.id });
    try {
      await h.db.update(users)
        .set({ isOnDuty: true, dutyStartTime: new Date(), assignedRouteId: nullRoute.id })
        .where(eq(users.id, h.ids.master));
      // Preconditions: both companies are NULL, and the master drives only nullBus.
      expect((await busRow(nullBus.id)).companyId).toBeNull();
      const [r] = await h.db.select().from(routes).where(eq(routes.id, nullRoute.id));
      expect(r.companyId).toBeNull();
      expect(await h.db.select().from(buses).where(eq(buses.driverId, h.ids.master))).toHaveLength(1);

      const res = await master.post(ACTIVATE).send({});
      expect(res.status).toBe(200);
      expect(res.body.busId).toBe(nullBus.id);
      expect((await busRow(nullBus.id)).currentRouteId).toBeNull();
    } finally {
      if (savedMaster) await h.db.update(users).set(savedMaster).where(eq(users.id, h.ids.master));
      await h.db.delete(buses).where(eq(buses.id, nullBus.id));
      await h.db.delete(routes).where(eq(routes.id, nullRoute.id));
    }
  });
});

describe("Q155 parent bus reads show only the child's own-school bus", () => {
  it("(3) X-2 smoke: company B's busB as the ONLY bus on routeA never reaches parentA, on either read", async () => {
    try {
      await setLink(h.ids.busA, null);
      await setLink(h.ids.busB, h.ids.routeA);
      const bB = await busRow(h.ids.busB);
      expect(bB.companyId).toBe(h.ids.companyB);
      expect(bB.currentRouteId).toBe(h.ids.routeA);
      expect(bB.currentLatitude).toBeTruthy();
      const [sA] = await h.db.select().from(students).where(eq(students.id, h.ids.studentA));
      expect(sA.routeId).toBe(h.ids.routeA);

      for (const read of READS) {
        const res = await parentA.get(read.url);
        expect(res.status, read.name).toBe(200);
        expect(read.busOf(res.body, h.ids.studentA), read.name).toBeNull();
        const text = JSON.stringify(res.body);
        expect(text, read.name).not.toContain(h.ids.busB);
        expect(text, read.name).not.toContain(String(bB.currentLatitude));
        expect(text, read.name).not.toContain(String(bB.currentLongitude));
      }
    } finally {
      await restoreBuses();
    }
  });

  for (const read of READS) {
    it(`(3a) studentBx (company B) on company A's routeA with company B's busB → no bus (red if ${read.name} stops dropping buses whose company differs from the route's)`, async () => {
      try {
        await setLink(h.ids.busA, null);
        await setLink(h.ids.busB, h.ids.routeA);
        // Preconditions: child and bus are both company B, the route is company A,
        // so only the route-company filter can catch it.
        const [sBx] = await h.db.select().from(students).where(eq(students.id, q8.studentBx));
        expect(sBx.companyId).toBe(h.ids.companyB);
        expect(sBx.routeId).toBe(h.ids.routeA);
        const bB = await busRow(h.ids.busB);
        expect(bB.companyId).toBe(h.ids.companyB);
        expect(bB.currentRouteId).toBe(h.ids.routeA);
        const [rA] = await h.db.select().from(routes).where(eq(routes.id, h.ids.routeA));
        expect(rA.companyId).toBe(h.ids.companyA);

        const res = await parentB.get(read.url);
        expect(res.status).toBe(200);
        expect(res.body.some((r: any) => (r.student?.id ?? r.id) === q8.studentBx)).toBe(true);
        expect(read.busOf(res.body, q8.studentBx)).toBeNull();
      } finally {
        await restoreBuses();
      }
    });

    // Q173-1: parentB (company B) no longer sees studentA4 (company A), so this
    // runs as parentNull (NULL company), linked to studentBx and studentA.
    it(`(3b) studentBx (company B) on routeA with company A's busA → no bus, studentA still sees busA (red if ${read.name} stops checking the bus's company against the child's)`, async () => {
      try {
        await setLink(h.ids.busA, h.ids.routeA);
        await setLink(h.ids.busB, h.ids.routeB);
        // Preconditions: route and bus are both company A, the child is company B,
        // so only the child-company check can catch it.
        const [sBx] = await h.db.select().from(students).where(eq(students.id, q8.studentBx));
        expect(sBx.companyId).toBe(h.ids.companyB);
        expect(sBx.routeId).toBe(h.ids.routeA);
        const bA = await busRow(h.ids.busA);
        expect(bA.companyId).toBe(h.ids.companyA);
        expect(bA.currentRouteId).toBe(h.ids.routeA);
        const [sA] = await h.db.select().from(students).where(eq(students.id, h.ids.studentA));
        expect(sA.companyId).toBe(h.ids.companyA);
        expect(sA.routeId).toBe(h.ids.routeA);
        expect((await userRow(h.ids.parentNull)).companyId).toBeNull();
        const nullLinks = await h.db.select().from(parentChildLinks).where(eq(parentChildLinks.parentId, h.ids.parentNull));
        expect(nullLinks.map((l) => l.studentId)).toEqual(expect.arrayContaining([q8.studentBx, h.ids.studentA]));

        const res = await parentNull.get(read.url);
        expect(res.status).toBe(200);
        expect(res.body.some((r: any) => (r.student?.id ?? r.id) === q8.studentBx)).toBe(true);
        expect(read.busOf(res.body, q8.studentBx)).toBeNull();
        expect(read.busOf(res.body, h.ids.studentA)?.id).toBe(h.ids.busA);
      } finally {
        await restoreBuses();
      }
    });
  }
});
