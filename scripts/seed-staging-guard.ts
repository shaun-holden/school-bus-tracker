// Pure safety checks for scripts/seed-staging.ts. ZERO imports on purpose:
// tests/seed-staging-guard.test.ts imports this file directly, and nothing
// here may touch the environment, the network or the database.
//
// The seed must be impossible to run against production by accident. Every
// check below is required; seed-staging.ts runs them all before any write,
// and re-runs the DB checks inside its transaction after locking `companies`.

// Exact slugs the seed owns. Compared by exact match only, never startsWith,
// so a look-alike such as "staging-alpha-x" is treated as foreign.
export const SEED_SLUGS = [
  'staging-alpha',
  'staging-bravo',
  'staging-pending',
  'staging-suspended',
] as const;

export type SeedSlug = (typeof SEED_SLUGS)[number];

export const MIN_PASSWORD_LENGTH = 12;

export const NO_COMPANY_DOMAIN = 'no-company';

export function seedEmail(role: string, n: number, slug: string): string {
  return `${role}-${n}@${slug}.example.invalid`;
}

// Every login the seed creates: [email, role, slug or null]. Single source of
// truth for both the seed and the users guard.
export const SEED_USERS: ReadonlyArray<{
  email: string;
  role: 'admin' | 'driver_admin' | 'driver' | 'parent';
  slug: SeedSlug | null;
  isActive: boolean;
}> = [
  ...(['staging-alpha', 'staging-bravo'] as const).flatMap((slug) => [
    { email: seedEmail('admin', 1, slug), role: 'admin' as const, slug, isActive: true },
    { email: seedEmail('driver_admin', 1, slug), role: 'driver_admin' as const, slug, isActive: true },
    { email: seedEmail('driver', 1, slug), role: 'driver' as const, slug, isActive: true },
    { email: seedEmail('driver', 2, slug), role: 'driver' as const, slug, isActive: false },
    { email: seedEmail('parent', 1, slug), role: 'parent' as const, slug, isActive: true },
    { email: seedEmail('parent', 2, slug), role: 'parent' as const, slug, isActive: true },
  ]),
  { email: seedEmail('admin', 1, 'staging-pending'), role: 'admin', slug: 'staging-pending', isActive: true },
  { email: seedEmail('admin', 1, 'staging-suspended'), role: 'admin', slug: 'staging-suspended', isActive: true },
  { email: seedEmail('driver', 1, 'staging-suspended'), role: 'driver', slug: 'staging-suspended', isActive: true },
  { email: seedEmail('parent', 1, NO_COMPANY_DOMAIN), role: 'parent', slug: null, isActive: true },
];

export const SEED_EMAILS: ReadonlyArray<string> = SEED_USERS.map((u) => u.email);

type Env = Record<string, string | undefined>;

/** Environment checks. Returns a list of problems; empty means OK. */
export function checkEnv(env: Env): string[] {
  const problems: string[] = [];
  if (env.SEED_TARGET !== 'staging') {
    problems.push("SEED_TARGET must be exactly 'staging'.");
  }
  const password = env.STAGING_SEED_PASSWORD;
  if (!password || password.length < MIN_PASSWORD_LENGTH) {
    problems.push(`STAGING_SEED_PASSWORD must be set and at least ${MIN_PASSWORD_LENGTH} characters.`);
  }
  if (!env.DATABASE_URL) {
    problems.push('DATABASE_URL must be set (in this terminal only, never from .env).');
  }
  const masterEmail = env.MASTER_ADMIN_EMAIL?.trim().toLowerCase();
  if (masterEmail && SEED_EMAILS.includes(masterEmail)) {
    problems.push('MASTER_ADMIN_EMAIL must not be one of the seed emails.');
  }
  return problems;
}

/** Companies check: every existing slug must be one of SEED_SLUGS, exactly. */
export function checkCompanies(slugs: ReadonlyArray<string | null>): string[] {
  const allowed: ReadonlyArray<string> = SEED_SLUGS;
  const foreign = slugs.filter((s) => s === null || !allowed.includes(s));
  if (foreign.length === 0) return [];
  return [
    `The database has ${foreign.length} company row(s) that are not seed companies. ` +
      'This may be production, or a staging DB someone added a company to. ' +
      'Reset the staging DB instead (see STAGING.md). Never relax this check.',
  ];
}

/** Users check: every user must be a seed email or a master_admin. */
export function checkUsers(rows: ReadonlyArray<{ email: string | null; role: string }>): string[] {
  const foreign = rows.filter(
    (r) => r.role !== 'master_admin' && (r.email === null || !SEED_EMAILS.includes(r.email)),
  );
  if (foreign.length === 0) return [];
  return [
    `The database has ${foreign.length} user row(s) that are neither seed users nor master_admin. ` +
      'Refusing to touch it. Reset the staging DB instead (see STAGING.md).',
  ];
}

/** Host and DB name only. Never the raw URL, never the password. */
export function describeDbTarget(databaseUrl: string): string {
  try {
    const url = new URL(databaseUrl);
    const name = url.pathname.replace(/^\//, '') || '(none)';
    return `Target database: host=${url.hostname || '(none)'} name=${name}`;
  } catch {
    return 'Target database: (DATABASE_URL could not be parsed; not shown)';
  }
}
