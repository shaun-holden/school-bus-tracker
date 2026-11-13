// WT-4 (Q49): parent check-in enable/disable through the real routes, with a
// parent linked to the student ONLY by link code (parentChildLinks, no
// students.parentId). Replaces the copied canManageCheckIn and friends in
// tests/parent-features.test.ts. A student of another company is refused
// with the routes' existence-neutral 403 ("You don't have access to this
// student"; same reply for a missing id). Real HTTP + real Postgres.
import { describe, it, expect, beforeAll, beforeEach } from 'vitest';
import { eq } from 'drizzle-orm';
import { studentCheckIns } from '@shared/schema';
import { useIntegrationHarness, type Agent } from './harness';
import { seedTd1Extras, TD1_EMAILS, SEED_PASSWORD } from './seed';

const h = useIntegrationHarness();
const NO_ACCESS = { message: "You don't have access to this student" };

let parentLinkA: Agent;
let parentLinkAId: string;

const checkInsFor = (studentId: string) =>
  h.db.select().from(studentCheckIns).where(eq(studentCheckIns.studentId, studentId));

beforeAll(async () => {
  ({ parentLinkA: parentLinkAId } = await seedTd1Extras(h.ids));
  // 1 login (MAX_LOGINS_PER_FILE is 8).
  const agent = h.anon();
  expect((await h.loginAttempt(TD1_EMAILS.parentLinkA, SEED_PASSWORD, agent)).status).toBe(200);
  parentLinkA = agent;
});

beforeEach(async () => {
  await h.db.delete(studentCheckIns);
});

describe('WT-4 check-in for a parent linked only by link code', () => {
  it('enable → 200 and a waiting check-in in company A; disable → 200 and it is gone (red if the lookup goes back to getStudentsByParentId only)', async () => {
    const on = await parentLinkA.post('/api/check-in/enable').send({ studentId: h.ids.studentA, deviceId: 'wt4-device' });
    expect(on.status).toBe(200);
    const rows = await checkInsFor(h.ids.studentA);
    expect(rows).toHaveLength(1);
    expect(rows[0].parentId).toBe(parentLinkAId);
    expect(rows[0].companyId).toBe(h.ids.companyA);
    expect(rows[0].status).toBe('waiting');

    const off = await parentLinkA.post('/api/check-in/disable').send({ studentId: h.ids.studentA });
    expect(off.status).toBe(200);
    expect(await checkInsFor(h.ids.studentA)).toHaveLength(0);
  });

  it("enable for company B's student → 403 and no row (red if the enable access check is removed)", async () => {
    const res = await parentLinkA.post('/api/check-in/enable').send({ studentId: h.ids.studentB, deviceId: 'wt4-device' });
    expect(res.status).toBe(403);
    expect(res.body).toEqual(NO_ACCESS);
    expect(await checkInsFor(h.ids.studentB)).toHaveLength(0);
  });

  it("disable for company B's student → 403 and B's check-in is untouched (red if the disable access check is removed)", async () => {
    await h.db.insert(studentCheckIns).values({
      studentId: h.ids.studentB,
      parentId: h.ids.parentB,
      companyId: h.ids.companyB,
      deviceId: 'wt4-b-device',
      status: 'waiting',
    });
    const res = await parentLinkA.post('/api/check-in/disable').send({ studentId: h.ids.studentB });
    expect(res.status).toBe(403);
    expect(res.body).toEqual(NO_ACCESS);
    expect(await checkInsFor(h.ids.studentB)).toHaveLength(1);
  });
});
