# Plan A: Offline Foundation — bundle React app into iOS (sessions/cookies retained)

> **HIGH RISK** — requires manual review before any builder agent executes.
>
> The four reasons:
> 1. **Deploy model changes.** Every iOS web-shell change after this lands needs a full TestFlight cycle (`cap sync` + Xcode archive + Apple review). Today client-only fixes ship via Railway in minutes.
> 2. **CORS misconfiguration breaks the entire iOS app silently.** A wrong allowlist, wrong middleware order, or missing `credentials: true` produces opaque failures (preflight 200, actual request looks like a network drop).
> 3. **Cross-origin session cookies in Capacitor WKWebView have iOS 17+ quirks.** `SameSite=None; Secure` is required to deliver the session cookie from `capacitor://localhost` to `https://www.schoolbustracker.org`, but iOS WKWebView ITP behavior is version-specific. Plan A may need to be followed urgently by Plan B (JWT) if cookies don't persist across force-quit.
> 4. **Every fetch call site must be updated correctly.** A missed site silently breaks one endpoint while everything else works — the kind of bug that hides until a parent or driver hits exactly that path on iOS.

## Two-phase context

This is **Plan A** of a two-phase offline-readiness fix.

- **Plan A (this document):** Bundle the React app into iOS so it launches offline. Keep the existing session/cookie auth and make it work cross-origin via CORS. Add minimal offline UX (network-error fallback, retry button). Ship and verify.
- **Plan B (separate document, to be written):** Migrate auth from session cookies to JWT (`Authorization: Bearer` header, token stored in iOS Keychain via `@capacitor/preferences` or similar). Eliminates the cross-origin cookie risk entirely.

**Explicit trigger to expedite Plan B:** if, during Plan A's TestFlight verification (step 7 in Migration Order), the session cookie does not persist across a force-quit and reopen, that is the signal to start Plan B immediately rather than treating it as a future enhancement.

## Goal
After the splash screen dismisses on a cold launch in airplane mode, render the React app shell from the local bundle instead of a permanent white screen, while keeping the existing same-origin web experience at `https://www.schoolbustracker.org` unchanged.

## Why this is risky (failure modes spelled out)

1. **CORS allowlist typo → silent login failure.** If `capacitor://localhost` is mistyped (e.g., `capacitor://localhost/`, trailing slash) the browser drops the response body before the app sees it. Symptom: login screen accepts credentials, immediately returns to login screen with no error.
2. **CORS middleware mounted in wrong order.** If CORS is registered *before* the Stripe webhook raw-body handler at `server/index.ts:12–38`, the raw body buffer can be consumed/mutated and webhook signature verification fails silently. If CORS is registered *after* `express.json()` at `server/index.ts:40`, preflights for non-JSON requests may not be handled correctly. Required order: Stripe webhook → CORS → `express.json()` → session → passport → routes.
3. **`SameSite=None` without `Secure` rejected by all modern browsers.** The existing `secure` flag is already gated on `NODE_ENV === 'production'`, so `SameSite=None` must use the same gate. Mismatch (e.g., `SameSite=None` in dev where `secure` is false) breaks dev login in browsers immediately.
4. **WKWebView ITP cookie eviction.** iOS 17+ Intelligent Tracking Prevention can evict third-party cookies after 7 days of inactivity. If a parent doesn't open the app for a week, they get silently logged out. This is acceptable Plan A behavior (user re-logs in) but should be observed.
5. **Missed fetch site → one broken endpoint.** Any `fetch('/api/...')` that doesn't go through `apiUrl()` resolves against `capacitor://localhost` on iOS and 404s. The "Files to change" section below lists every site by line number; the builder must update all of them.
6. **Splash dismissal regression.** The existing splash hide (`client/src/App.tsx:60`) fires on `!isLoading`. When `/api/auth/user` fails offline, `isLoading` still flips to `false` and `error` is set, so splash should still hide. Verify in the offline test path.
7. **Stripe checkout redirect strands user on web.** `client/src/pages/onboarding-plans.tsx:37` navigates to a Stripe-hosted URL via `window.location.href`. The Stripe `success_url` returns to the web origin, which on iOS WKWebView means the webview stays on `https://www.schoolbustracker.org` instead of returning to the bundle. Flagged in Open Questions.

## Out of scope (explicit)

- **JWT auth migration** — that's Plan B. Plan A keeps `connect-pg-simple` sessions and cookie auth.
- **Full React Query persistence** (`@tanstack/react-query-persist-client` / localStorage / IndexedDB). Offline-cached dashboard data has multi-tenant security implications (tenant A's cached data must not leak to tenant B on the same device) and storage-budget tradeoffs that warrant their own plan. Plan A only guarantees the app shell renders and clearly signals offline state.
- **Service-worker-based hybrid bundle caching.** Out of scope.
- **Android.** Capacitor config touches `androidScheme` indirectly via the bundled-mode flip, but Android is not in current shipping plans; all testing is iOS-only.
- **Self-hosting Google Fonts** (currently loaded from `fonts.googleapis.com` in `client/index.html`). System-font fallback is acceptable Plan A behavior offline.

## Context
- Affected user flow: every flow on the iOS app (parent, driver, admin, master_admin). Web app is unaffected by design — all changes must remain no-ops for browser users.
- Affected subscription tiers: none — this is platform-level plumbing.
- Why this approach over alternatives: DeShaun has stated a preference for "pure bundled for production stability." The alternative (continuing to load the bundle from Railway) was just demonstrated in TestFlight build 4 to white-screen when offline. Service-worker hybrid caching is a larger project deferred to a future plan. JWT auth (Plan B) is the cleaner long-term fix but a much larger surgery; Plan A unblocks offline launch without touching auth.

## Files to change

### Capacitor / iOS configuration

- **`capacitor.config.ts`** — two changes:
  1. **Invert the `PRODUCTION_SERVER_URL` default at line 6.** Today: `process.env.PRODUCTION_SERVER_URL || 'https://www.schoolbustracker.org'` — which means the bundle is *never* used unless the env var is explicitly unset. New behavior: `process.env.PRODUCTION_SERVER_URL || ''` so the bundle is used by default, and the env var remains an explicit opt-in for local-dev convenience or as a rollback escape hatch. Update the comment block above the const to make the inversion obvious to future maintainers.
  2. **Drop `plugins.SplashScreen.launchShowDuration` from `5000` to `2000`** (line 29). The 5s failsafe was sized for a remote bundle download over cellular; bundle load is essentially instant. 2s still gives WKWebView headroom on slower devices.

### Client — API base URL plumbing

- **`client/src/lib/apiBase.ts`** **(NEW)** — single source of truth for the API origin. Exports:
  - `API_BASE` constant (or `getApiBase()` function) returning:
    - `import.meta.env.VITE_API_BASE_URL` when `Capacitor.isNativePlatform()` is true. Fall back to the explicit production default `https://www.schoolbustracker.org` if the env var is missing, with a `console.warn` so the misconfiguration is visible.
    - Empty string (`''`) otherwise, so web builds keep using same-origin relative paths exactly as today.
  - `apiUrl(path: string)` helper that prepends the base only when `path` starts with `/api`. Leaves fully-qualified `http(s)://` URLs and non-API relative paths untouched. Tolerant of `path` with or without leading slash.
  
  This follows the existing `VITE_FIREBASE_*` convention verified in `client/src/lib/firebase.ts:6-12`.

- **`client/src/lib/queryClient.ts`** — central choke point. Two wraps:
  1. In `apiRequest()` at line 15, wrap the `url` argument with `apiUrl(url)` before passing it to `fetch`. `credentials: 'include'` is already set at line 19 — keep it.
  2. In `getQueryFn()`'s `queryFn` at line 32, `fetch(queryKey.join("/") as string, ...)` reconstructs the URL from the query key. Wrap that joined string with `apiUrl(...)`. `credentials: 'include'` already present at line 33 — keep it.
  
  Do **not** change `retry`, `refetchInterval`, `refetchOnWindowFocus`, `staleTime`, or `gcTime` in this plan — those are tuned for the existing live-data flow. Plan A's offline UX is handled in a separate component rather than by overriding global query defaults. (Recommended retry settings revisited in the "Offline UX" section below as a deferred follow-up.)

- **`client/src/App.tsx`** line 42 — direct `fetch` to `/api/users/${user.id}/role`. Replace with `apiRequest(`/api/users/${user.id}/role`, 'PATCH', { role: pendingRole })` so it picks up the base URL via the shared helper and gets `credentials: 'include'` for free.

- **`client/src/lib/distanceUtils.ts`** line 79 — third-party Nominatim (`https://nominatim.openstreetmap.org/...`). **Leave unchanged.** Add an inline comment explaining why (external geocoding API, not affected by base URL, not subject to our CORS rules). Will still fail offline, but that's geocoding's pre-existing behavior.

- **`client/src/pages/driver-password-setup.tsx`** line 44 — direct `fetch` inside a `useQuery` `queryFn`. Wrap with `apiUrl()`: `fetch(apiUrl(`/api/driver-invitation/verify?token=${encodeURIComponent(token)}`), { credentials: 'include' })`. Endpoint is unauthenticated, but `credentials: 'include'` is still correct so the CORS layer recognizes the cross-origin shape.

- **`client/src/pages/admin-dashboard.tsx`** — six direct `fetch` sites, all `fetch(`/api/routes/${routeId}/...`)`:
  - Line 161 — wrap with `apiUrl()`, **add** `credentials: 'include'` (currently omitted).
  - Line 1354 — wrap with `apiUrl()`, already has `credentials: 'include'`.
  - Line 1355 — wrap with `apiUrl()`, already has `credentials: 'include'`.
  - Line 1753 — wrap with `apiUrl()`, already has `credentials: 'include'`.
  - Line 1851 — wrap with `apiUrl()`, already has `credentials: 'include'`.
  - Line 2512 — wrap with `apiUrl()`, **add** `credentials: 'include'` (currently omitted).
  
  Same-origin web is unaffected by adding `credentials: 'include'`; cross-origin iOS silently drops the cookie without it.

- **`client/src/hooks/use-web-push.ts`** — already uses `apiRequest()`, so it picks up the base URL automatically once `queryClient.ts` is updated. **No code change required**, but verify after the queryClient change that the FCM token POST still succeeds from iOS.

- **`client/src/pages/onboarding-plans.tsx`** line 37 — `window.location.href = data.url` to a Stripe-hosted checkout URL. The URL is fully-qualified `https://` returned by the server. **No code change required for the navigation itself**, but see Open Questions for the return-URL strand-on-web concern.

### Client — offline UX

- **`client/src/hooks/use-auth.ts`** — `userQuery` has `retry: false` and `staleTime: 5 * 60 * 1000` today. When `/api/auth/user` fails with a network error, `isLoading` flips to `false` and `userQuery.error` is set. `App.tsx`'s Router falls back to rendering Landing for `!isAuthenticated`, which is acceptable for v1. **No code change required**, but:
  - Verify Landing renders without any synchronous API dependency. Spot-check `client/src/pages/landing.tsx` — confirm no `useQuery` for `/api/...` data gates render.
  - Splash hide already fires on `!isLoading` regardless of auth state (`App.tsx:60`), so an offline launch still dismisses the splash and shows Landing — that is the v1 offline UX for unauthenticated users.

- **`client/src/components/shared/OfflineBanner.tsx`** **(NEW)** — minimal banner:
  - Listens to `window.addEventListener('online' / 'offline', ...)` and renders a sticky top bar reading "No connection — some data may be out of date" with a "Retry" button.
  - Retry button calls `queryClient.invalidateQueries()`.
  - Hidden by default when `navigator.onLine === true`.
  - Mount once in `AppShell` (sibling of `<Toaster />` in `client/src/App.tsx:115`) so it appears on every route.
  - Keep dead simple — no animations, no toast spam. Goal: acknowledge offline state, not solve it.

- **`client/src/components/shared/NetworkErrorFallback.tsx`** **(NEW)** — top-level fallback for authenticated users whose first `/api/auth/user` call fails. Shows "No connection — Retry" with a button that re-fires the auth query via `userQuery.refetch()` (or `queryClient.invalidateQueries({ queryKey: ['/api/auth/user'] })`). Used by Router when `isLoading === false && error && !user`.
  - Mount in `client/src/App.tsx` Router function (around lines 65–71, replacing or augmenting the current `if (isLoading)` block) so that the error-no-cached-user state has a dedicated render path instead of falling through to Landing.
  - Unauthenticated users (no prior login on this device) still get Landing — `error` from a 401 returning null is not a network error, so this fallback only fires on genuine fetch failures.

- **React Query retry/staleTime/cacheTime tuning** — **deferred**. The default `retry: false`, `staleTime: 5000`, `gcTime: 300000` in `queryClient.ts:52-56` are sufficient for Plan A. Tuning toward `retry: 2` with exponential backoff and `staleTime: 30s` is a candidate for Plan B alongside JWT, where reauth and retry semantics are revisited together. Note in code comments that this is intentional.

- **`client/src/lib/splash-context.tsx`** — **no code change required**. Existing `Capacitor.isNativePlatform()` guard and `hasHiddenRef` idempotency already handle both online and offline cold-launch paths. Confirm via testing.

### Server — CORS

- **`server/index.ts`** — insert CORS middleware at the **exact** position between the Stripe webhook raw-body handler (lines 12–38, must remain first) and `app.use(express.json())` (line 40). The safe insertion point is line 39 (currently blank).
  
  Two acceptable approaches; recommend approach 1:
  1. Add the `cors` package (`npm install cors @types/cors`), call `app.use(cors({ origin: <function or array>, credentials: true }))`.
  2. Hand-roll middleware setting `Access-Control-Allow-Origin` (echoed from `req.headers.origin` if in allowlist), `Access-Control-Allow-Credentials: true`, `Access-Control-Allow-Methods`, `Access-Control-Allow-Headers: Content-Type`, short-circuiting `OPTIONS` with `204`.
  
  **Allowlist** (no wildcards — credentials require explicit origins):
  - `'capacitor://localhost'` — iOS production (bundled webview origin)
  - `'http://localhost:5173'` — Vite dev server
  - `'http://localhost'` — Capacitor live-reload during dev (no port)
  - `'ionic://localhost'` — legacy iOS scheme, harmless to include
  - `'https://www.schoolbustracker.org'` — production web origin (defensive even though same-origin)
  - `'https://schoolbustracker.org'` — apex (Open Question: verify which is canonical)
  
  Declare the allowlist as a `const` near the top of `server/index.ts` so it's grep-able and there's one place to add origins later.
  
  **Do NOT use `'*'`** — incompatible with `Access-Control-Allow-Credentials: true` per spec; browsers reject silently.
  
  **Middleware order verification (load-bearing):**
  ```
  app.post('/api/stripe/webhook', express.raw(...), ...)   // line 12–38, MUST stay first
  app.use(cors({ origin: ALLOWLIST, credentials: true })) // NEW, inserted at line 39
  app.use(express.json())                                  // line 40
  app.use(express.urlencoded(...))                         // line 41
  // ...logging middleware, then registerRoutes which mounts session + passport
  ```
  The Stripe webhook handler is mounted via `app.post(...)` rather than `app.use(...)`, so it short-circuits before CORS middleware ever runs for that one path. The raw-body buffer is preserved. Verify after install.

### Server — session cookie

- **`server/customAuth.ts`** lines 84–89 — `cookie` config in `getSession()`. Change `sameSite: 'lax'` (line 87) to a conditional matching the existing `secure` line:
  - `'none'` when `NODE_ENV === 'production'` (required for cross-site cookies from `capacitor://localhost`; legal only when `secure: true`, which is already conditional on production at line 86).
  - `'lax'` otherwise (preserves dev behavior for `npm run dev` in a browser).
  
  Do not change `httpOnly`, `maxAge`, or `resave`. The TypeScript type for `sameSite` accepts `'none' | 'lax' | 'strict' | boolean` — use the string literal form.

### Server — push notifications

- **`server/pushService.ts`** line 186 — `fcmOptions.link: "/"`. Relative root path, resolved by FCM SDK against the service-worker origin. On `capacitor://localhost`, resolves to `capacitor://localhost/` which routes to local `index.html`. **No code change required**, but flag for verification: tap an FCM notification while offline and confirm the app opens to Landing (or last route) without white-screening.
  
  Grep for any other URL construction in `pushService.ts` or `client/src/hooks/use-web-push.ts` that assumes a specific origin. Findings (verified): only the `fcmOptions.link` construction. No other origin-coupled URLs.

### Documentation

- **`CLAUDE.md`** — update the "Capacitor / iOS" section. Add a new "Deploy model" subsection documenting:
  - Web-only changes still deploy via Railway push (`git push` → Railway redeploy).
  - iOS web-shell changes require: `npm run build` → `npx cap sync ios` → Xcode archive → TestFlight upload → Apple review. Plan ~24h for non-expedited review.
  - The `PRODUCTION_SERVER_URL` env var in `capacitor.config.ts` is the rollback escape hatch — setting it for an Xcode build reverts that build to the old remote-bundle behavior.
  - Note that the WKWebView origin is now `capacitor://localhost` instead of `https://www.schoolbustracker.org`. The current claim in `CLAUDE.md` that "the webview origin matches the API origin — session cookies work without cross-origin handling" is **no longer true after this plan ships** — must be rewritten to describe the cross-origin CORS + `SameSite=None` reality.

## Database changes
None.

## API contract
No new endpoints. Behavior change on every existing endpoint:
- Will now respond with `Access-Control-Allow-Origin: <echoed origin>` and `Access-Control-Allow-Credentials: true` headers when called from an allowlisted origin.
- Will respond to `OPTIONS` preflights with `204` and the same CORS headers.
- Session cookie will carry `SameSite=None; Secure` in production (was `SameSite=Lax`).

## iOS / Capacitor considerations
- **Requires a new TestFlight build.** Both the `capacitor.config.ts` changes and the bundle contents must be re-packaged.
- After `npm run build`, run `npx cap sync ios` to copy `dist/public` into the iOS project and apply config changes.
- Open Xcode, increment build number, archive, upload to App Store Connect, submit to TestFlight.
- Confirm in Xcode that `PRODUCTION_SERVER_URL` is **not** set in the build environment (check Scheme → Run → Arguments → Environment Variables, and any `.xcconfig` files).
- After this ships, every future client change targeting iOS requires the same TestFlight cycle.

## Stripe / billing considerations
- Stripe checkout redirect in `onboarding-plans.tsx:37` uses `window.location.href = data.url`. On iOS WKWebView, this navigates to the Stripe-hosted page in the in-app webview. After successful checkout, Stripe redirects to the configured `success_url` server-side. If that URL is `https://www.schoolbustracker.org/onboarding/success`, the WKWebView lands on the web origin and stays there — defeating the bundled app. See Open Questions.
- **No Stripe webhook changes.** The raw-body handler at `server/index.ts:12-38` must remain mounted *before* the new CORS middleware and *before* `express.json()`. The handler uses `app.post(...)` not `app.use(...)`, so it short-circuits for the one path and the raw body buffer is preserved.

## Testing plan

### Manual — web in browser (must still work after CORS + cookie changes)
1. Local: `npm run build && npm start`, open `http://localhost:5000`, log in as each role (parent, driver, admin, master_admin). Confirm:
   - Cookie set with `SameSite=Lax` (NODE_ENV not production).
   - All authenticated requests succeed.
   - No CORS warnings in browser console.
2. Production: Railway deploy, open `https://www.schoolbustracker.org`, repeat with all roles. Confirm:
   - Cookie set with `SameSite=None; Secure`.
   - Same-origin requests succeed (browser may or may not show CORS handshake; either is fine since origin matches).
   - No CORS warnings.

### Manual — iOS native, online
1. `npm run build && npx cap sync ios`, build via Xcode, install on a real device over Wi-Fi.
2. Cold launch, log in as each role. Confirm `/api/auth/user`, route data, parent/student data all load.
3. Force-quit, relaunch within 60 seconds. Confirm session cookie persisted and user is auto-logged in. **If not, escalate to Plan B.**
4. Force-quit, wait >1 hour, relaunch. Confirm still logged in (session TTL is 7 days unless changed).
5. Use Safari Web Inspector against the WKWebView. Confirm requests show `Origin: capacitor://localhost` and responses carry `Access-Control-Allow-Origin: capacitor://localhost` + `Access-Control-Allow-Credentials: true`.

### Manual — iOS native, offline cold launch
1. With app installed and previously logged in, toggle airplane mode.
2. Force-quit and relaunch. Confirm:
   - Splash dismisses within ~2.5s (2s `launchShowDuration` + ~600ms `MIN_DISPLAY_MS` floor in `splash-context.tsx`).
   - App shell renders (Landing for cached-no-user; NetworkErrorFallback or Landing for authenticated-but-fetch-failed).
   - `OfflineBanner` is visible.
   - Tapping Retry while still offline reproduces the failure without crashing.
3. Disable airplane mode mid-session; confirm banner disappears on `online` event and `queryClient.invalidateQueries()` refills data.

### Manual — iOS native, mid-session airplane mode toggle
1. Log in online, navigate to a dashboard, confirm data renders.
2. Toggle airplane mode. Confirm:
   - Banner appears.
   - Existing rendered data remains visible (TanStack Query default — stale data shown, not cleared).
   - New requests fail via existing toast/error UI but do not blank the screen.
3. Toggle airplane mode off. Confirm banner disappears and data refreshes.

### Manual — cookie persistence stress test
1. iOS: log in → force-quit → reopen. Logged in? (Required.)
2. iOS: log in → logout → log in again. Confirm clean cycle, no stale cache.
3. iOS: log in → close app (not force-quit) → wait 24h → reopen. Still logged in? (Expected.)
4. iOS: log in → wait 8 days (or simulate by clearing session table row for that user). Reopen. Confirm gracefully shown logged out, no crash.

### Automated
- No new test files in this PR. CORS and cookie behavior are integration-level and hard to fake in vitest without spinning a real HTTP server. Existing `tests/auth-validation.test.ts` and `tests/multi-tenant.test.ts` continue to cover policy shape.
- DeShaun's existing workflow gates: `npm run check` (TypeScript) and `npm test` (vitest) before deploy.

## Migration order

Sequence chosen to avoid windows where web is broken or iOS is half-broken.

1. **Server: ship CORS + `SameSite=None; Secure` via Railway.** Add CORS middleware in `server/index.ts`; flip `sameSite` to `'none'` in production in `server/customAuth.ts`. `npm run build` → `npm run check` → `npm test` → commit → push. Railway redeploys.
   - **Why first:** additive for web. Web at `https://www.schoolbustracker.org` is same-origin so CORS headers are inert. `SameSite=None; Secure` is legal for same-origin requests. Existing iOS build (build 4, remote bundle, same-origin) continues to function unchanged.
2. **Verify web in production.** Log in on the live web app, exercise admin/driver/parent flows for ~5 minutes across at least two browsers. Confirm no regressions, no console warnings.
3. **Client: ship `VITE_API_BASE_URL` plumbing + fetch-site updates via Railway.** Add `client/src/lib/apiBase.ts`, update `queryClient.ts`, refactor every fetch site listed above. Add `OfflineBanner` + `NetworkErrorFallback`, mount in `AppShell` / Router. `npm run build` → `npm run check` → `npm test` → commit → push.
   - **Web still unchanged:** `Capacitor.isNativePlatform()` returns false in browser, so `apiUrl()` returns `''` and every wrapped call resolves to the same relative path as today.
4. **Verify web again.** Same smoke test as step 2. Required because the fetch refactor touches `admin-dashboard.tsx` at six lines and any of them could regress.
5. **Flip `capacitor.config.ts` to bundled + drop splash to 2000ms.** `npm run build && npx cap sync ios`. Commit (capacitor config + iOS project files updated by `cap sync`).
6. **TestFlight build.** Xcode archive, increment build number, upload, submit to internal TestFlight group.
7. **TestFlight verification — cookie persistence (PLAN B TRIGGER).** Install on real iOS device.
   - Cold launch online, log in. Confirm success.
   - Force-quit. Reopen.
   - **If still logged in:** proceed to step 8.
   - **If logged out:** stop. Do not promote to wider TestFlight. This is the trigger to expedite Plan B (JWT). Document the iOS version, device model, and any Safari Web Inspector cookie observations, then begin Plan B.
8. **TestFlight verification — airplane mode.** With cookie persistence confirmed:
   - Toggle airplane mode, force-quit, relaunch. Confirm app shell renders, `OfflineBanner` visible, no white screen.
   - Toggle airplane mode off. Confirm data loads, banner disappears.
   - Mid-session toggle test (see Testing plan above).
9. **Update `CLAUDE.md`.** Add the "Deploy model" subsection under "Capacitor / iOS". Correct the now-stale "webview origin matches the API origin" claim. Commit and push.
10. **Promote TestFlight build to wider group** only after steps 7–9 pass.

## Rollback plan

Three rollback paths, in order of cost.

1. **iOS-only regression discovered post-TestFlight, web still fine.** Set `PRODUCTION_SERVER_URL=https://www.schoolbustracker.org` as a build env var in Xcode (Scheme → Run → Arguments → Environment Variables, or via `.xcconfig`). `npm run build && npx cap sync ios`, archive a new build. The conditional in `capacitor.config.ts` resurrects `server.url`, restoring old remote-bundle behavior. New TestFlight build returns to pre-fix behavior in ~30 minutes + Apple review.
2. **Web-only regression from CORS or cookie change.** `git revert` the server commit, push to Railway. CORS middleware + `sameSite` flip are isolated to `server/index.ts` and `server/customAuth.ts`, so revert is surgical. Note: this re-breaks iOS if the bundled build has already shipped — prefer rollback path 1 if both are live.
3. **Total rollback.** Revert all commits from this plan in order. Redeploy server. Cut a new iOS build with `PRODUCTION_SERVER_URL` set. App returns to pre-fix state (minus the white-screen-offline bug which motivated this work).

**Keep the `PRODUCTION_SERVER_URL` escape hatch in `capacitor.config.ts` for at least one full release cycle** (~2 weeks of TestFlight stability) after this lands. Do not remove casually — it is the only zero-code-change safety net.

## Open questions

1. **TestFlight deploy cycle acceptable?** After this lands, client-only iOS fixes need a TestFlight cycle (~24h Apple review for non-expedited; expedited usually a few hours). DeShaun should confirm this is acceptable given his current iteration speed. If not, consider Capacitor Live Updates (Appflow) in a future plan.
2. **Production web origin — `www.` or apex?** `CLAUDE.md` references `https://www.schoolbustracker.org` consistently. Confirm whether `https://schoolbustracker.org` (apex) is also a live host that hits the same Railway service, or whether it redirects to `www.`. Both should be in the CORS allowlist if both are reachable; if apex 301-redirects to `www.`, the apex entry is defensive but not load-bearing.
3. **Stripe checkout return URL.** Where does the `create-checkout-session` handler set Stripe's `success_url` and `cancel_url`? If absolute `https://www.schoolbustracker.org/...`, the iOS WKWebView lands on the web origin after checkout and stays there for the rest of the session (webview keeps whatever it last navigated to). Options:
   - (a) Use a custom URL scheme deeplink (`com.topnotchtrainingcenter.schoolbustracker://...`) as the return URL on native builds.
   - (b) Accept the web detour as acceptable since onboarding is a one-time flow.
   - (c) Open Stripe checkout in the system browser (`window.open` with `_system` target or Capacitor Browser plugin) and use Universal Links to return.
   
   Builder must inspect the server's checkout-session creation handler and decide before shipping step 5. Re-flagged from the prior plan.
4. **Keep `PRODUCTION_SERVER_URL` escape hatch beyond first release?** Recommendation: **keep indefinitely.** Cost is one `if` in `capacitor.config.ts`; benefit is a working rollback that doesn't require code changes. Confirm DeShaun agrees.
5. **Live-reload during dev (`npx cap run ios -l --external`).** Adds an origin like `http://<dev-machine-ip>:5173`. Skip in v1 since DeShaun historically tests against deployed Railway. Add later if live-reload becomes part of the workflow.
6. **Google Fonts (`fonts.googleapis.com`) in `client/index.html`.** Will fail offline. System-font fallback is graceful. Recommend deferring self-hosting to a follow-up.

## Plan B preview

JWT migration removes the cross-origin cookie risk entirely. The server issues a signed JWT on login (storing user/session ID, expiry, role); the client stores it in iOS Keychain via `@capacitor/preferences` (or a more secure option like `capacitor-secure-storage-plugin`) and sends it as `Authorization: Bearer <token>` on every request. Session middleware (`connect-pg-simple`) is replaced or augmented with JWT verification middleware. Refresh-token rotation, logout (server-side token revocation list or short-lived access tokens + revocable refresh tokens), and CSRF posture (no longer needed for stateless JWT) all need their own design. Plan B will be its own document; do not detail it here. Plan A is intentionally a non-breaking precursor — if cookies hold up, Plan B can be deprioritized; if they don't, Plan B becomes urgent.
