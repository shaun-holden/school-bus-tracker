# Plan: Offline-readiness fix — bundle React app into iOS

> **HIGH RISK** — touches Capacitor native deploy model, server CORS, and the session-cookie policy that gates every authenticated request. A misconfigured CORS allowlist or wrong `sameSite` value will silently break login for either the web build or the iOS build (or both). Requires manual review and a staged rollout before any builder agent ships it.

## Goal
After the splash screen dismisses on a cold launch in airplane mode, render the React app shell from the local bundle instead of a permanent white screen, while keeping the existing same-origin web experience at `https://www.schoolbustracker.org` unchanged.

## Why this is risky
1. **Silent CORS breakage.** Once the iOS bundle is local (`capacitor://localhost`), every API call becomes cross-origin. A typo in the allowlist, a wrong `credentials` setting, or omitting an `OPTIONS` preflight handler manifests as "login appears to work then 401s on the next call" — not a loud error.
2. **Session cookie loss.** Today the session cookie is `sameSite: 'lax'`. Cross-site requests from `capacitor://localhost` to `https://www.schoolbustracker.org` will not carry that cookie. Flipping to `sameSite: 'none'` is required for iOS, but flipping it incorrectly (e.g., without `secure: true` in prod, or applied to dev too) breaks the web build's cookie or browser console warnings.
3. **Missed fetch sites.** Any `fetch('/api/...')` that does not get rewritten through the new base-URL helper will hit `capacitor://localhost/api/...` on iOS and 404 immediately. We have inventoried 8 call sites today but any new code added between now and the TestFlight cut needs to follow the new pattern.
4. **Deploy-cycle regression.** Today a client-only bug fix ships via Railway deploy in minutes. Once bundled, the same fix needs `cap sync` + Xcode archive + TestFlight + Apple review (~24h for non-expedited). The `PRODUCTION_SERVER_URL` escape hatch documented below mitigates this but is itself a foot-gun if forgotten.
5. **Push deeplink URLs.** Anything in `pushService.ts` or `use-web-push.ts` that builds an absolute URL on the assumption of a single origin will deeplink to the wrong place on iOS.
6. **Splash logic timing.** The existing splash hide is gated on `useAuth().isLoading` flipping to `false`. On bundle-load, the first `/api/auth/user` call may now reject quickly with a network error (offline) or succeed quickly (online). We need to confirm both paths still dismiss the splash and never leave it stuck.

## Context
- Affected user flow: every flow on the iOS app (parent, driver, admin, master_admin). Web app is unaffected by design — all changes must remain no-ops for browser users.
- Affected subscription tiers: none — this is platform-level plumbing.
- Why this approach over alternatives: DeShaun has stated a preference for "pure bundled for production stability." The alternative (continuing to load the bundle from Railway) was just demonstrated in TestFlight build 4 to fail catastrophically when offline. Service-worker-based hybrid caching is a larger project and is explicitly deferred.

## Files to change

### Capacitor / iOS configuration

- **`capacitor.config.ts`** — change two things:
  1. Invert the default of the `PRODUCTION_SERVER_URL` conditional. Today it defaults to `'https://www.schoolbustracker.org'` (line 6), which means the bundle is *never* used unless the env var is explicitly unset. New behavior: default to empty/undefined so the bundle is used, and only configure `server.url` when `PRODUCTION_SERVER_URL` is explicitly set as a build env var. Update the comment block above the const accordingly so future maintainers understand the inversion.
  2. Drop `plugins.SplashScreen.launchShowDuration` from `5000` to `2000` (line 29). The 5s failsafe was sized for a remote bundle download over cellular; bundle load is essentially instant, so 2s is enough headroom for a genuinely broken JS bundle to be detected without making every cold launch feel sluggish.

### Client — API base URL plumbing

- **`client/src/lib/apiBase.ts`** **(NEW)** — single source of truth for the API origin. Exports a `getApiBase()` (or constant `API_BASE`) that returns:
  - `import.meta.env.VITE_API_BASE_URL` when `Capacitor.isNativePlatform()` is true, falling back to an explicit production default of `https://www.schoolbustracker.org` if the env var is missing (with a `console.warn` so the misconfiguration is visible during dev).
  - Empty string (`''`) otherwise, so web builds keep using same-origin relative paths exactly as today.
  Also exports a small helper `apiUrl(path: string)` that prepends the base when `path` starts with `/api`, leaving fully-qualified URLs and non-API relative paths untouched. The helper must tolerate `path` starting with `/` or not.

- **`client/src/lib/queryClient.ts`** — central choke point. Two changes:
  1. In `apiRequest()` (line 10), wrap the `url` argument with `apiUrl(url)` before passing it to `fetch`. `credentials: 'include'` is already set (line 19) — keep it.
  2. In `getQueryFn()`'s `queryFn` (line 31), the call `fetch(queryKey.join("/") as string, ...)` reconstructs the URL from the query key. Wrap that joined string with `apiUrl(...)`. `credentials: 'include'` already present (line 33) — keep it.
  Do not change retry, refetchInterval, staleTime, or gcTime — those are tuned for the existing live-data flow.

- **`client/src/App.tsx`** (line 42) — direct `fetch` to `/api/users/${user.id}/role`. Replace with `apiRequest(`/api/users/${user.id}/role`, 'PATCH', { role: pendingRole })` so it picks up the base URL via the shared helper. This also gets correct `credentials: 'include'` for free.

- **`client/src/lib/distanceUtils.ts`** (line 79) — this fetch hits `https://nominatim.openstreetmap.org/...`, not our API. Leave it unchanged. Add an inline comment noting why (third-party API, not affected by base URL). It will still fail offline, but that is geocoding's existing behavior and orthogonal to this fix.

- **`client/src/pages/driver-password-setup.tsx`** (line 44) — direct `fetch` inside a `useQuery` `queryFn`. Replace with `fetch(apiUrl(`/api/driver-invitation/verify?token=${encodeURIComponent(token)}`), { credentials: 'include' })`. Note: this endpoint is unauthenticated, but adding `credentials: 'include'` is still correct so the CORS layer recognises the cross-origin call shape.

- **`client/src/pages/admin-dashboard.tsx`** — six direct `fetch` sites all of the form `fetch(`/api/routes/${routeId}/...`)`:
  - Line 161, 1354, 1355, 1753, 1851, 2512.
  Each one must be wrapped: `fetch(apiUrl(`/api/routes/${routeId}/...`), { credentials: 'include' })`. Three of them already pass `{ credentials: 'include' }` (1354, 1355, 1753, 1851); the other three (161, 2512) currently omit it. Add it everywhere — same-origin web is unaffected by adding `credentials: 'include'`, but cross-origin iOS will silently drop the cookie without it.

- **`client/src/hooks/use-web-push.ts`** — already uses `apiRequest()` (line 27), so it picks up the base URL automatically once `queryClient.ts` is updated. **No code change required**, but verify after the queryClient change that the FCM token POST still succeeds from iOS.

- **`client/src/pages/onboarding-plans.tsx`** (line 37) — assigns `window.location.href = data.url` where `data.url` is a Stripe-hosted checkout URL. This is a fully-qualified `https://` URL returned by the server, so it works correctly from `capacitor://localhost` as an outbound navigation. **No change required**, but call out in testing: confirm the Stripe checkout redirect actually opens (it may pop the system Safari, which is the desired behavior on iOS).

### Client — offline UX

- **`client/src/hooks/use-auth.ts`** — currently `userQuery` has `retry: false` and `staleTime: 5 * 60 * 1000`. When the `/api/auth/user` call fails with a network error (offline launch), `useAuth().isLoading` will flip to `false` and `userQuery.error` will be set. Today, `App.tsx`'s `Router` falls back to rendering the `<Route path="/" component={Landing} />` branch when `!isAuthenticated`, which is acceptable behavior (the Landing page renders without any API calls). **No code change required** in `use-auth.ts` itself, but:
  - Verify the Landing page renders without any synchronous API dependency. (Spot-check `client/src/pages/landing.tsx` — confirm it has no `useQuery` for `/api/...` data that would gate render.)
  - The splash hide already fires on `!isLoading` regardless of authentication state (`App.tsx:60`), so an offline launch will still dismiss the splash and show the Landing page — that is the v1 offline UX.

- **`client/src/components/shared/OfflineBanner.tsx`** **(NEW)** — minimal banner component:
  - Listens for `window.addEventListener('online' / 'offline', ...)` and renders a sticky top bar reading "No connection — some data may be out of date" with a "Retry" button that calls `queryClient.invalidateQueries()`.
  - Hidden by default when `navigator.onLine === true`.
  - Mount it once in `App.tsx`'s `AppShell` (sibling of `<Toaster />`) so it appears on every route.
  - Keep the component dead simple — no animations, no toast spam. The goal is to acknowledge offline state, not solve it.

- **`client/src/lib/splash-context.tsx`** — **no code change required**. The existing `Capacitor.isNativePlatform()` guard (line 29) and `hasHiddenRef` idempotency (line 30–31) already handle both online and offline cold-launch paths. Confirm via the testing plan below.

### Server — CORS

- **`server/index.ts`** — insert a CORS middleware *after* the Stripe webhook raw-body handler (which must remain first because it relies on the raw body buffer) but *before* `app.use(express.json())` (line 40). Two acceptable approaches:
  1. Add the `cors` package as a dependency (`npm install cors @types/cors`), call `app.use(cors({ origin: [...allowlist], credentials: true }))`. This is the conventional choice.
  2. Hand-roll a small middleware that sets `Access-Control-Allow-Origin` (echo'd from `req.headers.origin` if in allowlist), `Access-Control-Allow-Credentials: true`, `Access-Control-Allow-Methods`, `Access-Control-Allow-Headers: Content-Type`, and short-circuits `OPTIONS` with `204`. Avoids the new dependency.
  Recommend option 1 for clarity and battle-testing. Allowlist:
  - `'capacitor://localhost'` — iOS production
  - `'http://localhost'` — Capacitor live-reload during dev
  - `'ionic://localhost'` — legacy iOS scheme, harmless to include for safety
  - `'https://www.schoolbustracker.org'` — explicit so the web build still works under credentialed CORS (technically same-origin, so the browser won't trigger CORS, but listing it is defensive against future subdomain splits)
  - `'https://schoolbustracker.org'` — apex, in case marketing ever links there
  Do **not** use `'*'` for `Access-Control-Allow-Origin` — that's incompatible with `Access-Control-Allow-Credentials: true` per the CORS spec, and most browsers will reject the response silently.
  The allowlist should be a `const` exported (or at least declared) at the top of `server/index.ts` so it's grep-able and there's one place to add origins later.

### Server — session cookie

- **`server/customAuth.ts`** — `getSession()` cookie config (lines 84–89). Change `sameSite` from the literal `'lax'` to:
  - `'none'` when `NODE_ENV === 'production'` (required for cross-site cookies from `capacitor://localhost`, only legal when `secure: true`, which is already conditional on production)
  - `'lax'` otherwise (preserves dev behavior, no behavior change for `npm run dev` in a browser)
  Concretely the line becomes a conditional expression that mirrors the existing `secure` line above it. Do not change `httpOnly`, `maxAge`, or `resave`.

- **`server/pushService.ts`** — read through and confirm no client-bound URL is constructed assuming a particular origin. The FCM `fcmOptions.link: "/"` on line 186 is a relative root path, which the FCM SDK resolves against the origin of the service worker. When the bundle is on `capacitor://localhost`, this becomes `capacitor://localhost/` — that should still route to the local index.html. **No change required**, but flag for verification during iOS testing: tap an FCM notification while offline and confirm the app opens to a sensible page (Landing, not a white screen).

## Database changes
None.

## API contract
No new endpoints. Behavior change on every existing endpoint:
- Will now respond with `Access-Control-Allow-Origin: <echoed origin>` and `Access-Control-Allow-Credentials: true` headers when called from an allowlisted origin.
- Will respond to `OPTIONS` preflights with `204`.
- Session cookie will carry `SameSite=None; Secure` in production (was `SameSite=Lax`).

## iOS / Capacitor considerations
- **Requires a new TestFlight build.** Both the `capacitor.config.ts` changes and the bundle contents must be re-packaged.
- After client build completes, run `npx cap sync ios` to copy `dist/public` into the iOS project and apply config changes.
- Open Xcode, increment build number, archive, upload to App Store Connect, submit to TestFlight.
- Confirm in Xcode that the `PRODUCTION_SERVER_URL` env var is *not* set in the build environment (it should not be, since DeShaun builds locally — but worth checking the Xcode scheme env vars).
- After this ships, every future client-only change requires the same TestFlight cycle. There is no further iOS automation in this plan.

## Stripe / billing considerations
- The Stripe checkout redirect in `onboarding-plans.tsx` (line 37) uses `window.location.href = data.url` to navigate to a Stripe-hosted page. On iOS WKWebView, this should open the Stripe page in the in-app webview. Verify that after Stripe redirects back, the return URL (configured server-side in `create-checkout-session`) lands somewhere the iOS app can handle. If the return URL is `https://www.schoolbustracker.org/onboarding/success`, the WKWebView will navigate there and *stay on the web origin*, defeating the bundle. **Open question below.**
- No Stripe webhook changes. The raw-body handler in `server/index.ts:12–38` must remain mounted *before* the new CORS middleware and before `express.json()` — verify ordering.

## Testing approach

### Manual — web (must still work)
1. `npm run build && npm start` locally, hit `http://localhost:5000` in a browser, log in. Confirm:
   - Cookie set with `SameSite=Lax` (in dev) or `SameSite=None; Secure` (when running with `NODE_ENV=production`).
   - All authenticated requests succeed.
   - No CORS errors in browser console.
2. Deploy to Railway, hit `https://www.schoolbustracker.org`, repeat. Same-origin requests should not trigger any visible CORS handshake but headers should be present.

### Manual — iOS native (online)
1. Build iOS bundle via Xcode, install on a real device over Wi-Fi.
2. Launch cold, log in. Confirm `/api/auth/user`, route data, parent/student data all load.
3. Force-quit, relaunch, confirm session cookie persisted and user is auto-logged-in.
4. Use Safari Web Inspector against the WKWebView to confirm requests show `Origin: capacitor://localhost` and the response carries `Access-Control-Allow-Origin: capacitor://localhost`, `Access-Control-Allow-Credentials: true`.

### Manual — iOS native (offline)
1. With app installed and previously logged in, toggle airplane mode.
2. Force-quit and relaunch. Confirm:
   - Splash dismisses within ~2.5s (2s `launchShowDuration` + ~600ms `MIN_DISPLAY_MS` floor in `splash-context.tsx`).
   - The Landing page renders (or the cached user view, if the `useAuth` query returned its cached value before going stale).
   - The new `OfflineBanner` shows.
   - Tapping Retry while still offline reproduces the banner without crashing.
3. Disable airplane mode mid-session; confirm the banner disappears on the `'online'` event and a `queryClient.invalidateQueries()` refills data.

### Manual — iOS native (airplane mode mid-session)
1. Log in online. Navigate to a dashboard. Confirm data renders.
2. Toggle airplane mode. Confirm:
   - Banner appears.
   - Existing rendered data remains visible (TanStack Query default behavior — stale data is shown, not cleared).
   - New requests fail visibly via existing toast/error UI but do not blank the screen.
3. Toggle airplane mode off. Confirm data refreshes.

### Automated
- No new test files in this PR. Reason: CORS and cookie behavior are integration-level and hard to fake in vitest without spinning a real HTTP server. The existing `tests/auth-validation.test.ts` and `tests/multi-tenant.test.ts` continue to cover the policy shape.
- Run `npm run check` (TypeScript) and `npm test` (existing vitest suite) before deploy per DeShaun's workflow.

## Migration order

This ordering exists specifically to avoid a window where web is broken or iOS is half-broken:

1. **Server-side ship (Railway only).** Add CORS middleware in `server/index.ts` and flip `sameSite` to `'none'` in production in `server/customAuth.ts`. Build, test, commit, push, Railway deploys.
   - Why first: additive. Web at `https://www.schoolbustracker.org` is same-origin so CORS headers are inert. `SameSite=None; Secure` still works for same-origin requests. Existing iOS build (build 4, remote bundle) continues to function unchanged because it's also same-origin.
2. **Verify web in production.** Log in on the live web app, exercise admin/driver/parent flows for ~5 minutes. Confirm no regressions.
3. **Client base-URL plumbing ship (Railway only, still no iOS impact).** Add `client/src/lib/apiBase.ts`, update `queryClient.ts`, refactor the inventoried fetch sites in `App.tsx`, `driver-password-setup.tsx`, and `admin-dashboard.tsx`. Add `OfflineBanner.tsx` and mount in `AppShell`.
   - On web, `apiUrl()` returns the empty string for non-native, so every wrapped call resolves to the same relative path as today. Behavior identical.
   - Build, test, commit, push, Railway deploys.
4. **Verify web again.** Same smoke test as step 2.
5. **Flip Capacitor config to bundled.** Change `capacitor.config.ts` to default-empty `PRODUCTION_SERVER_URL` and drop splash to 2000ms. Run `npm run build && npx cap sync ios`.
6. **TestFlight build.** Xcode archive, upload, internal-test on at least one real iOS device. Run the full iOS test matrix above (online, offline cold launch, mid-session airplane mode toggle).
7. **Promote to wider TestFlight group** only after the test matrix passes.

## Rollback plan

Three rollback paths, in order of cost:

1. **iOS-only regression discovered post-TestFlight, web still fine.** Set `PRODUCTION_SERVER_URL=https://www.schoolbustracker.org` as a build env var in Xcode (Scheme → Run → Arguments → Environment Variables, or via a `.xcconfig` if one exists). Run `npm run build && npx cap sync ios`, archive a new build. The conditional in `capacitor.config.ts` will resurrect the `server.url` configuration, restoring the old remote-bundle behavior. New TestFlight build returns the app to pre-fix behavior in ~30 minutes plus Apple review.
2. **Web-only regression from the CORS or cookie change.** `git revert` the server commit, push to Railway. CORS middleware and `sameSite` flip are isolated to two files (`server/index.ts`, `server/customAuth.ts`) so the revert is surgical. Note: this will re-break iOS if the bundled build has already shipped, so prefer rollback path 1 if both are live.
3. **Total rollback.** Revert all commits from this plan in order. Re-deploy server. Cut a new iOS build with `PRODUCTION_SERVER_URL` set. App returns to pre-fix state, minus the white-screen-offline bug which is what motivated this work in the first place.

**Keep the `PRODUCTION_SERVER_URL` escape hatch in `capacitor.config.ts` for at least one full release cycle (~2 weeks of TestFlight) after this lands.** Do not remove it casually — it is the only safety net.

## Open questions

1. **Deploy-cycle confirmation.** Confirmed implicit, but worth stating explicitly: after this lands, client-only fixes need a TestFlight cycle (~24h Apple review for non-expedited, or ~hours for expedited). DeShaun should confirm this is acceptable given his current iteration speed.
2. **TanStack Query persistence (`@tanstack/react-query-persist-client`).** Should v1 include localStorage/IndexedDB persistence so that an offline cold launch can render cached dashboard data instead of just the Landing page? Recommendation: **defer**. The current v1 plan only ensures the app shell renders and clearly signals offline state. Full offline data caching is a separate, larger project with its own staleness/security/storage-budget considerations (especially for multi-tenant data — a logged-out cache for tenant A must not leak when tenant B logs in on the same device).
3. **`PRODUCTION_SERVER_URL` escape hatch lifetime.** Should we keep it indefinitely as a permanent safety valve, or remove it after the bundled build proves stable (e.g., one full release cycle)? Recommendation: **keep indefinitely**. Cost is one `if` in `capacitor.config.ts`; benefit is a working rollback that doesn't require code changes.
4. **Stripe return URL.** Where does the `create-checkout-session` endpoint set Stripe's `success_url` and `cancel_url`? If they are absolute `https://www.schoolbustracker.org/...` paths, on iOS the WKWebView will navigate to the web origin after checkout and effectively kick the user out of the bundled app for the rest of the session (since the webview stays on whatever it last navigated to). Need to confirm whether: (a) the iOS app should use a custom URL scheme deeplink (`com.topnotchtrainingcenter.schoolbustracker://...`) as the return URL on native builds, or (b) the existing web-URL return is acceptable because the user typically completes onboarding once and a brief detour to the web view is fine. **The builder agent must inspect the server's checkout-session creation handler and decide before shipping step 5.**
5. **External resources in `client/index.html`.** Google Fonts (`fonts.googleapis.com`) and the Replit dev banner are loaded from external origins. These will fail offline. Fonts fall back gracefully to system fonts. The Replit banner is dev-only. Recommendation: leave as-is for v1; consider self-hosting fonts in a follow-up.
6. **Allowlist for Capacitor live-reload during dev.** If DeShaun uses `npx cap run ios -l --external` for live reload, the origin will be `http://<dev-machine-ip>:5173` or similar. Do we want to add a wildcard for `http://*` in dev, or skip live-reload support entirely? Recommendation: skip for v1 — DeShaun has historically tested against deployed Railway. Add later if live-reload becomes part of the workflow.
