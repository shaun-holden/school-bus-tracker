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
  linkCodes,
  parentNotifications,
  routeSchools,
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
  driverAdminA: 'driver-admin-a@sbt.test',
  parentNull: 'parent-null@sbt.test',
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
  driverAdminA: string;
  parentNull: string;

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
  linkCodeA: string;
  linkCodeB: string;
  noticeA: string;
  noticeB: string;
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

export async function insertUser(
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

  // Active link code for the tenant's student (reachability target for the
  // link-code / regenerate-code record-by-id guards).
  const [linkCode] = await db
    .insert(linkCodes)
    .values({
      companyId,
      code: `${prefix}-LINK-0001`,
      studentId: student.id,
      createdById: adminId,
      status: 'active',
      expiresAt: new Date('2099-01-01T00:00:00Z'),
    })
    .returning({ id: linkCodes.id });

  // Company-wide (global) parent notification, no route.
  const [notice] = await db
    .insert(parentNotifications)
    .values({
      companyId,
      title: `${prefix}-Notice`,
      message: `${prefix}-Notice message`,
      createdById: adminId,
      isGlobal: true,
    })
    .returning({ id: parentNotifications.id });

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
    linkCode: linkCode.id,
    notice: notice.id,
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

  // driver_admin in A: the "same-company driver_admin" path of the check-in guard.
  const driverAdminA = await insertUser(
    { email: EMAILS.driverAdminA, firstName: 'A-DriverAdmin', lastName: 'Seed', role: 'driver_admin', companyId: companyA },
    { password: true },
  );
  // Parent with no company and no children (SEC-20: null never matches null).
  const parentNull = await insertUser(
    { email: EMAILS.parentNull, firstName: 'Null-Parent', lastName: 'Seed', role: 'parent', companyId: null },
    { password: true },
  );

  return {
    companyA, companyB, companyC, companyD, companyA2,
    adminA: a.admin, driverA: a.driver, parentA: a.parent, driverA2: a.driver2, driverA_archived,
    adminB: b.admin, driverB: b.driver, parentB: b.parent, driverB2: b.driver2,
    adminNull, master, adminC, adminD, adminA2, driverAdminA, parentNull,
    schoolA: a.school, schoolB: b.school,
    routeA: a.route, routeB: b.route,
    stopA1: a.stop1, stopA2: a.stop2, stopB1: b.stop1, stopB2: b.stop2,
    studentA: a.student, studentB: b.student,
    linkA: a.link, linkB: b.link,
    busA: a.bus, busB: b.bus,
    shiftA: a.shift, shiftB: b.shift,
    linkCodeA: a.linkCode, linkCodeB: b.linkCode,
    noticeA: a.notice, noticeB: b.notice,
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

  const userIds = [ids.adminA, ids.driverA, ids.driverA2, ids.driverAdminA, ids.adminB, ids.driverB, ids.driverB2, ids.parentNull];
  const userRows = await db
    .select({ id: users.id, companyId: users.companyId })
    .from(users)
    .where(inArray(users.id, userIds));
  const companyOf = new Map(userRows.map((u) => [u.id, u.companyId]));
  if (!companyOf.has(ids.parentNull) || companyOf.get(ids.parentNull) !== null) fail('parentNull must exist with a NULL companyId');
  for (const id of [ids.adminA, ids.driverA, ids.driverA2, ids.driverAdminA]) {
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

  const codeRows = await db
    .select({ id: linkCodes.id, companyId: linkCodes.companyId, studentId: linkCodes.studentId, status: linkCodes.status })
    .from(linkCodes)
    .where(inArray(linkCodes.id, [ids.linkCodeA, ids.linkCodeB]));
  const codeOf = new Map(codeRows.map((r) => [r.id, r]));
  const cA = codeOf.get(ids.linkCodeA);
  const cB = codeOf.get(ids.linkCodeB);
  if (!cA || cA.companyId !== ids.companyA || cA.studentId !== ids.studentA || cA.status !== 'active') {
    fail('linkCodeA is not an active company A code for studentA');
  }
  if (!cB || cB.companyId !== ids.companyB || cB.studentId !== ids.studentB || cB.status !== 'active') {
    fail('linkCodeB is not an active company B code for studentB');
  }

  const noticeRows = await db
    .select({ id: parentNotifications.id, companyId: parentNotifications.companyId, isGlobal: parentNotifications.isGlobal })
    .from(parentNotifications)
    .where(inArray(parentNotifications.id, [ids.noticeA, ids.noticeB]));
  const noticeCompany = new Map(noticeRows.map((r) => [r.id, r.isGlobal === true ? r.companyId : 'not-global']));
  if (noticeCompany.get(ids.noticeA) !== ids.companyA || noticeCompany.get(ids.noticeB) !== ids.companyB) {
    fail('global notices are not in their companies');
  }
}

// ---------------------------------------------------------------------------
// Q8 extras: NOT part of the default seed. Only the q8-* / q17b-* files call
// seedQ8Extras(ids) after the harness has seeded, so every other file keeps
// the plain two-tenant data.
//
// Recipients a company-A route event on routeA at schoolA / stopA1 must reach:
//   (parentA, studentA)    via both students.parentId and a link: ONE row
//   (parentNull, studentA) null-company parent linked to an A student
// and must NOT reach:
//   parentA3     child on routeA2 (same school, other route)
//   parentNull   for studentBx (company-B student on routeA/schoolA, bad data)
//   parentB      for studentBx (company B) and for studentA4 (linked by mistake)
//   adminA       students.parentId of studentA4 (shortcut pointing at an admin)
export const Q8_EMAILS = {
  parentA3: 'q8-parent-a3@sbt.test',
  driverX: 'q8-driver-x@sbt.test',
} as const;

export interface Q8Ids {
  parentA3: string;
  driverX: string;
  routeA2: string;
  stopA2x: string;
  studentA3: string;
  studentA4: string;
  studentBx: string;
  schoolA2: string;
  schoolA3: string;
}

export async function seedQ8Extras(ids: SeedIds): Promise<Q8Ids> {
  const A = ids.companyA;
  const parentA3 = await insertUser(
    { email: Q8_EMAILS.parentA3, firstName: 'A-Parent3', lastName: 'Seed', role: 'parent', companyId: A },
    { password: true },
  );
  // Company-A driver whose assignedRouteId is company B's route (bad data):
  // reaches the route tenant check on its own.
  const driverX = await insertUser(
    { email: Q8_EMAILS.driverX, firstName: 'A-DriverX', lastName: 'Seed', role: 'driver', companyId: A, assignedRouteId: ids.routeB },
    { password: true },
  );

  const [routeA2] = await db
    .insert(routes)
    .values({ companyId: A, name: 'A-Route2', schoolId: ids.schoolA, busNumber: 'A-200' })
    .returning({ id: routes.id });
  const [stopA2x] = await db
    .insert(routeStops)
    .values({ routeId: routeA2.id, schoolId: ids.schoolA, name: 'A-Route2-Stop', address: 'A-30 Stop St', order: 1 })
    .returning({ id: routeStops.id });

  const [schoolA2] = await db
    .insert(schools)
    .values({ companyId: A, name: 'A-School2', address: 'A-2 School Rd' })
    .returning({ id: schools.id });
  await db.insert(routeSchools).values({ routeId: ids.routeA, schoolId: schoolA2.id, order: 0 });
  const [schoolA3] = await db
    .insert(schools)
    .values({ companyId: A, name: 'A-School3', address: 'A-3 School Rd' })
    .returning({ id: schools.id });

  const [studentA3] = await db
    .insert(students)
    .values({ companyId: A, firstName: 'A-Student3', lastName: 'Seed', parentId: parentA3, schoolId: ids.schoolA, routeId: routeA2.id, stopId: stopA2x.id })
    .returning({ id: students.id });
  await db.insert(parentChildLinks).values({ parentId: parentA3, studentId: studentA3.id });

  const [studentA4] = await db
    .insert(students)
    .values({ companyId: A, firstName: 'A-Student4', lastName: 'Seed', parentId: ids.adminA, schoolId: ids.schoolA, routeId: ids.routeA, stopId: ids.stopA1 })
    .returning({ id: students.id });
  await db.insert(parentChildLinks).values({ parentId: ids.parentB, studentId: studentA4.id });

  const [studentBx] = await db
    .insert(students)
    .values({ companyId: ids.companyB, firstName: 'B-StudentX', lastName: 'Seed', parentId: ids.parentB, schoolId: ids.schoolA, routeId: ids.routeA, stopId: ids.stopA1 })
    .returning({ id: students.id });
  await db.insert(parentChildLinks).values([
    { parentId: ids.parentB, studentId: studentBx.id },
    { parentId: ids.parentNull, studentId: studentBx.id },
  ]);

  await db.insert(parentChildLinks).values({ parentId: ids.parentNull, studentId: ids.studentA });

  return {
    parentA3, driverX,
    routeA2: routeA2.id, stopA2x: stopA2x.id,
    studentA3: studentA3.id, studentA4: studentA4.id, studentBx: studentBx.id,
    schoolA2: schoolA2.id, schoolA3: schoolA3.id,
  };
}

// ---------------------------------------------------------------------------
// Q8 round 2 extras: opt-in like seedQ8Extras (call it after seedQ8Extras).
// Every new student is a company-A student on routeA at schoolA / stopA1, so
// it is reachable by an arrival at schoolA, a departure from it and a
// completion of stopA1; none of them may produce a notice:
//   A-ShortB     students.parentId = parentB (company B), no link row
//   A-ShortNull  students.parentId = parentNull (no company), no link row
//   A-LinkAdmin  students.parentId = driverA; adminA linked via parentChildLinks
// Plus two schools that are on a driver's route by ONE path only:
//   schoolStopOnly   only through a routeA stop's schoolId
//   schoolRouteOnly  only as routes.schoolId of routeR (no stops, no
//                    routeSchools), driven by driverR
export const Q8R2_EMAILS = {
  driverR: 'q8r2-driver-r@sbt.test',
} as const;

export interface Q8R2Ids {
  studentShortB: string;
  studentShortNull: string;
  studentLinkAdmin: string;
  schoolStopOnly: string;
  schoolRouteOnly: string;
  routeR: string;
  driverR: string;
}

export async function seedQ8Round2(ids: SeedIds): Promise<Q8R2Ids> {
  const A = ids.companyA;
  const onRouteA = { companyId: A, lastName: 'Seed', schoolId: ids.schoolA, routeId: ids.routeA, stopId: ids.stopA1 };

  const [shortB] = await db.insert(students).values({ ...onRouteA, firstName: 'A-ShortB', parentId: ids.parentB }).returning({ id: students.id });
  const [shortNull] = await db.insert(students).values({ ...onRouteA, firstName: 'A-ShortNull', parentId: ids.parentNull }).returning({ id: students.id });
  const [linkAdmin] = await db.insert(students).values({ ...onRouteA, firstName: 'A-LinkAdmin', parentId: ids.driverA }).returning({ id: students.id });
  await db.insert(parentChildLinks).values({ parentId: ids.adminA, studentId: linkAdmin.id });

  const [schoolStopOnly] = await db
    .insert(schools)
    .values({ companyId: A, name: 'A-SchoolStopOnly', address: 'A-4 School Rd' })
    .returning({ id: schools.id });
  await db.insert(routeStops).values({ routeId: ids.routeA, schoolId: schoolStopOnly.id, name: 'A-Stop-3', address: 'A-40 Stop St', order: 3 });

  const [schoolRouteOnly] = await db
    .insert(schools)
    .values({ companyId: A, name: 'A-SchoolRouteOnly', address: 'A-5 School Rd' })
    .returning({ id: schools.id });
  const [routeR] = await db
    .insert(routes)
    .values({ companyId: A, name: 'A-RouteR', schoolId: schoolRouteOnly.id, busNumber: 'A-300' })
    .returning({ id: routes.id });
  const driverR = await insertUser(
    { email: Q8R2_EMAILS.driverR, firstName: 'A-DriverR', lastName: 'Seed', role: 'driver', companyId: A, assignedRouteId: routeR.id },
    { password: true },
  );

  return {
    studentShortB: shortB.id, studentShortNull: shortNull.id, studentLinkAdmin: linkAdmin.id,
    schoolStopOnly: schoolStopOnly.id, schoolRouteOnly: schoolRouteOnly.id, routeR: routeR.id, driverR,
  };
}

// ---------------------------------------------------------------------------
// TD-1/TD-2 (Q47) extras: opt-in, like seedQ8Extras. A company-A parent who is
// linked to studentA ONLY through parentChildLinks (studentA.parentId stays
// parentA), so the link-code lookup path is the only way in.
export const TD1_EMAILS = {
  parentLinkA: 'td1-parent-link-a@sbt.test',
} as const;

export async function seedTd1Extras(ids: SeedIds): Promise<{ parentLinkA: string }> {
  const parentLinkA = await insertUser(
    { email: TD1_EMAILS.parentLinkA, firstName: 'A-ParentLink', lastName: 'Seed', role: 'parent', companyId: ids.companyA },
    { password: true },
  );
  await db.insert(parentChildLinks).values({ parentId: parentLinkA, studentId: ids.studentA });
  return { parentLinkA };
}
