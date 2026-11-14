// T4b E7: admin alerts go through pushToRecipients, so the fence applies on
// top of getAlertRecipients. getAlertRecipients doesn't know the parent-portal
// rule (decision 2A); only the fence does. So with the portal off an alert
// still writes its in-app row but pushes nobody, and with it on the same
// alert pushes the parent (positive control). Real HTTP + real Postgres.
import { describe, it, expect, beforeAll, beforeEach, afterEach, vi } from 'vitest';
import { eq } from 'drizzle-orm';
import { companies, parentNotifications } from '@shared/schema';
import { pushService } from '../../server/pushService';
import { useIntegrationHarness, type Agent } from './harness';

const h = useIntegrationHarness();
let adminA: Agent;
const send = () => vi.mocked(pushService.sendToUsers);

beforeAll(async () => {
  adminA = await h.loginAs('adminA');
});

beforeEach(() => {
  send().mockClear();
});

afterEach(async () => {
  await h.db.update(companies).set({ parentPortalEnabled: true }).where(eq(companies.id, h.ids.companyA));
});

describe('T4b E7 alert through the fence', () => {
  it('positive control: a global alert pushes company A\'s parent with data { type: "alert" }', async () => {
    const res = await adminA.post('/api/notifications').send({ type: 'info', title: 'T4b alert', message: 'Hello', isGlobal: true });
    expect(res.status).toBe(200);
    expect(send()).toHaveBeenCalledTimes(1);
    const [ids, payload] = send().mock.calls[0] as [string[], { data?: unknown }];
    expect(ids).toContain(h.ids.parentA);
    expect(payload.data).toEqual({ type: 'alert' });
  });

  it('with the parent portal off, the alert row is still written but nobody is pushed (red if the alert push bypasses pushToRecipients, #17)', async () => {
    await h.db.update(companies).set({ parentPortalEnabled: false }).where(eq(companies.id, h.ids.companyA));
    const res = await adminA.post('/api/notifications').send({ type: 'info', title: 'T4b portal off', message: 'Hello', isGlobal: true });
    expect(res.status).toBe(200);
    expect(await h.db.select().from(parentNotifications).where(eq(parentNotifications.id, res.body.id))).toHaveLength(1);
    expect(send()).not.toHaveBeenCalled();
  });
});
