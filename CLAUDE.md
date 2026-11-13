# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Commands

Run from the repo root.

- `npm run dev` — start the dev server (`tsx server/index.ts`, `NODE_ENV=development`). Vite is mounted by the Express server in dev.
- `npm run build` — production build: `vite build` emits the client to `dist/public`, then `esbuild` bundles the server to `dist/index.js`.
- `npm start` — run the built server. Requires a prior `npm run build`.
- `npm run check` — TypeScript check (`tsc --noEmit`). There is no separate lint step; type-check is the gate.
- `npm test` — run the full vitest suite. CI (`.github/workflows/ci.yml`, workflow `CI`, job `ci`) runs on every push and pull request to `main`, `staging` and `production`: `npm ci`, `npm run check`, `npm run build`, then `npm test` against a `postgres:17` service (`TEST_DATABASE_URL` → `sbt_ci_test`). A newer push to the same ref cancels the running job. Locally `npm test` needs Postgres 17 on port 5433 and `TEST_DATABASE_URL` (a local `*_test` DB) in `.env`; `npm run test:unit` runs without a DB.
- `npm run test:watch`, `npm run test:coverage` — same runner, different modes.
- `npm run db:push` — apply `shared/schema.ts` to Postgres via Drizzle Kit (requires `DATABASE_URL`).

Run a single test file: `npx vitest run tests/auth-validation.test.ts`
Filter by name: `npx vitest run -t "pattern"`

One-off scripts live in `scripts/`: `seed-master-admin.ts`, `seed-stripe-products.ts`, and `setup-native.sh` for local Capacitor setup.

Deployed on Railway. Build and deploy settings live in the Railway dashboard (Config as Code / `railway.json` was retired before Railway's 2026-12-01 cutoff). Builder: Railpack, Node pinned to 20 via `package.json` `engines` and `.node-version`. Health check: `GET /healthz` (DB ping).

## Environments

| Env | Branch | URL | Data | Deploys when |
|---|---|---|---|---|
| Local | dev branches / `main` | localhost:5001 | local Postgres | – |
| **Staging** | `staging` | https://school-bus-tracker-staging.up.railway.app (see `STAGING.md`) | its own Postgres (`Postgres-cKuC`), **synthetic seed only** | push to `staging`, CI-gated |
| **Production** | `production` | https://www.schoolbustracker.org | live (`Postgres`) | push to `production`, CI-gated |

- **Pushing `main` deploys nothing.** (Target model: takes effect when DeShaun switches production to the `production` branch, staging-plan S5.)
- **Promotion** (SHELL, each step needs DeShaun's OK; fast-forward only, so production is always a commit that already ran on staging):
  1. `git fetch origin && git merge-base --is-ancestor origin/staging main && git push origin main:staging`
  2. Verify on staging (web, plus the iOS app pointed at staging when auth, cookies or CORS changed).
  3. `git push origin origin/staging:production` (exactly the commit that ran on staging).
- Never `--force`, never a `+` refspec, never `git push --all` (it would fire both environments).
- **Staging data is synthetic only** (`scripts/seed-staging.ts`); never copy production data to staging. How to reseed, the Railway dashboard settings and the seeded logins are in `STAGING.md`.

## Architecture

**Layout.** Server in `server/` (Express + TypeScript), client in `client/src/` (React SPA built with Vite), shared Drizzle schema and Zod validation in `shared/schema.ts`, Postgres via `pg.Pool` + `drizzle-orm/node-postgres` (`server/db.ts`). Path aliases: `@/*` → `client/src/*`, `@shared/*` → `shared/*`.

**Big central files.** `server/routes.ts` (5200+ lines, 120+ handlers) and `server/storage.ts` (2800+ lines, one `DatabaseStorage` class implementing `IStorage`). When adding a feature, the pattern is: new handler in `routes.ts`, new method on `IStorage` + `DatabaseStorage`. There is no per-domain file split yet — splitting would be a multi-hour refactor worth its own PR. `shared/schema.ts` (~30 tables) is the single source of truth for DB shape and client-side Zod validation.

**Multi-tenant model.** Nearly every table carries `companyId` referencing `companies`. A "company" is a tenant (school district, camp, etc.). Two helpers in `server/tenant.ts` (pure, no imports; `routes.ts` imports them, along with `isOutsideCallerTenant`, `hasId` and the role helpers) are load-bearing:

- `isMasterAdminUser(user)` — true for `role === 'master_admin'` or `user._masterAdminImpersonating === true`. **Power checks only** (master-only actions, role rules); never use it to skip a `companyId` comparison.
- `isUnscopedMaster(user)` — true only for a master admin who is NOT impersonating. This is the tenant-bypass helper.
- `companyScope(user)` — returns `undefined` only for a non-impersonating master (no filter; an impersonating master gets the impersonated `companyId`), the string `companyId` for a normal admin, or `null` if the user has no company (caller must short-circuit with `[]`).

**Enforcement patterns.** Every mutating handler for a tenant-scoped entity follows one of two shapes:

- *Record-by-id* (PATCH / PUT / DELETE): fetch the record, 404 if missing, 404 if `!isUnscopedMaster(user) && record.companyId !== user.companyId` or `isOutsideCallerTenant(user, record.companyId)` (masks existence — do not leak "exists but forbidden").
- *Creates* (POST): after `zodSchema.parse(req.body)`, force `validatedData.companyId = user.companyId ?? null`. Never trust a `companyId` from the body.
- *List reads* (GET collections): `const scope = companyScope(user); if (scope === null) return res.json([]); const rows = await storage.getAllX(scope);`. The `getAll*` methods take an optional `companyId` filter.

Master admin can impersonate a tenant via `POST /api/master-admin/impersonate/:companyId`. Impersonation means acting as that school: an impersonating master is scoped to the impersonated company (sees only its rows, creates land in it, other companies' records are 404). The overlay middleware in `routes.ts` rewrites `req.user.companyId` and sets `_masterAdminImpersonating: true` from `req.session.impersonatedCompanyId`; handlers that re-fetch the caller must use `getCaller(req)` (routes.ts), never `storage.getUser(req.user.id)`, because the fresh DB row drops the overlay. Never pass a `getCaller` result to a `storage.update*` call — the master's own row keeps `companyId` null. For tenant decisions use `isUnscopedMaster(user)` (true only for a master who is NOT impersonating; `companyScope` and `isOutsideCallerTenant` use it). `isMasterAdminUser(user)` still means "has master powers" (impersonating or not) and is for power checks only, never for skipping a `companyId` comparison. A master admin has no messaging (`canAccessMessaging`) except while impersonating, and can never redeem a link code.

**Roles.** `parent`, `driver`, `admin`, `driver_admin`, `master_admin`. Helpers in `server/tenant.ts`: `isAdminRole`, `isDriverRole`, `isParentRole`, `canAccessMessaging`, plus `isMasterAdminUser`.

**Name collision to avoid.** `registerRoutes` declares a middleware `const isMasterAdmin = (req, res, next) => ...` around line 5012 (for master-admin-only routes). That `const` shadows any module-level function of the same name for the entire `registerRoutes` scope. That's why the boolean helper is `isMasterAdminUser`, not `isMasterAdmin`. Do not reintroduce the collision by renaming it back.

**Client.** Wouter for routing. Role-based dashboards (`/admin`, `/driver`, `/parent`, `/` for master admin). `client/src/pages/` is flat, `components/` is split by role (`admin/`, `driver/`, `parent/`, `shared/`, `ui/`). Server state via TanStack Query (`client/src/lib/queryClient.ts`). Auth state via `useAuth()` in `client/src/hooks/use-auth.ts` — `logout` calls `queryClient.clear()` to wipe per-user caches. Forms use React Hook Form + Zod schemas imported from `shared/schema.ts`.

**Auth.** Custom email/password in `server/customAuth.ts` with bcryptjs hashing and Passport local strategy, sessions stored in Postgres via `connect-pg-simple`. Session cookie is `httpOnly`, `secure` in production, and `sameSite` is conditional: `'none'` in production (required for the iOS Capacitor bundle's cross-origin requests in Phase B), `'lax'` otherwise. See `plans/offline-readiness-fix-phase-a.md` for the migration history. `SESSION_SECRET` is required unless `NODE_ENV` is explicitly `development` or `test` — the startup throws otherwise. Rate limiters (`authLimiter`, `registerLimiter`) are exported for reuse.

**Billing.** Three Stripe plans (Starter/Professional/Enterprise). Feature flags live on the `companies` row (e.g., `parentPortalEnabled`); plan-based user caps are enforced by `storage.canCreateUser(companyId, role)`. Webhooks land in `server/webhookHandlers.ts` and use the stock Stripe SDK for signature verification (the old `stripe-replit-sync` dependency has been removed).

**Push notifications.** `server/pushService.ts` plus `client/src/hooks/use-web-push.ts` and `@capacitor/push-notifications`. Device tokens persist in the `deviceTokens` table, one row per (user, token, platform): `POST /api/device-tokens` (`registerDeviceTokenSchema`, masters refused) moves a phone's token to the user now logged in on it and caps each user at 10 active tokens; `DELETE /api/device-tokens` only turns off the caller's own token. On logout the server turns off **this phone's** token (the app sends it as `deviceToken`) and the caller's web tokens, never the user's other phones and never another user's rows. The sender turns off a dead token by row id (`deactivateDeviceTokenById`).

**Parent-child linking.** Admins generate codes like `TNT-483921` via `/api/link-codes`. Parents redeem at `/api/link-child`. The relationship is many-to-many through `parentChildLinks`. For parent-facing reads of a parent's kids, use `storage.getLinkedStudentsByParentId(userId)`, **not** `getStudentsByParentId(userId)` — the latter only returns students where `students.parentId === userId` (the single-parent shortcut) and misses the link-code flow.

**Capacitor / iOS.** The iOS app serves the bundled React build (`dist/public`) from `capacitor://localhost` in a WKWebView; the API stays on `https://www.schoolbustracker.org`, so **every API call is cross-origin**. This is handled by the Phase A CORS allowlist (`ALLOWED_ORIGINS` in `server/origins.ts`) plus the `SameSite=None; Secure` production session cookie (`server/customAuth.ts`). The `PRODUCTION_SERVER_URL` env var in `capacitor.config.ts` is the code-free rollback escape hatch: set it to resurrect the old behavior where the WKWebView loads the remote site directly (same-origin, no CORS). App id `com.TopNotchTrainingCenter.SchoolBusTracker`. Plugins: PushNotifications, Geolocation, StatusBar, Keyboard, Haptics. `capacitor.config.ts` controls this. Any server change that alters cookie policy or auth redirects should be tested in the iOS app, not just the browser.

**Cross-origin readiness (Phase A, shipped 2026-05-17).** Server has CORS middleware (`cors` npm package) in the `createApp()` middleware chain in `server/app.ts`, registered between the Stripe webhook raw-body handler and `app.use(express.json())`. Allowlist is exported as `ALLOWED_ORIGINS` and includes `capacitor://localhost`, `ionic://localhost`, `http://localhost`, `https://www.schoolbustracker.org`, and `https://schoolbustracker.org`. Disallowed origins receive a clean 403 via `callback(null, false)` — no 500s in logs from rejected origins. The middleware is inert for same-origin web traffic (browser doesn't trigger preflights). Allowlist is regression-tested in `tests/cors.test.ts`.

Client has an `apiUrl(path)` helper at `client/src/lib/apiBase.ts`. It returns the path unchanged on web (no-op for same-origin) and prepends `import.meta.env.VITE_API_BASE_URL` (or falls back to `https://www.schoolbustracker.org`) when `Capacitor.isNativePlatform()` is true. All `fetch('/api/...')` call sites in the client are wrapped: `queryClient.ts` (default fetcher), `App.tsx` (role PATCH), `pages/admin-dashboard.tsx` (6 sites), `pages/driver-password-setup.tsx`. The wrap is also a no-op for web because `getApiBase()` returns an empty string.

A passive `<OfflineBanner />` component at `client/src/components/shared/OfflineBanner.tsx` mounts inside `TooltipProvider` near the global `<Toaster />`. Listens to `window` `'online'`/`'offline'` events. Shows only when offline; refetch on reconnect is handled automatically by React Query's `refetchOnWindowFocus` default — no manual `invalidateQueries`.

## Pitfalls learnt the hard way

- **N+1 enrichment.** Student-enrichment endpoints batch-load related records via `getSchoolsByIds` / `getRoutesByIds` / `getRouteStopsByIds` / `getBusesByRouteIds`. Sites 2/3/4 share an `enrichStudentsWithSchoolAndRoute` helper. Don't reintroduce `Promise.all(students.map(async s => await storage.getX(...)))` loops — they turn into dozens of serial queries.
- **Day-boundary queries.** `storage.getAttendanceByDate(dateString, companyId?, timezone?)` uses Postgres `AT TIME ZONE` with the caller's `company.timezone`. Don't use `setHours(0,0,0,0)` for date windows — it evaluates in server-local time, which is UTC on Railway, so any non-UTC tenant gets the wrong day. The full day-boundary family is now migrated to this pattern: the `getTodays*` attendance methods, `markStudentAttendance`, the bus-journey methods, and the `studentCheckIns` (Bluetooth boarding) methods (`enableStudentCheckIn`, `disableStudentCheckIn`, `getActiveCheckInsForRoute`, `getCheckInStatus`, `getTodayCheckInsForParent`, `getTodayCheckInsForStudents`) all take a `timezone` param and compare `(col AT TIME ZONE ${tz})::date = ${dateString}::date`. Callers derive `tz` from `company?.timezone || 'UTC'`. Any new day-scoped query must follow the same shape — never reintroduce `setHours`/`DATE()` on plain timestamps.
- **Duty toggle idempotency.** `PATCH /api/driver/duty-status` no-ops when the requested `isOnDuty` matches the current state. This protects against a rapid double-tap overwriting `dutyStartTime` or firing the off-transition cleanup twice. Preserve the guard.
- **Geolocation on the driver dashboard.** Uses `@capacitor/geolocation` (CoreLocation on iOS, FusedLocationProvider on Android, `navigator.geolocation` on web). A `permissionDeniedRef` short-circuits the 30s polling loop once the driver denies permission — OS/browsers cache the denial and won't re-prompt, so retrying wastes battery. The driver must toggle duty off/on (or change device settings) to re-arm. Errors surface as a toast plus inline red-bordered message; don't swallow them silently. Match both W3C `.code` (1/2/3) and the native `Error.message` strings ("denied", "unavailable", "timeout") when categorizing failures — Capacitor exposes both shapes depending on platform.
- **Cross-tenant IDs in request bodies.** When a handler takes a foreign-key id from the request (studentId, routeId, driverId, etc.), fetch the referenced record and check its `companyId` before acting. Storage methods take raw ids and do not tenant-scope internally.

## Tests

Vitest, configured in `vitest.config.ts`. Tests live in `tests/` (not colocated). Suite covers schema validation, role/tenant access, plan limits, bus-status transitions, driver and parent features, input validation, and auth. Coverage is shallow relative to the handler count — roughly 10%. When you add tenant-sensitive logic, add an HTTP-level test under `tests/integration/` whose title names the guard clause whose deletion turns it red, with the foreign row seeded so it is reachable (checklist X-1/X-2).

**Perf & security checklist.** `docs/perf-security-checklist.md` is the merge checklist (OWASP / CWE-sourced, IDs T/S/P/M/X).
- Every new or changed tenant query path needs a cross-tenant test that names the clause whose deletion turns it red (section X).
- The `reviewer` agent grades every diff against it before merge; any critical/high FAIL blocks the merge.

## Tooling

**Project-scoped Claude Code subagents.** Four agents live in `.claude/agents/`:
- `planner` — produces file-level plans in `plans/*.md` before any builder runs. Never writes code.
- `react-builder` — implements approved plans for client/ files.
- `express-api` — implements approved plans for server/ files.
- `reviewer` — reads diffs before commit; flags critical/important/suggestions. Never writes code.
- `tester` — writes/runs the Vitest suite (company isolation, role access, plan caps, validation). Never writes app code.

The intended flow for any non-trivial change: planner → human review of plan → builder → reviewer → human review of findings → commit → verify on Railway. See `LEARNINGS.md` for the discipline that makes this work and the specific failure modes to avoid (especially: never `cd` between codebases in the same terminal, always verify `pwd` before any session, never `git add -A` or `.`).

### Six-window workflow (COACH 🧭 / DEV-1 🔨1 / DEV-2 🔨2 / SHELL 🐚 / HUB / READER 📖 optional)
DeShaun runs up to six Claude windows. Talk to **COACH** in plain English; COACH writes brief files and says which window reads which. Each dev works in its OWN git worktree, so SHELL can test, merge and ship without touching files a dev is editing.
**Every window reads `~/Projects/school-bus-tracker/team-rules.md` first** (untracked; the full team rules: status lines, locks, queues, pausing, stamps, risky steps). The list below is the short version for anyone reading CLAUDE.md.

| Window | Folder | Branch | Does |
|---|---|---|---|
| **COACH** | `~/Projects/school-bus-tracker` | (reads only) | Plans, splits work so the two devs never touch the same files at once, writes briefs. Never writes application code, never runs git writes. Role file: `~/Projects/school-bus-tracker/coach-prompt.md`. |
| **DEV-1** | `~/Projects/school-bus-tracker-dev1` | `dev1/work` | Writes application code and **commits on its own branch only**. Role file: `~/Projects/school-bus-tracker/dev1-prompt.md`. |
| **DEV-2** | `~/Projects/school-bus-tracker-dev2` | `dev2/work` | Same as DEV-1, in its own folder and branch. Role file: `~/Projects/school-bus-tracker/dev2-prompt.md`. |
| **SHELL** | `~/Projects/school-bus-tracker` | `main` | Ops only: tests and reviews IN the dev folder, merges one dev branch at a time into `main`, pushes, ships. Never edits application code. Role file: `~/Projects/school-bus-tracker/shell-prompt.md`. |
| **HUB** | `~/Projects/school-bus-tracker` | (reads only) | Watches and reports on all windows (status, stuck windows, what's next for DeShaun) and answers questions. New briefs and order changes go to COACH. Never edits, never runs git writes, builds or tests, never assigns work. |
| **READER** (optional) | `~/Projects/school-bus-tracker` | (reads only) | Read-only code lookups and brief pre-reads for COACH (COACH may message it directly). May write only its untracked `reader-<topic>.md` answers and `reader-log.md`. No git writes, builds, tests or locks; never assigns work. |

Rules (non-negotiable):
- Only **DEV-1/DEV-2** edit application code, each only inside its own folder. A fix spotted by COACH, SHELL, HUB or READER goes back to a dev.
- **Devs** may run git ONLY to `merge --no-edit main` into their branch and to commit on it. They never push, never merge into `main`, never switch branches, never `checkout`/`stash`/`reset`. **SHELL** does every other git operation.
- Briefs, reports, role files (`*-prompt.md`), `BACKLOG.local.md`, `QUEUE.local.md`, `locks/` and `dispatch/` are untracked and live ONLY in the main folder. Always refer to them by full path (`~/Projects/school-bus-tracker/<file>`).
- A dev commits BEFORE reporting done, and stays idle while SHELL tests its folder.
- SHELL merges ONE branch at a time, only after the build, the full test suite and the review pass. After each merge, the other dev runs `git merge --no-edit main` before its next task.
- **Queuing + locks:** DeShaun may queue a paste into a busy window; it starts only if that window's last task ended ✅. Windows working in a dev folder hold a lock via `~/Projects/school-bus-tracker/team-lock.sh take|refresh|release`, and a queued task first runs `team-lock.sh wait` in the background (2 clear checks in a row; gives up after 60 min, or 4 h while the other side holds a fresh lock). A lock not refreshed for 3 h is reported as stale, never deleted. SHELL releases only after every test mutation is restored and the folder is clean. A window that stops with ❓ keeps its lock. The brief wins over "merge main first".
- **No double pastes:** each brief names its window in the title; a window refuses a brief for another window. Before starting a brief a window runs `team-lock.sh started <brief> "<window>"`; exit 3 = already started → stop and ask DeShaun "Run it again?" (`rerun` only after a yes). It runs `finished … ok|stopped` at the end. Re-runs get new brief names. COACH adds the "Paste status" list (one bullet per brief) from `team-lock.sh status` to every reply; "paste status update" asks COACH, HUB or READER for it fresh; READER also answers "status" in the full layout. Every paste goes in its own code block. Each team talks only about its own project (never another project's questions or status).
- **Report upward directly:** when SHELL or a dev ends ✅ or ❓, it sends COACH a one-line note (session "🚌 COACH"). Notes are info only and go upward only: work reaches a window only as DeShaun's paste, and a window refuses tasks sent by any other window. A note is never approval to push or ship.
- At most 2 full test runs on the machine at once. Windows check this themselves before starting one (count with `ps -axo command | grep -E '^(\S*/)?node \S*vitest(\.mjs)? run( --\S+)* *$' | grep -vE -- '--(testNamePattern|dir|project|changed|related)' | wc -l`; start if under 2, otherwise wait in the background). No need to ask DeShaun; pushes and shipping still need their OK.
- Nothing ships without DeShaun's approval. If pushing `main` deploys nothing, SHELL pushes it right after each merge with no extra OK; staging/production always need DeShaun's approval. Never `git push --all`. "Merged" is not "live": confirm a deploy actually succeeded before calling it shipped.
- **Secrets never enter a Claude window.** DeShaun sets them in the hosting dashboard or a plain terminal. Local settings files that the build needs are copied into the dev folders by SHELL during setup and are never committed or printed. A secret that lands in any chat is compromised: rotate it.
- Every window ends each reply with `✅ <window> idle – nothing running` (task fully finished), `⏳ <window> busy – <what>`, or `❓ <window> waiting for DeShaun – <question>` (stopped for their answer).
- **Perf + security merge gate:** before SHELL merges a dev branch, the reviewer grades the diff against `docs/perf-security-checklist.md`, and `npm audit --audit-level=high` must show no NEW high/critical advisories compared with `main` (main's existing baseline is being cleared separately). High or critical = no merge. SHELL never runs `npm audit fix` or changes dependencies; dependency fixes are dev tasks.
- Project-specific: stage explicit paths only, never `git add -A` / `git add .` (see `LEARNINGS.md`), and never pass a secret through the `!` prefix (it records into that session's transcript).

**Plans live in `plans/`.** Each non-trivial change gets its own plan file. Current plans:
- `plans/splashscreen-timing-fix.md` (shipped 2026-05-16)
- `plans/offline-readiness-fix.md` (comprehensive, north star)
- `plans/offline-readiness-fix-phase-a.md` (server + client plumbing, shipped 2026-05-17)
- `plans/offline-foundation.md` (early draft, superseded by phase-a)

**Phase B (JWT auth migration) is the next major task.** Gate criteria for starting Phase B are documented in `plans/offline-readiness-fix-phase-a.md` (24 hours deployed, no rollback, ≥1 real user session in logs, zero CORS errors). Do not start Phase B before the gate clears.
