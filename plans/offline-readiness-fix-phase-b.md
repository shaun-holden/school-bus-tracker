# Plan: Offline-readiness fix — Phase B (Capacitor bundle flip + TestFlight)

> **HIGH RISK** — flips the iOS app from loading the remote site to serving the bundled build, so every API call becomes cross-origin (`capacitor://localhost` → `https://www.schoolbustracker.org`) and the Stripe checkout return flow changes shape. Touches Capacitor native deploy model and the Stripe billing return URL. **Requires manual review before any builder agent executes.** After this ships, every client-only fix needs a full TestFlight cycle.

## Preamble — gate status (settled, do not re-litigate)

Phase A (`plans/offline-readiness-fix-phase-a.md`) has been live on Railway for ~2 months. The Phase-B gate is **cleared and verified in production**:
- `capacitor://localhost` preflight returns `204` with the correct `Access-Control-Allow-Origin` + `Access-Control-Allow-Credentials: true`.
- Disallowed origins receive a clean `401` with no `ACAO` header — no `500`s in logs.
- Real authenticated sessions observed; zero CORS-related errors over the window.

The server CORS layer (`server/index.ts:11-59`), the `SameSite=None; Secure` production cookie (`server/customAuth.ts`), the `apiUrl()` plumbing (`client/src/lib/apiBase.ts`), and all inventoried fetch refactors are already shipped. **Phase B is therefore designed to be config-only for the iOS-facing surface.** Two items below intentionally touch server/docs/test code; each is flagged where the config-only assumption breaks and each is independently shippable.

## Goal
Flip the iOS app to serve the bundled React build from `capacitor://localhost` (instead of loading the remote site), so a cold launch in airplane mode renders the app shell instead of a white screen — then cut a new TestFlight build and verify the online / offline / mid-session-airplane matrix.

## Context
- Affected user flow: every flow on the **iOS app** (parent, driver, admin, master_admin). The web app at `https://www.schoolbustracker.org` is unaffected by design — the only web-touching change (the `/api/*` 404 fix, §5) is additive and separable.
- Affected subscription tiers: none. Billing is touched only insofar as the Stripe **checkout return URL** behavior changes on native (§3) — no tier gating, no price/plan logic.
- Why this approach over alternatives: DeShaun wants "pure bundled for production stability." Phase A was built specifically so this step is a config flip. Service-worker hybrid caching and TanStack Query persistence remain deferred (parent plan Open Question #2).

## Files to change

Ordered config-only server/shared surface first, then the iOS build. Total: **1 config file, 1 docs file, 2 new/edited test files, 1 optional server edit.**

### A. (Optional, Railway-only, separable) Server — JSON 404 for unmatched `/api/*` — §5

- **`server/index.ts`** — insert a terminal `/api` guard **after** `const server = await registerRoutes(app);` (line 97) and **before** the error-handler at line 99 / the `setupVite`/`serveStatic` branch at lines 114-118. Behavior: `app.use('/api', (req, res) => res.status(404).json({ message: 'Not found' }))`. This runs after every real API route is registered but before the SPA catch-alls in `server/vite.ts` (`app.use("*", ...)` at `vite.ts:44` and `vite.ts:82`), so an unmatched `/api/anything` returns a JSON `404` instead of `200 index.html`. Non-`/api` paths still fall through to the SPA catch-all unchanged.
  - **Why not edit `server/vite.ts`:** the two catch-alls live in both the dev (`setupVite`) and prod (`serveStatic`) paths; putting the guard once in `index.ts` before the branch covers both without duplicating logic.
  - **This is a server code edit — it breaks the "config-only" framing.** It is **independent of the iOS flip** and carries no iOS impact. Recommended to ship it as its own small Railway-only PR (or bundled with the webhook-ordering test in §4a) **before** the config flip, so the iOS diff stays purely `capacitor.config.ts`. Scanner probes like `/api/.env`, `/api/credentials` currently return `200` HTML (confirmed in prod — no secret leak, just wrong status); this corrects the status.

### B. Capacitor / iOS configuration — §1

- **`capacitor.config.ts`** — two changes, both config-only:
  1. **Invert the `PRODUCTION_SERVER_URL` default (line 6).** Today it is `process.env.PRODUCTION_SERVER_URL || 'https://www.schoolbustracker.org'`, which means `server.url` is *always* set and the bundle is *never* used. Change the fallback to empty so it becomes `process.env.PRODUCTION_SERVER_URL || ''`. Result: with the env var unset (DeShaun's normal local build), `PRODUCTION_SERVER_URL` is falsy, the conditional spread at lines 14-19 contributes nothing, and the WKWebView serves `webDir` (`dist/public`) from `capacitor://localhost`. Update the comment block at lines 3-5 to describe the inversion: default = bundled assets; set `PRODUCTION_SERVER_URL` **only** to resurrect remote-bundle behavior (the rollback escape hatch).
  2. **Drop `plugins.SplashScreen.launchShowDuration` from `5000` to `2000` (line 29).** The 5s failsafe was sized for a remote bundle download over cellular; local bundle load is near-instant, so 2s is enough headroom to detect a genuinely broken JS bundle without making every cold launch feel sluggish.
  - Leave everything else (`launchAutoHide`, `launchFadeOutDuration`, `backgroundColor`, all other plugins, `ios`/`android` blocks) untouched.

### C. Docs — CLAUDE.md correction — §4b

- **`CLAUDE.md`** (Capacitor / iOS section) — the current claim "The app wraps `https://www.schoolbustracker.org` in a WKWebView, so the webview origin matches the API origin — session cookies work without cross-origin handling" becomes **false** after the flip. Replace it with the post-flip reality: the iOS bundle loads from `capacitor://localhost` (bundled `dist/public`), the API stays on `https://www.schoolbustracker.org`, so every API call is cross-origin and is handled by the Phase A CORS allowlist (`server/index.ts` `ALLOWED_ORIGINS`) plus the `SameSite=None; Secure` production session cookie (`server/customAuth.ts`). Note the `PRODUCTION_SERVER_URL` env var as the rollback escape hatch that resurrects the old remote-bundle behavior. This is a documentation edit only — no runtime effect.

### D. Tests — §4a

- **`tests/webhook-ordering.test.ts`** **(NEW)** — assert the Stripe raw-body webhook handler is registered before all body-parsing middleware, including the Phase A `cors` layer. **Constraint:** `server/index.ts` runs an IIFE on import (`seedMasterAdmin()` + `server.listen()` at lines 94-124), so a test **cannot** `import` it without booting a real server and seeding the DB. Chosen approach (zero side-effects): read the `server/index.ts` source as text and assert ordering by string index —
  - `indexOf("app.post(\n  '/api/stripe/webhook'")` (or a tolerant regex for `/api/stripe/webhook`) is **less than** `indexOf('cors(')`, which is **less than** `indexOf('express.json()')`.
  - This directly encodes the invariant (webhook raw handler → cors → json) and fails loudly if a future edit reorders them. Read the file via `fs.readFileSync(path.resolve(__dirname, '../server/index.ts'), 'utf-8')`.
  - **Alternative (larger, not chosen):** refactor `server/index.ts` to export a `createApp()` factory separate from the `listen()` side-effect, then use `supertest` to POST a raw body to `/api/stripe/webhook` and assert the handler receives a `Buffer`. That is a real server refactor (breaks config-only) and is out of scope for Phase B; note it as a future improvement if the source-order test proves too brittle.
  - This is a **test-only** addition (no app code) and can ship with the §5 server PR or standalone.

### E. VITE_API_BASE_URL wiring decision — §2 — **no file change**

**Decision: do NOT wire `VITE_API_BASE_URL` for Phase B v1. Rely on the committed hardcoded fallback `DEFAULT_NATIVE_API_BASE = "https://www.schoolbustracker.org"` in `client/src/lib/apiBase.ts:7` as the single source of truth.**

Rationale — each candidate location was evaluated and rejected:
- **Railway build env — WRONG.** Railway builds the *web/server* artifact. The **iOS bundle is built locally on DeShaun's Mac** via `npm run build`, so `import.meta.env.VITE_API_BASE_URL` is resolved at *that* build, not on Railway. A Railway env var never reaches the native bundle.
- **Xcode build config — WRONG.** Xcode does not run Vite; the bundle is already built before `npx cap sync ios`. Xcode env vars only feed `capacitor.config.ts` (via `process.env` at config-eval time, e.g. `PRODUCTION_SERVER_URL`) — they cannot set `import.meta.env`.
- **`.env.production` — technically correct but redundant, and not chosen for v1.** `vite build` reads `.env.production` in production mode on the Mac, so it *would* bake into the native bundle. `.gitignore` line 2 ignores only the bare `.env`, so `.env.production` **is committable**. But it introduces a *second* source of truth that can silently drift from the `apiBase.ts` fallback, and the value is a fixed, public production origin that the fallback already yields. For a solo dev, one source of truth is safer.

Concrete builder instruction: **leave `VITE_API_BASE_URL` unset; change nothing.** Keep the env-var read in `apiBase.ts` as a documented escape hatch. **If, and only if, a divergent origin is ever needed (e.g. a staging TestFlight bundle), the sole correct location is a committed `.env.production` at repo root read by `vite build` on the Mac — never Railway env, never Xcode.** Note this in the PR description.

## Database changes
None.

## API contract
No new or changed endpoints. Two behavior notes:
- (§5, optional) Unmatched `/api/*` paths return `404 { "message": "Not found" }` (JSON) instead of `200` + SPA HTML. Real API routes are unaffected.
- The Stripe checkout return URL behavior on native is discussed in "Stripe / billing considerations" — no handler change.

## iOS / Capacitor considerations
- **Requires a new TestFlight build.** Both the `capacitor.config.ts` changes and the freshly bundled `dist/public` must be re-packaged.
- Build order on the Mac: `npm run build` (emits `dist/public`), then `npx cap sync ios` (copies `dist/public` into the iOS project and applies the config).
- In Xcode: **bump `CURRENT_PROJECT_VERSION`** (the build number) in the `App` target's build settings — required by App Store Connect for a new TestFlight upload; the marketing version (`MARKETING_VERSION`) can stay unless DeShaun wants a new version string. Archive → upload to App Store Connect → submit to TestFlight (internal group first).
- **Confirm `PRODUCTION_SERVER_URL` is NOT set** in the Xcode scheme's environment variables (Scheme → Run → Arguments → Environment Variables) or any `.xcconfig`. If it is set, the config conditional resurrects `server.url` and the flip silently no-ops.
- After this ships, every future client-only change requires the same `build → cap sync → archive → TestFlight` cycle. No further iOS automation in this plan.

## Stripe / billing considerations — resolves parent-plan Open Question #4

**Inspected:** `server/routes.ts:5286-5349` (`POST /api/business/create-checkout-session`). It reads optional `successUrl`/`cancelUrl` from `req.body` and otherwise defaults to `${baseUrl}/onboarding/success?...` and `${baseUrl}/onboarding/plans`, where `baseUrl = process.env.APP_URL || 'https://' + RAILWAY_PUBLIC_DOMAIN` (line 5328). The client (`client/src/pages/onboarding-plans.tsx:34`) sends **only `priceId`** — so the server always uses the absolute web-origin fallback. The redirect happens via `window.location.href = data.url` (`onboarding-plans.tsx:37`) to the Stripe-hosted checkout page.

**Decision: accept the existing absolute web-URL return. No handler change, no custom-scheme deeplink for Phase B v1.** Concrete instruction to the builder: **do not modify the checkout-session handler or the client redirect.**

Rationale:
- Onboarding (an admin creating/subscribing a company) is a **rare, one-time** flow, not a per-session action.
- After Stripe redirects to `https://www.schoolbustracker.org/onboarding/success`, the WKWebView navigates to the **web origin**, which is same-origin to the API and runs the full web app correctly — the user is not broken, just temporarily off the bundle. A cold relaunch restores the `capacitor://localhost` bundle.
- The alternative — a custom-scheme deeplink return URL (`com.topnotchtrainingcenter.schoolbustracker://...`) — requires registering the URL scheme in `Info.plist` and adding a Capacitor `App` `appUrlOpen` handler in native/client code. That is **native + client code work that breaks Phase B's config-only design** and is HIGH RISK. It is explicitly **deferred to a named follow-up** ("native Stripe return deeplink") and should get its own plan if the brief web-origin detour proves unacceptable in testing.

**Webhook ordering unchanged.** The raw-body handler at `server/index.ts:21-47` remains first, before `cors` (49-59) and `express.json()` (61). This is now regression-guarded by the §4a test.

## Testing approach

### Automated (Shell runs `npm run check` + `npm test` per DeShaun's workflow)
- **`tests/webhook-ordering.test.ts`** (NEW, §4a) — source-order assertion: webhook handler registered before `cors` before `express.json()` in `server/index.ts`.
- **`tests/cors.test.ts`** (existing, Phase A) — unchanged; confirms `ALLOWED_ORIGINS` still contains exactly the five origins.
- (If §5 shipped) optionally add a small assertion or manual curl noting unmatched `/api/*` returns `404` JSON. A full route-level integration test is out of scope given the IIFE import constraint on `server/index.ts`; a curl in the smoke below is sufficient.
- Run `npm run check` and `npm test` green before any commit/deploy.

### Manual — web (must still work after the §5 server PR)
1. Railway deploy of the §5 change, hit `https://www.schoolbustracker.org`, log in. Full admin/driver/parent smoke — no regressions.
2. `curl -i https://www.schoolbustracker.org/api/.env` → expect `404` + JSON, not `200` HTML. `curl -i https://www.schoolbustracker.org/` → still `200` SPA HTML.

### Manual — iOS matrix (from parent plan; run on a real device via TestFlight/local install)
**Online (Wi-Fi):**
1. Cold launch, log in. Confirm `/api/auth/user`, route data, parent/student data all load from `capacitor://localhost` against the remote API.
2. Force-quit, relaunch — session cookie persisted, auto-logged-in.
3. Safari Web Inspector against the WKWebView: requests show `Origin: capacitor://localhost`; responses carry `Access-Control-Allow-Origin: capacitor://localhost` and `Access-Control-Allow-Credentials: true`.
4. Stripe: from onboarding, tap a plan → confirm the Stripe checkout page opens; complete/cancel → confirm it returns to `…/onboarding/success` or `/onboarding/plans` on the web origin and the app remains usable; force-quit + relaunch restores the bundle.

**Offline cold launch (airplane mode):**
1. With app previously logged-in, enable airplane mode, force-quit, relaunch. Confirm splash dismisses within ~2.5s (2000ms `launchShowDuration` + splash-context floor) — no white screen.
2. Landing (or cached user view) renders; the Phase A `OfflineBanner` shows.
3. Tap Retry while still offline — banner persists, no crash (button disabled per Phase A spec).

**Mid-session airplane toggle:**
1. Log in online, navigate to a dashboard (data renders).
2. Enable airplane mode: banner appears; already-rendered stale data stays visible; new requests fail via existing toast/error UI without blanking the screen.
3. Disable airplane mode: banner disappears on the `online` event; queries refill.

**FCM deeplink (spot-check):** tap a push notification while offline → app opens to a sensible page (Landing), not a white screen.

## Risk & rollback

### What could break in production (iOS only — web is untouched by the flip)
1. **Forgotten `PRODUCTION_SERVER_URL` in Xcode** → flip silently no-ops. Mitigation: the pre-archive checklist step above.
2. **Cross-origin auth regression** already de-risked: Phase A CORS + `SameSite=None; Secure` verified in prod for 2 months.
3. **Splash stuck** if a broken JS bundle ships — 2000ms failsafe + `launchAutoHide` still dismisses; a broken bundle would show Landing/blank, caught in the offline cold-launch test before promoting past the internal TestFlight group.
4. **Stripe detour to web origin** (accepted behavior) — verified in the online matrix step 4.

### Rollback plan
The two Phase A halves already ship together, so that caveat is satisfied. **Phase B rollback is the config-flip reversal:**
1. **iOS regression, web fine (expected common case):** set `PRODUCTION_SERVER_URL=https://www.schoolbustracker.org` as a build env var in the Xcode scheme (or a `.xcconfig`), run `npm run build && npx cap sync ios`, bump `CURRENT_PROJECT_VERSION`, archive a new TestFlight build. The `capacitor.config.ts` conditional resurrects `server.url` → old remote-bundle behavior. ~30 min + Apple review.
2. **§5 server 404 change regresses web:** `git revert` that isolated commit, push, Railway redeploys. Independent of the iOS artifacts.
3. **Docs/test-only changes** (CLAUDE.md, webhook-ordering test) carry no runtime risk; revert if needed with no deploy impact.

**Keep the `PRODUCTION_SERVER_URL` escape hatch in `capacitor.config.ts` indefinitely** (parent plan Open Question #3 recommendation) — it is the only code-free rollback path.

## Config-only assumption — where it holds and where it breaks
- **Holds** for the core iOS flip: the only native-surface change is `capacitor.config.ts`. No client code edit is needed (the checkout redirect and all fetch sites were handled in Phase A; `onboarding-plans.tsx` already uses `apiRequest` + an absolute Stripe URL). `VITE_API_BASE_URL` is intentionally left unset (fallback is the source of truth).
- **Breaks (flagged, both separable and non-iOS):**
  - §5 JSON `404` for unmatched `/api/*` is a **server code edit** (`server/index.ts`) — ship as its own Railway-only PR, independent of the flip.
  - §4a webhook-ordering vitest is **test-only** — no app code.
  - §4b CLAUDE.md is **docs-only**.

## Open questions
- **Custom-scheme Stripe return deeplink:** deferred by decision above. Only revisit (its own plan) if the brief web-origin detour after checkout is judged unacceptable during the online iOS matrix step 4. Not a blocker for shipping Phase B.
- Otherwise: **None** — Open Question #4 is resolved; #1/#2/#3/#5/#6 from the parent plan were previously accepted/deferred and do not block Phase B.
