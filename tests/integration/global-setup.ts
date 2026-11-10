// Integration globalSetup: runs once per `vitest run` that includes the
// integration project, in the main vitest process.
//
// Raw `pg` only. This file must import NOTHING under server/ (server/db.ts
// opens a pool on DATABASE_URL at import time).
//
// Steps: guard → CREATE DATABASE if missing → take the run lock →
// DROP/CREATE SCHEMA public → drizzle-kit push --force → assert sessions table.
import path from 'path';
import { fileURLToPath } from 'url';
import { spawnSync } from 'child_process';
import dotenv from 'dotenv';
import pg from 'pg';
import { assertTestDatabaseUrl } from './db-guard';

const ROOT = fileURLToPath(new URL('../..', import.meta.url));

// Held for the whole run, so a second run in the same folder waits here instead
// of dropping the schema under the first. Different key from the per-file lock
// in harness.ts (a run must not block on its own file locks).
export const RUN_LOCK_KEY = 4_701_002;

function redact(text: string, url: string): string {
  return text.split(url).join('<TEST_DATABASE_URL>');
}

export default async function globalSetup() {
  dotenv.config({ path: path.join(ROOT, '.env'), quiet: true });
  const url = process.env.TEST_DATABASE_URL;
  const dbName = assertTestDatabaseUrl(url);
  const testUrl = url as string;

  // 1. CREATE DATABASE if missing, via the maintenance DB on the same server.
  const adminUrl = new URL(testUrl);
  adminUrl.pathname = '/postgres';
  const admin = new pg.Client({ connectionString: adminUrl.toString() });
  await admin.connect();
  try {
    const { rowCount } = await admin.query('SELECT 1 FROM pg_database WHERE datname = $1', [dbName]);
    if (!rowCount) {
      // Re-check the name right before the DDL (it is interpolated).
      if (!/^[A-Za-z0-9_]+_test$/.test(dbName)) throw new Error('Refusing CREATE DATABASE on a non-_test name');
      await admin.query(`CREATE DATABASE "${dbName}"`);
    }
  } finally {
    await admin.end();
  }

  // 2. Take the run lock on the test DB and empty the schema.
  assertTestDatabaseUrl(testUrl);
  const lockClient = new pg.Client({ connectionString: testUrl });
  await lockClient.connect();
  await lockClient.query('SELECT pg_advisory_lock($1)', [RUN_LOCK_KEY]);

  const { rows: [{ db }] } = await lockClient.query('SELECT current_database() AS db');
  if (db !== dbName || !/_test$/.test(db)) {
    throw new Error(`Connected to "${db}", expected "${dbName}"; refusing to drop the schema.`);
  }
  await lockClient.query('DROP SCHEMA IF EXISTS public CASCADE');
  await lockClient.query('CREATE SCHEMA public');

  // 3. Push shared/schema.ts. --force is safe only because the schema was just
  //    emptied and the guard passed. Switch to `drizzle-kit migrate` once
  //    migrations/ is generated.
  assertTestDatabaseUrl(testUrl);
  const push = spawnSync('npx', ['drizzle-kit', 'push', '--force'], {
    cwd: ROOT,
    env: { ...process.env, DATABASE_URL: testUrl },
    encoding: 'utf8',
  });
  if (push.status !== 0) {
    const out = redact(`${push.stdout ?? ''}\n${push.stderr ?? ''}`, testUrl);
    throw new Error(`drizzle-kit push failed (exit ${push.status}):\n${out}`);
  }

  // 4. connect-pg-simple runs with createTableIfMissing: false, so the
  //    sessions table must come from the push.
  const { rows: [{ reg }] } = await lockClient.query("SELECT to_regclass('public.sessions') AS reg");
  if (reg === null) {
    throw new Error('drizzle-kit push did not create public.sessions; logins would fail.');
  }

  return async function teardown() {
    try {
      await lockClient.query('SELECT pg_advisory_unlock($1)', [RUN_LOCK_KEY]);
    } finally {
      await lockClient.end();
    }
  };
}
