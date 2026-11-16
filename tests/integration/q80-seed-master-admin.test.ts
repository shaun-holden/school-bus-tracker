// Q80 (SB-4): the boot-time master-admin seed creates the account when it is
// missing and never promotes an existing one. No log line carries the email
// (checklist S-13). Fake env values only; .env may hold real ones, which are
// overwritten here and never printed.
import { describe, it, expect, beforeAll, afterAll, beforeEach, afterEach, type MockInstance } from 'vitest';
import { eq } from 'drizzle-orm';
import { users, passwordCredentials } from '@shared/schema';
import { seedMasterAdmin } from '../../scripts/seed-master-admin';
import { useIntegrationHarness } from './harness';
import { EMAILS } from './seed';

const h = useIntegrationHarness();
const NEW_MASTER = 'q80-new-master@sbt.test';
const ENV_KEYS = ['MASTER_ADMIN_EMAIL', 'MASTER_ADMIN_PASSWORD'] as const;
const saved: Partial<Record<(typeof ENV_KEYS)[number], string>> = {};
let spies: MockInstance[] = [];

beforeAll(() => {
  for (const k of ENV_KEYS) if (k in process.env) saved[k] = process.env[k];
});

afterAll(() => {
  for (const k of ENV_KEYS) {
    if (saved[k] !== undefined) process.env[k] = saved[k];
    else delete process.env[k];
  }
});

beforeEach(() => {
  spies = [
    vi.spyOn(console, 'log').mockImplementation(() => {}),
    vi.spyOn(console, 'warn').mockImplementation(() => {}),
    vi.spyOn(console, 'error').mockImplementation(() => {}),
  ];
});

afterEach(() => {
  for (const s of spies) s.mockRestore();
});

function setSeedEnv(email: string) {
  process.env.MASTER_ADMIN_EMAIL = email;
  process.env.MASTER_ADMIN_PASSWORD = 'fake-test-only-pw';
}

/** Every argument of every console.log/warn/error call, as one string. */
function allLogged(): string {
  return spies.flatMap((s) => s.mock.calls.flat().map((a) => String(a))).join('\n');
}

const usersByEmail = (email: string) => h.db.select().from(users).where(eq(users.email, email));

describe('seedMasterAdmin (Q80, SB-4)', () => {
  it('A: an existing parent with MASTER_ADMIN_EMAIL stays a parent in its own company and the email is not logged (red if the existing-user branch sets role master_admin)', async () => {
    // X-3: the seeded parent is reachable before the seed runs.
    const [before] = await usersByEmail(EMAILS.parentA);
    expect(before).toBeDefined();
    expect(before.role).toBe('parent');
    expect(before.companyId).toBe(h.ids.companyA);

    setSeedEnv(EMAILS.parentA);
    await seedMasterAdmin();

    const after = await usersByEmail(EMAILS.parentA);
    expect(after).toHaveLength(1);
    expect(after[0].role).toBe('parent');
    expect(after[0].companyId).toBe(before.companyId);

    expect(console.warn).toHaveBeenCalledWith(
      'Master admin seed: MASTER_ADMIN_EMAIL belongs to an existing non-master account; not promoted.',
    );
    expect(allLogged()).not.toContain(EMAILS.parentA);
  });

  it('B: create path control, a new email gets one master_admin row with no company and a password row, and the email is not logged', async () => {
    expect(await usersByEmail(NEW_MASTER)).toHaveLength(0);

    setSeedEnv(NEW_MASTER);
    await seedMasterAdmin();

    const rows = await usersByEmail(NEW_MASTER);
    expect(rows).toHaveLength(1);
    expect(rows[0].role).toBe('master_admin');
    expect(rows[0].companyId).toBeNull();
    const creds = await h.db.select().from(passwordCredentials).where(eq(passwordCredentials.userId, rows[0].id));
    expect(creds).toHaveLength(1);

    expect(console.log).toHaveBeenCalledWith('Master admin seed: account created.');
    expect(allLogged()).not.toContain(NEW_MASTER);
  });

  it('C: a second run with the same email adds no row and logs "already exists" without the email', async () => {
    setSeedEnv(NEW_MASTER);
    await seedMasterAdmin();

    expect(await usersByEmail(NEW_MASTER)).toHaveLength(1);
    expect(console.log).toHaveBeenCalledWith('Master admin seed: already exists.');
    expect(allLogged()).not.toContain(NEW_MASTER);
  });
});
