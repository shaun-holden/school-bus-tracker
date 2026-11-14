// T4b E1-E3: stop arrival, school arrival and school departure push to the
// in-app audience after the fence, once per event, and never name another
// family's child. pushService is mocked (tests/integration/setup.ts), so the
// assertions read pushService.sendToUsers calls (ids + payload), which
// pushToRecipients makes before the response is sent. Real HTTP + real
// Postgres. Each "no push" test sits next to a positive control.
import { describe, it, expect, beforeAll, beforeEach, afterEach, vi } from 'vitest';
import { eq } from 'drizzle-orm';
import { students, parentChildLinks, schoolVisits, routeStopCompletions, systemNotifications, companies } from '@shared/schema';
import { pushService } from '../../server/pushService';
import { useIntegrationHarness, type Agent } from './harness';
import { insertUser } from './seed';

const h = useIntegrationHarness();
const TZ = 'America/Chicago';

let driverA: Agent;
let parentP2: string;

const send = () => vi.mocked(pushService.sendToUsers);
const pushes = () => send().mock.calls.map((c) => ({ ids: [...(c[0] as string[])].sort(), body: (c[1] as { body: string }).body, type: (c[1] as { data?: { type?: string } }).data?.type }));
const bodyFor = (userId: string) => pushes().find((p) => p.ids.includes(userId))?.body;

function yesterdayNoonChicago(): Date {
  const today = new Intl.DateTimeFormat('en-CA', { timeZone: TZ }).format(new Date());
  const [y, m, d] = today.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d - 1, 18, 0, 0)); // ~noon Chicago yesterday
}

beforeAll(async () => {
  // A second family at the same stop / route / school.
  parentP2 = await insertUser(
    { email: 't4b-parent-p2@sbt.test', firstName: 'A-ParentP2', lastName: 'Seed', role: 'parent', companyId: h.ids.companyA },
    { password: false },
  );
  const [kid] = await h.db
    .insert(students)
    .values({ companyId: h.ids.companyA, firstName: 'A-Kid2', lastName: 'Secret', parentId: parentP2, schoolId: h.ids.schoolA, routeId: h.ids.routeA, stopId: h.ids.stopA1 })
    .returning({ id: students.id });
  await h.db.insert(parentChildLinks).values({ parentId: parentP2, studentId: kid.id });
  // 1 login (MAX_LOGINS_PER_FILE is 8).
  driverA = await h.loginAs('driverA');
});

beforeEach(async () => {
  for (const t of [schoolVisits, routeStopCompletions, systemNotifications]) await h.db.delete(t);
  send().mockClear();
});

afterEach(async () => {
  await h.db.update(companies).set({ parentPortalEnabled: true }).where(eq(companies.id, h.ids.companyA));
});

describe('T4b E1 stop arrival', () => {
  it('first completion pushes stop_arrival to each family with only their own child; a second completion today pushes nothing more (red if the first-today guard is removed)', async () => {
    const res = await driverA.post('/api/driver/mark-stop-completed').send({ routeId: h.ids.routeA, routeStopId: h.ids.stopA1, stopSequence: 1 });
    expect(res.status).toBe(200);
    expect(pushes().every((p) => p.type === 'stop_arrival')).toBe(true);
    expect(bodyFor(h.ids.parentA)).toBe('The bus is at A-Stop-1 for A-Student.');
    expect(bodyFor(parentP2)).toBe('The bus is at A-Stop-1 for A-Kid2.');
    expect(bodyFor(h.ids.parentA)).not.toContain('A-Kid2');
    const after1 = send().mock.calls.length;
    const res2 = await driverA.post('/api/driver/mark-stop-completed').send({ routeId: h.ids.routeA, routeStopId: h.ids.stopA1, stopSequence: 1 });
    expect(res2.status).toBe(200);
    expect(send().mock.calls.length).toBe(after1);
  });

  it('3A: the in-app notice names the stop, not its address', async () => {
    await driverA.post('/api/driver/mark-stop-completed').send({ routeId: h.ids.routeA, routeStopId: h.ids.stopA1, stopSequence: 1 });
    const rows = await h.db.select().from(systemNotifications).where(eq(systemNotifications.recipientId, h.ids.parentA));
    expect(rows.map((r) => r.message)).toContain('The bus has arrived at A-Stop-1 for A-Student');
    expect(rows.map((r) => r.message).join(' ')).not.toContain('A-10 Stop St');
  });

  it('2A: with the parent portal off, parents get no push but still get the in-app notice (red if the fence ignores parent_portal_enabled)', async () => {
    await h.db.update(companies).set({ parentPortalEnabled: false }).where(eq(companies.id, h.ids.companyA));
    const res = await driverA.post('/api/driver/mark-stop-completed').send({ routeId: h.ids.routeA, routeStopId: h.ids.stopA1, stopSequence: 1 });
    expect(res.status).toBe(200);
    expect(send()).not.toHaveBeenCalled();
    const rows = await h.db.select().from(systemNotifications).where(eq(systemNotifications.recipientId, h.ids.parentA));
    expect(rows).toHaveLength(1);
  });
});

describe('T4b E2 school arrival', () => {
  it('first arrival pushes school_arrival; a second arrival at the same school today pushes nothing more (red if the created guard is removed)', async () => {
    const res = await driverA.post('/api/driver-school-arrival').send({ schoolId: h.ids.schoolA });
    expect(res.status).toBe(200);
    expect(bodyFor(h.ids.parentA)).toBe("A-Student's bus has arrived at A-School.");
    expect(pushes().every((p) => p.type === 'school_arrival')).toBe(true);
    const after1 = send().mock.calls.length;
    expect(after1).toBeGreaterThan(0);
    expect((await driverA.post('/api/driver-school-arrival').send({ schoolId: h.ids.schoolA })).status).toBe(200);
    expect(send().mock.calls.length).toBe(after1);
    expect(await h.db.select().from(schoolVisits)).toHaveLength(1);
  });
});

describe('T4b E3 school departure', () => {
  it('first departure pushes school_departure; a second departure pushes nothing more (red if departed_at IS NULL is removed)', async () => {
    const arr = await driverA.post('/api/driver-school-arrival').send({ schoolId: h.ids.schoolA });
    send().mockClear();
    const visitId = arr.body.id;
    const dep = await driverA.post('/api/driver-school-departure').send({ visitId });
    expect(dep.status).toBe(200);
    expect(bodyFor(h.ids.parentA)).toBe("A-Student's bus has left A-School.");
    expect(pushes().every((p) => p.type === 'school_departure')).toBe(true);
    const after1 = send().mock.calls.length;
    expect(after1).toBeGreaterThan(0);
    const dep2 = await driverA.post('/api/driver-school-departure').send({ visitId });
    expect(dep2.status).toBe(200);
    expect(dep2.body.id).toBe(visitId);
    expect(send().mock.calls.length).toBe(after1);
  });

  it('a visit from yesterday → 404 "Visit not found", departed_at untouched, no push (red if the today check is removed)', async () => {
    const [old] = await h.db
      .insert(schoolVisits)
      .values({ companyId: h.ids.companyA, driverId: h.ids.driverA, schoolId: h.ids.schoolA, routeId: h.ids.routeA, arrivedAt: yesterdayNoonChicago(), visitDate: yesterdayNoonChicago() })
      .returning({ id: schoolVisits.id });
    const res = await driverA.post('/api/driver-school-departure').send({ visitId: old.id });
    expect(res.status).toBe(404);
    expect(res.body).toEqual({ message: 'Visit not found' });
    expect((await h.db.select().from(schoolVisits).where(eq(schoolVisits.id, old.id)))[0].departedAt).toBeNull();
    expect(send()).not.toHaveBeenCalled();
  });
});
