// TD-2 (Q47): POST /api/students/:studentId/absence accepts a parent linked
// by code (parentChildLinks) as well as the students.parentId shortcut, and
// still refuses a parent of another company. The attendance row itself is
// unchanged (UTC-midnight date, no companyId: parked as DUP-5). Real HTTP +
// real Postgres.
import { describe, it, expect, beforeAll, beforeEach } from 'vitest';
import { eq } from 'drizzle-orm';
import { attendance } from '@shared/schema';
import { useIntegrationHarness, type Agent } from './harness';
import { seedTd1Extras, TD1_EMAILS, SEED_PASSWORD } from './seed';

const h = useIntegrationHarness();

let parentLinkA: Agent;
let parentA: Agent;
let parentB: Agent;

const url = () => `/api/students/${h.ids.studentA}/absence`;
const rowsForStudentA = () => h.db.select().from(attendance).where(eq(attendance.studentId, h.ids.studentA));

beforeAll(async () => {
  await seedTd1Extras(h.ids);
  // 3 logins (MAX_LOGINS_PER_FILE is 8).
  const agent = h.anon();
  expect((await h.loginAttempt(TD1_EMAILS.parentLinkA, SEED_PASSWORD, agent)).status).toBe(200);
  parentLinkA = agent;
  parentA = await h.loginAs('parentA');
  parentB = await h.loginAs('parentB');
});

beforeEach(async () => {
  await h.db.delete(attendance);
});

describe('TD-2 absence report ownership', () => {
  it('(a) a parent linked to studentA only by link code gets 200 and an absence row is stored (red if the getLinkedStudentsByParentId lookup is removed)', async () => {
    const res = await parentLinkA.post(url()).send({ date: '2026-12-01', notes: 'Sick' });
    expect(res.status).toBe(200);
    const rows = await rowsForStudentA();
    expect(rows).toHaveLength(1);
    expect(rows[0].isAbsent).toBe(true);
  });

  it('(b) company B\'s parent reporting studentA absent gets 404 "Student not found", the same body as a missing id, and no row (red if the ownership check is deleted; Q54 moved 403 to 404, T-2)', async () => {
    const missing = await parentB.post('/api/students/no-such-student/absence').send({ date: '2026-12-01' });
    expect(missing.status).toBe(404);
    const res = await parentB.post(url()).send({ date: '2026-12-01' });
    expect(res.status).toBe(404);
    expect(res.body).toEqual({ message: 'Student not found' });
    expect(res.body).toEqual(missing.body);
    expect(await rowsForStudentA()).toHaveLength(0);
  });

  it('(c) the direct parent (students.parentId) still gets 200', async () => {
    const res = await parentA.post(url()).send({ date: '2026-12-02' });
    expect(res.status).toBe(200);
    expect(await rowsForStudentA()).toHaveLength(1);
  });
});
