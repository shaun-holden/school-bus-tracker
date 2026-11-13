// T4a area 3: POST /api/messages push sender name. The push names the sender
// by first name + last initial, or a role label ("A parent", "Your driver",
// "School staff"), and NEVER by email; the sender's id goes in argument 4 so
// the app can open the conversation. pushService is mocked in integration
// tests, so this asserts on the notifyNewMessage mock arguments.
import { describe, it, expect, beforeAll, beforeEach, vi } from 'vitest';
import { pushService } from '../../server/pushService';
import { useIntegrationHarness, type Agent } from './harness';
import { insertUser, SEED_PASSWORD } from './seed';

const h = useIntegrationHarness();
const NO_NAME_EMAIL = 'q-t4a-noname-parent@sbt.test';

let noNameParent: Agent;
let parentA: Agent;
let noNameParentId: string;

const pushMock = () => vi.mocked(pushService.notifyNewMessage);

beforeAll(async () => {
  // A company-A parent with an email and NO first or last name.
  noNameParentId = await insertUser(
    { email: NO_NAME_EMAIL, firstName: null, lastName: null, role: 'parent', companyId: h.ids.companyA },
    { password: true },
  );
  // 2 logins (MAX_LOGINS_PER_FILE is 8).
  const agent = h.anon();
  expect((await h.loginAttempt(NO_NAME_EMAIL, SEED_PASSWORD, agent)).status).toBe(200);
  noNameParent = agent;
  parentA = await h.loginAs('parentA');
});

beforeEach(() => {
  pushMock().mockClear();
});

describe('T4a message push sender', () => {
  it('a sender with no name is "A parent" (argument 2 never contains the email or an @) and argument 4 is the sender\'s id (red if the email fallback comes back)', async () => {
    const res = await noNameParent.post('/api/messages').send({ recipientId: h.ids.driverA, content: 'Hello from no name' });
    expect(res.status).toBe(200);
    expect(pushMock()).toHaveBeenCalledTimes(1);
    const args = pushMock().mock.calls[0];
    expect(args[0]).toBe(h.ids.driverA);
    expect(args[1]).not.toContain('@');
    expect(args[1]).not.toContain(NO_NAME_EMAIL);
    expect(args[1]).toBe('A parent');
    expect(args[3]).toBe(noNameParentId);
  });

  it('a named sender is first name + last initial, never the full last name; the message text is not passed', async () => {
    const res = await parentA.post('/api/messages').send({ recipientId: h.ids.driverA, content: 'Secret body text' });
    expect(res.status).toBe(200);
    const args = pushMock().mock.calls[0];
    expect(args[1]).toBe('A-Parent S.');
    expect(args[2]).toBeUndefined();
    expect(args[3]).toBe(h.ids.parentA);
  });
});
