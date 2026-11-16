// Q89: saving a route keeps its driver (PATCH /api/routes/:id treats
// driverId: null as "not sent"; "" still unassigns), and the messaging
// contact lists use the same parent fence as the route-event recipients
// (direct parents of this company + linked parents of this company or with no
// company), with the send check agreeing. Real HTTP + real Postgres; every
// foreign row is seeded and asserted to exist (checklist X-1/X-2/X-3).
//
// Each title names the clause whose deletion turns it red.
import { describe, it, expect, beforeAll } from 'vitest';
import { eq } from 'drizzle-orm';
import { parentChildLinks, routes, students, users } from '@shared/schema';
import { useIntegrationHarness, type Agent } from './harness';
import { insertUser, seedQ8Extras, seedQ8Round2, SEED_PASSWORD, type Q8Ids, type Q8R2Ids } from './seed';

const h = useIntegrationHarness();

const EMAIL_DIRECT_A = 'q89-direct-a@sbt.test';
const EMAIL_A_WITH_B_CHILD = 'q89-a-with-b-child@sbt.test';
const EMAIL_NULL_TWO_SCHOOLS = 'q89-null-two-schools@sbt.test';
const EMAIL_NULL_B_ONLY = 'q89-null-b-only@sbt.test';

let q8: Q8Ids;
let r2: Q8R2Ids;
let adminA: Agent;
let driverA: Agent;
let directParentA: Agent;
let parentAWithBChild: Agent;
let directParentAId: string;
let parentAWithBChildId: string;
let nullTwoSchoolsId: string;
let nullBOnlyId: string;

async function login(email: string): Promise<Agent> {
  const agent = h.anon();
  const res = await h.loginAttempt(email, SEED_PASSWORD, agent);
  expect(res.status).toBe(200);
  return agent;
}

const routeRow = async (id: string) => (await h.db.select().from(routes).where(eq(routes.id, id)))[0];
const contactIds = (res: { body: Array<{ id: string }> }) => res.body.map((c) => c.id);

beforeAll(async () => {
  q8 = await seedQ8Extras(h.ids);
  r2 = await seedQ8Round2(h.ids);
  const onRouteA = { companyId: h.ids.companyA, lastName: 'Seed', schoolId: h.ids.schoolA, routeId: h.ids.routeA, stopId: h.ids.stopA1 };

  // A company-A parent known ONLY through students.parentId (no link row).
  directParentAId = await insertUser(
    { email: EMAIL_DIRECT_A, firstName: 'Q89-DirectA', lastName: 'Seed', role: 'parent', companyId: h.ids.companyA },
    { password: true },
  );
  await h.db.insert(students).values({ ...onRouteA, firstName: 'Q89-DirectChild', parentId: directParentAId });

  // A company-A parent whose only (direct) child is a company-B student on routeB.
  parentAWithBChildId = await insertUser(
    { email: EMAIL_A_WITH_B_CHILD, firstName: 'Q89-AWithB', lastName: 'Seed', role: 'parent', companyId: h.ids.companyA },
    { password: true },
  );
  await h.db.insert(students).values({
    companyId: h.ids.companyB, firstName: 'Q89-BChild', lastName: 'Seed', parentId: parentAWithBChildId,
    schoolId: h.ids.schoolB, routeId: h.ids.routeB, stopId: h.ids.stopB1,
  });

  // A NULL-company parent with a B child inserted (and linked) BEFORE an A child.
  nullTwoSchoolsId = await insertUser(
    { email: EMAIL_NULL_TWO_SCHOOLS, firstName: 'Q89-NullTwo', lastName: 'Seed', role: 'parent', companyId: null },
    { password: false },
  );
  const [bKid] = await h.db.insert(students).values({
    companyId: h.ids.companyB, firstName: 'Q89-NullTwo-B', lastName: 'Seed', parentId: h.ids.parentB,
    schoolId: h.ids.schoolB, routeId: h.ids.routeB, stopId: h.ids.stopB1,
  }).returning({ id: students.id });
  const [aKid] = await h.db.insert(students).values({ ...onRouteA, firstName: 'Q89-NullTwo-A', parentId: h.ids.parentA }).returning({ id: students.id });
  await h.db.insert(parentChildLinks).values({ parentId: nullTwoSchoolsId, studentId: bKid.id });
  await h.db.insert(parentChildLinks).values({ parentId: nullTwoSchoolsId, studentId: aKid.id });

  // A NULL-company parent with only a B child.
  nullBOnlyId = await insertUser(
    { email: EMAIL_NULL_B_ONLY, firstName: 'Q89-NullB', lastName: 'Seed', role: 'parent', companyId: null },
    { password: false },
  );
  const [bOnlyKid] = await h.db.insert(students).values({
    companyId: h.ids.companyB, firstName: 'Q89-NullB-Kid', lastName: 'Seed', parentId: h.ids.parentB,
    schoolId: h.ids.schoolB, routeId: h.ids.routeB, stopId: h.ids.stopB1,
  }).returning({ id: students.id });
  await h.db.insert(parentChildLinks).values({ parentId: nullBOnlyId, studentId: bOnlyKid.id });

  // 4 logins (MAX_LOGINS_PER_FILE is 8).
  adminA = await h.loginAs('adminA');
  driverA = await h.loginAs('driverA');
  directParentA = await login(EMAIL_DIRECT_A);
  parentAWithBChild = await login(EMAIL_A_WITH_B_CHILD);

  // X-3: the seeded rows are what the tests assume.
  const rA = await routeRow(h.ids.routeA);
  expect(rA.driverId).toBe(h.ids.driverA);
  expect(rA.companyId).toBe(h.ids.companyA);
  const rB = await routeRow(h.ids.routeB);
  expect(rB.driverId).toBe(h.ids.driverB);
  const [a4] = await h.db.select().from(students).where(eq(students.id, q8.studentA4));
  expect(a4).toMatchObject({ companyId: h.ids.companyA, routeId: h.ids.routeA, parentId: h.ids.adminA });
  const a4Links = await h.db.select().from(parentChildLinks).where(eq(parentChildLinks.studentId, q8.studentA4));
  expect(a4Links.map((l) => l.parentId)).toContain(h.ids.parentB);
  const [shortB] = await h.db.select().from(students).where(eq(students.id, r2.studentShortB));
  expect(shortB).toMatchObject({ companyId: h.ids.companyA, routeId: h.ids.routeA, parentId: h.ids.parentB });
  const linkAdmin = await h.db.select().from(parentChildLinks).where(eq(parentChildLinks.studentId, r2.studentLinkAdmin));
  expect(linkAdmin.map((l) => l.parentId)).toContain(h.ids.adminA);
  const nullLinks = await h.db.select().from(parentChildLinks).where(eq(parentChildLinks.parentId, h.ids.parentNull));
  expect(nullLinks.map((l) => l.studentId)).toContain(h.ids.studentA);
  const [pB] = await h.db.select().from(users).where(eq(users.id, h.ids.parentB));
  expect(pB.companyId).toBe(h.ids.companyB);
  const [pNull] = await h.db.select().from(users).where(eq(users.id, h.ids.parentNull));
  expect(pNull.companyId).toBeNull();
  const twoLinks = await h.db.select().from(parentChildLinks).where(eq(parentChildLinks.parentId, nullTwoSchoolsId));
  expect(twoLinks).toHaveLength(2);
});

describe('Q89 driver and parent contacts', () => {
  it('B4 getParentsForDriver uses the route-event fence: direct A parent and NULL-company linked parent listed; B parent and admin not', async () => {
    const res = await driverA.get('/api/messages/contacts');
    expect(res.status).toBe(200);
    const ids = contactIds(res);
    expect(ids).toContain(directParentAId);
    expect(ids).toContain(h.ids.parentA);
    expect(ids).toContain(h.ids.parentNull);
    expect(ids).toContain(nullTwoSchoolsId);
    expect(ids).not.toContain(h.ids.parentB);
    expect(ids).not.toContain(h.ids.adminA);
    expect(ids).not.toContain(nullBOnlyId);
  });

  it('B5 getDriversForParent includes direct children: a direct parent sees the route driver; a B child gives no B driver', async () => {
    const direct = await directParentA.get('/api/messages/contacts');
    expect(direct.status).toBe(200);
    expect(contactIds(direct)).toContain(h.ids.driverA);

    const cross = await parentAWithBChild.get('/api/messages/contacts');
    expect(cross.status).toBe(200);
    expect(contactIds(cross)).not.toContain(h.ids.driverB);
  });

  it('B6 recipient any-linked-child check: a NULL-company parent with a child in the sender\'s school is messageable', async () => {
    const ok = await driverA.post('/api/messages').send({ recipientId: nullTwoSchoolsId, content: 'Q89 B6 hello' });
    expect(ok.status).toBe(200);
    const refused = await driverA.post('/api/messages').send({ recipientId: nullBOnlyId, content: 'Q89 B6 refused' });
    expect(refused.status).toBe(404);
    expect(refused.body).toEqual({ message: 'Recipient not found' });
  });
});

describe('Q89 PATCH /api/routes/:id keeps the driver', () => {
  it('B1 driverId === null is "not sent": an edit with driverId null keeps the driver', async () => {
    const res = await adminA.patch(`/api/routes/${h.ids.routeA}`).send({ name: 'A-Route renamed', driverId: null });
    expect(res.status).toBe(200);
    const row = await routeRow(h.ids.routeA);
    expect(row.name).toBe('A-Route renamed');
    expect(row.driverId).toBe(h.ids.driverA);
  });

  it('B3 isDriverInCompany still runs: another school\'s driver → 404, driver unchanged', async () => {
    const res = await adminA.patch(`/api/routes/${h.ids.routeA}`).send({ driverId: h.ids.driverB });
    expect(res.status).toBe(404);
    expect(res.body.message).toBe('Driver not found');
    expect((await routeRow(h.ids.routeA)).driverId).toBe(h.ids.driverA);
  });

  it('B2 driverId "" still unassigns', async () => {
    const res = await adminA.patch(`/api/routes/${h.ids.routeA}`).send({ driverId: '' });
    expect(res.status).toBe(200);
    expect((await routeRow(h.ids.routeA)).driverId).toBeNull();
  });
});
