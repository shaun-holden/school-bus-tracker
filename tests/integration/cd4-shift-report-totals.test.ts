// CD-4: the shift report written on an on → off PATCH /api/driver/duty-status
// counts real drop-offs (student_attendance.dropped_off_at) and the driver's
// vehicle issues for the company's local day, and never names another
// tenant's route. Real HTTP + real Postgres; the foreign / wrong-day rows are
// seeded so each clause is reachable (checklist X-1/X-2/X-3).
import { describe, it, expect, beforeAll } from 'vitest';
import { and, desc, eq, inArray, sql } from 'drizzle-orm';
import { users, studentAttendance, vehicleIssues, driverShiftReports, routes } from '@shared/schema';
import { useIntegrationHarness, type Agent } from './harness';
import { seedQ8Extras, Q8_EMAILS, SEED_PASSWORD, type Q8Ids } from './seed';

const h = useIntegrationHarness();
const URL = '/api/driver/duty-status';
const KEYS = ['dutyStartTime', 'id', 'isOnDuty'];

let q8: Q8Ids;
let driverA: Agent;
let driverX: Agent;
let offResBody: Record<string, unknown>;
let crossTenantIssueId: string;
let oldIssueId: string;
let postedIssueId: string;
let firstDriverXReportId: string;
let nullRouteId: string;

async function login(email: string): Promise<Agent> {
  const agent = h.anon();
  const res = await h.loginAttempt(email, SEED_PASSWORD, agent);
  expect(res.status).toBe(200);
  return agent;
}

const newestReport = async (driverId: string) => {
  const [row] = await h.db
    .select()
    .from(driverShiftReports)
    .where(eq(driverShiftReports.driverId, driverId))
    .orderBy(desc(driverShiftReports.shiftEndTime))
    .limit(1);
  return row;
};

beforeAll(async () => {
  q8 = await seedQ8Extras(h.ids);
  await h.db
    .update(users)
    .set({ isOnDuty: false, dutyStartTime: null })
    .where(inArray(users.id, [h.ids.driverA, q8.driverX]));

  // 2 logins (MAX_LOGINS_PER_FILE is 8).
  driverA = await h.loginAs('driverA');
  driverX = await login(Q8_EMAILS.driverX);

  const on = await driverA.patch(URL).send({ isOnDuty: true });
  expect(on.status).toBe(200);

  // Times set explicitly: defaultNow() depends on the Postgres session TimeZone.
  const now = new Date();
  const base = { companyId: h.ids.companyA, driverId: h.ids.driverA, routeId: h.ids.routeA, attendanceDate: now };
  await h.db.insert(studentAttendance).values([
    { ...base, studentId: h.ids.studentA, status: 'present', droppedOffAt: now },
    { ...base, studentId: q8.studentA4, status: 'present' },
    { ...base, studentId: q8.studentA3, status: 'absent' },
  ]);

  const issue = { busId: h.ids.busA, issueType: 'mechanical', description: 'CD-4 test issue' };
  // Q76a: the unresolved driverA issue goes through the real write path
  // (POST /api/vehicle-issues → createVehicleIssue). The sentinel default makes
  // mutation 1 (createdAt: new Date() removed) red even on a UTC database. The
  // schema is built once per run and only TRUNCATEd per file, so the finally
  // is the only thing that keeps the sentinel out of later files.
  await h.db.execute(sql`ALTER TABLE vehicle_issues ALTER COLUMN created_at SET DEFAULT '2000-01-01 00:00:00'`);
  try {
    const posted = await driverA
      .post('/api/vehicle-issues')
      .send({ busId: h.ids.busA, issueType: 'mechanical', description: 'CD-4 test issue', severity: 'normal' });
    expect(posted.status).toBe(200);
    postedIssueId = posted.body.id;
  } finally {
    await h.db.execute(sql`ALTER TABLE vehicle_issues ALTER COLUMN created_at SET DEFAULT now()`);
  }
  await h.db.insert(vehicleIssues).values([
    { ...issue, companyId: h.ids.companyA, driverId: h.ids.driverA, createdAt: now, isResolved: true },
    // Another driver of the same company, today.
    { ...issue, companyId: h.ids.companyA, driverId: h.ids.driverA2, createdAt: now },
  ]);
  const [cross] = await h.db
    .insert(vehicleIssues)
    .values({ ...issue, companyId: h.ids.companyB, driverId: h.ids.driverA, createdAt: now })
    .returning({ id: vehicleIssues.id });
  crossTenantIssueId = cross.id;
  const [old] = await h.db
    .insert(vehicleIssues)
    .values({ ...issue, companyId: h.ids.companyA, driverId: h.ids.driverA, createdAt: new Date(Date.now() - 2 * 864e5) })
    .returning({ id: vehicleIssues.id });
  oldIssueId = old.id;

  const off = await driverA.patch(URL).send({ isOnDuty: false });
  expect(off.status).toBe(200);
  offResBody = off.body;

  // driverX: company A, assignedRouteId = company B's routeB (bad data).
  // X-3, checked before the first toggle: going off duty resets assignedRouteId.
  const [x] = await h.db.select().from(users).where(eq(users.id, q8.driverX));
  expect(x.companyId).toBe(h.ids.companyA);
  expect(x.assignedRouteId).toBe(h.ids.routeB);
  const [rb] = await h.db.select().from(routes).where(eq(routes.id, h.ids.routeB));
  expect(rb.companyId).toBe(h.ids.companyB);
  expect((await driverX.patch(URL).send({ isOnDuty: true })).status).toBe(200);
  expect((await driverX.patch(URL).send({ isOnDuty: false })).status).toBe(200);
  firstDriverXReportId = (await newestReport(q8.driverX)).id;

  // Q76a: a route with NO company, assigned to driverX, then on → off again.
  const [nr] = await h.db.insert(routes).values({ companyId: null, name: 'CD-4 Null-Company Route' }).returning({ id: routes.id });
  nullRouteId = nr.id;
  await h.db.update(users).set({ assignedRouteId: nullRouteId }).where(eq(users.id, q8.driverX));
  const [x2] = await h.db.select().from(users).where(eq(users.id, q8.driverX));
  expect(x2.assignedRouteId).toBe(nullRouteId);
  expect((await driverX.patch(URL).send({ isOnDuty: true })).status).toBe(200);
  expect((await driverX.patch(URL).send({ isOnDuty: false })).status).toBe(200);
});

const reportById = async (id: string) =>
  (await h.db.select().from(driverShiftReports).where(eq(driverShiftReports.id, id)))[0];

describe('CD-4 shift report totals', () => {
  it('the foreign and wrong-day issue rows landed as seeded (X-3)', async () => {
    const [cross] = await h.db.select().from(vehicleIssues).where(eq(vehicleIssues.id, crossTenantIssueId));
    expect(cross.companyId).toBe(h.ids.companyB);
    expect(cross.driverId).toBe(h.ids.driverA);
    const [old] = await h.db.select().from(vehicleIssues).where(eq(vehicleIssues.id, oldIssueId));
    expect(Date.now() - old.createdAt!.getTime()).toBeGreaterThan(36 * 3600e3);
    const rows = await h.db
      .select()
      .from(vehicleIssues)
      .where(and(eq(vehicleIssues.busId, h.ids.busA), eq(vehicleIssues.description, 'CD-4 test issue')));
    expect(rows).toHaveLength(5);
  });

  it('studentsPickedUp = 2 and studentsDroppedOff = 1 (red if the droppedOffAt != null filter is removed)', async () => {
    const report = await newestReport(h.ids.driverA);
    expect(report).toBeTruthy();
    expect(report.companyId).toBe(h.ids.companyA);
    expect(report.studentsPickedUp).toBe(2);
    expect(report.studentsDroppedOff).toBe(1);
  });

  it('issuesReported = 2 (red if eq(vehicleIssues.driverId), eq(vehicleIssues.companyId) or onLocalDay(vehicleIssues.createdAt) is removed from countTodaysVehicleIssuesForDriver)', async () => {
    const report = await newestReport(h.ids.driverA);
    expect(report.issuesReported).toBe(2);
  });

  it('a route from another tenant gives routeName and routeId null (red if the isOutsideCallerTenant route check is removed)', async () => {
    const report = await reportById(firstDriverXReportId);
    expect(report).toBeTruthy();
    expect(report.companyId).toBe(h.ids.companyA);
    expect(report.routeName).toBeNull();
    expect(report.routeId).toBeNull();
  });

  it('a NULL-company route gives routeName and routeId null (red if the isOutsideCallerTenant route check lets a NULL-company route through)', async () => {
    const reports = await h.db.select().from(driverShiftReports).where(eq(driverShiftReports.driverId, q8.driverX));
    expect(reports).toHaveLength(2);
    const nullRouteReport = reports.find((r) => r.id !== firstDriverXReportId)!;
    expect(nullRouteReport).toBeTruthy();
    expect(nullRouteReport.routeId).toBeNull();
    expect(nullRouteReport.routeName).toBeNull();
  });

  it('a vehicle issue POSTed through the app gets created_at = now in UTC wall time (red if createdAt: new Date() is removed from createVehicleIssue)', async () => {
    const result = await h.db.execute(
      sql`select abs(extract(epoch from (created_at - (now() AT TIME ZONE 'UTC')))) < 300 as ok from vehicle_issues where id = ${postedIssueId}`,
    );
    expect(result.rows).toHaveLength(1);
    expect((result.rows[0] as { ok: boolean }).ok).toBe(true);
  });

  it('control: the vehicle_issues.created_at default is back to now() after the sentinel', async () => {
    const result = await h.db.execute(
      sql`select column_default from information_schema.columns where table_schema = 'public' and table_name = 'vehicle_issues' and column_name = 'created_at'`,
    );
    expect(String((result.rows[0] as { column_default: string | null }).column_default)).toContain('now()');
  });

  it('control: an own-tenant route still names the report', async () => {
    const report = await newestReport(h.ids.driverA);
    expect(report.routeId).toBe(h.ids.routeA);
    expect(report.routeName).toBeTruthy();
  });

  it('control: the on → off response still has exactly { id, isOnDuty, dutyStartTime }', () => {
    expect(Object.keys(offResBody).sort()).toEqual(KEYS);
    expect(offResBody.isOnDuty).toBe(false);
    expect(offResBody.dutyStartTime).toBeNull();
  });
});
