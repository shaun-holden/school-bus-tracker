// Two-tenant seed for the integration harness (plan Decision 4 + brief I4).
//
// Direct db.insert() with tables from @shared/schema, never storage.*, so the
// seed does not depend on storage changes. Names are prefixed `A-` / `B-` so a
// leak is easy to spot in a response body. Bus numbers and emails are globally
// unique.
import bcrypt from 'bcryptjs';
import { eq, inArray } from 'drizzle-orm';
import { db } from '../../server/db';
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

export const SEED_PASSWORD = 'integration-Pass-123';

export const EMAILS = {
  adminA: 'admin-a@sbt.test',
  driverA: 'driver-a@sbt.test',
  parentA: 'parent-a@sbt.test',
  driverA2: 'driver-a2@sbt.test',
  driverA_archived: 'driver-a-archived@sbt.test',
  adminB: 'admin-b@sbt.test',
  driverB: 'driver-b@sbt.test',
  parentB: 'parent-b@sbt.test',
  driverB2: 'driver-b2@sbt.test',
  adminNull: 'admin-null@sbt.test',
  master: 'master@sbt.test',
  adminC: 'admin-c@sbt.test',
  adminD: 'admin-d@sbt.test',
  adminA2: 'admin-a2@sbt.test',
} as const;

export type Persona = keyof typeof EMAILS;

export interface SeedIds {
  companyA: string;
  companyB: string;
  companyC: string;
  companyD: string;
  companyA2: string;

  adminA: string;
  driverA: string;
  parentA: string;
  driverA2: string;
  driverA_archived: string;
  adminB: string;
  driverB: string;
  parentB: string;
  driverB2: string;
  adminNull: string;
  master: string;
  adminC: string;
  adminD: string;
  adminA2: string;

  schoolA: string;
  schoolB: string;
  routeA: string;
  routeB: string;
  stopA1: string;
  stopA2: string;
  stopB1: string;
  stopB2: string;
  studentA: string;
  studentB: string;
  linkA: string;
  linkB: string;
  busA: string;
  busB: string;
  shiftA: string;
  shiftB: string;
}

const PROFESSIONAL = {
  planType: 'professional' as const,
  staffUserLimit: 5,
  parentUserLimit: null,
  parentPortalEnabled: true,
  gpsEnabled: true,
};

let cachedHash: string | undefined;
function seedHash(): string {
  // Cost 4: comparePasswords reads the cost from the hash, so logins stay fast.
  cachedHash ??= bcrypt.hashSync(SEED_PASSWORD, 4);
  return cachedHash;
}

async function insertCompany(values: typeof companies.$inferInsert): Promise<string> {
  const [row] = await db.insert(companies).values(values).returning({ id: companies.id });
  return row.id;
}

async function insertUser(
  values: typeof users.$inferInsert,
  opts: { password: boolean },
): Promise<string> {
  const [row] = await db.insert(users).values(values).returning({ id: users.id });
  if (opts.password) {
    await db.insert(passwordCredentials).values({ userId: row.id, passwordHash: seedHash() });
  }
  return row.id;
}

async function seedTenant(prefix: 'A' | 'B', companyId: string) {
  const email = (k: string) => (EMAILS as Record<string, string>)[k];

  const adminId = await insertUser(
    { email: email(`admin${prefix}`), firstName: `${prefix}-Admin`, lastName: 'Seed', role: 'admin', companyId },
    { password: true },
  );
  const driverId = await insertUser(
    { email: email(`driver${prefix}`), firstName: `${prefix}-Driver`, lastName: 'Seed', role: 'driver', companyId },
    { password: true },
  );
  const parentId = await insertUser(
    { email: email(`parent${prefix}`), firstName: `${prefix}-Parent`, lastName: 'Seed', role: 'parent', companyId },
    { password: true },
  );
  // Driver with an email, NO password and NO bus: the reachability target for
  // send-invitation ("already set up") and the bus driver check ("already assigned").
  const driver2Id = await insertUser(
    { email: email(`driver${prefix}2`), firstName: `${prefix}-Driver2`, lastName: 'Seed', role: 'driver', companyId },
    { password: false },
  );

  const [school] = await db
    .insert(schools)
    .values({ companyId, name: `${prefix}-School`, address: `${prefix}-1 School Rd` })
    .returning({ id: schools.id });

  const [route] = await db
    .insert(routes)
    .values({ companyId, name: `${prefix}-Route`, driverId, schoolId: school.id, busNumber: `${prefix}-100` })
    .returning({ id: routes.id });

  await db.update(users).set({ assignedRouteId: route.id }).where(eq(users.id, driverId));

  const [stop1] = await db
    .insert(routeStops)
    .values({ routeId: route.id, schoolId: school.id, name: `${prefix}-Stop-1`, address: `${prefix}-10 Stop St`, order: 1 })
    .returning({ id: routeStops.id });
  const [stop2] = await db
    .insert(routeStops)
    .values({ routeId: route.id, schoolId: school.id, name: `${prefix}-Stop-2`, address: `${prefix}-20 Stop St`, order: 2 })
    .returning({ id: routeStops.id });

  const [student] = await db
    .insert(students)
    .values({
      companyId,
      firstName: `${prefix}-Student`,
      lastName: 'Seed',
      parentId,
      schoolId: school.id,
      routeId: route.id,
      stopId: stop1.id,
    })
    .returning({ id: students.id });

  const [link] = await db
    .insert(parentChildLinks)
    .values({ parentId, studentId: student.id })
    .returning({ id: parentChildLinks.id });

  const [bus] = await db
    .insert(buses)
    .values({
      companyId,
      busNumber: `${prefix}-100`,
      make: `${prefix}-Make`,
      driverId,
      currentRouteId: route.id,
      currentLatitude: prefix === 'A' ? '41.87810000' : '29.76040000',
      currentLongitude: prefix === 'A' ? '-87.62980000' : '-95.36980000',
    })
    .returning({ id: buses.id });

  // Legacy shape: companyId NULL. Only the users.companyId join can scope it.
  const shiftStart = new Date('2026-11-02T13:00:00Z');
  const shiftEnd = new Date('2026-11-02T15:00:00Z');
  const [shift] = await db
    .insert(driverShiftReports)
    .values({
      companyId: null,
      driverId,
      driverName: `${prefix}-Driver Seed`,
      busId: bus.id,
      routeId: route.id,
      busNumber: `${prefix}-100`,
      routeName: `${prefix}-Route`,
      shiftStartTime: shiftStart,
      shiftEndTime: shiftEnd,
      totalDurationMinutes: 120,
    })
    .returning({ id: driverShiftReports.id });

  return {
    admin: adminId,
    driver: driverId,
    parent: parentId,
    driver2: driver2Id,
    school: school.id,
    route: route.id,
    stop1: stop1.id,
    stop2: stop2.id,
    student: student.id,
    link: link.id,
    bus: bus.id,
    shift: shift.id,
  };
}

/** Seeds both tenants plus the extra personas. Call after resetDb(). */
export async function seedTwoTenants(): Promise<SeedIds> {
  const companyA = await insertCompany({
    name: 'A-Company', slug: 'co-a', status: 'approved', isActive: true, timezone: 'America/Chicago', ...PROFESSIONAL,
  });
  const companyB = await insertCompany({
    name: 'B-Company', slug: 'co-b', status: 'approved', isActive: true, timezone: 'America/Chicago', ...PROFESSIONAL,
  });
  const companyC = await insertCompany({
    name: 'C-Company', slug: 'co-c', status: 'pending_approval', isActive: false, timezone: 'America/Chicago', ...PROFESSIONAL,
  });
  const companyD = await insertCompany({
    name: 'D-Company', slug: 'co-d', status: 'suspended', isActive: false, timezone: 'America/Chicago', ...PROFESSIONAL,
  });
  const companyA2 = await insertCompany({
    name: 'A2-Company', slug: 'co-a2', status: 'approved', isActive: true, timezone: 'America/Chicago', ...PROFESSIONAL,
  });

  const a = await seedTenant('A', companyA);
  const b = await seedTenant('B', companyB);

  const driverA_archived = await insertUser(
    { email: EMAILS.driverA_archived, firstName: 'A-Archived', lastName: 'Driver', role: 'driver', companyId: companyA, isActive: false },
    { password: true },
  );
  const adminNull = await insertUser(
    { email: EMAILS.adminNull, firstName: 'Null-Admin', lastName: 'Seed', role: 'admin', companyId: null },
    { password: true },
  );
  const master = await insertUser(
    { email: EMAILS.master, firstName: 'Master', lastName: 'Seed', role: 'master_admin', companyId: null },
    { password: true },
  );
  const adminC = await insertUser(
    { email: EMAILS.adminC, firstName: 'C-Admin', lastName: 'Seed', role: 'admin', companyId: companyC },
    { password: true },
  );
  const adminD = await insertUser(
    { email: EMAILS.adminD, firstName: 'D-Admin', lastName: 'Seed', role: 'admin', companyId: companyD },
    { password: true },
  );
  const adminA2 = await insertUser(
    { email: EMAILS.adminA2, firstName: 'A2-Admin', lastName: 'Seed', role: 'admin', companyId: companyA2 },
    { password: true },
  );

  return {
    companyA, companyB, companyC, companyD, companyA2,
    adminA: a.admin, driverA: a.driver, parentA: a.parent, driverA2: a.driver2, driverA_archived,
    adminB: b.admin, driverB: b.driver, parentB: b.parent, driverB2: b.driver2,
    adminNull, master, adminC, adminD, adminA2,
    schoolA: a.school, schoolB: b.school,
    routeA: a.route, routeB: b.route,
    stopA1: a.stop1, stopA2: a.stop2, stopB1: b.stop1, stopB2: b.stop2,
    studentA: a.student, studentB: b.student,
    linkA: a.link, linkB: b.link,
    busA: a.bus, busB: b.bus,
    shiftA: a.shift, shiftB: b.shift,
  };
}

/**
 * Fast sanity check run by every integration file's beforeAll, so no file
 * depends on seed.test.ts having run first. Throws on the first mismatch.
 */
export async function assertSeed(ids: SeedIds): Promise<void> {
  const fail = (what: string) => {
    throw new Error(`assertSeed: ${what}`);
  };

  const companyRows = await db
    .select({ id: companies.id, status: companies.status, isActive: companies.isActive })
    .from(companies)
    .where(inArray(companies.id, [ids.companyA, ids.companyB]));
  if (companyRows.length !== 2) fail('companies A and B missing');
  for (const c of companyRows) {
    if (c.status !== 'approved' || c.isActive !== true) fail(`company ${c.id} is not approved+active`);
  }

  const userIds = [ids.adminA, ids.driverA, ids.driverA2, ids.adminB, ids.driverB, ids.driverB2];
  const userRows = await db
    .select({ id: users.id, companyId: users.companyId })
    .from(users)
    .where(inArray(users.id, userIds));
  const companyOf = new Map(userRows.map((u) => [u.id, u.companyId]));
  for (const id of [ids.adminA, ids.driverA, ids.driverA2]) {
    if (companyOf.get(id) !== ids.companyA) fail(`user ${id} is not in company A`);
  }
  for (const id of [ids.adminB, ids.driverB, ids.driverB2]) {
    if (companyOf.get(id) !== ids.companyB) fail(`user ${id} is not in company B`);
  }

  const busRows = await db
    .select({ id: buses.id, companyId: buses.companyId })
    .from(buses)
    .where(inArray(buses.id, [ids.busA, ids.busB]));
  const busCompany = new Map(busRows.map((r) => [r.id, r.companyId]));
  if (busCompany.get(ids.busA) !== ids.companyA || busCompany.get(ids.busB) !== ids.companyB) {
    fail('buses are not in their companies');
  }

  const routeRows = await db
    .select({ id: routes.id, companyId: routes.companyId })
    .from(routes)
    .where(inArray(routes.id, [ids.routeA, ids.routeB]));
  const routeCompany = new Map(routeRows.map((r) => [r.id, r.companyId]));
  if (routeCompany.get(ids.routeA) !== ids.companyA || routeCompany.get(ids.routeB) !== ids.companyB) {
    fail('routes are not in their companies');
  }

  const shiftRows = await db
    .select({ id: driverShiftReports.id, companyId: driverShiftReports.companyId })
    .from(driverShiftReports)
    .where(inArray(driverShiftReports.id, [ids.shiftA, ids.shiftB]));
  if (shiftRows.length !== 2 || shiftRows.some((r) => r.companyId !== null)) {
    fail('shift reports must exist with a NULL companyId');
  }
}
