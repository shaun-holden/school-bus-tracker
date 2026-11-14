// T4b: storage.filterPushRecipients(userIds, companyId), the push fence every
// event goes through. Kept: active parent/driver users of an approved, active
// company; a parent only when that company's parent portal is on (decision
// 2A); a NULL-company parent only when linked (link row or students.parentId)
// to a student of that company. Real Postgres; foreign rows seeded and
// asserted to be in company B. Each title names the clause whose removal turns
// it red; every "dropped" case sits next to a positive control.
import { describe, it, expect, beforeAll, afterEach, vi } from 'vitest';
import { eq } from 'drizzle-orm';
import { users, students, parentChildLinks, companies } from '@shared/schema';
import { storage } from '../../server/storage';
import { db } from '../../server/db';
import { useIntegrationHarness } from './harness';
import { insertUser } from './seed';

const h = useIntegrationHarness();

let inactiveParentA: string;
let nullParentLinkedB: string;
let nullParentLinkedA: string;

const keep = (ids: string[], companyId: string | null = h.ids.companyA) => storage.filterPushRecipients(ids, companyId);

beforeAll(async () => {
  // parentB (company B) linked by mistake to company A's studentA.
  await h.db.insert(parentChildLinks).values({ parentId: h.ids.parentB, studentId: h.ids.studentA });
  inactiveParentA = await insertUser(
    { email: 't4b-inactive@sbt.test', firstName: 'A-Off', lastName: 'Seed', role: 'parent', companyId: h.ids.companyA, isActive: false },
    { password: false },
  );
  await h.db.insert(parentChildLinks).values({ parentId: inactiveParentA, studentId: h.ids.studentA });
  // NULL-company parents: one linked only to a B student, one linked to A's.
  nullParentLinkedB = await insertUser(
    { email: 't4b-null-b@sbt.test', firstName: 'Null-B', lastName: 'Seed', role: 'parent', companyId: null },
    { password: false },
  );
  await h.db.insert(parentChildLinks).values({ parentId: nullParentLinkedB, studentId: h.ids.studentB });
  nullParentLinkedA = await insertUser(
    { email: 't4b-null-a@sbt.test', firstName: 'Null-A', lastName: 'Seed', role: 'parent', companyId: null },
    { password: false },
  );
  await h.db.insert(parentChildLinks).values({ parentId: nullParentLinkedA, studentId: h.ids.studentA });
  // Foreign rows really are company B.
  const [sb] = await h.db.select().from(students).where(eq(students.id, h.ids.studentB));
  expect(sb.companyId).toBe(h.ids.companyB);
  const [pb] = await h.db.select().from(users).where(eq(users.id, h.ids.parentB));
  expect(pb.companyId).toBe(h.ids.companyB);
});

afterEach(async () => {
  await h.db.update(companies).set({ status: 'approved', isActive: true, parentPortalEnabled: true }).where(eq(companies.id, h.ids.companyA));
});

describe('T4b filterPushRecipients', () => {
  it('positive control: company A\'s parent and driver, and a NULL-company parent linked to an A student, are kept', async () => {
    expect((await keep([h.ids.parentA, h.ids.driverA, nullParentLinkedA])).sort()).toEqual([h.ids.parentA, h.ids.driverA, nullParentLinkedA].sort());
  });

  it('company B\'s parent linked by mistake to an A student is dropped (red if users.companyId = companyId becomes true)', async () => {
    expect(await keep([h.ids.parentB, h.ids.parentA])).toEqual([h.ids.parentA]);
  });

  it('a NULL-company parent linked only to a B student is dropped for a company-A event (red if the NULL-company branch drops students.companyId = companyId)', async () => {
    expect(await keep([nullParentLinkedB, nullParentLinkedA])).toEqual([nullParentLinkedA]);
  });

  it('an inactive linked A parent is dropped (red if the isActive clause is dropped)', async () => {
    expect(await keep([inactiveParentA, h.ids.parentA])).toEqual([h.ids.parentA]);
  });

  it('adminA and driver_admin A are dropped (red if the role filter is dropped)', async () => {
    expect(await keep([h.ids.adminA, h.ids.driverAdminA, h.ids.driverA])).toEqual([h.ids.driverA]);
  });

  it('a null or empty companyId returns [] without running a query (red if the null-companyId short-circuit is removed; the inner join alone would also give [])', async () => {
    const spy = vi.spyOn(db, 'selectDistinct');
    try {
      expect(await keep([h.ids.parentA], null)).toEqual([]);
      expect(await keep([h.ids.parentA], '')).toEqual([]);
      expect(spy).not.toHaveBeenCalled();
    } finally {
      spy.mockRestore();
    }
  });

  it('an unknown companyId (no company row: the inner join) or no ids gives []', async () => {
    expect(await keep([h.ids.parentA], null)).toEqual([]);
    expect(await keep([h.ids.parentA], '')).toEqual([]);
    expect(await keep([h.ids.parentA], 'no-such-company')).toEqual([]);
    expect(await keep([], h.ids.companyA)).toEqual([]);
  });

  it('a company that is not approved, or inactive, keeps nobody (red if the company status/isActive clause is dropped)', async () => {
    await h.db.update(companies).set({ status: 'pending_approval' }).where(eq(companies.id, h.ids.companyA));
    expect(await keep([h.ids.parentA, h.ids.driverA])).toEqual([]);
    await h.db.update(companies).set({ status: 'approved', isActive: false }).where(eq(companies.id, h.ids.companyA));
    expect(await keep([h.ids.parentA, h.ids.driverA])).toEqual([]);
  });

  it('decision 2A: with the parent portal off, parents are dropped but drivers are kept (red if the parent_portal_enabled clause is dropped)', async () => {
    await h.db.update(companies).set({ parentPortalEnabled: false }).where(eq(companies.id, h.ids.companyA));
    expect(await keep([h.ids.parentA, nullParentLinkedA, h.ids.driverA])).toEqual([h.ids.driverA]);
  });
});
