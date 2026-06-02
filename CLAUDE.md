# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Commands

Run from the repo root.

- `npm run dev` — start the dev server (`tsx server/index.ts`, `NODE_ENV=development`). Vite is mounted by the Express server in dev.
- `npm run build` — production build: `vite build` emits the client to `dist/public`, then `esbuild` bundles the server to `dist/index.js`.
- `npm start` — run the built server. Requires a prior `npm run build`.
- `npm run check` — TypeScript check (`tsc --noEmit`). There is no separate lint step; type-check is the gate.
- `npm test` — run the full vitest suite. CI runs this on push/PR to `main` (`.github/workflows/test.yml`).
- `npm run test:watch`, `npm run test:coverage` — same runner, different modes.
- `npm run db:push` — apply `shared/schema.ts` to Postgres via Drizzle Kit (requires `DATABASE_URL`).

Run a single test file: `npx vitest run tests/auth-validation.test.ts`
Filter by name: `npx vitest run -t "pattern"`

One-off scripts live in `scripts/`: `seed-master-admin.ts`, `seed-stripe-products.ts`, and `setup-native.sh` for local Capacitor setup.

Deployed on Railway via nixpacks (`nixpacks.toml`, `railway.json`). Health check hits `/`.

## Architecture

**Layout.** Server in `server/` (Express + TypeScript), client in `client/src/` (React SPA built with Vite), shared Drizzle schema and Zod validation in `shared/schema.ts`, Postgres via Neon serverless (`server/db.ts`). Path aliases: `@/*` → `client/src/*`, `@shared/*` → `shared/*`.

**Big central files.** `server/routes.ts` (5200+ lines, 120+ handlers) and `server/storage.ts` (2800+ lines, one `DatabaseStorage` class implementing `IStorage`). When adding a feature, the pattern is: new handler in `routes.ts`, new method on `IStorage` + `DatabaseStorage`. There is no per-domain file split yet — splitting would be a multi-hour refactor worth its own PR. `shared/schema.ts` (~30 tables) is the single source of truth for DB shape and client-side Zod validation.

**Multi-tenant model.** Nearly every table carries `companyId` referencing `companies`. A "company" is a tenant (school district, camp, etc.). Two helpers at the top of `routes.ts` are load-bearing:

- `isMasterAdminUser(user)` — true for `role === 'master_admin'` or `user._masterAdminImpersonating === true`.
- `companyScope(user)` — returns `undefined` for master-admin (no filter), the string `companyId` for a normal admin, or `null` if the user has no company (caller must short-circuit with `[]`).

**Enforcement patterns.** Every mutating handler for a tenant-scoped entity follows one of two shapes:

- *Record-by-id* (PATCH / PUT / DELETE): fetch the record, 404 if missing, 404 if `!isMasterAdminUser(user) && record.companyId !== user.companyId` (masks existence — do not leak "exists but forbidden").
- *Creates* (POST): after `zodSchema.parse(req.body)`, force `validatedData.companyId = user.companyId ?? null`. Never trust a `companyId` from the body.
- *List reads* (GET collections): `const scope = companyScope(user); if (scope === null) return res.json([]); const rows = await storage.getAllX(scope);`. The `getAll*` methods take an optional `companyId` filter.

Master admin can impersonate a tenant via `POST /api/master-admin/impersonate/:companyId`. Impersonation rewrites `user.companyId` at the session layer, so all the guards above work unchanged without special cases.

**Roles.** `parent`, `driver`, `admin`, `driver_admin`, `master_admin`. Helpers in `routes.ts`: `isAdminRole`, `isDriverRole`, `isParentRole`, plus `isMasterAdminUser`.

**Name collision to avoid.** `registerRoutes` declares a middleware `const isMasterAdmin = (req, res, next) => ...` around line 4650 (for master-admin-only routes). That `const` shadows any module-level function of the same name for the entire `registerRoutes` scope. That's why the boolean helper is `isMasterAdminUser`, not `isMasterAdmin`. Do not reintroduce the collision by renaming it back.

**Client.** Wouter for routing. Role-based dashboards (`/admin`, `/driver`, `/parent`, `/` for master admin). `client/src/pages/` is flat, `components/` is split by role (`admin/`, `driver/`, `parent/`, `shared/`, `ui/`). Server state via TanStack Query (`client/src/lib/queryClient.ts`). Auth state via `useAuth()` in `client/src/hooks/use-auth.ts` — `logout` calls `queryClient.clear()` to wipe per-user caches. Forms use React Hook Form + Zod schemas imported from `shared/schema.ts`.

**Auth.** Custom email/password in `server/customAuth.ts` with bcryptjs hashing and Passport local strategy, sessions stored in Postgres via `connect-pg-simple`. Session cookie is `httpOnly`, `secure` in production, and `sameSite` is conditional: `'none'` in production (required for the iOS Capacitor bundle's cross-origin requests in Phase B), `'lax'` otherwise. See `plans/offline-readiness-fix-phase-a.md` for the migration history. `SESSION_SECRET` is required unless `NODE_ENV` is explicitly `development` or `test` — the startup throws otherwise. Rate limiters (`authLimiter`, `registerLimiter`) are exported for reuse.

**Billing.** Three Stripe plans (Starter/Professional/Enterprise). Feature flags live on the `companies` row (e.g., `parentPortalEnabled`); plan-based user caps are enforced by `storage.canCreateUser(companyId, role)`. Webhooks land in `server/webhookHandlers.ts` and use the stock Stripe SDK for signature verification (the old `stripe-replit-sync` dependency has been removed).

**Push notifications.** `server/pushService.ts` plus `client/src/hooks/use-web-push.ts` and `@capacitor/push-notifications`. Device tokens persist in the `deviceTokens` table; on logout the server calls `storage.deactivateDeviceTokensForUser(userId)` so a force-quit or dropped-DELETE doesn't leave tokens delivering to the next session on that device.

**Parent-child linking.** Admins generate codes like `TNT-483921` via `/api/link-codes`. Parents redeem at `/api/link-child`. The relationship is many-to-many through `parentChildLinks`. For parent-facing reads of a parent's kids, use `storage.getLinkedStudentsByParentId(userId)`, **not** `getStudentsByParentId(userId)` — the latter only returns students where `students.parentId === userId` (the single-parent shortcut) and misses the link-code flow.

**Capacitor / iOS.** The app wraps `https://www.schoolbustracker.org` in a WKWebView, so the webview origin matches the API origin — session cookies work without cross-origin handling. App id `com.TopNotchTrainingCenter.SchoolBusTracker`. Plugins: PushNotifications, Geolocation, StatusBar, Keyboard, Haptics. `capacitor.config.ts` controls this. Any server change that alters cookie policy or auth redirects should be tested in the iOS app, not just the browser.

**Cross-origin readiness (Phase A, shipped 2026-05-17).** Server has CORS middleware (`cors` npm package) at `server/index.ts`, registered between the Stripe webhook raw-body handler and `app.use(express.json())`. Allowlist is exported as `ALLOWED_ORIGINS` and includes `capacitor://localhost`, `ionic://localhost`, `http://localhost`, `https://www.schoolbustracker.org`, and `https://schoolbustracker.org`. Disallowed origins receive a clean 403 via `callback(null, false)` — no 500s in logs from rejected origins. The middleware is inert for same-origin web traffic (browser doesn't trigger preflights). Allowlist is regression-tested in `tests/cors.test.ts`.

Client has an `apiUrl(path)` helper at `client/src/lib/apiBase.ts`. It returns the path unchanged on web (no-op for same-origin) and prepends `import.meta.env.VITE_API_BASE_URL` (or falls back to `https://www.schoolbustracker.org`) when `Capacitor.isNativePlatform()` is true. All `fetch('/api/...')` call sites in the client are wrapped: `queryClient.ts` (default fetcher), `App.tsx` (role PATCH), `pages/admin-dashboard.tsx` (6 sites), `pages/driver-password-setup.tsx`. The wrap is also a no-op for web because `getApiBase()` returns an empty string.

A passive `<OfflineBanner />` component at `client/src/components/shared/OfflineBanner.tsx` mounts inside `TooltipProvider` near the global `<Toaster />`. Listens to `window` `'online'`/`'offline'` events. Shows only when offline; refetch on reconnect is handled automatically by React Query's `refetchOnWindowFocus` default — no manual `invalidateQueries`.

## Pitfalls learnt the hard way

- **N+1 enrichment.** Student-enrichment endpoints batch-load related records via `getSchoolsByIds` / `getRoutesByIds` / `getRouteStopsByIds` / `getBusesByRouteIds`. Sites 2/3/4 share an `enrichStudentsWithSchoolAndRoute` helper. Don't reintroduce `Promise.all(students.map(async s => await storage.getX(...)))` loops — they turn into dozens of serial queries.
- **Day-boundary queries.** `storage.getAttendanceByDate(dateString, companyId?, timezone?)` uses Postgres `AT TIME ZONE` with the caller's `company.timezone`. Don't use `setHours(0,0,0,0)` for date windows — it evaluates in server-local time, which is UTC on Railway, so any non-UTC tenant gets the wrong day. The full day-boundary family is now migrated to this pattern: the `getTodays*` attendance methods, `markStudentAttendance`, the bus-journey methods, and the `studentCheckIns` (Bluetooth boarding) methods (`enableStudentCheckIn`, `disableStudentCheckIn`, `getActiveCheckInsForRoute`, `getCheckInStatus`, `getTodayCheckInsForParent`, `getTodayCheckInsForStudents`) all take a `timezone` param and compare `(col AT TIME ZONE ${tz})::date = ${dateString}::date`. Callers derive `tz` from `company?.timezone || 'UTC'`. Any new day-scoped query must follow the same shape — never reintroduce `setHours`/`DATE()` on plain timestamps.
- **Duty toggle idempotency.** `PATCH /api/driver/duty-status` no-ops when the requested `isOnDuty` matches the current state. This protects against a rapid double-tap overwriting `dutyStartTime` or firing the off-transition cleanup twice. Preserve the guard.
- **Geolocation on the driver dashboard.** Uses `@capacitor/geolocation` (CoreLocation on iOS, FusedLocationProvider on Android, `navigator.geolocation` on web). A `permissionDeniedRef` short-circuits the 30s polling loop once the driver denies permission — OS/browsers cache the denial and won't re-prompt, so retrying wastes battery. The driver must toggle duty off/on (or change device settings) to re-arm. Errors surface as a toast plus inline red-bordered message; don't swallow them silently. Match both W3C `.code` (1/2/3) and the native `Error.message` strings ("denied", "unavailable", "timeout") when categorizing failures — Capacitor exposes both shapes depending on platform.
- **Cross-tenant IDs in request bodies.** When a handler takes a foreign-key id from the request (studentId, routeId, driverId, etc.), fetch the referenced record and check its `companyId` before acting. Storage methods take raw ids and do not tenant-scope internally.

## Tests

Vitest, configured in `vitest.config.ts`. Tests live in `tests/` (not colocated). Suite covers schema validation, role/tenant access, plan limits, bus-status transitions, driver and parent features, input validation, and auth. Coverage is shallow relative to the handler count — roughly 10%. When you add tenant-sensitive logic, extend `tests/multi-tenant.test.ts`.

## Tooling

**Project-scoped Claude Code subagents.** Four agents live in `.claude/agents/`:
- `planner` — produces file-level plans in `plans/*.md` before any builder runs. Never writes code.
- `react-builder` — implements approved plans for client/ files.
- `express-api` — implements approved plans for server/ files.
- `reviewer` — reads diffs before commit; flags critical/important/suggestions. Never writes code.

The intended flow for any non-trivial change: planner → human review of plan → builder → reviewer → human review of findings → commit → verify on Railway. See `LEARNINGS.md` for the discipline that makes this work and the specific failure modes to avoid (especially: never `cd` between codebases in the same terminal, always verify `pwd` before any session, never `git add -A` or `.`).

**Plans live in `plans/`.** Each non-trivial change gets its own plan file. Current plans:
- `plans/splashscreen-timing-fix.md` (shipped 2026-05-16)
- `plans/offline-readiness-fix.md` (comprehensive, north star)
- `plans/offline-readiness-fix-phase-a.md` (server + client plumbing, shipped 2026-05-17)
- `plans/offline-foundation.md` (early draft, superseded by phase-a)

**Phase B (JWT auth migration) is the next major task.** Gate criteria for starting Phase B are documented in `plans/offline-readiness-fix-phase-a.md` (24 hours deployed, no rollback, ≥1 real user session in logs, zero CORS errors). Do not start Phase B before the gate clears.
