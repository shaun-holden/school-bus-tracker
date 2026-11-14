// Q62 (DeShaun's choice A): a master admin impersonating a school can READ
// conversations but can't SEND (403, no row, no push). The conversation list
// never shows a master's name or email ("School staff"), and never anyone's
// email: a user with a blank name shows a role label. Real HTTP + real
// Postgres. pushService is mocked (tests/integration/setup.ts).
import { describe, it, expect, beforeAll, beforeEach, vi } from 'vitest';
import { eq } from 'drizzle-orm';
import { directMessages, users } from '@shared/schema';
import { pushService } from '../../server/pushService';
import { useIntegrationHarness, type Agent } from './harness';
import { insertUser, EMAILS } from './seed';

const h = useIntegrationHarness();
const NO_NAME_EMAIL = 'q62-noname-driver@sbt.test';

let master: Agent;
let parentA: Agent;
let driverA: Agent;
let noNameDriver: string;

const send = () => vi.mocked(pushService.sendToUsers);
type Conv = { recipientId: string; recipientName: string };

beforeAll(async () => {
  // A company-A driver with no first or last name, in a thread with parentA.
  noNameDriver = await insertUser(
    { email: NO_NAME_EMAIL, firstName: null, lastName: null, role: 'driver', companyId: h.ids.companyA },
    { password: false },
  );
  await h.db.insert(directMessages).values({ senderId: noNameDriver, recipientId: h.ids.parentA, content: 'Bus is late', companyId: h.ids.companyA });
  // A thread that already exists from the master (sent before Q62).
  await h.db.insert(directMessages).values({ senderId: h.ids.master, recipientId: h.ids.parentA, content: 'From the office', companyId: h.ids.companyA });
  const [m] = await h.db.select().from(users).where(eq(users.id, h.ids.master));
  expect(m.firstName).toBeTruthy();

  // 3 logins (MAX_LOGINS_PER_FILE is 8).
  master = await h.loginAs('master');
  expect((await master.post(`/api/master-admin/impersonate/${h.ids.companyA}`).send({})).status).toBe(200);
  parentA = await h.loginAs('parentA');
  driverA = await h.loginAs('driverA');
});

beforeEach(() => {
  send().mockClear();
});

describe('Q62 sending', () => {
  it('a master impersonating company A → POST /api/messages to parentA is 403, no message row, no push (red if the send block is removed)', async () => {
    const before = (await h.db.select().from(directMessages).where(eq(directMessages.senderId, h.ids.master))).length;
    const res = await master.post('/api/messages').send({ recipientId: h.ids.parentA, content: 'Hello from the office' });
    expect(res.status).toBe(403);
    expect(res.body).toEqual({ message: "Staff messages can't be sent while viewing a school" });
    expect((await h.db.select().from(directMessages).where(eq(directMessages.senderId, h.ids.master))).length).toBe(before);
    expect(send()).not.toHaveBeenCalled();
  });

  it('positive control: driverA → parentA still sends (200) and pushes', async () => {
    const res = await driverA.post('/api/messages').send({ recipientId: h.ids.parentA, content: 'Running late' });
    expect(res.status).toBe(200);
    expect(send()).toHaveBeenCalledTimes(1);
  });

  it('an impersonating master can still read conversations (200)', async () => {
    expect((await master.get('/api/messages/conversations')).status).toBe(200);
  });
});

describe('Q62 conversation list names', () => {
  let convs: Conv[];
  let body: string;
  beforeAll(async () => {
    const res = await parentA.get('/api/messages/conversations');
    expect(res.status).toBe(200);
    convs = res.body;
    body = JSON.stringify(res.body);
  });

  it('a thread with the master shows "School staff" and the body has neither the master\'s name nor email (red if the master_admin label is removed)', async () => {
    const row = convs.find((c) => c.recipientId === h.ids.master);
    expect(row?.recipientName).toBe('School staff');
    const [m] = await h.db.select().from(users).where(eq(users.id, h.ids.master));
    // The master's first name, full name and email ("Seed" alone is also in
    // other seed users' last names, so it isn't checked on its own).
    for (const part of [m.firstName, `${m.firstName} ${m.lastName}`, EMAILS.master]) {
      if (part) expect(body).not.toContain(part);
    }
  });

  it('a user with a blank name shows the role label "Driver", never their email (red if the email fallback comes back)', async () => {
    const row = convs.find((c) => c.recipientId === noNameDriver);
    expect(row?.recipientName).toBe('Driver');
    expect(body).not.toContain(NO_NAME_EMAIL);
  });

  it('positive control: a named driver still shows their name', async () => {
    const row = convs.find((c) => c.recipientId === h.ids.driverA);
    expect(row?.recipientName).toBe('A-Driver Seed');
  });
});
