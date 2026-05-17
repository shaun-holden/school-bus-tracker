# Plan: Offline-readiness fix — Phase A (Railway-only, zero iOS impact)

> **MEDIUM RISK** — touches the production session cookie's `sameSite` and introduces a new CORS middleware on every API response. Both are inert for same-origin web users today, but a misconfiguration silently breaks authenticated requests. Phase A intentionally ships nothing iOS-facing, so a regression can be reverted with a single `git revert` and a Railway redeploy.

## Goal
Land the server CORS layer, the session cookie `sameSite` flip, the client API-base plumbing, the inventoried direct-`fetch` refactors, and a minimal `OfflineBanner` — all behind no-op behavior for current web users — so that the subsequent Phase B (Capacitor bundle flip + new TestFlight build) becomes a config-only change with no further server or shared-client edits.

This is **Phase A of two**. Phase B (covered in `plans/offline-readiness-fix.md`) flips `capacitor.config.ts` to default-empty `PRODUCTION_SERVER_URL`, drops splash duration to 2000ms, and cuts a new TestFlight build. Phase B should not be started until Phase A has been deployed to Railway and verified in production for at least one full smoke cycle.

### Gate to Phase B
Phase A is gate-cleared for Phase B when (a) deployed to Railway for at least 24 hours, (b) no rollback occurred, (c) at least one real user authenticated session is observed in Railway logs, and (d) zero CORS-related errors in Railway logs over that window.

## Context
- Affected user flow: none visibly. All Phase A changes are no-ops for browser users hitting `https://www.schoolbustracker.org`. CORS headers are inert on same-origin requests; `sameSite=None; Secure` is legal and behaves identically to `Lax` for same-origin; `apiUrl()` returns `''` on web so wrapped fetches resolve to the same relative paths; the `OfflineBanner` only renders when `navigator.onLine === false`.
- Affected subscription tiers: none — platform plumbing.
- Why this approach: it is the smallest set of changes that lets the Phase B iOS bundle flip be a pure config change. Splitting Phase A from Phase B isolates the rollback surface — if either half regresses, the other is untouched.

## Files to change

Total: **9 files** — 3 server, 6 client.

### Server — CORS

- **`server/index.ts`** — insert a CORS middleware **after** the Stripe webhook raw-body handler (lines 12–38) but **before** `app.use(express.json())` (currently line 40). **DECIDED:** use the `cors` npm package — `npm install cors @types/cors`, then call `app.use(cors({ origin: ALLOWED_ORIGINS, credentials: true }))`. The package is ~4KB, battle-tested, and the explicit option shape is easier to audit than a hand-rolled middleware. No hand-rolled fallback.

  Declare and **export** a single `const ALLOWED_ORIGINS` at the top of `server/index.ts` (above `const app = express();`) so future origin additions have one obvious home and the new CORS test (see below) can import it directly:
  ```
  capacitor://localhost          // iOS production bundle (used in Phase B)
  http://localhost               // Capacitor live-reload during dev
  ionic://localhost              // legacy iOS scheme, harmless to include
  https://www.schoolbustracker.org   // explicit, defensive against future subdomain splits
  https://schoolbustracker.org       // apex, in case marketing ever links there
  ```
  Sub-decision for the builder: keep `ALLOWED_ORIGINS` co-located in `server/index.ts` (matches the current plan), rather than extracting to a new `server/middleware/cors.ts` module. Revisit only if a second consumer appears.

  Do **not** use `'*'` for `Access-Control-Allow-Origin` — that is incompatible with `Access-Control-Allow-Credentials: true` per the CORS spec, and browsers reject the response silently.

  Ordering invariant: the Stripe webhook raw-body handler at `server/index.ts:12–38` must stay first because it relies on the raw `Buffer` body for signature verification. The new CORS middleware sits between it and `express.json()` at the current line 40.

- **`tests/cors.test.ts`** **(NEW)** — vitest unit test that imports `ALLOWED_ORIGINS` from `server/index.ts` and asserts membership of exactly these five origin strings, no more, no less: `capacitor://localhost`, `ionic://localhost`, `http://localhost`, `https://www.schoolbustracker.org`, `https://schoolbustracker.org`. From `tests/cors.test.ts`, the import path to reach the allowlist is `from '../server/index'`. Rationale for the omitted `http://localhost:5173`: Vite dev is mounted by Express on `:5000` (same-origin), so CORS is never triggered for `:5173` — not part of the allowlist.

### Server — session cookie

- **`server/customAuth.ts`** — the cookie config currently at lines 84–89 reads:
  ```
  cookie: {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'lax',
    maxAge: sessionTtl,
  }
  ```
  Change line 87 to a conditional that mirrors the `secure` line above it:
  ```
  sameSite: process.env.NODE_ENV === 'production' ? 'none' : 'lax',
  ```
  - `'none'` in production is required for the Phase B iOS bundle (cross-site from `capacitor://localhost` to `https://www.schoolbustracker.org`). It is only legal when `secure: true`, which is already true in production via the line above.
  - `'lax'` elsewhere preserves dev and test behavior unchanged.
  Do not touch `httpOnly`, `secure`, `maxAge`, `resave`, or `saveUninitialized`.

### Client — API base URL plumbing

- **`client/src/lib/apiBase.ts`** **(NEW)** — single source of truth for the API origin. Must export exactly these two symbols with the following signatures:
  ```ts
  /**
   * Returns the API origin to prepend to /api paths.
   * - On Capacitor native (iOS), returns import.meta.env.VITE_API_BASE_URL
   *   if set, otherwise the hardcoded production fallback
   *   'https://www.schoolbustracker.org' (with a console.warn if the env var
   *   is missing, so the misconfig is loud during dev).
   * - On web, returns '' so relative paths resolve same-origin (today's behavior).
   */
  export function getApiBase(): string;

  /**
   * Prepends the API base to a path when the path begins with '/api'.
   * - Fully-qualified URLs (anything matching /^https?:\/\//) are returned unchanged.
   * - Non-API relative paths are returned unchanged.
   * - Tolerates `path` starting with '/' or not — internally normalize so the
   *   result has exactly one '/' between origin and path.
   */
  export function apiUrl(path: string): string;
  ```
  Implementation must use `Capacitor.isNativePlatform()` from `@capacitor/core` (already a dependency; see `client/src/main.tsx:2` and `client/src/lib/splash-context.tsx:2` for existing imports of the same module). No new dependencies.

- **`client/src/lib/queryClient.ts`** — two wraps, no other changes:
  1. Line 15: `await fetch(url, { ... })` becomes `await fetch(apiUrl(url), { ... })`.
  2. Line 32: `await fetch(queryKey.join("/") as string, { ... })` becomes `await fetch(apiUrl(queryKey.join("/") as string), { ... })`.
  Import `apiUrl` from `./apiBase` at the top of the file. **Do not** modify `credentials: 'include'` (already correct on both fetches), `throwIfResNotOk`, the `on401` branching, or any `QueryClient` default option (`refetchInterval`, `refetchOnWindowFocus`, `staleTime`, `gcTime`, `retry`) — those are tuned for the existing live-data flow.

### Client — direct-fetch refactors (verified against current code)

All line numbers below were re-verified against the current working tree on this branch. None of these sites have been migrated to `apiRequest()` since the parent plan was drafted.

- **`client/src/App.tsx:42`** — direct `fetch` for the role PATCH inside the `useEffect` at lines 33–52. Replace the entire `fetch(...)` call (lines 42–46) with:
  ```ts
  apiRequest(`/api/users/${user.id}/role`, 'PATCH', { role: pendingRole })
  ```
  Add `apiRequest` to the existing `from "./lib/queryClient"` import at line 3. The `.then(...)` chain that clears `sessionStorage` and reloads (lines 46–49) stays unchanged — `apiRequest` returns a Promise that resolves once the response is OK.

- **`client/src/pages/driver-password-setup.tsx:44`** — direct `fetch` inside a `useQuery` `queryFn` (lines 40–50). The endpoint is unauthenticated and the function inspects `response.ok` and parses error JSON manually, so keep the raw `fetch` shape; only wrap the URL and add `credentials: 'include'`:
  ```ts
  const response = await fetch(
    apiUrl(`/api/driver-invitation/verify?token=${encodeURIComponent(token)}`),
    { credentials: 'include' }
  );
  ```
  Adding `credentials: 'include'` is a no-op for same-origin web but is required so the Phase B cross-origin call presents a recognizable shape to the CORS layer. Import `apiUrl` from `@/lib/apiBase`.

- **`client/src/pages/admin-dashboard.tsx`** — six fetch sites. Verified line numbers and current credential state:
  | Line | Current shape | Change |
  |------|---------------|--------|
  | 161 | `fetch(\`/api/routes/${route.id}/schools\`)` — no credentials | Wrap with `apiUrl(...)`, add `{ credentials: 'include' }` |
  | 1354 | `fetch(\`/api/routes/${routeId}/stops\`, { credentials: 'include' })` | Wrap with `apiUrl(...)`, keep credentials |
  | 1355 | `fetch(\`/api/routes/${routeId}/schools\`, { credentials: 'include' })` | Wrap with `apiUrl(...)`, keep credentials |
  | 1753 | `fetch(\`/api/routes/${routeId}/schools\`, { credentials: 'include' })` | Wrap with `apiUrl(...)`, keep credentials |
  | 1851 | `fetch(\`/api/routes/${routeId}/schools\`, { credentials: 'include' })` | Wrap with `apiUrl(...)`, keep credentials |
  | 2512 | `fetch(\`/api/routes/${routeId}/schools\`)` — no credentials | Wrap with `apiUrl(...)`, add `{ credentials: 'include' }` |

  Correction vs the parent plan: the parent plan listed 1354, 1355, 1753, 1851 as "already passing credentials" (four sites) and 161, 2512 as the two missing. That is correct as of today — all four already pass `{ credentials: 'include' }`, only 161 and 2512 need it added.

  Import `apiUrl` from `@/lib/apiBase` once at the top of the file (the existing `import { apiRequest, queryClient } from "@/lib/queryClient";` at line 19 stays). Do not refactor these into `apiRequest()` calls — three of them branch on `response.ok` before parsing and changing the control flow is out of scope for Phase A.

- **`client/src/lib/distanceUtils.ts:79`** — Nominatim geocoding call. **Verified unchanged at line 79.** This hits `https://nominatim.openstreetmap.org/...`, not our API. Leave it alone. Optionally add a single-line comment above the `fetch` noting "third-party API — not routed through apiUrl()" so the next person grepping for stray `fetch(` calls knows it is intentional. No functional change either way.

### Client — offline UX

- **`client/src/components/shared/OfflineBanner.tsx`** **(NEW)** — minimal sticky banner. Behavior:
  - On mount, register `window.addEventListener('online', ...)` and `window.addEventListener('offline', ...)`. Initialize internal state from `navigator.onLine`.
  - When offline, render a single full-width bar pinned to the top of the viewport with text "No connection — some data may be out of date" and a "Retry" button. The Retry button calls `queryClient.invalidateQueries()` (import the singleton from `@/lib/queryClient`). It does **not** call any specific API itself — invalidation is enough; queries that are currently mounted will refetch.
  - **Retry button disabled state.** The Retry button must be disabled when `navigator.onLine === false`. On hover, its tooltip reads exactly: `Reconnect to retry`. Because the component already listens to `window` `online`/`offline` events and re-renders on transition, the button re-enables automatically when connectivity returns. (In practice the banner itself unmounts when online, so the disabled state is only visible during the offline window — that is the intended UX.)
  - When online, render `null`.
  - Clean up both listeners in the effect's cleanup function.
  - No animations, no toast spam, no role gating. Plain Tailwind, consistent with the existing `components/ui` styling. Keep the component under 50 lines.

- **`client/src/App.tsx`** — mount `OfflineBanner` once inside the `AppShell` function (lines 109–121) as a sibling of `<Toaster />` at line 115. Place it directly above `<Toaster />` so the banner sits above any toasts visually:
  ```tsx
  <TooltipProvider>
    <OfflineBanner />
    <Toaster />
    <Router />
  </TooltipProvider>
  ```
  Add the import at the top of the file alongside the existing `@/components/ui/toaster` import.

## Database changes
None.

## API contract
No new endpoints. Behavior changes apply to every existing endpoint:
- Responses will carry `Access-Control-Allow-Origin: <echoed allowlisted origin>` and `Access-Control-Allow-Credentials: true` when the request supplies an `Origin` header in the allowlist. Same-origin browser requests (which omit `Origin` or send the same one) are unaffected in practice.
- `OPTIONS` preflights to any path will respond `204` with the headers above. The existing handler matrix is unchanged.
- The production session cookie will carry `SameSite=None; Secure` instead of `SameSite=Lax`. Dev and test remain `SameSite=Lax`.

## iOS / Capacitor considerations
**None — Phase A is web only.**

No change to `capacitor.config.ts`. No `npx cap sync`. No Xcode work. No new TestFlight build. The existing iOS build (build 4 in TestFlight, which loads the remote bundle from `https://www.schoolbustracker.org`) continues to function unchanged after Phase A ships, because it is still same-origin — the CORS headers are inert and the cookie still attaches.

If, while reviewing this plan, you find yourself wanting to touch `capacitor.config.ts`, the splash launchShowDuration, `cap sync`, or anything Xcode-related, **stop** — that is Phase B work and belongs in the parent plan's migration steps 5–7.

## Stripe / billing considerations
**None for Phase A.** The Stripe webhook raw-body handler in `server/index.ts:12–38` remains the first middleware. The new CORS middleware sits below it. No webhook route, signature verification, checkout-session, or subscription-tier logic is touched. The Stripe return-URL question (parent plan Open Question #4) is a Phase B concern because it only matters once the iOS app is on a different origin than the Stripe redirect target.

## Testing approach

### Manual — web only (this is the whole testing matrix for Phase A)

1. **Local dev mode** — `npm run dev`, hit `http://localhost:5000`, log in.
   - Confirm the session cookie in DevTools shows `SameSite=Lax` (because `NODE_ENV=development`).
   - Confirm no CORS errors in the console.
   - Click through admin/driver/parent dashboards. Every API request should succeed exactly as before.
   - Verify `OfflineBanner` is absent (you are online).
   - In DevTools, toggle "Offline" in the Network tab. Confirm the banner appears within ~1s. Click Retry while still offline — queries should be invalidated (visible in React Query DevTools if installed, or by the network-tab refetch attempt) without the page crashing. Toggle back to online and confirm the banner disappears.

2. **Local production-style build** — `npm run build && NODE_ENV=production SESSION_SECRET=test-secret npm start`, hit `http://localhost:5000`, log in.
   - Confirm the session cookie shows `SameSite=None; Secure`. Note: most browsers require `Secure` cookies be set over HTTPS — on plain `http://localhost` the cookie may be rejected. If that happens, this step has a known limitation: either use a local HTTPS proxy, or skip it and rely on the Railway smoke (step 3) for the production cookie check. **Document the outcome in the PR rather than blocking on a fix here.** Cannot verify SameSite=None; Secure over http://localhost — browsers reject. Verification deferred to Railway smoke. Document the result in the PR description.
   - Exercise admin/driver/parent flows for ~3 minutes. No regressions.

3. **Railway production smoke** — after deploy, hit `https://www.schoolbustracker.org`, log in.
   - Confirm the session cookie in DevTools shows `SameSite=None; Secure`.
   - Open DevTools Network tab. Pick any `/api/...` request. Confirm the response carries `Access-Control-Allow-Credentials: true`. Same-origin browser requests will not have an `Origin` request header, so `Access-Control-Allow-Origin` may not appear on the response — that is correct CORS behavior for same-origin and not a regression.
   - Spot-check the six refactored admin-dashboard fetches by navigating to the admin routes view and watching for `/api/routes/<id>/schools` calls — they must still return 200.
   - Spot-check the App.tsx role PATCH by signing up a brand-new account via the role-selection flow (this only fires if `sessionStorage.pendingRole` is set, which the role-selection page sets).
   - Spot-check `driver-password-setup` by hitting `/driver/password-setup?token=<expired>` — the page should render its error state cleanly, proving the unauthenticated cross-origin-ready fetch still works.

### Automated
- **`tests/cors.test.ts`** (new file, listed above in "Files to change"). Asserts the `ALLOWED_ORIGINS` export from `server/index.ts` (imported via `from '../server/index'`) contains exactly the five planned origin strings: `capacitor://localhost`, `ionic://localhost`, `http://localhost`, `https://www.schoolbustracker.org`, `https://schoolbustracker.org`.
- CORS preflight behavior and cookie attachment remain integration-level and difficult to fake under vitest without spinning a real HTTP server. The existing `tests/auth-validation.test.ts` and `tests/multi-tenant.test.ts` continue to cover the policy shape.
- Run `npm run check` and `npm test` before the Railway deploy per DeShaun's workflow (`npm run build` → tests → `git add . / commit / push`).

### iOS testing
**Skipped intentionally in Phase A.** Nothing iOS-facing changes in this phase. The existing TestFlight build 4 continues to load the remote bundle and is unaffected by Phase A's server changes (same-origin remains same-origin). iOS testing is the gate for Phase B.

## Risk & rollback

### What could break in production
1. **CORS allowlist typo.** A stray character in any allowed origin would make the middleware refuse to echo it, but since web is same-origin and iOS has not yet flipped to `capacitor://localhost`, this would be invisible in Phase A and only surface in Phase B. Mitigation: copy the allowlist verbatim from the table above; the new `tests/cors.test.ts` (see Files to change) asserts the allowlist contents.
2. **`sameSite: 'none'` cookie rejected by older browsers.** Browsers older than ~2020 (Chrome <80, Safari <13) treat `SameSite=None` as `Strict`. The SchoolBusTracker user base is current iOS Safari + current desktop browsers, so practical risk is near zero, but worth knowing.
3. **`cors` package middleware ordering bug.** If the middleware accidentally gets inserted *before* the Stripe webhook raw-body handler, the `cors` package's `OPTIONS` short-circuit will not affect the webhook path (Stripe never sends `OPTIONS`), and the regular middleware does not consume the body — so this should be benign — but verify in code review that the webhook handler is still the first registered route after `const app = express()`.
4. **Missed `fetch` site** (incidental risk). If a new `fetch('/api/...')` was added on `main` between this plan being written and the builder agent executing, it will not flow through `apiUrl()`. As of this plan's verification pass, the only `fetch(` call sites in `client/src/` outside `queryClient.ts` are the eight listed above plus `distanceUtils.ts`. Re-run `grep -rn "fetch(" client/src` before merging.

### Rollback
Single path: `git revert` the Phase A commits, `git push`, Railway redeploys. Both changed server files (`server/index.ts`, `server/customAuth.ts`) and the client changes are isolated — no schema migrations, no Stripe state, no Firebase config, no iOS artifacts. Revert is cheap and complete.

Note: do **not** attempt a partial revert (e.g., revert the cookie change but keep the CORS middleware). The two changes ship together so that Phase B has the full surface ready; rolling back only one half leaves an inconsistent state that nobody has tested.

### Incidental risks noticed while reading

- **Multi-tenant guards are not touched in Phase A.** None of the refactored files contain `companyId` enforcement logic. The `App.tsx` role PATCH, the six admin-dashboard route fetches, and the driver-password-setup verification all hit endpoints whose server-side tenant scoping is unchanged. No `isMasterAdminUser` / `companyScope` shadowing risk in this phase.
- **`apiBase.ts` will be a new module touched by every component indirectly via `queryClient.ts`.** That is the desired single choke point — do not export additional helpers from it (`fetchJson`, request wrappers, etc.) in this PR. Keeping the API surface to `getApiBase` and `apiUrl` preserves the parent plan's deliberate scope.

## What this phase deliberately does NOT do

These are explicitly **Phase B** work, covered in `plans/offline-readiness-fix.md`:

- **No `capacitor.config.ts` edits.** The `PRODUCTION_SERVER_URL` default stays as-is. The bundle is still loaded remotely from Railway on iOS.
- **No splash launchShowDuration change.** Stays at 5000ms.
- **No `npx cap sync ios`, no Xcode archive, no TestFlight build.**
- **No `VITE_API_BASE_URL` build-env wiring.** The new `apiBase.ts` will read this env var, but since Phase A never runs in a Capacitor native context, the production fallback string is dead code in Phase A. Phase B is when it actually matters.
- **No TanStack Query persistence (`@tanstack/react-query-persist-client`).** Parent plan Open Question #2 — deferred indefinitely.
- **No `pushService.ts` URL-construction audit, no FCM deeplink testing.**
- **No Stripe `success_url` / `cancel_url` audit.** Parent plan Open Question #4 — Phase B concern.
- **No self-hosting Google Fonts or removing the Replit dev banner from `client/index.html`.**

## Decisions

The parent plan has six open questions. Five are Phase B concerns (deploy cycle, persistence, escape-hatch lifetime, Stripe return URL, live-reload allowlist) and do not block Phase A. The two that were pulled forward to Phase A are now resolved:

1. **`cors` npm package vs. hand-rolled middleware — DECIDED: use the `cors` package.** Rationale: ~4KB, battle-tested, explicit option shape is easier to audit. The hand-rolled fallback is dropped from this plan entirely. (Reflected inline in the Server — CORS section above.)

2. **Local production-style build cookie test — DECIDED: accept the limitation.** Rationale: `Secure` cookies over plain `http://localhost` are typically rejected by browsers, and standing up a local HTTPS proxy adds setup cost for marginal coverage. The Railway smoke (Testing approach step 3) is the authoritative `SameSite=None; Secure` check and runs minutes after deploy. Outcome is documented in the PR description per Testing step 2.

3. **CORS test file location — DECIDED: `tests/cors.test.ts`.** Follows CLAUDE.md's "Tests live in `tests/` (not colocated)" convention. The test imports `ALLOWED_ORIGINS` via `from '../server/index'`. Although the file lives under `tests/`, it exercises server code and counts toward the 3-server / 6-client split (total 9 files) in the Files to change list.

4. **CORS allowlist alignment — DECIDED: runtime allowlist is the source of truth; test asserts exactly those five entries.** The test asserts `capacitor://localhost`, `ionic://localhost`, `http://localhost`, `https://www.schoolbustracker.org`, `https://schoolbustracker.org`. `http://localhost:5173` is intentionally excluded — Vite dev is mounted by Express on `:5000` (same-origin), so CORS is never triggered for `:5173`.

## PR description guidance

When opening the Phase A PR, the description should call out:

- **`VITE_API_BASE_URL` is intentionally unset in Phase A.** Phase A does not set `VITE_API_BASE_URL` anywhere — `apiBase.ts` falls back to the hardcoded production URL `https://www.schoolbustracker.org`. Phase B is responsible for wiring this env var (Railway build env, `.env.production`, or Xcode build config — to be decided in Phase B).
- **Local production-style cookie verification outcome.** Per Testing approach step 2, record whether the local `SameSite=None; Secure` check was possible (it usually is not over plain `http://localhost`) and confirm the Railway smoke (step 3) was used as the authoritative check.
- **Allowlist + CORS test confirmation.** Restate the final agreed allowlist contents (the five entries above) and confirm the CORS test lives at `tests/cors.test.ts`.

## Phase B Punch List

Items deferred from Phase A's review to Phase B's plan. Add these to `plans/offline-readiness-fix.md` (or its successor) before Phase B begins:

1. **Stripe webhook ordering test.** Add a vitest that verifies the Stripe webhook raw-body handler is registered before any body-parsing middleware (including the Phase A `cors` layer). This is best done in Phase B because Phase B is where ordering regressions would actually start mattering for the cross-origin checkout return flow.
2. **CLAUDE.md update.** Remove the "webview origin matches API origin" claim in the Capacitor / iOS section — that becomes false after the Capacitor bundle flip in Phase B, since the iOS bundle will load from `capacitor://localhost` while the API stays on `https://www.schoolbustracker.org`.

> Plan saved to `plans/offline-readiness-fix-phase-a.md`. Review it, then invoke the appropriate builder agent (`@agent-express-api` for the server pieces, `@agent-react-builder` for the client pieces) with the plan path.
