// Q74 CD-2 / T-1: PATCH /api/system-notifications/:id/read and
// DELETE /api/system-notifications/:id fetch the row and 404 across tenants
// (getCaller + isOutsideCallerTenant); mark-read also needs the row to be
// visible to the caller by the GET list rules (driver / parent lists).
// DELETE /api/notifications/:id (parent notifications) gets the same tenant
// 404. Every test inserts its own rows. Real HTTP + real Postgres.
import { describe, it, expect, beforeAll } from 'vitest';
import { eq } from 'drizzle-orm';
import { parentNotifications, systemNotifications } from '@shared/schema';
import { useIntegrationHarness, type Agent } from './harness';
import { insertUser } from './seed';

const h = useIntegrationHarness();

let adminA: Agent;
let parentA: Agent;
let driverA: Agent;
let otherParentA: string;

async function insertNotice(values: Partial<typeof systemNotifications.$inferInsert> & { title: string }) {
  const [row] = await h.db
    .insert(systemNotifications)
    .values({
      companyId: h.ids.companyA,
      senderId: h.ids.adminA,
      senderRole: 'admin',
      recipientRole: 'parent',
      message: `${values.title} message`,
      type: 'info',
      ...values,
    })
    .returning({ id: systemNotifications.id });
  return row.id;
}
const noticeRow = async (id: string) => (await h.db.select().from(systemNotifications).where(eq(systemNotifications.id, id)))[0];

async function insertParentNotice(values: Partial<typeof parentNotifications.$inferInsert> & { title: string }) {
  const [row] = await h.db
    .insert(parentNotifications)
    .values({ companyId: h.ids.companyA, createdById: h.ids.adminA, message: `${values.title} message`, type: 'info', ...values })
    .returning({ id: parentNotifications.id });
  return row.id;
}
const parentNoticeExists = async (id: string) =>
  (await h.db.select().from(parentNotifications).where(eq(parentNotifications.id, id))).length === 1;

beforeAll(async () => {
  otherParentA = await insertUser(
    { email: 'q74-other-parent-a@sbt.test', firstName: 'Q74-OtherParent', lastName: 'Seed', role: 'parent', companyId: h.ids.companyA },
    { password: false },
  );
  // 3 logins (MAX_LOGINS_PER_FILE is 8).
  adminA = await h.loginAs('adminA');
  parentA = await h.loginAs('parentA');
  driverA = await h.loginAs('driverA');
});

describe('Q74 PATCH /api/system-notifications/:id/read', () => {
  it('7. adminA on a company-B row → 404, still unread, no B text in the body (red if the PATCH tenant check is removed)', async () => {
    const id = await insertNotice({ title: 'Q74-B-Secret', companyId: h.ids.companyB, senderId: h.ids.adminB, recipientRole: 'all_drivers' });
    const res = await adminA.patch(`/api/system-notifications/${id}/read`).send({});
    expect(res.status).toBe(404);
    expect(res.body).toEqual({ message: 'Notification not found' });
    expect(JSON.stringify(res.body)).not.toContain('Q74-B-Secret');
    expect((await noticeRow(id)).isRead).toBe(false);
  });

  it('9. parentA on an A row addressed to another A parent → 404, still unread (red if the visibility check is removed)', async () => {
    const id = await insertNotice({ title: 'Q74-OtherParent', recipientId: otherParentA });
    const res = await parentA.patch(`/api/system-notifications/${id}/read`).send({});
    expect(res.status).toBe(404);
    expect((await noticeRow(id)).isRead).toBe(false);
  });

  it('10. driverA on an A recipientRole "parent" broadcast → 404, still unread (catches a company-only check)', async () => {
    const id = await insertNotice({ title: 'Q74-ParentsOnly', recipientRole: 'parent' });
    const res = await driverA.patch(`/api/system-notifications/${id}/read`).send({});
    expect(res.status).toBe(404);
    expect((await noticeRow(id)).isRead).toBe(false);
  });

  it('11. controls: adminA on an A row → 200; parentA on an A all_parents broadcast → 200; driverA on an A all_drivers broadcast → 200 (each marked read)', async () => {
    const own = await insertNotice({ title: 'Q74-Own', recipientRole: 'all_drivers' });
    expect((await adminA.patch(`/api/system-notifications/${own}/read`).send({})).status).toBe(200);
    expect((await noticeRow(own)).isRead).toBe(true);
    const parents = await insertNotice({ title: 'Q74-AllParents', recipientRole: 'all_parents' });
    expect((await parentA.patch(`/api/system-notifications/${parents}/read`).send({})).status).toBe(200);
    expect((await noticeRow(parents)).isRead).toBe(true);
    const drivers = await insertNotice({ title: 'Q74-AllDrivers', recipientRole: 'all_drivers' });
    expect((await driverA.patch(`/api/system-notifications/${drivers}/read`).send({})).status).toBe(200);
    expect((await noticeRow(drivers)).isRead).toBe(true);
  });
});

describe('Q74 DELETE /api/system-notifications/:id', () => {
  it('8. adminA on a company-B row → 404, the row is still there (red if the DELETE tenant check is removed)', async () => {
    const id = await insertNotice({ title: 'Q74-B-Delete', companyId: h.ids.companyB, senderId: h.ids.adminB, recipientRole: 'all_drivers' });
    const res = await adminA.delete(`/api/system-notifications/${id}`);
    expect(res.status).toBe(404);
    expect(await noticeRow(id)).toBeDefined();
  });

  it('11b. control: adminA deletes an A row → 200, gone', async () => {
    const id = await insertNotice({ title: 'Q74-A-Delete', recipientRole: 'all_drivers' });
    expect((await adminA.delete(`/api/system-notifications/${id}`)).status).toBe(200);
    expect(await noticeRow(id)).toBeUndefined();
  });
});

describe('Q74 DELETE /api/notifications/:id (parent notifications)', () => {
  it('12. adminA on a company-B parent notification → 404, still there (red if its tenant check is removed); own A → 200; a NULL-company row → 404, still there', async () => {
    const foreign = await insertParentNotice({ title: 'Q74-B-Parent', companyId: h.ids.companyB, createdById: h.ids.adminB });
    const res = await adminA.delete(`/api/notifications/${foreign}`);
    expect(res.status).toBe(404);
    expect(res.body).toEqual({ message: 'Notification not found' });
    expect(await parentNoticeExists(foreign)).toBe(true);

    const own = await insertParentNotice({ title: 'Q74-A-Parent' });
    expect((await adminA.delete(`/api/notifications/${own}`)).status).toBe(200);
    expect(await parentNoticeExists(own)).toBe(false);

    const noCompany = await insertParentNotice({ title: 'Q74-Null-Parent', companyId: null });
    expect((await adminA.delete(`/api/notifications/${noCompany}`)).status).toBe(404);
    expect(await parentNoticeExists(noCompany)).toBe(true);
  });
});
