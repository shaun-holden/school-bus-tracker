import { describe, it, expect, beforeAll } from 'vitest';
import { sendDriverInvitationEmail } from '../../server/emailService';
import { pushService } from '../../server/pushService';
import { useIntegrationHarness, type Agent } from './harness';

const h = useIntegrationHarness();
let adminA: Agent;

beforeAll(async () => {
  adminA = await h.loginAs('adminA');
});

describe('integration harness smoke', () => {
  it('logs in as adminA with a real session; GET /api/auth/user returns 200 with company A', async () => {
    const res = await adminA.get('/api/auth/user');
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ id: h.ids.adminA, role: 'admin', companyId: h.ids.companyA });
  });

  it('an anonymous GET /api/auth/user is 401 (the session cookie is what authenticates)', async () => {
    const res = await h.anon().get('/api/auth/user');
    expect(res.status).toBe(401);
  });

  it('GET /healthz is 200 {ok:true} with the test DB up', async () => {
    const res = await h.anon().get('/healthz');
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ ok: true });
    expect(res.headers['cache-control']).toBe('no-store');
  });

  it('the setup-file factory mocks reach the server graph (no real email/push)', () => {
    expect(vi.isMockFunction(sendDriverInvitationEmail)).toBe(true);
    expect(vi.isMockFunction(pushService.notifyParentsOfAlert)).toBe(true);
  });
});
