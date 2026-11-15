// Q65: body ids are tenant-checked.
// - POST /api/messages `studentId`: a student of the sender's company that the
//   sender is tied to (a parent's linked child, or on one of the driver's
//   routes), else 404 "Student not found"; a bad shape is a 400.
// - GET /api/messages/contacts never falls back to an email.
// - POST /api/system-notifications `recipientId` / `routeId` and
//   POST /api/driver/system-notifications `routeId` (body or the
//   assignedRouteId fallback) must be in the caller's company.
// Q69: the 2 system-notification POSTs check recipientRole / type enums and
// title / message lengths (400 "Invalid notification", not a pg 500).
// Real HTTP + real Postgres. Seeded with seedQ8Extras: routeA2 (company A, no
// driver) with studentA3, and driverX (company A, assignedRouteId = routeB).
import { describe, it, expect, beforeAll } from 'vitest';
import { eq } from 'drizzle-orm';
import { directMessages, parentChildLinks, students, systemNotifications, users } from '@shared/schema';
import { useIntegrationHarness, type Agent } from './harness';
import { seedQ8Extras, EMAILS, Q8_EMAILS, SEED_PASSWORD, type Q8Ids } from './seed';

const h = useIntegrationHarness();

let q8: Q8Ids;
let unlinkedA: string;
let parentA: Agent;
let driverA: Agent;
let parentNull: Agent;
let adminA: Agent;
let master: Agent;
let driverX: Agent;

const sentBy = async (id: string) =>
  (await h.db.select().from(directMessages).where(eq(directMessages.senderId, id))).length;
const notesBy = async (id: string) =>
  (await h.db.select().from(systemNotifications).where(eq(systemNotifications.senderId, id))).length;

beforeAll(async () => {
  q8 = await seedQ8Extras(h.ids);
  // A company-A student on driverA's route that parentA isn't linked to (its
  // parent is parentA3; no parent_child_links row).
  const [s] = await h.db
    .insert(students)
    .values({ companyId: h.ids.companyA, firstName: 'Q65-Unlinked', lastName: 'Seed', parentId: q8.parentA3, schoolId: h.ids.schoolA, routeId: h.ids.routeA })
    .returning({ id: students.id });
  unlinkedA = s.id;
  // parentA also linked to company B's studentB (a cross-school link: bad data,
  // or a parent with children at two schools). The link check passes, so test 1
  // is stopped by the student company check alone.
  await h.db.insert(parentChildLinks).values({ parentId: h.ids.parentA, studentId: h.ids.studentB }).onConflictDoNothing();
  // parentNull (no company) linked to studentA: company A inferred. seedQ8Extras
  // already adds this link; keep the insert so the file doesn't depend on it.
  await h.db.insert(parentChildLinks).values({ parentId: h.ids.parentNull, studentId: h.ids.studentA }).onConflictDoNothing();

  // 6 logins (MAX_LOGINS_PER_FILE is 8).
  parentA = await h.loginAs('parentA');
  driverA = await h.loginAs('driverA');
  parentNull = await h.loginAs('parentNull');
  adminA = await h.loginAs('adminA');
  master = await h.loginAs('master');
  expect((await master.post(`/api/master-admin/impersonate/${h.ids.companyA}`).send({})).status).toBe(200);
  driverX = h.anon();
  expect((await h.loginAttempt(Q8_EMAILS.driverX, SEED_PASSWORD, driverX)).status).toBe(200);
});

describe('Q65 POST /api/messages studentId', () => {
  it('1. parentA → driverA with company B\'s studentB (linked to parentA) → 404 "Student not found", no row (red if the student company check is removed)', async () => {
    const before = await sentBy(h.ids.parentA);
    const res = await parentA.post('/api/messages').send({ recipientId: h.ids.driverA, content: 'about B', studentId: h.ids.studentB });
    expect(res.status).toBe(404);
    expect(res.body).toEqual({ message: 'Student not found' });
    expect(await sentBy(h.ids.parentA)).toBe(before);
  });

  it('2. parentA → driverA with a company-A student parentA is not linked to → 404, no row (red if the parent-link check is removed)', async () => {
    const before = await sentBy(h.ids.parentA);
    const res = await parentA.post('/api/messages').send({ recipientId: h.ids.driverA, content: 'about unlinked', studentId: unlinkedA });
    expect(res.status).toBe(404);
    expect(res.body).toEqual({ message: 'Student not found' });
    expect(await sentBy(h.ids.parentA)).toBe(before);
  });

  it('3. driverA → parentA with company-A studentA3 (routeA2, not driverA\'s) → 404, no row (red if the driver route check is removed)', async () => {
    const before = await sentBy(h.ids.driverA);
    const res = await driverA.post('/api/messages').send({ recipientId: h.ids.parentA, content: 'about A3', studentId: q8.studentA3 });
    expect(res.status).toBe(404);
    expect(res.body).toEqual({ message: 'Student not found' });
    expect(await sentBy(h.ids.driverA)).toBe(before);
  });

  it('4. an unknown UUID → 404 (not 500); studentId {} → 400; a missing content keeps its 400 text', async () => {
    const unknown = await parentA.post('/api/messages').send({ recipientId: h.ids.driverA, content: 'x', studentId: '00000000-0000-4000-8000-000000000000' });
    expect(unknown.status).toBe(404);
    expect(unknown.body).toEqual({ message: 'Student not found' });
    const obj = await parentA.post('/api/messages').send({ recipientId: h.ids.driverA, content: 'x', studentId: {} });
    expect(obj.status).toBe(400);
    expect(JSON.stringify(obj.body)).not.toContain('studentId');
    const noContent = await parentA.post('/api/messages').send({ recipientId: h.ids.driverA });
    expect(noContent.status).toBe(400);
    expect(noContent.body).toEqual({ message: 'Recipient and content are required' });
  });

  it('5. controls: parentA → driverA with studentA → 200, stored; driverA → parentA with studentA → 200; no studentId → 200, NULL', async () => {
    const withKid = await parentA.post('/api/messages').send({ recipientId: h.ids.driverA, content: 'about A', studentId: h.ids.studentA });
    expect(withKid.status).toBe(200);
    expect(withKid.body.studentId).toBe(h.ids.studentA);
    const fromDriver = await driverA.post('/api/messages').send({ recipientId: h.ids.parentA, content: 'about A too', studentId: h.ids.studentA });
    expect(fromDriver.status).toBe(200);
    const plain = await parentA.post('/api/messages').send({ recipientId: h.ids.driverA, content: 'plain' });
    expect(plain.status).toBe(200);
    expect(plain.body.studentId).toBeNull();
  });

  it('6. parentNull (company inferred from studentA) → driverA with studentA → 200; with studentB → 404', async () => {
    const ok = await parentNull.post('/api/messages').send({ recipientId: h.ids.driverA, content: 'null parent about A', studentId: h.ids.studentA });
    expect(ok.status).toBe(200);
    const foreign = await parentNull.post('/api/messages').send({ recipientId: h.ids.driverA, content: 'null parent about B', studentId: h.ids.studentB });
    expect(foreign.status).toBe(404);
    expect(foreign.body).toEqual({ message: 'Student not found' });
  });
});

describe('Q65 GET /api/messages/contacts names', () => {
  const blank = async (id: string, fn: () => Promise<void>) => {
    const [row] = await h.db.select().from(users).where(eq(users.id, id));
    await h.db.update(users).set({ firstName: null, lastName: null }).where(eq(users.id, id));
    try {
      await fn();
    } finally {
      await h.db.update(users).set({ firstName: row.firstName, lastName: row.lastName }).where(eq(users.id, id));
    }
  };

  it('7. a blank-name driver shows "Driver" and a blank-name parent "Parent"; the body has no email (red if the email fallback returns)', async () => {
    await blank(h.ids.driverA, async () => {
      const res = await parentA.get('/api/messages/contacts');
      expect(res.status).toBe(200);
      expect(res.body.find((c: { id: string }) => c.id === h.ids.driverA)?.name).toBe('Driver');
      expect(JSON.stringify(res.body)).not.toContain(EMAILS.driverA);
    });
    await blank(h.ids.parentA, async () => {
      const res = await driverA.get('/api/messages/contacts');
      expect(res.status).toBe(200);
      expect(res.body.find((c: { id: string }) => c.id === h.ids.parentA)?.name).toBe('Parent');
      expect(JSON.stringify(res.body)).not.toContain(EMAILS.parentA);
    });
  });
});

describe('Q65 POST /api/system-notifications (admin) body ids', () => {
  const note = (extra: Record<string, unknown>) => ({ title: 'Q65', message: 'note', recipientRole: 'parent', ...extra });

  it('8a. recipientId = company B\'s parentB → 404 "Recipient not found", nothing stored (red if the admin recipient check is removed)', async () => {
    const before = await notesBy(h.ids.adminA);
    const res = await adminA.post('/api/system-notifications').send(note({ recipientId: h.ids.parentB }));
    expect(res.status).toBe(404);
    expect(res.body).toEqual({ message: 'Recipient not found' });
    expect(await notesBy(h.ids.adminA)).toBe(before);
  });

  it('8b. routeId = routeB → 404 "Route not found", nothing stored (red if the admin route check is removed)', async () => {
    const before = await notesBy(h.ids.adminA);
    const res = await adminA.post('/api/system-notifications').send(note({ recipientRole: 'route_parents', routeId: h.ids.routeB }));
    expect(res.status).toBe(404);
    expect(res.body).toEqual({ message: 'Route not found' });
    expect(await notesBy(h.ids.adminA)).toBe(before);
  });

  it('8c. routeId {} → 400; recipientId "" → 400', async () => {
    expect((await adminA.post('/api/system-notifications').send(note({ routeId: {} }))).status).toBe(400);
    expect((await adminA.post('/api/system-notifications').send(note({ recipientId: '' }))).status).toBe(400);
  });

  it('8d. controls: parentNull (no company, linked to studentA) as recipientId → 200; parentA + routeA → 200, stored as sent; no ids (all drivers) → 200', async () => {
    const nullParent = await adminA.post('/api/system-notifications').send(note({ recipientId: h.ids.parentNull }));
    expect(nullParent.status).toBe(200);
    const sameCompany = await adminA.post('/api/system-notifications').send(note({ recipientId: h.ids.parentA, routeId: h.ids.routeA }));
    expect(sameCompany.status).toBe(200);
    expect(sameCompany.body).toMatchObject({ recipientId: h.ids.parentA, routeId: h.ids.routeA, companyId: h.ids.companyA });
    const all = await adminA.post('/api/system-notifications').send(note({ recipientRole: 'all_drivers' }));
    expect(all.status).toBe(200);
  });

  it('8e. a master impersonating A: routeId = routeB → 404; routeA → 200 (the check reads getCaller\'s companyId)', async () => {
    const foreign = await master.post('/api/system-notifications').send(note({ recipientRole: 'route_parents', routeId: h.ids.routeB }));
    expect(foreign.status).toBe(404);
    const own = await master.post('/api/system-notifications').send(note({ recipientRole: 'route_parents', routeId: h.ids.routeA }));
    expect(own.status).toBe(200);
    expect(own.body).toMatchObject({ routeId: h.ids.routeA, companyId: h.ids.companyA });
  });
});

describe('Q65 POST /api/driver/system-notifications routeId', () => {
  const note = (extra: Record<string, unknown>) => ({ title: 'Q65', message: 'route note', ...extra });

  it('9a. driverA with routeId = routeB → 404 "Route not found", nothing stored (red if the driver route check is removed)', async () => {
    const before = await notesBy(h.ids.driverA);
    const res = await driverA.post('/api/driver/system-notifications').send(note({ routeId: h.ids.routeB }));
    expect(res.status).toBe(404);
    expect(res.body).toEqual({ message: 'Route not found' });
    expect(await notesBy(h.ids.driverA)).toBe(before);
  });

  it('9b. driverA with routeA2 (company A, not driven or assigned to driverA) → 404 (red if the "drives this route" check is removed)', async () => {
    const res = await driverA.post('/api/driver/system-notifications').send(note({ routeId: q8.routeA2 }));
    expect(res.status).toBe(404);
    expect(res.body).toEqual({ message: 'Route not found' });
  });

  it('9c. routeId {} → 400; routeId "" → 400', async () => {
    expect((await driverA.post('/api/driver/system-notifications').send(note({ routeId: {} }))).status).toBe(400);
    expect((await driverA.post('/api/driver/system-notifications').send(note({ routeId: '' }))).status).toBe(400);
  });

  it('9d. control: driverA with its own routeA → 200, stored; with no routeId → 200, falls back to routeA', async () => {
    const own = await driverA.post('/api/driver/system-notifications').send(note({ routeId: h.ids.routeA }));
    expect(own.status).toBe(200);
    expect(own.body).toMatchObject({ routeId: h.ids.routeA, companyId: h.ids.companyA });
    const fallback = await driverA.post('/api/driver/system-notifications').send(note({}));
    expect(fallback.status).toBe(200);
    expect(fallback.body.routeId).toBe(h.ids.routeA);
  });

  it('9e. driverX (company A, assignedRouteId = company B\'s routeB): body routeB → 404, and no routeId (the fallback) → 404, nothing stored (red if isRouteInCompany is removed)', async () => {
    const before = await notesBy(q8.driverX);
    const body = await driverX.post('/api/driver/system-notifications').send(note({ routeId: h.ids.routeB }));
    expect(body.status).toBe(404);
    const fallback = await driverX.post('/api/driver/system-notifications').send(note({}));
    expect(fallback.status).toBe(404);
    expect(fallback.body).toEqual({ message: 'Route not found' });
    expect(await notesBy(q8.driverX)).toBe(before);
  });
});

describe('Q69 system-notification enum and length checks', () => {
  const TYPES = ['delay', 'emergency', 'info', 'route_change'] as const;
  const admin = (extra: Record<string, unknown>) => ({ title: 'Q69', message: 'note', recipientRole: 'all_drivers', ...extra });
  const driver = (extra: Record<string, unknown>) => ({ title: 'Q69', message: 'route note', ...extra });

  it('admin recipientRole "bogus" → 400 "Invalid notification", nothing stored (red if recipientRole is a plain string)', async () => {
    const before = await notesBy(h.ids.adminA);
    const res = await adminA.post('/api/system-notifications').send(admin({ recipientRole: 'bogus' }));
    expect(res.status).toBe(400);
    expect(res.body).toEqual({ message: 'Invalid notification' });
    expect(await notesBy(h.ids.adminA)).toBe(before);
  });

  it('admin type "bogus" → 400, nothing stored (red if the admin type is a plain string)', async () => {
    const before = await notesBy(h.ids.adminA);
    const res = await adminA.post('/api/system-notifications').send(admin({ type: 'bogus' }));
    expect(res.status).toBe(400);
    expect(res.body).toEqual({ message: 'Invalid notification' });
    expect(await notesBy(h.ids.adminA)).toBe(before);
  });

  it('admin title of 101 characters → 400; a missing recipientRole keeps the old "required" text', async () => {
    expect((await adminA.post('/api/system-notifications').send(admin({ title: 'x'.repeat(101) }))).status).toBe(400);
    const missing = await adminA.post('/api/system-notifications').send({ title: 'Q69', message: 'note' });
    expect(missing.status).toBe(400);
    expect(missing.body).toEqual({ message: 'Title, message, and recipientRole are required' });
  });

  it('driver type "bogus" → 400, nothing stored (red if the driver type is a plain string)', async () => {
    const before = await notesBy(h.ids.driverA);
    const res = await driverA.post('/api/driver/system-notifications').send(driver({ type: 'bogus', routeId: h.ids.routeA }));
    expect(res.status).toBe(400);
    expect(res.body).toEqual({ message: 'Invalid notification' });
    expect(await notesBy(h.ids.driverA)).toBe(before);
  });

  it('driver message of 2001 characters → 400', async () => {
    const res = await driverA.post('/api/driver/system-notifications').send(driver({ message: 'x'.repeat(2001), routeId: h.ids.routeA }));
    expect(res.status).toBe(400);
    expect(res.body).toEqual({ message: 'Invalid notification' });
  });

  it('controls: each valid type → 200 for admin (all_drivers) and driver; a 300-character driver message → 200', async () => {
    for (const type of TYPES) {
      const a = await adminA.post('/api/system-notifications').send(admin({ type }));
      expect(a.status).toBe(200);
      expect(a.body).toMatchObject({ type, recipientRole: 'all_drivers' });
      const d = await driverA.post('/api/driver/system-notifications').send(driver({ type, routeId: h.ids.routeA }));
      expect(d.status).toBe(200);
      expect(d.body.type).toBe(type);
    }
    const long = await driverA.post('/api/driver/system-notifications').send(driver({ message: 'y'.repeat(300), routeId: h.ids.routeA }));
    expect(long.status).toBe(200);
  });
});
