# School Bus Tracker

School Bus Tracker is a multi-tenant web, iOS and Android app where schools and camps track their buses, drivers check students on and off, and parents see live status. Public site: https://www.schoolbustracker.org

## For developers

A React + Express + Postgres app. Each school or camp is a tenant (a "company"), and users have one of five roles: parent, driver, admin, driver admin and master admin. The iOS and Android apps are Capacitor shells around the same React build.

### Run it locally
1. Prerequisites: Node 20 (`.node-version`; `package.json` `engines` is `20.x`) and Postgres 17.
2. Settings: create a `.env` file in the repo root (gitignored; the server loads it with `dotenv`) and set the variables listed under "Configuration". Locally you need at least `DATABASE_URL` and `PORT=5001` (the server defaults to 5000). `SESSION_SECRET` may be left out only when `NODE_ENV` is `development` or `test`. Never commit real values.
3. Install and create the schema: `npm install`, then `npm run db:push` (applies `shared/schema.ts` through Drizzle Kit; needs `DATABASE_URL`).
4. Start: `npm run dev` → http://localhost:5001. Vite is mounted inside the Express server in dev, so there is one process and one port.
5. Optional, first login: `npx tsx scripts/seed-master-admin.ts` creates a master admin from `MASTER_ADMIN_EMAIL` / `MASTER_ADMIN_PASSWORD` (export them, with `DATABASE_URL`, in your shell).

Production build: `npm run build` (client to `dist/public`, server bundled to `dist/index.js`), then `npm start`.

### Run the tests
- Type-check (this is the lint gate; there is no separate linter): `npm run check`.
- All tests: `npm test` (Vitest, two projects: `unit` and `integration`). The integration tests need Postgres 17 and `TEST_DATABASE_URL` in `.env`, pointing at a local database whose name ends in `_test` (a guard refuses anything else). Locally that Postgres runs on port 5433.
- Unit tests only, no database: `npm run test:unit`.
- One file: `npx vitest run tests/auth-validation.test.ts`. By name: `npx vitest run -t "pattern"`. Also `npm run test:watch` and `npm run test:coverage`.
- CI (`.github/workflows/ci.yml`) runs on every push and pull request to `main`, `staging` and `production`: `npm ci`, `npm run check`, `npm run build`, then `npm test` against a Postgres 17 service.

### Folder layout
| Folder | What's in it |
|---|---|
| `client/src/` | React SPA built with Vite. `pages/` (one file per page, flat), `components/` split by role (`admin/`, `driver/`, `parent/`, `shared/`, `ui/`), `hooks/`, `lib/`. |
| `server/` | Express API in TypeScript. `routes.ts` (the HTTP handlers), `storage.ts` (all database access), `tenant.ts` (tenant and role helpers), `customAuth.ts` (email/password sessions), `app.ts` (middleware, CORS, `/healthz`). |
| `shared/` | `schema.ts`: the Drizzle tables and Zod validation, shared by server and client. |
| `tests/` | Vitest tests; `tests/integration/` holds the HTTP-level tests that need a test database. |
| `scripts/` | One-off scripts: seed a master admin, seed Stripe products, seed staging (synthetic data), native setup. |
| `ios/`, `android/` | Capacitor native projects. |
| `fastlane/` | iOS (TestFlight) and Android (Play) release lanes. |
| `docs/` | `perf-security-checklist.md`, the merge checklist. |
| `plans/` | Design plans for larger changes. |

Path aliases: `@/*` → `client/src/*`, `@shared/*` → `shared/*`.

### Configuration (names only, never values)
| Variable | What it's for | Where it's set |
|---|---|---|
| `DATABASE_URL` | Postgres connection for the app and `db:push` | Railway dashboard / local `.env` |
| `TEST_DATABASE_URL` | Postgres used by the integration tests (local `*_test` database only) | local `.env` / CI |
| `SESSION_SECRET` | Signs the session cookie; required unless `NODE_ENV` is `development` or `test` | Railway dashboard / local `.env` |
| `NODE_ENV` | `production` on Railway (secure cross-site cookie for the iOS app) | Railway dashboard (the npm scripts set it locally) |
| `APP_URL` | Base URL used in links the app sends (e.g. invites) | Railway dashboard / local `.env` |
| `PORT` | HTTP port (defaults to 5000; 5001 locally) | Railway / local `.env` |
| `STRIPE_SECRET_KEY`, `STRIPE_PUBLISHABLE_KEY`, `VITE_STRIPE_PUBLISHABLE_KEY` | Stripe billing (test-mode keys outside production) | Railway dashboard / local `.env` |
| `STRIPE_WEBHOOK_SECRET` | Verifies Stripe webhook signatures | Railway dashboard / local `.env` |
| `RESEND_API_KEY`, `RESEND_FROM_EMAIL` | Outgoing email; unset = email off (sends fail softly and are logged) | Railway dashboard / local `.env` |
| `SIGNUP_NOTIFY_EMAIL` | Who receives the "new business signed up" email; unset = nothing is sent and a warning is logged | Railway dashboard / local `.env` |
| `FIREBASE_SERVICE_ACCOUNT` | Push notifications for Android and web (Firebase Cloud Messaging) | Railway dashboard |
| `APNS_KEY_ID`, `APNS_TEAM_ID`, `APNS_PRIVATE_KEY`, `APNS_BUNDLE_ID` | Push notifications (iOS / APNs) | Railway dashboard |
| `MASTER_ADMIN_EMAIL`, `MASTER_ADMIN_PASSWORD` | The master admin login created by `scripts/seed-master-admin.ts` | Railway dashboard / your shell |
| `STAGING_SEED_PASSWORD` | Password for the synthetic staging seed logins (`scripts/seed-staging.ts`) | staging only, your shell |
| `VITE_API_BASE_URL` | Build-time API base for the native apps (unset = the production site). Store builds refuse to run if it is set. | plain terminal, build time only |
| `PRODUCTION_SERVER_URL` | Rollback switch in `capacitor.config.ts`: makes the native app load a remote site instead of its bundle. Normally unset. | plain terminal, build time only |
| `ASC_KEY_ID`, `ASC_ISSUER_ID`, `ASC_KEY_FILEPATH` | App Store Connect API key for `fastlane ios beta` (template: `fastlane/.env.example`) | plain terminal |
| `PLAY_STORE_JSON_KEY` | Play service-account key for `fastlane android beta` (release signing comes from the gitignored `android/keystore.properties`) | plain terminal |

### How deploys work
- Hosted on Railway. Each environment deploys from its own branch:
  - pushing `main` deploys nothing;
  - pushing `staging` deploys staging, which has its own database with synthetic seed data only (never production data);
  - pushing `production` deploys the live site.
- Promotion is fast-forward only: `main` → `staging` → `production`, so production is always exactly a commit that already ran on staging. No force pushes.
- A deploy is gated by CI and by Railway's health check, `GET /healthz` (pings the database; returns `{"ok":true}` when healthy).
- If a deploy fails, read its deploy log in the Railway dashboard, then redeploy the previous deployment.
- The iOS and Android apps bundle their own copy of the web app, so a web deploy does not change them. They ship separately through fastlane (`fastlane ios beta` → TestFlight, `fastlane android beta` → Play). Run `npm run build && npx cap sync <platform>` first.
