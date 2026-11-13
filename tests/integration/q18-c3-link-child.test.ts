// Q18 Part C3: POST /api/link-child. A parent who already belongs to a
// company can't redeem another company's code, and the refusal is
// byte-identical to an unknown code (no existence leak), with nothing
// written. A null-company parent can still redeem and adopts the code's
// company. Real HTTP + real Postgres; each title names the clause whose
// deletion turns it red.
import { describe, it, expect, beforeAll } from 'vitest';
import { and, eq } from 'drizzle-orm';
import { users, students, linkCodes, parentChildLinks } from '@shared/schema';
import { useIntegrationHarness, type Agent } from './harness';

const h = useIntegrationHarness();
const URL = '/api/link-child';

let parentA: Agent;
let parentNull: Agent;
let unknownBody: unknown;

const linksFor = (parentId: string, studentId: string) =>
  h.db.select().from(parentChildLinks).where(and(eq(parentChildLinks.parentId, parentId), eq(parentChildLinks.studentId, studentId)));
const usesOf = async (id: string) => (await h.db.select().from(linkCodes).where(eq(linkCodes.id, id)))[0].usesCount;

async function insertCode(code: string, studentId: string, companyId: string | null) {
  const [row] = await h.db
    .insert(linkCodes)
    .values({ companyId, code, studentId, createdById: h.ids.adminA, status: 'active', expiresAt: new Date('2099-01-01T00:00:00Z') })
    .returning({ id: linkCodes.id });
  return row.id;
}

beforeAll(async () => {
  // 2 logins (MAX_LOGINS_PER_FILE is 8).
  parentA = await h.loginAs('parentA');
  parentNull = await h.loginAs('parentNull');
  const unknown = await parentA.post(URL).send({ code: 'NOPE-000000' });
  expect(unknown.status).toBe(400);
  unknownBody = unknown.body;
});

describe('C3 refusals answer exactly like an unknown code', () => {
  it('parentA (company A) redeeming company B\'s code gets 400 with the unknown-code body, no link row, use count unchanged (red if the codeCompanyId !== user.companyId check is dropped)', async () => {
    const before = await usesOf(h.ids.linkCodeB);
    const res = await parentA.post(URL).send({ code: 'B-LINK-0001' });
    expect(res.status).toBe(400);
    expect(res.body).toEqual(unknownBody);
    expect(await linksFor(h.ids.parentA, h.ids.studentB)).toHaveLength(0);
    expect(await usesOf(h.ids.linkCodeB)).toBe(before);
  });

  it('a legacy code with companyId NULL for a company-B student is also refused for parentA (company from the student)', async () => {
    const id = await insertCode('LEGACY-B-0001', h.ids.studentB, null);
    const res = await parentA.post(URL).send({ code: 'LEGACY-B-0001' });
    expect(res.status).toBe(400);
    expect(res.body).toEqual(unknownBody);
    expect(await linksFor(h.ids.parentA, h.ids.studentB)).toHaveLength(0);
    expect(await usesOf(id)).toBe(0);
  });

  it('a code whose company can\'t be resolved (code and student both NULL) gives the unknown-code 400 (red if !codeCompanyId is dropped)', async () => {
    const [orphan] = await h.db
      .insert(students)
      .values({ companyId: null, firstName: 'Orphan', lastName: 'Seed', parentId: h.ids.adminA })
      .returning({ id: students.id });
    const id = await insertCode('ORPHAN-0001', orphan.id, null);
    const res = await parentNull.post(URL).send({ code: 'ORPHAN-0001' });
    expect(res.status).toBe(400);
    expect(res.body).toEqual(unknownBody);
    expect(await linksFor(h.ids.parentNull, orphan.id)).toHaveLength(0);
    expect(await usesOf(id)).toBe(0);
  });
});

describe('C3 null-company parent still links', () => {
  it('parentNull redeems company A\'s code: 200, a link row, and parentNull adopts company A', async () => {
    const res = await parentNull.post(URL).send({ code: 'A-LINK-0001' });
    expect(res.status).toBe(200);
    expect(await linksFor(h.ids.parentNull, h.ids.studentA)).toHaveLength(1);
    const [row] = await h.db.select().from(users).where(eq(users.id, h.ids.parentNull));
    expect(row.companyId).toBe(h.ids.companyA);
  });
});
