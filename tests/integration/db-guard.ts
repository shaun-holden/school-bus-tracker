// Hard guard for the integration-test database URL.
//
// Every integration step that creates, drops, pushes or truncates calls this
// first (global-setup.ts, setup.ts, harness.ts resetDb()). It imports nothing,
// so tests/db-guard.test.ts can unit-test it without a database.
//
// Error messages name the host and database only, never the full URL, so a
// URL with a password in it is never echoed into a log.

export const ALLOWED_TEST_DB_HOSTS = ['localhost', '127.0.0.1', '::1'] as const;

const FIX_IT =
  'Integration tests need a local Postgres 17 test database. Add a line like\n' +
  '  TEST_DATABASE_URL=postgres://localhost:5433/sbt_<folder>_test\n' +
  'to this folder\'s .env (CI sets it in .github/workflows/ci.yml). ' +
  'Run only the unit tests with `npm run test:unit`.';

export function assertTestDatabaseUrl(url: string | undefined | null): string {
  if (!url) {
    throw new Error(`TEST_DATABASE_URL is not set.\n${FIX_IT}`);
  }

  if (process.env.NODE_ENV === 'production') {
    throw new Error('Refusing to touch a test database with NODE_ENV=production.');
  }

  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    throw new Error(`TEST_DATABASE_URL does not parse as a URL.\n${FIX_IT}`);
  }

  if (parsed.protocol !== 'postgres:' && parsed.protocol !== 'postgresql:') {
    throw new Error(`TEST_DATABASE_URL must use postgres:// or postgresql:// (got "${parsed.protocol}").`);
  }

  // node-postgres lets ?host= / ?hostaddr= override the authority host, so
  // a query param could point a "localhost" URL somewhere else.
  for (const key of ['host', 'hostaddr']) {
    if (parsed.searchParams.has(key)) {
      throw new Error(`TEST_DATABASE_URL must not set the "${key}" query parameter.`);
    }
  }

  const host = parsed.hostname.replace(/^\[(.*)\]$/, '$1').toLowerCase();
  if (!(ALLOWED_TEST_DB_HOSTS as readonly string[]).includes(host)) {
    throw new Error(
      `TEST_DATABASE_URL host "${host || '(none)'}" is not local. ` +
        `Allowed hosts: ${ALLOWED_TEST_DB_HOSTS.join(', ')}.`,
    );
  }

  let dbName: string;
  try {
    dbName = decodeURIComponent(parsed.pathname.replace(/^\//, ''));
  } catch {
    throw new Error('TEST_DATABASE_URL has an undecodable database name.');
  }
  if (!/^[A-Za-z0-9_]+_test$/.test(dbName)) {
    throw new Error(
      `TEST_DATABASE_URL database "${dbName || '(none)'}" must end with "_test" ` +
        '(letters, digits and underscores only).',
    );
  }

  return dbName;
}
