import { describe, it, expect } from 'vitest';
import { eq, inArray } from 'drizzle-orm';
import {
  companies,
  users,
  passwordCredentials,
  schools,
  routes,
  routeStops,
  students,
  parentChildLinks,
  buses,
  driverShiftReports,
} from '@shared/schema';
import { useIntegrationHarness } from './harness';

// Re-reads every seeded row and checks where it landed (rule 5: prove B's rows
// really are in B before any test asserts that A can't see them).
const h = useIntegrationHarness();

describe('seedTwoTenants: every row lands in the right company', () => {
  it('companies A, B, A2 are approved+active Professional; C is pending, D suspended', async () => {
    const { ids, db } = h;
    const rows = await db.select().from(companies);
    const byId = new Map(rows.map((r) => [r.id, r]));
    expect(rows).toHaveLength(5);
    for (const id of [ids.companyA, ids.companyB, ids.companyA2]) {
      const c = byId.get(id)!;
      expect(c).toMatchObject({
        status: 'approved', isActive: true, planType: 'professional',
        parentPortalEnabled: true, gpsEnabled: true, timezone: 'America/Chicago',
      });
    }
    expect(byId.get(ids.companyC)).toMatchObject({ status: 'pending_approval' });
    expect(byId.get(ids.companyD)).toMatchObject({ status: 'suspended' });
    expect(byId.get(ids.companyA)!.slug).toBe('co-a');
    expect(byId.get(ids.companyB)!.slug).toBe('co-b');
  });

  it('users carry the expected role, companyId and password state', async () => {
    const { ids, db } = h;
    const rows = await db.select().from(users);
    const creds = await db.select({ userId: passwordCredentials.userId }).from(passwordCredentials);
    const hasPw = new Set(creds.map((c) => c.userId));
    const byId = new Map(rows.map((r) => [r.id, r]));
    const expectUser = (id: string, role: string, companyId: string | null, password: boolean) => {
      const u = byId.get(id);
      expect(u, id).toBeDefined();
      expect(u!.role).toBe(role);
      expect(u!.companyId).toBe(companyId);
      expect(hasPw.has(id)).toBe(password);
    };
    expectUser(ids.adminA, 'admin', ids.companyA, true);
    expectUser(ids.driverA, 'driver', ids.companyA, true);
    expectUser(ids.parentA, 'parent', ids.companyA, true);
    expectUser(ids.driverA2, 'driver', ids.companyA, false);
    expectUser(ids.driverA_archived, 'driver', ids.companyA, true);
    expectUser(ids.adminB, 'admin', ids.companyB, true);
    expectUser(ids.driverB, 'driver', ids.companyB, true);
    expectUser(ids.parentB, 'parent', ids.companyB, true);
    expectUser(ids.driverB2, 'driver', ids.companyB, false);
    expectUser(ids.adminNull, 'admin', null, true);
    expectUser(ids.master, 'master_admin', null, true);
    expectUser(ids.adminC, 'admin', ids.companyC, true);
    expectUser(ids.adminD, 'admin', ids.companyD, true);
    expectUser(ids.adminA2, 'admin', ids.companyA2, true);
    expect(byId.get(ids.driverA_archived)!.isActive).toBe(false);
    expect(byId.get(ids.driverA)!.assignedRouteId).toBe(ids.routeA);
    expect(byId.get(ids.driverB)!.assignedRouteId).toBe(ids.routeB);
    // Globally unique emails.
    const emails = rows.map((r) => r.email);
    expect(new Set(emails).size).toBe(emails.length);
  });

  it('schools, routes, stops and students are in their tenant with local FKs', async () => {
    const { ids, db } = h;
    const [sA] = await db.select().from(schools).where(eq(schools.id, ids.schoolA));
    const [sB] = await db.select().from(schools).where(eq(schools.id, ids.schoolB));
    expect(sA.companyId).toBe(ids.companyA);
    expect(sB.companyId).toBe(ids.companyB);
    expect(sA.name.startsWith('A-')).toBe(true);
    expect(sB.name.startsWith('B-')).toBe(true);

    const [rA] = await db.select().from(routes).where(eq(routes.id, ids.routeA));
    const [rB] = await db.select().from(routes).where(eq(routes.id, ids.routeB));
    expect(rA).toMatchObject({ companyId: ids.companyA, driverId: ids.driverA, schoolId: ids.schoolA });
    expect(rB).toMatchObject({ companyId: ids.companyB, driverId: ids.driverB, schoolId: ids.schoolB });

    const stops = await db.select().from(routeStops)
      .where(inArray(routeStops.id, [ids.stopA1, ids.stopA2, ids.stopB1, ids.stopB2]));
    const stopRoute = new Map(stops.map((s) => [s.id, s]));
    expect(stopRoute.get(ids.stopA1)!.routeId).toBe(ids.routeA);
    expect(stopRoute.get(ids.stopA2)!.routeId).toBe(ids.routeA);
    expect(stopRoute.get(ids.stopB1)!.routeId).toBe(ids.routeB);
    expect(stopRoute.get(ids.stopB2)!.routeId).toBe(ids.routeB);
    expect(stops.filter((s) => s.routeId === ids.routeB).every((s) => s.name.startsWith('B-'))).toBe(true);

    const [stA] = await db.select().from(students).where(eq(students.id, ids.studentA));
    const [stB] = await db.select().from(students).where(eq(students.id, ids.studentB));
    expect(stA).toMatchObject({
      companyId: ids.companyA, parentId: ids.parentA, schoolId: ids.schoolA, routeId: ids.routeA, stopId: ids.stopA1,
    });
    expect(stB).toMatchObject({
      companyId: ids.companyB, parentId: ids.parentB, schoolId: ids.schoolB, routeId: ids.routeB, stopId: ids.stopB1,
    });

    const links = await db.select().from(parentChildLinks);
    expect(links).toHaveLength(2);
    expect(links.find((l) => l.id === ids.linkA)).toMatchObject({ parentId: ids.parentA, studentId: ids.studentA });
    expect(links.find((l) => l.id === ids.linkB)).toMatchObject({ parentId: ids.parentB, studentId: ids.studentB });
  });

  it('buses are A-100 / B-100 in their tenant; no-password drivers have no bus', async () => {
    const { ids, db } = h;
    const rows = await db.select().from(buses);
    expect(rows).toHaveLength(2);
    const bA = rows.find((b) => b.id === ids.busA)!;
    const bB = rows.find((b) => b.id === ids.busB)!;
    expect(bA).toMatchObject({ companyId: ids.companyA, busNumber: 'A-100', driverId: ids.driverA, currentRouteId: ids.routeA });
    expect(bB).toMatchObject({ companyId: ids.companyB, busNumber: 'B-100', driverId: ids.driverB, currentRouteId: ids.routeB });
    expect(bA.currentLatitude).not.toBe(bB.currentLatitude);
    expect(rows.some((b) => b.driverId === ids.driverA2 || b.driverId === ids.driverB2)).toBe(false);
  });

  it('shift reports have a NULL companyId and point at the tenant driver', async () => {
    const { ids, db } = h;
    const rows = await db.select().from(driverShiftReports);
    expect(rows).toHaveLength(2);
    expect(rows.find((r) => r.id === ids.shiftA)).toMatchObject({ companyId: null, driverId: ids.driverA });
    expect(rows.find((r) => r.id === ids.shiftB)).toMatchObject({ companyId: null, driverId: ids.driverB });
  });
});
