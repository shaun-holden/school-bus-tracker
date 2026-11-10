import { describe, it, expect } from 'vitest';
// Import ONLY the pure guard module. Never import scripts/seed-staging.ts: it
// runs seed() at the top level and would try to reach a database.
import {
  SEED_SLUGS,
  SEED_EMAILS,
  MIN_PASSWORD_LENGTH,
  checkEnv,
  checkCompanies,
  checkUsers,
  describeDbTarget,
} from '../scripts/seed-staging-guard';

const GOOD_ENV = {
  SEED_TARGET: 'staging',
  STAGING_SEED_PASSWORD: 'x'.repeat(MIN_PASSWORD_LENGTH),
  DATABASE_URL: 'postgresql://u:p@localhost:5432/school_bus_staging_test',
};

const seedUserRows = SEED_EMAILS.map((email) => ({ email, role: 'parent' }));

describe('seed-staging guard', () => {
  // Red if the `SEED_TARGET === 'staging'` check in checkEnv is removed.
  it('refuses when SEED_TARGET is missing', () => {
    const { SEED_TARGET: _omit, ...env } = GOOD_ENV;
    expect(checkEnv(env)).not.toEqual([]);
    expect(checkEnv({ ...GOOD_ENV, SEED_TARGET: 'production' })).not.toEqual([]);
  });

  // Red if the STAGING_SEED_PASSWORD length check in checkEnv is removed.
  it('refuses a short or missing password', () => {
    expect(checkEnv({ ...GOOD_ENV, STAGING_SEED_PASSWORD: 'x'.repeat(MIN_PASSWORD_LENGTH - 1) })).not.toEqual([]);
    const { STAGING_SEED_PASSWORD: _omit, ...env } = GOOD_ENV;
    expect(checkEnv(env)).not.toEqual([]);
  });

  // Red if the DATABASE_URL presence check in checkEnv is removed.
  it('refuses when DATABASE_URL is missing', () => {
    const { DATABASE_URL: _omit, ...env } = GOOD_ENV;
    expect(checkEnv(env)).not.toEqual([]);
  });

  // Red if the MASTER_ADMIN_EMAIL-vs-seed-emails check in checkEnv is removed.
  it('refuses when MASTER_ADMIN_EMAIL is one of the seed emails', () => {
    expect(checkEnv({ ...GOOD_ENV, MASTER_ADMIN_EMAIL: SEED_EMAILS[0] })).not.toEqual([]);
    expect(checkEnv({ ...GOOD_ENV, MASTER_ADMIN_EMAIL: SEED_EMAILS[0].toUpperCase() })).not.toEqual([]);
    expect(checkEnv({ ...GOOD_ENV, MASTER_ADMIN_EMAIL: 'owner@real-staging-admin.example' })).toEqual([]);
  });

  // Red if checkCompanies stops rejecting slugs outside SEED_SLUGS.
  it('refuses when an unknown company slug is present', () => {
    expect(checkCompanies([...SEED_SLUGS, 'lincoln-unified'])).not.toEqual([]);
    expect(checkCompanies([null])).not.toEqual([]);
  });

  // Red if checkCompanies' exact match is loosened to a startsWith/prefix match.
  it('refuses a startsWith look-alike slug', () => {
    expect(checkCompanies(['staging-alpha-x'])).not.toEqual([]);
    expect(checkCompanies(['staging-'])).not.toEqual([]);
  });

  // Red if checkUsers stops rejecting non-seed, non-master_admin users.
  it('refuses when a non-seed user email is present', () => {
    expect(checkUsers([...seedUserRows, { email: 'parent@real-family.example', role: 'parent' }])).not.toEqual([]);
    expect(checkUsers([{ email: null, role: 'driver' }])).not.toEqual([]);
  });

  // Red if any check above starts refusing a clean staging DB.
  it('allows only seed slugs, seed emails and master_admin', () => {
    expect(checkEnv(GOOD_ENV)).toEqual([]);
    expect(checkCompanies([])).toEqual([]);
    expect(checkCompanies([...SEED_SLUGS])).toEqual([]);
    expect(checkUsers([])).toEqual([]);
    expect(checkUsers([...seedUserRows, { email: 'owner@real-staging-admin.example', role: 'master_admin' }])).toEqual([]);
  });

  // Red if MIN_PASSWORD_LENGTH is lowered: the tests above are relative to the
  // constant, so pin the documented minimum with literal lengths too.
  it('pins the password minimum at 12 characters', () => {
    expect(MIN_PASSWORD_LENGTH).toBe(12);
    expect(checkEnv({ ...GOOD_ENV, STAGING_SEED_PASSWORD: 'x'.repeat(11) })).not.toEqual([]);
    expect(checkEnv({ ...GOOD_ENV, STAGING_SEED_PASSWORD: 'x'.repeat(12) })).toEqual([]);
  });

  // Red if checkCompanies' exact match is loosened to a case-insensitive one.
  it('refuses a case-variant of a seed slug', () => {
    expect(checkCompanies(['STAGING-ALPHA'])).not.toEqual([]);
    expect(checkCompanies(['Staging-Bravo'])).not.toEqual([]);
  });

  // Red if checkUsers exempts any role other than exactly master_admin.
  it('refuses non-seed admin and driver_admin users (only master_admin is exempt)', () => {
    expect(checkUsers([{ email: 'boss@real-district.example', role: 'admin' }])).not.toEqual([]);
    expect(checkUsers([{ email: 'lead@real-district.example', role: 'driver_admin' }])).not.toEqual([]);
    expect(checkUsers([{ email: 'boss@real-district.example', role: 'MASTER_ADMIN' }])).not.toEqual([]);
  });

  // Red if checkEnv stops trimming MASTER_ADMIN_EMAIL before comparing.
  it('refuses a whitespace-padded seed email as MASTER_ADMIN_EMAIL', () => {
    expect(checkEnv({ ...GOOD_ENV, MASTER_ADMIN_EMAIL: `  ${SEED_EMAILS[0]}\n` })).not.toEqual([]);
    expect(checkEnv({ ...GOOD_ENV, MASTER_ADMIN_EMAIL: ` ${SEED_EMAILS[0].toUpperCase()} ` })).not.toEqual([]);
  });

  it('seed emails are all @*.example.invalid and unique', () => {
    expect(new Set(SEED_EMAILS).size).toBe(SEED_EMAILS.length);
    for (const e of SEED_EMAILS) expect(e).toMatch(/^[a-z_]+-\d+@[a-z-]+\.example\.invalid$/);
  });

  // Red if describeDbTarget ever echoes the raw URL or the password.
  it('describes the DB target without the password or raw URL', () => {
    const out = describeDbTarget('postgresql://user:s3cretpass@db.example.com:5432/staging_db');
    expect(out).toContain('db.example.com');
    expect(out).toContain('staging_db');
    expect(out).not.toContain('s3cretpass');
    expect(out).not.toContain('postgresql://');
    expect(describeDbTarget('not a url :: s3cretpass')).not.toContain('s3cretpass');
  });
});
