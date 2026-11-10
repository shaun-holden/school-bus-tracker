// HF1 tenant guards, reached over real HTTP against a real Postgres.
// Each title names the route string and the guard clause whose deletion turns
// the test red. Line numbers are deliberately not cited (HF2 moved them).
import { describe, it, expect, beforeAll, beforeEach } from 'vitest';
import crypto from 'crypto';
import { eq } from 'drizzle-orm';
import { buses, driverInvitations } from '@shared/schema';
import { sendDriverInvitationEmail } from '../../server/emailService';
import { useIntegrationHarness, type Agent } from './harness';

const h = useIntegrationHarness();
let adminA: Agent;
let adminNull: Agent;

beforeAll(async () => {
  adminA = await h.loginAs('adminA');
  adminNull = await h.loginAs('adminNull');
});

const ids = (rows: Array<{ id: string }>) => rows.map((r) => r.id);

describe('GET /api/driver-shift-reports (HF1 #1-#3)', () => {
  it('#1 admin with no company gets [] (red if `if (scope === null) return res.json([])` is removed from GET /api/driver-shift-reports)', async () => {
    const res = await adminNull.get('/api/driver-shift-reports');
    expect(res.status).toBe(200);
    expect(res.body).toEqual([]);
  });

  it('#2 adminA sees shiftA but not shiftB (red if GET /api/driver-shift-reports stops passing `getDriverShiftReports(undefined, scope)`)', async () => {
    const res = await adminA.get('/api/driver-shift-reports');
    expect(res.status).toBe(200);
    expect(ids(res.body)).toContain(h.ids.shiftA);
    expect(ids(res.body)).not.toContain(h.ids.shiftB);
  });

  it('#3 shiftB (NULL companyId) is excluded only by the driver join (red if storage getDriverShiftReports drops `eq(users.companyId, companyId)`)', async () => {
    const res = await adminA.get('/api/driver-shift-reports');
    expect(res.status).toBe(200);
    expect(ids(res.body)).toEqual([h.ids.shiftA]);
  });
});

describe('GET /api/routes/:routeId/stops (HF1 #4-#5)', () => {
  it("#4 adminA asking for routeB's stops gets 404 with no B- stop (red if `if (!isMasterAdminUser(user) && route.companyId !== user.companyId)` 404 is removed)", async () => {
    const res = await adminA.get(`/api/routes/${h.ids.routeB}/stops`);
    expect(res.status).toBe(404);
    expect(JSON.stringify(res.body)).not.toMatch(/B-Stop/);
  });

  it('#4 positive control: adminA gets its own routeA stops', async () => {
    const res = await adminA.get(`/api/routes/${h.ids.routeA}/stops`);
    expect(res.status).toBe(200);
    expect(ids(res.body).sort()).toEqual([h.ids.stopA1, h.ids.stopA2].sort());
  });

  it('#5 an unknown routeId gets 404 (red if `if (!route) return res.status(404)` is removed from GET /api/routes/:routeId/stops)', async () => {
    const res = await adminA.get(`/api/routes/${crypto.randomUUID()}/stops`);
    expect(res.status).toBe(404);
    expect(res.body).toEqual({ message: 'Route not found' });
  });
});

describe('PATCH /api/buses/:id (HF1 #6-#7)', () => {
  it('#6 body companyId/currentRouteId are ignored (red if `insertBusSchema.omit({ companyId: true, currentRouteId: true })` is removed from PATCH /api/buses/:id)', async () => {
    const res = await adminA
      .patch(`/api/buses/${h.ids.busA}`)
      .send({ make: 'X', companyId: h.ids.companyB, currentRouteId: h.ids.routeB });
    expect(res.status).toBe(200);
    const [row] = await h.db.select().from(buses).where(eq(buses.id, h.ids.busA));
    expect(row.make).toBe('X');
    expect(row.companyId).toBe(h.ids.companyA);
    expect(row.currentRouteId).toBe(h.ids.routeA);
  });

  it("#7 assigning company B's driver gets 404 and busA keeps driverA (red if the `driver.companyId !== existingBus.companyId` driver check is removed from PATCH /api/buses/:id)", async () => {
    const res = await adminA.patch(`/api/buses/${h.ids.busA}`).send({ driverId: h.ids.driverB2 });
    expect(res.status).toBe(404);
    expect(res.body).toEqual({ message: 'Driver not found' });
    const [row] = await h.db.select().from(buses).where(eq(buses.id, h.ids.busA));
    expect(row.driverId).toBe(h.ids.driverA);
  });
});

describe('POST /api/drivers/:id/send-invitation (HF1 #8, #8b)', () => {
  beforeEach(() => {
    vi.mocked(sendDriverInvitationEmail).mockClear();
  });

  it("#8 inviting company B's driver gets 404, writes no invitation and sends no email (red if `if (driver.companyId !== user.companyId)` 404 is removed)", async () => {
    const res = await adminA.post(`/api/drivers/${h.ids.driverB2}/send-invitation`).send({});
    expect(res.status).toBe(404);
    expect(res.body).toEqual({ message: 'Driver not found' });
    const rows = await h.db.select().from(driverInvitations).where(eq(driverInvitations.driverId, h.ids.driverB2));
    expect(rows).toHaveLength(0);
    expect(sendDriverInvitationEmail).not.toHaveBeenCalled();
  });

  it('#8b inviting own driverA2 emails a /driver/password-setup?token=<64 hex> link (red if `buildPasswordSetupUrl(token)` is not the 4th sendDriverInvitationEmail arg)', async () => {
    const res = await adminA.post(`/api/drivers/${h.ids.driverA2}/send-invitation`).send({});
    expect(res.status).toBe(200);
    expect(sendDriverInvitationEmail).toHaveBeenCalledTimes(1);
    const args = vi.mocked(sendDriverInvitationEmail).mock.calls[0];
    expect(args[0]).toBe('driver-a2@sbt.test');
    expect(args[2]).toBe('A-Company');
    expect(args[3]).toMatch(/\/driver\/password-setup\?token=[0-9a-f]{64}$/);
    const rows = await h.db.select().from(driverInvitations).where(eq(driverInvitations.driverId, h.ids.driverA2));
    expect(rows).toHaveLength(1);
    expect(rows[0].companyId).toBe(h.ids.companyA);
  });
});
