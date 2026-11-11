// Q7b: billing is the school's own decision. A master admin impersonating a
// school may not start Stripe checkout (nor create a Stripe customer for it).
// Real HTTP + real Postgres (Q4 harness); the Stripe client is factory-mocked
// so nothing real loads and no network call is possible.
//
// Test 2 (adminA) clears companyA.stripeCustomerId first, so it does not
// depend on what test 1 did (under a mutation test 1 may leak a write).
//
// Each title names the clause whose removal turns it red.
import { describe, it, expect, beforeAll, beforeEach, vi } from 'vitest';
import { eq } from 'drizzle-orm';
import { companies, users } from '@shared/schema';
import { useIntegrationHarness, type Agent } from './harness';

const fake = vi.hoisted(() => {
  const customersCreate = vi.fn(async () => ({ id: 'cus_fake_q7b' }));
  const sessionsCreate = vi.fn(async () => ({ id: 'cs_fake_q7b', url: 'https://checkout.stripe.test/cs_fake_q7b' }));
  const stripe = {
    customers: { create: customersCreate },
    checkout: { sessions: { create: sessionsCreate } },
  };
  return { stripe, customersCreate, sessionsCreate };
});

vi.mock('../../server/stripeClient', () => ({
  getUncachableStripeClient: vi.fn(async () => fake.stripe),
  getStripePublishableKey: vi.fn(async () => 'pk_test_fake_q7b'),
  getStripeSecretKey: vi.fn(async () => 'sk_test_fake_q7b'),
}));

import { getUncachableStripeClient } from '../../server/stripeClient';

const h = useIntegrationHarness();
let master: Agent; // master admin, NOT impersonating
let impersonator: Agent; // master admin impersonating company A
let adminA: Agent;

const PATH = '/api/business/create-checkout-session';
const BODY = { priceId: 'price_fake_q7b' };
const getCompany = async (id: string) => (await h.db.select().from(companies).where(eq(companies.id, id)))[0];

const stripeCalls = () => ({
  client: vi.mocked(getUncachableStripeClient).mock.calls.length,
  customers: fake.customersCreate.mock.calls.length,
  sessions: fake.sessionsCreate.mock.calls.length,
});

beforeAll(async () => {
  // 3 logins (MAX_LOGINS_PER_FILE is 8).
  master = await h.loginAs('master');
  impersonator = await h.loginAs('master');
  adminA = await h.loginAs('adminA');

  const imp = await impersonator.post(`/api/master-admin/impersonate/${h.ids.companyA}`).send({});
  expect(imp.status).toBe(200);
  const me = await impersonator.get('/api/auth/user');
  expect(me.body).toMatchObject({ role: 'master_admin', companyId: h.ids.companyA, _masterAdminImpersonating: true });
  const plain = await master.get('/api/auth/user');
  expect(plain.body.role).toBe('master_admin');
  expect(plain.body._masterAdminImpersonating).toBeUndefined();
});

beforeEach(() => {
  vi.mocked(getUncachableStripeClient).mockClear();
  fake.customersCreate.mockClear();
  fake.sessionsCreate.mockClear();
});

describe('POST /api/business/create-checkout-session while impersonating (Q7b)', () => {
  it('impersonating master of A → 403 and Stripe is never called; A.stripeCustomerId unchanged (red if the `_masterAdminImpersonating === true` 403 is removed from create-checkout-session)', async () => {
    const before = await getCompany(h.ids.companyA);
    const res = await impersonator.post(PATH).send(BODY);
    expect(res.status).toBe(403);
    expect(res.body).toEqual({ message: "Billing is managed by the school's own admin, not while impersonating" });
    expect(stripeCalls()).toEqual({ client: 0, customers: 0, sessions: 0 });
    const after = await getCompany(h.ids.companyA);
    expect(after.stripeCustomerId).toBe(before.stripeCustomerId);
  });

  it('positive control: adminA → 200 with the checkout url, Stripe reached (red if the impersonation guard also blocks a real company admin)', async () => {
    await h.db.update(companies).set({ stripeCustomerId: null }).where(eq(companies.id, h.ids.companyA));
    const res = await adminA.post(PATH).send(BODY);
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ url: 'https://checkout.stripe.test/cs_fake_q7b', sessionId: 'cs_fake_q7b' });
    // companyA has no stripeCustomerId, so the handler creates one.
    expect(stripeCalls()).toEqual({ client: 1, customers: 1, sessions: 1 });
    expect((await getCompany(h.ids.companyA)).stripeCustomerId).toBe('cus_fake_q7b');
    const sessionArgs = fake.sessionsCreate.mock.calls[0] as unknown as [{ metadata: { companyId: string } }];
    expect(sessionArgs[0].metadata.companyId).toBe(h.ids.companyA);
  });

  it('the Q7b guard keys on the impersonation flag, not the role: a NON-impersonating master that carries its own companyId still reaches Stripe (status + Stripe calls only, no message text; red if the guard is changed to `role === \'master_admin\'`)', async () => {
    // No route creates this state today (seeded masters have companyId null), so
    // set it for this test only and restore it afterwards. The session is
    // re-read from the DB on every request, so the same agent sees the change.
    await h.db.update(companies).set({ stripeCustomerId: null }).where(eq(companies.id, h.ids.companyA));
    await h.db.update(users).set({ companyId: h.ids.companyA }).where(eq(users.id, h.ids.master));
    try {
      const me = await master.get('/api/auth/user');
      expect(me.body).toMatchObject({ role: 'master_admin', companyId: h.ids.companyA });
      expect(me.body._masterAdminImpersonating).toBeUndefined();

      const res = await master.post(PATH).send(BODY);
      expect(res.status).toBe(200);
      expect(stripeCalls()).toEqual({ client: 1, customers: 1, sessions: 1 });
    } finally {
      await h.db.update(users).set({ companyId: null }).where(eq(users.id, h.ids.master));
    }
    // ...while the impersonating master (same role) is still blocked, Stripe untouched.
    vi.mocked(getUncachableStripeClient).mockClear();
    fake.customersCreate.mockClear();
    fake.sessionsCreate.mockClear();
    const blocked = await impersonator.post(PATH).send(BODY);
    expect(blocked.status).toBe(403);
    expect(stripeCalls()).toEqual({ client: 0, customers: 0, sessions: 0 });
  });

  it('non-impersonating master → 403 "Only company admins can create checkout sessions", Stripe never called (red if the isAdminRole/companyId guard is loosened)', async () => {
    const res = await master.post(PATH).send(BODY);
    expect(res.status).toBe(403);
    expect(res.body).toEqual({ message: 'Only company admins can create checkout sessions' });
    expect(stripeCalls()).toEqual({ client: 0, customers: 0, sessions: 0 });
  });
});
