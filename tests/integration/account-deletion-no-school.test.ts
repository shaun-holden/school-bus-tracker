// Q59 decision 1A for children with NO school: when a parent with no company
// deletes their account, a no-school child (companyId NULL) that only this
// parent has, with no history, is deleted too (no school could ever see it).
// It stays if another parent is linked to it, if it has history (attendance,
// student_attendance or a direct message), or if it belongs to a company
// (school roster). Real HTTP + real Postgres. Seeded with seedQ8Extras +
// seedQ8Round2 (A-ShortNull: company A, parentId = parentNull, no link).
import { describe, it, expect, beforeAll } from 'vitest';
import { eq } from 'drizzle-orm';
import { students, parentChildLinks, directMessages, users } from '@shared/schema';
import { useIntegrationHarness } from './harness';
import { seedQ8Extras, seedQ8Round2, SEED_PASSWORD, type Q8R2Ids } from './seed';

const h = useIntegrationHarness();

let r2: Q8R2Ids;
let solo: string;
let shared: string;
let withHistory: string;

const exists = async (id: string) => (await h.db.select().from(students).where(eq(students.id, id))).length === 1;

async function noSchoolKid(firstName: string) {
  const [s] = await h.db
    .insert(students)
    .values({ companyId: null, firstName, lastName: 'Seed', parentId: h.ids.parentNull })
    .returning({ id: students.id });
  return s.id;
}

beforeAll(async () => {
  await seedQ8Extras(h.ids);
  r2 = await seedQ8Round2(h.ids);
  solo = await noSchoolKid('Null-Solo');
  shared = await noSchoolKid('Null-Shared');
  await h.db.insert(parentChildLinks).values({ parentId: h.ids.parentB, studentId: shared });
  withHistory = await noSchoolKid('Null-History');
  await h.db.insert(directMessages).values({ senderId: h.ids.parentNull, recipientId: h.ids.driverA, content: 'About my child', studentId: withHistory });
  // A-ShortNull really is a company-A student whose parentId is parentNull.
  const [shortNull] = await h.db.select().from(students).where(eq(students.id, r2.studentShortNull));
  expect(shortNull.companyId).toBe(h.ids.companyA);
  expect(shortNull.parentId).toBe(h.ids.parentNull);

  // 1 login (MAX_LOGINS_PER_FILE is 8).
  const parentNull = await h.loginAs('parentNull');
  const res = await parentNull.post('/api/auth/delete-account').send({ password: SEED_PASSWORD });
  expect(res.status).toBe(200);
});

describe('Q59 no-school children of a deleted no-company parent', () => {
  it('positive control: the deleted parent is scrubbed', async () => {
    const [row] = await h.db.select().from(users).where(eq(users.id, h.ids.parentNull));
    expect(row.isActive).toBe(false);
    expect(row.email).toBe(`deleted-${h.ids.parentNull}@deleted.invalid`);
  });

  it('(a) a no-school child only this parent has, with no history, is deleted', async () => {
    expect(await exists(solo)).toBe(false);
  });

  it('(b) a no-school child also linked to another parent stays (red if the "other parent linked" check is removed)', async () => {
    expect(await exists(shared)).toBe(true);
    expect(await h.db.select().from(parentChildLinks).where(eq(parentChildLinks.studentId, shared))).toHaveLength(1);
  });

  it('(c) a no-school child with a direct-message history stays (red if the history-keep check is removed)', async () => {
    expect(await exists(withHistory)).toBe(true);
    expect(await h.db.select().from(directMessages).where(eq(directMessages.studentId, withHistory))).toHaveLength(1);
  });

  it('(d) A-ShortNull (company A, parentId = this parent, no link) stays in the school roster (red if the companyId IS NULL filter is removed)', async () => {
    expect(await exists(r2.studentShortNull)).toBe(true);
  });
});
