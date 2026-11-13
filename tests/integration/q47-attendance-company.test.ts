// Q47: driver attendance marks carry the route's company. Before this, the
// only insert into student_attendance wrote company_id NULL while the admin
// "today" view (getAllAttendanceData) filters on company_id, so company
// admins saw no driver marks at all. Real HTTP + real Postgres; the marks are
// created through the real POST path (not inserted with a companyId), so the
// admin test can't pass for the wrong reason.
import { describe, it, expect, beforeAll, beforeEach } from 'vitest';
import { eq } from 'drizzle-orm';
import { studentAttendance } from '@shared/schema';
import { useIntegrationHarness, type Agent } from './harness';

const h = useIntegrationHarness();

let driverA: Agent;
let adminA: Agent;
let adminB: Agent;

const rows = () => h.db.select().from(studentAttendance).where(eq(studentAttendance.studentId, h.ids.studentA));
const ids = (body: Array<{ id: string }>) => body.map((r) => r.id);

beforeAll(async () => {
  // 3 logins (MAX_LOGINS_PER_FILE is 8).
  driverA = await h.loginAs('driverA');
  adminA = await h.loginAs('adminA');
  adminB = await h.loginAs('adminB');
});

beforeEach(async () => {
  await h.db.delete(studentAttendance);
});

describe('Q47 driver marks carry the route company', () => {
  it('starting from zero rows, driverA marks studentA present → the row has company A and adminA\'s GET /api/student-attendance shows it (red if markStudentAttendance stops passing route.companyId, M11)', async () => {
    expect(await rows()).toHaveLength(0);
    const res = await driverA.post('/api/student-attendance').send({ studentId: h.ids.studentA, status: 'present' });
    expect(res.status).toBe(200);
    const [row] = await rows();
    expect(row.companyId).toBe(h.ids.companyA);
    const list = await adminA.get('/api/student-attendance');
    expect(list.status).toBe(200);
    expect(ids(list.body)).toContain(row.id);
  });

  it('adminB (company B) does not see company A\'s mark (getAllAttendanceData companyId filter, X-1)', async () => {
    const res = await driverA.post('/api/student-attendance').send({ studentId: h.ids.studentA, status: 'present' });
    expect(res.status).toBe(200);
    const list = await adminB.get('/api/student-attendance');
    expect(list.status).toBe(200);
    expect(ids(list.body)).not.toContain(res.body.id);
  });

  it('a legacy NULL-company mark from today, re-marked, gets company A and becomes visible to adminA (coalesce on the update path)', async () => {
    const [legacy] = await h.db
      .insert(studentAttendance)
      .values({ companyId: null, studentId: h.ids.studentA, driverId: h.ids.driverA, routeId: h.ids.routeA, status: 'absent', attendanceDate: new Date() })
      .returning({ id: studentAttendance.id });
    const res = await driverA.post('/api/student-attendance').send({ studentId: h.ids.studentA, status: 'present' });
    expect(res.status).toBe(200);
    expect(res.body.id).toBe(legacy.id);
    const [row] = await rows();
    expect(row.companyId).toBe(h.ids.companyA);
    expect(row.status).toBe('present');
    expect(ids((await adminA.get('/api/student-attendance')).body)).toContain(legacy.id);
  });
});
