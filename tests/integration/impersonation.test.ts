// Q7 (SEC-45 / DUP-2 / Q19): a master admin impersonating company A acts as
// an admin of A. Lists show only A, B's records are 404, creates land in A,
// the master's own users row is never written, and messaging is open only
// while impersonating. Real HTTP + real Postgres (Q4 harness).
//
// Describes run in order on one seeded DB. The create in "creates" adds an A
// school, so later list checks assert "contains", not equality. The
// stop-impersonating describe runs last because it ends the impersonation.
//
// Each title names the clause whose removal (or revert) turns it red.
import { describe, it, expect, beforeAll } from 'vitest';
import { and, eq } from 'drizzle-orm';
import { users, students, buses, routes, schools, parentChildLinks, linkCodes, directMessages } from '@shared/schema';
import { useIntegrationHarness, type Agent } from './harness';

const h = useIntegrationHarness();
let master: Agent; // master admin, NOT impersonating
let impersonator: Agent; // master admin impersonating company A
let parentA: Agent;
let driverA: Agent;

beforeAll(async () => {
  // 4 logins here + parentB in the mark-read describe = 5 (MAX_LOGINS_PER_FILE is 8).
  master = await h.loginAs('master');
  impersonator = await h.loginAs('master');
  parentA = await h.loginAs('parentA');
  driverA = await h.loginAs('driverA');

  // Preconditions outside the tests, so a broken impersonation fails the file.
  const imp = await impersonator.post(`/api/master-admin/impersonate/${h.ids.companyA}`).send({});
  expect(imp.status).toBe(200);
  const me = await impersonator.get('/api/auth/user');
  expect(me.body).toMatchObject({ role: 'master_admin', companyId: h.ids.companyA, _masterAdminImpersonating: true });
  const plain = await master.get('/api/auth/user');
  expect(plain.body.role).toBe('master_admin');
  expect(plain.body._masterAdminImpersonating).toBeUndefined();
});

const idsOf = (rows: Array<{ id: string }>) => rows.map((r) => r.id).sort();
const getUser = async (id: string) => (await h.db.select().from(users).where(eq(users.id, id)))[0];
const getStudent = async (id: string) => (await h.db.select().from(students).where(eq(students.id, id)))[0];
const getBus = async (id: string) => (await h.db.select().from(buses).where(eq(buses.id, id)))[0];
const getRoute = async (id: string) => (await h.db.select().from(routes).where(eq(routes.id, id)))[0];

const SCOPE_CLAUSE =
  'red if companyScope bypasses on isMasterAdminUser instead of isUnscopedMaster, or getCaller(req) drops the req.session.impersonatedCompanyId overlay';

describe('1. lists while impersonating A show only A', () => {
  it(`GET /api/schools → only schoolA (${SCOPE_CLAUSE})`, async () => {
    const res = await impersonator.get('/api/schools');
    expect(res.status).toBe(200);
    expect(idsOf(res.body)).toEqual([h.ids.schoolA]);
  });

  it(`GET /api/students → only studentA (${SCOPE_CLAUSE})`, async () => {
    const res = await impersonator.get('/api/students');
    expect(res.status).toBe(200);
    expect(idsOf(res.body)).toEqual([h.ids.studentA]);
  });

  it(`GET /api/buses → only busA (${SCOPE_CLAUSE})`, async () => {
    const res = await impersonator.get('/api/buses');
    expect(res.status).toBe(200);
    expect(idsOf(res.body)).toEqual([h.ids.busA]);
  });

  it(`GET /api/routes → only routeA (${SCOPE_CLAUSE})`, async () => {
    const res = await impersonator.get('/api/routes');
    expect(res.status).toBe(200);
    expect(idsOf(res.body)).toEqual([h.ids.routeA]);
  });

  it('positive control: the non-impersonating master still sees A and B schools (red if companyScope stops returning undefined for an unscoped master)', async () => {
    const res = await master.get('/api/schools');
    expect(res.status).toBe(200);
    expect(idsOf(res.body)).toEqual([h.ids.schoolA, h.ids.schoolB].sort());
  });
});

describe("2. B's records by id are 404 while impersonating A", () => {
  it("GET /api/students/:id of studentA → 200 (positive control: the impersonator reaches its own company's record)", async () => {
    const res = await impersonator.get(`/api/students/${h.ids.studentA}`);
    expect(res.status).toBe(200);
    expect(res.body.id).toBe(h.ids.studentA);
  });

  it("GET /api/students/:id of studentB → 404 (red if GET /api/students/:id uses `isMasterAdminUser(user)` instead of `isUnscopedMaster(user)`, or re-fetches with storage.getUser(userId) instead of getCaller(req))", async () => {
    const res = await impersonator.get(`/api/students/${h.ids.studentB}`);
    expect(res.status).toBe(404);
    expect(res.body).toEqual({ message: 'Student not found' });
  });

  it("PUT /api/students/:id of studentB → 404 and studentB is unchanged (red if PUT /api/students/:id uses `isMasterAdminUser(user)` instead of `isUnscopedMaster(user)` in its admin-path 404, or re-fetches with storage.getUser(userId))", async () => {
    const before = await getStudent(h.ids.studentB);
    const res = await impersonator.put(`/api/students/${h.ids.studentB}`).send({ firstName: 'IMP-Hijacked' });
    expect(res.status).toBe(404);
    expect(res.body).toEqual({ message: 'Student not found' });
    const after = await getStudent(h.ids.studentB);
    expect(after.firstName).toBe(before.firstName);
    expect(after.companyId).toBe(h.ids.companyB);
  });

  it("PATCH /api/buses/:id of busB → 404 and busB is unchanged (red if PATCH /api/buses/:id uses `isMasterAdminUser(user)` instead of `isUnscopedMaster(user)`, or re-fetches with storage.getUser)", async () => {
    const before = await getBus(h.ids.busB);
    const res = await impersonator.patch(`/api/buses/${h.ids.busB}`).send({ make: 'IMP-Make' });
    expect(res.status).toBe(404);
    expect(res.body).toEqual({ message: 'Bus not found' });
    const after = await getBus(h.ids.busB);
    expect(after.make).toBe(before.make);
    expect(after.companyId).toBe(h.ids.companyB);
  });

  it("PATCH /api/routes/:id of routeB → 404 and routeB is unchanged (red if PATCH /api/routes/:id uses `isMasterAdminUser(user)` instead of `isUnscopedMaster(user)`, or re-fetches with storage.getUser)", async () => {
    const before = await getRoute(h.ids.routeB);
    const res = await impersonator.patch(`/api/routes/${h.ids.routeB}`).send({ name: 'IMP-Route' });
    expect(res.status).toBe(404);
    expect(res.body).toEqual({ message: 'Route not found' });
    const after = await getRoute(h.ids.routeB);
    expect(after.name).toBe(before.name);
    expect(after.companyId).toBe(h.ids.companyB);
  });

  it("POST /api/driver-check-in of driverB on routeB + busB → 404 and nothing in B is written (red if POST /api/driver-check-in uses `isMasterAdminUser(user)` instead of `isUnscopedMaster(user)` in its caller-company 404, or re-fetches with storage.getUser)", async () => {
    const busBefore = await getBus(h.ids.busB);
    const routeBefore = await getRoute(h.ids.routeB);
    const res = await impersonator.post('/api/driver-check-in').send({
      driverId: h.ids.driverB, routeId: h.ids.routeB, busId: h.ids.busB,
      fuelLevel: 'Full', interiorClean: true, exteriorClean: true,
    });
    expect(res.status).toBe(404);
    expect(res.body).toEqual({ message: 'Not found' });
    const dB = await getUser(h.ids.driverB);
    expect(dB.isOnDuty).toBe(false);
    expect(dB.lastCheckInTime).toBeNull();
    const busAfter = await getBus(h.ids.busB);
    expect(busAfter.driverId).toBe(busBefore.driverId);
    expect(busAfter.fuelLevel).toBe(busBefore.fuelLevel);
    expect(busAfter.status).toBe(busBefore.status);
    expect((await getRoute(h.ids.routeB)).driverId).toBe(routeBefore.driverId);
  });
});

describe('B1. PATCH /api/users/:id/role while impersonating A', () => {
  it("a company B user → 404 and the role is unchanged (red if the tenant 404 is `isOutsideCallerTenant` bypassing on isMasterAdminUser, or reverts to `!callerIsMaster && (...)`)", async () => {
    const res = await impersonator.patch(`/api/users/${h.ids.driverB2}/role`).send({ role: 'parent' });
    expect(res.status).toBe(404);
    expect(res.body).toEqual({ message: 'User not found' });
    expect((await getUser(h.ids.driverB2)).role).toBe('driver');
  });

  it('a company A user → 200 (positive control: the impersonator keeps admin powers in A; red if callerIsFullAdmin stops using isMasterAdminUser)', async () => {
    const res = await impersonator.patch(`/api/users/${h.ids.driverA2}/role`).send({ role: 'driver_admin' });
    expect(res.status).toBe(200);
    expect((await getUser(h.ids.driverA2)).role).toBe('driver_admin');
    const back = await impersonator.patch(`/api/users/${h.ids.driverA2}/role`).send({ role: 'driver' });
    expect(back.status).toBe(200);
    expect((await getUser(h.ids.driverA2)).role).toBe('driver');
  });
});

describe('3. creates while impersonating A land in A', () => {
  it('POST /api/schools with a body companyId of B is stored with companyId A (red if POST /api/schools re-fetches with storage.getUser instead of getCaller(req), or stops forcing `validatedData.companyId = user.companyId`)', async () => {
    const res = await impersonator
      .post('/api/schools')
      .send({ name: 'IMP-School', address: 'IMP-1 Impersonation Rd', companyId: h.ids.companyB });
    expect(res.status).toBe(200);
    const [row] = await h.db.select().from(schools).where(eq(schools.id, res.body.id));
    expect(row.companyId).toBe(h.ids.companyA);
  });
});

describe('B2. POST /api/link-child refuses any master admin', () => {
  it("impersonating master → 403, no link written, code still active (red if the `user?.role === 'master_admin'` 403 in POST /api/link-child is removed)", async () => {
    const res = await impersonator.post('/api/link-child').send({ code: 'A-LINK-0001' });
    expect(res.status).toBe(403);
    expect(res.body).toEqual({ message: "Master admins can't link children" });
    const links = await h.db.select().from(parentChildLinks).where(eq(parentChildLinks.parentId, h.ids.master));
    expect(links).toEqual([]);
    const [code] = await h.db.select().from(linkCodes).where(eq(linkCodes.id, h.ids.linkCodeA));
    expect(code.status).toBe('active');
    expect((await getUser(h.ids.master)).companyId).toBeNull();
  });

  it("non-impersonating master → 403 and its users.companyId stays NULL (red if the `user?.role === 'master_admin'` 403 in POST /api/link-child is removed: updateUserCompany would write company B onto the master)", async () => {
    const res = await master.post('/api/link-child').send({ code: 'B-LINK-0001' });
    expect(res.status).toBe(403);
    expect(res.body).toEqual({ message: "Master admins can't link children" });
    expect((await getUser(h.ids.master)).companyId).toBeNull();
    const links = await h.db
      .select()
      .from(parentChildLinks)
      .where(and(eq(parentChildLinks.parentId, h.ids.master), eq(parentChildLinks.studentId, h.ids.studentB)));
    expect(links).toEqual([]);
  });
});

describe('6. messaging (Q19): master only while impersonating', () => {
  const MSG_CLAUSE = 'canAccessMessaging allows master_admin without the impersonation flag';

  describe('non-impersonating master → 403 on all 4 gated endpoints', () => {
    it(`GET /api/messages/contacts → 403 (red if ${MSG_CLAUSE})`, async () => {
      const res = await master.get('/api/messages/contacts');
      expect(res.status).toBe(403);
      expect(res.body).toEqual({ message: 'Only parents and drivers can access messaging' });
    });

    it(`GET /api/messages/conversations → 403 (red if ${MSG_CLAUSE})`, async () => {
      const res = await master.get('/api/messages/conversations');
      expect(res.status).toBe(403);
      expect(res.body).toEqual({ message: 'Only parents and drivers can access messaging' });
    });

    it(`GET /api/messages/conversation/:recipientId → 403 (red if ${MSG_CLAUSE})`, async () => {
      const res = await master.get(`/api/messages/conversation/${h.ids.parentA}`);
      expect(res.status).toBe(403);
      expect(res.body).toEqual({ message: 'Only parents and drivers can access messaging' });
    });

    it('POST /api/messages → 403 (Q62: the master send block runs before canAccessMessaging)', async () => {
      const res = await master.post('/api/messages').send({ recipientId: h.ids.parentA, content: 'master-unscoped' });
      expect(res.status).toBe(403);
      expect(res.body).toEqual({ message: "Staff messages can't be sent while viewing a school" });
    });
  });

  describe('impersonating master → 200 (red if canAccessMessaging rejects a master with _masterAdminImpersonating, or getCaller drops the overlay)', () => {
    it('GET /api/messages/contacts → 200', async () => {
      const res = await impersonator.get('/api/messages/contacts');
      expect(res.status).toBe(200);
      expect(Array.isArray(res.body)).toBe(true);
    });

    it('GET /api/messages/conversations → 200', async () => {
      const res = await impersonator.get('/api/messages/conversations');
      expect(res.status).toBe(200);
      expect(Array.isArray(res.body)).toBe(true);
    });

    it('GET /api/messages/conversation/:recipientId → 200', async () => {
      const res = await impersonator.get(`/api/messages/conversation/${h.ids.parentA}`);
      expect(res.status).toBe(200);
      expect(Array.isArray(res.body)).toBe(true);
    });

    it('POST /api/messages to parentA → 403 (Q62: reading stays, sending is refused; red if the master send block is removed)', async () => {
      const res = await impersonator.post('/api/messages').send({ recipientId: h.ids.parentA, content: 'imp-to-parentA' });
      expect(res.status).toBe(403);
      expect(res.body).toEqual({ message: "Staff messages can't be sent while viewing a school" });
    });
  });

  describe('parentA and driverA are unchanged → 200', () => {
    for (const who of ['parentA', 'driverA'] as const) {
      it(`${who}: contacts, conversations, conversation and POST /api/messages → 200 (red if canAccessMessaging stops allowing ${who === 'parentA' ? 'parent' : 'driver'})`, async () => {
        const agent = who === 'parentA' ? parentA : driverA;
        const other = who === 'parentA' ? h.ids.driverA : h.ids.parentA;
        expect((await agent.get('/api/messages/contacts')).status).toBe(200);
        expect((await agent.get('/api/messages/conversations')).status).toBe(200);
        expect((await agent.get(`/api/messages/conversation/${other}`)).status).toBe(200);
        const sent = await agent.post('/api/messages').send({ recipientId: other, content: `${who}-hello` });
        expect(sent.status).toBe(200);
        expect(sent.body).toMatchObject({ senderId: h.ids[who], recipientId: other, companyId: h.ids.companyA });
      });
    }
  });
});

describe('I4. PATCH /api/messages/:messageId/read: only the recipient may mark it read', () => {
  let parentB: Agent;
  let messageToB: string;
  const getMessage = async (id: string) =>
    (await h.db.select().from(directMessages).where(eq(directMessages.id, id)))[0];

  beforeAll(async () => {
    parentB = await h.loginAs('parentB');
    const [row] = await h.db
      .insert(directMessages)
      .values({ companyId: h.ids.companyB, senderId: h.ids.driverB, recipientId: h.ids.parentB, content: 'B-driver-to-B-parent' })
      .returning({ id: directMessages.id });
    messageToB = row.id;
  });

  it("parentA marking a message addressed to parentB → 404 and the row stays unread (red if `eq(directMessages.recipientId, recipientId)` is removed from storage.markMessageAsRead)", async () => {
    const res = await parentA.patch(`/api/messages/${messageToB}/read`).send({});
    expect(res.status).toBe(404);
    expect(res.body).toEqual({ message: 'Message not found' });
    const row = await getMessage(messageToB);
    expect(row.isRead).toBe(false);
    expect(row.readAt).toBeNull();
  });

  it('positive control: the recipient parentB marking it → 200 and isRead true (red if PATCH /api/messages/:messageId/read stops passing the caller id to markMessageAsRead)', async () => {
    const res = await parentB.patch(`/api/messages/${messageToB}/read`).send({});
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ id: messageToB, recipientId: h.ids.parentB, isRead: true });
    const row = await getMessage(messageToB);
    expect(row.isRead).toBe(true);
    expect(row.readAt).not.toBeNull();
  });
});

describe('4. the master users row is never written', () => {
  it("after all the impersonated requests, master's users.companyId is still NULL and role master_admin (red if any handler writes a getCaller() result back)", async () => {
    const row = await getUser(h.ids.master);
    expect(row.companyId).toBeNull();
    expect(row.role).toBe('master_admin');
  });
});

// Last: ends the impersonation on the impersonator agent.
describe('5. stop-impersonating restores the unscoped view', () => {
  it('POST /api/master-admin/stop-impersonating → GET /api/schools contains schoolA and schoolB (red if getCaller keeps the overlay after the session key is deleted, or companyScope stops returning undefined for an unscoped master)', async () => {
    const stop = await impersonator.post('/api/master-admin/stop-impersonating').send({});
    expect(stop.status).toBe(200);
    const res = await impersonator.get('/api/schools');
    expect(res.status).toBe(200);
    const got = idsOf(res.body);
    expect(got).toContain(h.ids.schoolA);
    expect(got).toContain(h.ids.schoolB);
  });

  it('after stopping, messaging is refused again (red if canAccessMessaging allows master_admin without the impersonation flag)', async () => {
    const res = await impersonator.get('/api/messages/conversations');
    expect(res.status).toBe(403);
  });

  it("master's users.companyId is still NULL after stop-impersonating", async () => {
    expect((await getUser(h.ids.master)).companyId).toBeNull();
  });
});
