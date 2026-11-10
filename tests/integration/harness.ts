// Per-file integration harness: the real app (createApp), the real session
// store and the real test database.
//
// Usage in a test file:
//   const h = useIntegrationHarness();
//   beforeAll(async () => { adminA = await h.loginAs('adminA'); });
//   ... h.ids.busA, h.app, h.db
//
// useIntegrationHarness() registers a beforeAll that takes the per-file
// advisory lock, then runs resetDb() → seedTwoTenants() → assertSeed(ids), and
// an afterAll that releases the lock and ends the app pool.
import { beforeAll, afterAll, expect } from 'vitest';
import supertest from 'supertest';
import type { Express } from 'express';
import type { PoolClient } from 'pg';
import { createApp } from '../../server/app';
import { pool, db } from '../../server/db';
import { assertTestDatabaseUrl } from './db-guard';
import { seedTwoTenants, assertSeed, EMAILS, SEED_PASSWORD, type Persona, type SeedIds } from './seed';

// Per-file lock: two runs in the same folder queue instead of truncating each
// other's data. (global-setup.ts holds a different, run-wide key.)
export const FILE_LOCK_KEY = 4_701_001;

// authLimiter allows 10 POST /api/auth/login attempts per 15 min per process.
// Each test file gets fresh modules (so a fresh limiter); stop well before 10.
export const MAX_LOGINS_PER_FILE = 8;
let loginAttempts = 0;

export type Agent = ReturnType<typeof supertest.agent>;

/** Guard + TRUNCATE every public table. Refuses unless the app pool really points at TEST_DATABASE_URL. */
export async function resetDb(): Promise<void> {
  const used = (pool as unknown as { options: { connectionString?: string } }).options.connectionString;
  assertTestDatabaseUrl(used);
  if (!process.env.TEST_DATABASE_URL || used !== process.env.TEST_DATABASE_URL) {
    throw new Error('resetDb: the app pool is not connected to TEST_DATABASE_URL; refusing to TRUNCATE.');
  }
  const { rows: [{ db: current }] } = await pool.query('SELECT current_database() AS db');
  if (!/_test$/.test(current)) {
    throw new Error(`resetDb: connected database "${current}" does not end in _test; refusing to TRUNCATE.`);
  }

  const { rows } = await pool.query<{ tablename: string }>(
    "SELECT tablename FROM pg_tables WHERE schemaname = 'public'",
  );
  if (rows.length === 0) throw new Error('resetDb: no tables in public (did globalSetup run?)');
  const list = rows.map((r) => `"public"."${r.tablename.replace(/"/g, '""')}"`).join(', ');
  await pool.query(`TRUNCATE TABLE ${list} RESTART IDENTITY CASCADE`);
}

export interface Harness {
  readonly app: Express;
  readonly ids: SeedIds;
  readonly db: typeof db;
  readonly pool: typeof pool;
  /** Fresh supertest agent with no session. */
  anon(): Agent;
  /** Raw login attempt (counts against the per-file limit). Returns the response. */
  loginAttempt(email: string, password?: string, agent?: Agent): Promise<supertest.Response>;
  /** Logs a seeded persona in on a new agent and expects 200. */
  loginAs(persona: Persona): Promise<Agent>;
}

export function useIntegrationHarness(): Harness {
  let app: Express | undefined;
  let ids: SeedIds | undefined;
  let lockClient: PoolClient | undefined;

  beforeAll(async () => {
    // A dedicated client holds the session-level advisory lock for the file.
    lockClient = await pool.connect();
    await lockClient.query('SELECT pg_advisory_lock($1)', [FILE_LOCK_KEY]);

    await resetDb();
    ids = await seedTwoTenants();
    await assertSeed(ids);

    ({ app } = await createApp({ requestLog: false }));
  });

  afterAll(async () => {
    try {
      if (lockClient) {
        await lockClient.query('SELECT pg_advisory_unlock($1)', [FILE_LOCK_KEY]);
        lockClient.release();
      }
    } finally {
      await pool.end();
    }
  });

  const need = <T>(v: T | undefined, what: string): T => {
    if (v === undefined) throw new Error(`harness: ${what} is not ready (use it inside a test or a later beforeAll)`);
    return v;
  };

  const h: Harness = {
    get app() {
      return need(app, 'app');
    },
    get ids() {
      return need(ids, 'ids');
    },
    db,
    pool,
    anon() {
      return supertest.agent(h.app);
    },
    async loginAttempt(email, password = SEED_PASSWORD, agent = h.anon()) {
      loginAttempts += 1;
      if (loginAttempts > MAX_LOGINS_PER_FILE) {
        throw new Error(
          `Login attempt ${loginAttempts} in one file: authLimiter allows 10 per process. ` +
            'Split this test file (or reuse an agent from beforeAll).',
        );
      }
      return agent.post('/api/auth/login').send({ email, password });
    },
    async loginAs(persona) {
      const agent = h.anon();
      const res = await h.loginAttempt(EMAILS[persona], SEED_PASSWORD, agent);
      expect(res.status, `login as ${persona}: ${JSON.stringify(res.body)}`).toBe(200);
      return agent;
    },
  };
  return h;
}
