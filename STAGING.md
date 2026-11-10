# Staging

Staging is a full copy of the app on Railway with its **own** Postgres, filled only with **synthetic** data from `scripts/seed-staging.ts`. It is never a copy of production: production holds children's names, home stops and live locations.

> **Service names.** Staging's database service is **`Postgres-cKuC`**. **`Postgres`** is production's. Every staging command below uses `--service Postgres-cKuC`, and the staging app's variable reference is `${{Postgres-cKuC.DATABASE_URL}}`. If a command doesn't name `Postgres-cKuC`, don't run it against staging.

- **Staging URL:** `<staging URL>` (DeShaun fills this in)
- **Branch:** `staging`. Promotion and the environments table are in `CLAUDE.md` → "Environments".

## Railway dashboard settings

Railway settings live in the dashboard only. There is no `railway.json` and no `.railway/railway.ts` (DeShaun, 2026-11-10).

| Setting | Production | Staging |
|---|---|---|
| Trigger branch | `production` | `staging` |
| Wait for CI | ON | ON |
| GitHub ruleset on the branch | no deletion, no force push, requires check `ci` | same |
| Builder | Railpack | Railpack |
| `RAILPACK_NODE_VERSION` | `20` | `20` |
| Build command | blank (Railpack runs `npm run build`) | blank |
| Start command | `npm start` | `npm start` |
| Health check path / timeout | `/healthz` / 300 | `/healthz` / 300 |
| Restart policy | On Failure, max retries 3 | On Failure, max retries 3 |
| DB service (Postgres 17) | `Postgres` | `Postgres-cKuC` |
| `DATABASE_URL` | `${{Postgres.DATABASE_URL}}` | `${{Postgres-cKuC.DATABASE_URL}}` |

**Production cutover:** production's builder, start command and health check get switched in the dashboard when Q16 (the `railway.json` / `nixpacks.toml` removal) reaches production. That must happen before **2026-12-01**, when Railway stops reading `railway.json`.

### Variables (names only; values are set in the Railway dashboard, never in a Claude window)

| Variable | Production | Staging |
|---|---|---|
| `NODE_ENV` | `production` | `production`. Required: the session cookie is only `Secure; SameSite=None` in production mode, and the iOS app needs that. |
| `DATABASE_URL` | reference to `Postgres` | reference to `Postgres-cKuC` |
| `SESSION_SECRET` | production secret | a **different**, staging-only value |
| `APP_URL` | `https://www.schoolbustracker.org` | the staging URL, so invite links point at staging |
| `MASTER_ADMIN_EMAIL`, `MASTER_ADMIN_PASSWORD` | production login | a staging-only login. Must not be one of the seed emails; the seed refuses if it is. |
| `STRIPE_SECRET_KEY`, `STRIPE_PUBLISHABLE_KEY`, `VITE_STRIPE_PUBLISHABLE_KEY`, `STRIPE_WEBHOOK_SECRET` | live keys | **test-mode** keys, plus a test-mode webhook endpoint at `<staging URL>/api/stripe/webhook` |
| `RESEND_API_KEY`, `RESEND_FROM_EMAIL` | set | **unset** (email off: sends fail softly and are logged) |
| `APNS_KEY_ID`, `APNS_TEAM_ID`, `APNS_PRIVATE_KEY`, `APNS_BUNDLE_ID`, `FIREBASE_SERVICE_ACCOUNT`, `VITE_FIREBASE_*` | set | **unset** (push off) |
| `PRODUCTION_SERVER_URL`, `REPL_ID` | unset | unset |

**On staging, Stripe is in test mode, and email and push are off.** No real person gets mail or a push from staging.

## Apply the schema and (re)seed

Do this in a **plain terminal**, never in a Claude window, and never via the `!` prefix: that records into the session transcript. Set ONLY the staging database address, and only in that terminal.

```sh
railway link            # pick the School Bus project, environment: staging
railway status          # must say environment: staging

# 1. Check the host FIRST. It must be the STAGING Postgres host.
railway run --service Postgres-cKuC sh -c 'node -e "console.log(new URL(process.env.DATABASE_PUBLIC_URL).host)"'

# 2. Apply the schema.
railway run --service Postgres-cKuC sh -c 'DATABASE_URL="$DATABASE_PUBLIC_URL" npm run db:push'

# 3. Read the staging-only seed password without echoing it (keeps it out of shell history).
read -rs STAGING_SEED_PASSWORD && export STAGING_SEED_PASSWORD

# 4. Seed (re-runnable; every row is upserted).
railway run --service Postgres-cKuC sh -c 'DATABASE_URL="$DATABASE_PUBLIC_URL" SEED_TARGET=staging npx tsx scripts/seed-staging.ts'
```

The app's own `DATABASE_URL` is Railway's internal address, which only works inside Railway, so these commands use the staging Postgres's public address. The generic host check is `node -e 'console.log(new URL(process.env.DATABASE_URL).host)'` once `DATABASE_URL` is set.

### What the seed refuses
It exits 1 and writes nothing if any of these fail:
- `SEED_TARGET` is not exactly `staging`;
- `STAGING_SEED_PASSWORD` is shorter than 12 characters;
- `DATABASE_URL` is unset;
- `MASTER_ADMIN_EMAIL` is a seed email;
- the DB has any company whose slug isn't exactly `staging-alpha`, `staging-bravo`, `staging-pending` or `staging-suspended`;
- the DB has any user that isn't a seed user or a `master_admin`.

The seed never reads `.env`. It prints only the DB host and name, never the URL or the password. All writes happen in one transaction that locks `companies` and re-checks first.

**If the seed refuses because of a non-seed company on staging** (e.g. someone tested business signup), reset the staging DB (drop and recreate the schema in Railway, then `npm run db:push`) and reseed. **Never relax the guard.** If it refuses and you are not sure you're on staging, stop: you may be pointed at production.

## Seeded logins

All share the password you entered as `STAGING_SEED_PASSWORD`. It isn't stored anywhere in the repo. The master admin is not seeded here: it comes from `MASTER_ADMIN_EMAIL` / `MASTER_ADMIN_PASSWORD` on boot.

| Email | Role | Company | Notes |
|---|---|---|---|
| `admin-1@staging-alpha.example.invalid` | admin | A, Staging Alpha (America/New_York) | |
| `driver_admin-1@staging-alpha.example.invalid` | driver_admin | A | drives route A2 / bus A-02 |
| `driver-1@staging-alpha.example.invalid` | driver | A | drives route A1 / bus A-01 |
| `driver-2@staging-alpha.example.invalid` | driver | A | **inactive** |
| `parent-1@staging-alpha.example.invalid` | parent | A | direct parent of all 3 students |
| `parent-2@staging-alpha.example.invalid` | parent | A | linked to 1 student ONLY via a parent-child link |
| `admin-1@staging-bravo.example.invalid` | admin | B, Staging Bravo (America/Los_Angeles) | |
| `driver_admin-1@staging-bravo.example.invalid` | driver_admin | B | drives route B2 / bus B-02 |
| `driver-1@staging-bravo.example.invalid` | driver | B | drives route B1 / bus B-01 |
| `driver-2@staging-bravo.example.invalid` | driver | B | **inactive** |
| `parent-1@staging-bravo.example.invalid` | parent | B | direct parent of all 3 students |
| `parent-2@staging-bravo.example.invalid` | parent | B | linked to 1 student ONLY via a parent-child link |
| `admin-1@staging-pending.example.invalid` | admin | C, pending approval | should land on the pending page |
| `admin-1@staging-suspended.example.invalid` | admin | D, suspended | should be logged out / blocked |
| `driver-1@staging-suspended.example.invalid` | driver | D, suspended | should be logged out / blocked |
| `parent-1@no-company.example.invalid` | parent | none | company-less parent, no links |

Districts A and B each also get:
- 1 school;
- 2 routes with 3 stops each;
- 2 buses (`A-01`/`A-02`, `B-01`/`B-02`);
- 3 students;
- 1 active link code (`STA-000001` / `STB-000001`, valid 365 days). Each reseed resets it to active and 0 uses.

## Point the iOS app at staging

In a plain terminal:

```sh
VITE_API_BASE_URL=<staging URL> npm run build && npx cap sync ios
```

Then open `ios/App/App.xcworkspace` in Xcode and run on a device. Log in with a seeded login above.

## Point the iOS app back at production

Rebuild without the variable, which falls back to `https://www.schoolbustracker.org`:

```sh
npm run build && npx cap sync ios
```

Check first that `VITE_API_BASE_URL` isn't still exported in that terminal (`echo $VITE_API_BASE_URL` prints nothing) and isn't in a local `.env`. Then run from Xcode again. Never ship a TestFlight or App Store build made while pointed at staging.
