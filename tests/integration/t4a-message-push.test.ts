// T4a area 3, moved onto T4b's pushToRecipients: POST /api/messages push
// sender name. The push names the sender by first name + last initial, or a
// role label ("A parent", "Your driver", "School staff"), and NEVER by email;
// the sender's id goes in data.senderId so the app can open the conversation,
// and the message text is never sent. pushService is mocked in integration
// tests, so this asserts on the pushService.sendToUsers ids + payload (the
// message push now goes through the fence like every other event).
import { describe, it, expect, beforeAll, beforeEach, vi } from 'vitest';
import { eq } from 'drizzle-orm';
import { companies } from '@shared/schema';
import { pushService } from '../../server/pushService';
import { useIntegrationHarness, type Agent } from './harness';
import { insertUser, SEED_PASSWORD } from './seed';

const h = useIntegrationHarness();
const NO_NAME_EMAIL = 'q-t4a-noname-parent@sbt.test';

let noNameParent: Agent;
let parentA: Agent;
let driverA: Agent;
let masterImp: Agent;
let noNameParentId: string;

type Payload = { title: string; body: string; data?: Record<string, unknown> };
const pushMock = () => vi.mocked(pushService.sendToUsers);
const onlyPush = () => {
  expect(pushMock()).toHaveBeenCalledTimes(1);
  const [ids, payload] = pushMock().mock.calls[0] as [string[], Payload];
  return { ids, payload };
};

beforeAll(async () => {
  // A company-A parent with an email and NO first or last name.
  noNameParentId = await insertUser(
    { email: NO_NAME_EMAIL, firstName: null, lastName: null, role: 'parent', companyId: h.ids.companyA },
    { password: true },
  );
  // 4 logins (MAX_LOGINS_PER_FILE is 8).
  const agent = h.anon();
  expect((await h.loginAttempt(NO_NAME_EMAIL, SEED_PASSWORD, agent)).status).toBe(200);
  noNameParent = agent;
  parentA = await h.loginAs('parentA');
  driverA = await h.loginAs('driverA');
  masterImp = await h.loginAs('master');
  expect((await masterImp.post(`/api/master-admin/impersonate/${h.ids.companyA}`).send({})).status).toBe(200);
});

beforeEach(() => {
  pushMock().mockClear();
});

describe('T4a message push sender', () => {
  it('a sender with no name is "A parent" (argument 2 never contains the email or an @) and argument 4 is the sender\'s id (red if the email fallback comes back)', async () => {
    const res = await noNameParent.post('/api/messages').send({ recipientId: h.ids.driverA, content: 'Hello from no name' });
    expect(res.status).toBe(200);
    const { ids, payload } = onlyPush();
    expect(ids).toEqual([h.ids.driverA]);
    expect(payload.body).not.toContain('@');
    expect(payload.body).not.toContain(NO_NAME_EMAIL);
    expect(payload.body).toBe('A parent sent you a message');
    expect(payload.data).toEqual({ type: 'message', senderId: noNameParentId });
  });

  it('a named sender is first name + last initial, never the full last name; the message text is not passed', async () => {
    const res = await parentA.post('/api/messages').send({ recipientId: h.ids.driverA, content: 'Secret body text' });
    expect(res.status).toBe(200);
    const { payload } = onlyPush();
    expect(payload.body).toBe('A-Parent S. sent you a message');
    expect(JSON.stringify(payload)).not.toContain('Secret body text');
    expect(payload.data?.senderId).toBe(h.ids.parentA);
  });
});

describe('T4b message push through the fence', () => {
  it('decision 2A: with the parent portal off, a driver who gets a message from another driver is still pushed (the portal rule only drops parents)', async () => {
    await h.db.update(companies).set({ parentPortalEnabled: false }).where(eq(companies.id, h.ids.companyA));
    try {
      const res = await driverA.post('/api/messages').send({ recipientId: h.ids.driverA2, content: 'Shift swap?' });
      expect(res.status).toBe(200);
      expect(onlyPush().ids).toEqual([h.ids.driverA2]);
    } finally {
      await h.db.update(companies).set({ parentPortalEnabled: true }).where(eq(companies.id, h.ids.companyA));
    }
  });

  it('an inactive recipient gets no push (red if the message push bypasses pushToRecipients, #17)', async () => {
    const inactive = await insertUser(
      { email: 't4b-inactive-driver@sbt.test', firstName: 'A-Gone', lastName: 'Seed', role: 'driver', companyId: h.ids.companyA, isActive: false },
      { password: false },
    );
    const res = await parentA.post('/api/messages').send({ recipientId: inactive, content: 'Hello?' });
    expect(res.status).toBe(200);
    expect(pushMock()).not.toHaveBeenCalled();
  });
});

describe('Q60 PL-7 impersonating master', () => {
  it('a master impersonating company A can no longer send (Q62: 403, no push), so no push can ever carry the master\'s name; the "School staff" sender branch stays as defence in depth', async () => {
    const res = await masterImp.post('/api/messages').send({ recipientId: h.ids.parentA, content: 'From the office' });
    expect(res.status).toBe(403);
    expect(pushMock()).not.toHaveBeenCalled();
  });

  it('positive control: a normal driver sender keeps first name + last initial', async () => {
    const res = await driverA.post('/api/messages').send({ recipientId: h.ids.parentA, content: 'Running late' });
    expect(res.status).toBe(200);
    expect(onlyPush().payload.body).toBe('A-Driver S. sent you a message');
  });
});
