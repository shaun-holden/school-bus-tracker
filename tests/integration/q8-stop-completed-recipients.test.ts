// Q8 Part A4: POST /api/driver/mark-stop-completed writes nothing unless the
// route is the driver's assigned route, the stop is on that route, and the
// route is in the caller's company; "Bus Arrived at Stop" goes only to the
// parents of that route's students at that stop. Real HTTP + real Postgres.
// Each title names the clause whose deletion turns it red.
import { describe, it, expect, beforeAll } from 'vitest';
import { eq } from 'drizzle-orm';
import { systemNotifications, routeStopCompletions } from '@shared/schema';
import { useIntegrationHarness, type Agent } from './harness';
import { seedQ8Extras, seedQ8Round2, Q8_EMAILS, SEED_PASSWORD, type Q8Ids } from './seed';

const h = useIntegrationHarness();
const TITLE = 'Bus Arrived at Stop';
const URL = '/api/driver/mark-stop-completed';

let q8: Q8Ids;
let driverA: Agent;
let driverX: Agent;
let parentB: Agent;
let parentNull: Agent;

async function login(email: string): Promise<Agent> {
  const agent = h.anon();
  const res = await h.loginAttempt(email, SEED_PASSWORD, agent);
  expect(res.status).toBe(200);
  return agent;
}

const completions = () => h.db.select().from(routeStopCompletions);
const stopRows = () => h.db.select().from(systemNotifications).where(eq(systemNotifications.title, TITLE));

beforeAll(async () => {
  q8 = await seedQ8Extras(h.ids);
  await seedQ8Round2(h.ids);
  // 4 logins (MAX_LOGINS_PER_FILE is 8).
  driverA = await h.loginAs('driverA');
  driverX = await login(Q8_EMAILS.driverX);
  parentB = await h.loginAs('parentB');
  parentNull = await h.loginAs('parentNull');
});

describe('Q8 A4 refusals (no completion row, no notices)', () => {
  it('a same-company route that is not the driver\'s assignedRouteId (routeA2 + its own stop) gives 404 (red if the routeId === user.assignedRouteId check is deleted)', async () => {
    const res = await driverA.post(URL).send({ routeId: q8.routeA2, routeStopId: q8.stopA2x, stopSequence: 1 });
    expect(res.status).toBe(404);
    expect(await completions()).toHaveLength(0);
    expect(await stopRows()).toHaveLength(0);
  });

  it('the driver\'s own routeA with a stop that belongs to routeA2 gives 404 (red if the routeStop.routeId === routeId check is deleted)', async () => {
    const res = await driverA.post(URL).send({ routeId: h.ids.routeA, routeStopId: q8.stopA2x, stopSequence: 1 });
    expect(res.status).toBe(404);
    expect(await completions()).toHaveLength(0);
    expect(await stopRows()).toHaveLength(0);
  });

  it('a company-A driver assigned (bad data) to company B\'s routeB, with B\'s own stop, gives 404 (red if the isOutsideCallerTenant(user, route.companyId) check is deleted)', async () => {
    const res = await driverX.post(URL).send({ routeId: h.ids.routeB, routeStopId: h.ids.stopB1, stopSequence: 1 });
    expect(res.status).toBe(404);
    expect(await completions()).toHaveLength(0);
    expect(await stopRows()).toHaveLength(0);
  });

  it('an unknown stop on the driver\'s route gives 404; missing ids give 400', async () => {
    expect((await driverA.post(URL).send({ routeId: h.ids.routeA, routeStopId: 'no-such-stop' })).status).toBe(404);
    expect((await driverA.post(URL).send({ routeId: h.ids.routeA })).status).toBe(400);
    expect(await completions()).toHaveLength(0);
  });
});

describe('Q8 A4 recipients', () => {
  it('driverA completes stopA1 on routeA: 200, one completion, rows only for parentA and parentNull (A-Student), companyId A', async () => {
    const res = await driverA.post(URL).send({ routeId: h.ids.routeA, routeStopId: h.ids.stopA1, stopSequence: 1 });
    expect(res.status).toBe(200);
    expect(await completions()).toHaveLength(1);

    const rows = await stopRows();
    expect(rows.map((r) => `${r.recipientId}|${r.message}`).sort()).toEqual(
      [
        `${h.ids.parentA}|The bus has arrived at A-Stop-1 for A-Student`,
        `${h.ids.parentNull}|The bus has arrived at A-Stop-1 for A-Student`,
      ].sort(),
    );
    expect(rows.every((r) => r.companyId === h.ids.companyA)).toBe(true);
  });
});

// Round 2 (SHELL mutations 2c, 3b): a fresh completion of stopA1 on routeA.
describe('Q8 round 2: stop-completed recipients, parent company and role', () => {
  const rowsNow = stopRows;
  beforeAll(async () => {
    await h.db.delete(systemNotifications).where(eq(systemNotifications.title, TITLE));
    const res = await driverA.post(URL).send({ routeId: h.ids.routeA, routeStopId: h.ids.stopA1, stopSequence: 1 });
    expect(res.status).toBe(200);
  });

  it('parentB (company B) as students.parentId of A-ShortB, no link, gets 0 rows in the DB and in GET (red if eq(users.companyId, companyId) is dropped from the parentId-shortcut query)', async () => {
    expect((await rowsNow()).filter((r) => r.recipientId === h.ids.parentB)).toHaveLength(0);
    const res = await parentB.get('/api/system-notifications');
    expect(res.status).toBe(200);
    expect(res.body.filter((n: { title: string; message: string }) => n.title === TITLE && n.message.includes('A-ShortB'))).toHaveLength(0);
  });

  it('null-company parentNull as students.parentId of A-ShortNull, no link, gets no A-ShortNull row in the DB or in GET (red if eq(users.companyId, companyId) is dropped from the parentId-shortcut query)', async () => {
    expect((await rowsNow()).filter((r) => r.recipientId === h.ids.parentNull && r.message.includes('A-ShortNull'))).toHaveLength(0);
    const res = await parentNull.get('/api/system-notifications');
    expect(res.status).toBe(200);
    expect(res.body.filter((n: { title: string; message: string }) => n.title === TITLE && n.message.includes('A-ShortNull'))).toHaveLength(0);
  });

  it('adminA, linked to A-LinkAdmin through parentChildLinks, gets 0 rows (red if users.role = \'parent\' is dropped from the link-code query)', async () => {
    expect((await rowsNow()).filter((r) => r.recipientId === h.ids.adminA)).toHaveLength(0);
  });

  it('only parentA and parentNull (for A-Student) are notified', async () => {
    const rows = await rowsNow();
    expect(rows.map((r) => r.recipientId).sort()).toEqual([h.ids.parentA, h.ids.parentNull].sort());
    expect(rows.every((r) => r.message.includes('A-Student'))).toBe(true);
  });
});
