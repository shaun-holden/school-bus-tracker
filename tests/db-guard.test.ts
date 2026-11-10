import { describe, it, expect, afterEach, vi } from 'vitest';
import { assertTestDatabaseUrl } from './integration/db-guard';

// Unit test for the integration-test DB guard. No database is contacted.
describe('assertTestDatabaseUrl (integration DB guard)', () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it('accepts a localhost database whose name ends in _test', () => {
    vi.stubEnv('NODE_ENV', 'test');
    expect(assertTestDatabaseUrl('postgres://localhost/x_test')).toBe('x_test');
    expect(assertTestDatabaseUrl('postgres://localhost:5433/sbt_dev1_test')).toBe('sbt_dev1_test');
    expect(assertTestDatabaseUrl('postgresql://postgres:postgres@127.0.0.1:5432/sbt_ci_test')).toBe('sbt_ci_test');
    expect(assertTestDatabaseUrl('postgres://[::1]:5433/x_test')).toBe('x_test');
  });

  it('rejects a database name that does not end in _test (.../sbt)', () => {
    vi.stubEnv('NODE_ENV', 'test');
    expect(() => assertTestDatabaseUrl('postgres://localhost:5433/sbt')).toThrow(/_test/);
    expect(() => assertTestDatabaseUrl('postgres://localhost:5433/sbt_test_prod')).toThrow(/_test/);
    expect(() => assertTestDatabaseUrl('postgres://localhost:5433/')).toThrow(/_test/);
  });

  it('rejects a remote (Railway rlwy.net) host even when the name ends in _test', () => {
    vi.stubEnv('NODE_ENV', 'test');
    expect(() =>
      assertTestDatabaseUrl('postgresql://postgres:secret@shuttle.proxy.rlwy.net:41234/railway_test'),
    ).toThrow(/not local/);
  });

  it('never echoes the password of a rejected URL', () => {
    vi.stubEnv('NODE_ENV', 'test');
    expect(() =>
      assertTestDatabaseUrl('postgresql://postgres:hunter2@shuttle.proxy.rlwy.net:41234/railway_test'),
    ).toThrow(expect.objectContaining({ message: expect.not.stringContaining('hunter2') }));
  });

  it('rejects a ?host= override that would redirect a localhost URL', () => {
    vi.stubEnv('NODE_ENV', 'test');
    expect(() =>
      assertTestDatabaseUrl('postgres://localhost:5433/x_test?host=db.example.com'),
    ).toThrow(/host/);
  });

  it('rejects a missing URL with a fix-it message', () => {
    vi.stubEnv('NODE_ENV', 'test');
    expect(() => assertTestDatabaseUrl(undefined)).toThrow(/TEST_DATABASE_URL is not set/);
    expect(() => assertTestDatabaseUrl('')).toThrow(/\.env/);
  });

  it('rejects an unparseable URL and a non-postgres scheme', () => {
    vi.stubEnv('NODE_ENV', 'test');
    expect(() => assertTestDatabaseUrl('not a url')).toThrow(/parse/);
    expect(() => assertTestDatabaseUrl('mysql://localhost/x_test')).toThrow(/postgres/);
  });

  it('rejects everything when NODE_ENV is production', () => {
    vi.stubEnv('NODE_ENV', 'production');
    expect(() => assertTestDatabaseUrl('postgres://localhost/x_test')).toThrow(/production/);
  });
});
