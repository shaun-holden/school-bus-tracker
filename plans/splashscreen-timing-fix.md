# Plan: SplashScreen timing fix for Capacitor iOS

> **HIGH RISK** — Touches Capacitor native code (new plugin, Podfile, `cap sync`, TestFlight build). Requires manual review and a fresh TestFlight upload before merge. Do not execute without confirmation from DeShaun.

## Goal
Make the iOS splash screen dismiss when the React app has actually mounted and finished its initial auth check, instead of disappearing on a fixed native timer (which currently exposes either a blank WKWebView or a brief login-page flash before redirect).

## Context

- **Affected user flow:** every launch of the iOS Capacitor app (`com.TopNotchTrainingCenter.SchoolBusTracker`). All roles — parent, driver, admin, driver_admin, master_admin — see the splash on cold start.
- **Affected subscription tiers:** none — purely UX.
- **Why this approach (programmatic `SplashScreen.hide()` gated on auth resolution) over alternatives:**
  - Pure timer (current `launchShowDuration` approach) cannot know how long the WKWebView + remote `https://www.schoolbustracker.org` load + React mount + `/api/auth/user` round trip will take. On a cold cellular launch this is highly variable.
  - Hiding on `DOMContentLoaded` would dismiss before TanStack Query resolves `useAuth()`, causing the documented login-page flash before the role-based redirect at `client/src/App.tsx:69-86`.
  - Hiding after auth resolves matches the existing UX intent: the user sees the splash, then their dashboard — never an unauthenticated transitional state on a return visit.

### What is actually shown today

The user's prompt mentions "a fixed 2000ms" splash, but the repo state is different — surface this in Open Questions.

Verified state in repo:

- `capacitor.config.ts:28-32` declares a `SplashScreen` plugin block with `launchShowDuration: 0`, `backgroundColor: '#1e40af'`, `showSpinner: false`. Recent commit `6a38f94` ("Disable Capacitor splash screen launch delay") is what set `launchShowDuration: 0`.
- `@capacitor/splash-screen` is **not** in `package.json` (verified — only `@capacitor/{android,app,cli,core,geolocation,haptics,ios,keyboard,push-notifications,status-bar}` are present, lines 17-26).
- `ios/App/Podfile` does **not** include `pod 'CapacitorSplashScreen'` (lines 11-20). The plugin block in `capacitor.config.ts` is currently being read by nothing — it is silently ignored.
- `ios/App/App/Info.plist:25-26` sets `UILaunchStoryboardName` = `LaunchScreen`. That storyboard (`ios/App/App/Base.lproj/LaunchScreen.storyboard`, standard Capacitor template) is what actually paints the blue/branded splash during the iOS process bootstrap — it is dismissed by iOS itself the moment the root `UIViewController` (Capacitor's `CAPBridgeViewController`) finishes loading, regardless of whether the webview has painted.

The "splash flashes too quickly" symptom is therefore **iOS dismissing the LaunchScreen as soon as the WKWebView controller is up**, leaving a blue (or white) gap while the remote URL is fetched and React mounts. The fix is to install `@capacitor/splash-screen`, keep the splash showing past native handoff, and dismiss it ourselves from React.

## Files to change

- **`package.json`** — add `"@capacitor/splash-screen": "^8.0.1"` (match the major version of the other Capacitor 8.x packages, lines 17-26). Run `npm install` to populate `package-lock.json`.
- **`ios/App/Podfile`** — add `pod 'CapacitorSplashScreen', :path => '../../node_modules/@capacitor/splash-screen'` inside the `capacitor_pods` block (currently lines 11-20). The builder must run `cd ios/App && pod install` after `npm install`, or rely on `npx cap sync ios` which does it for them.
- **`capacitor.config.ts`** — replace the current `SplashScreen` plugin block (lines 28-32) with:
  - `launchShowDuration: 3000` — upper bound how long the native splash sits before iOS would force-hide it as a failsafe (covers the worst-case slow cellular load).
  - `launchAutoHide: false` — critical. Tells the plugin not to auto-dismiss on a timer; we will call `SplashScreen.hide()` from JS.
  - `launchFadeOutDuration: 200` — soft fade so dismissal does not feel like a hard cut.
  - `backgroundColor: '#1e40af'` — keep current brand blue.
  - `showSpinner: false` — keep (no spinner on the launch image; we have no spinner asset).
  - `iosSpinnerStyle: 'small'` — harmless default in case `showSpinner` is ever flipped on for debugging.
  - `androidScaleType: 'CENTER_CROP'` — included for parity even though Android isn't shipping today; avoids surprises if `npx cap sync android` is ever run.
- **`client/src/main.tsx`** **(modify)** — currently 6 lines, just calls `createRoot(...).render(<App />)`. Add (described, do not write code):
  1. Import `Capacitor` from `@capacitor/core` and `SplashScreen` from `@capacitor/splash-screen`.
  2. Before `createRoot`, capture a `splashShownAt = Date.now()` timestamp (only when `Capacitor.isNativePlatform()` is true). This is read by the bootstrap hook to enforce the minimum-display-time floor (see below).
  3. Expose `splashShownAt` to the React tree by attaching it to `window` under a typed key (e.g. `window.__splashShownAt`) or by passing it through a small React Context. Prefer the context approach — keep `window` clean. A new file `client/src/lib/splash-context.tsx` **(NEW)** can export `SplashContext` and `SplashProvider`.
- **`client/src/lib/splash-context.tsx`** **(NEW)** — describes a tiny React Context that holds `{ shownAt: number | null, hide: () => Promise<void> }`. The `hide()` implementation:
  1. Returns early if `!Capacitor.isNativePlatform()` — web build (production schoolbustracker.org) has no splash plugin.
  2. Returns early if it has already been called (idempotency guard — use a module-level `hasHidden` boolean).
  3. Computes `elapsed = Date.now() - shownAt` and `await new Promise(r => setTimeout(r, Math.max(0, MIN_DISPLAY_MS - elapsed)))` where `MIN_DISPLAY_MS = 600`. This prevents a sub-300ms flash on warm starts where auth is cached and the dashboard mounts almost instantly.
  4. Calls `await SplashScreen.hide({ fadeOutDuration: 200 })`. Wrap in try/catch and log to `console.warn` only — never let a splash error block app rendering.
- **`client/src/App.tsx`** — modify in two places:
  1. Wrap the existing `<ErrorBoundary>` tree in `<SplashProvider>` (around line 94-101).
  2. Inside the `Router` component (lines 25-90), after the existing `useAuth()` and the existing `useEffect` for `pendingRole` (lines 31-50), add a new `useEffect` that:
     - Runs when `isLoading` transitions from `true` to `false` (auth has resolved).
     - Calls the context's `hide()` function.
     - Has dependency array `[isLoading]`.
     - **Important:** do NOT gate on `isAuthenticated` — an unauthenticated user landing on the Landing page is a valid resolved state; we still want to dismiss the splash for them.
  3. Also call `hide()` from the `ErrorBoundary` fallback path so a hard render error doesn't trap the user on a frozen splash. Either pass `hide` into `ErrorBoundary` as a prop or call it from a `componentDidCatch` lifecycle. Check `client/src/components/ErrorBoundary.tsx` (read it first) and pick the lighter touch.

## Database changes
None.

## API contract
None.

## iOS / Capacitor considerations

**Native rebuild required.** This adds a new CocoaPod (`CapacitorSplashScreen`) and changes Capacitor plugin config. Sequence DeShaun must run:

1. `npm install` — pulls `@capacitor/splash-screen`.
2. `npm run build` — required because Capacitor copies `dist/public` into the iOS bundle and reads `capacitor.config.ts` during sync.
3. `npx cap sync ios` — runs `pod install` and updates `ios/App/App/capacitor.config.json` and the generated plugin registration.
4. Open `ios/App/App.xcworkspace` in Xcode, increment the build number, archive, upload to TestFlight.
5. Wait for TestFlight processing, install on a physical iPhone, do a **cold launch** (force-quit first) on both Wi-Fi and cellular to verify timing.

**Do NOT** plan to test only in the simulator — simulator load times are unrealistically fast and will mask the cellular-launch gap that motivated this fix.

**Do NOT** assume the existing `LaunchScreen.storyboard` needs editing. The storyboard paints the very first frame (before any Capacitor code runs); the JS-controlled splash takes over seamlessly after process bootstrap as long as the storyboard's background color matches `capacitor.config.ts > SplashScreen.backgroundColor` (`#1e40af`). Read `ios/App/App/Base.lproj/LaunchScreen.storyboard` once and confirm the background color matches — if not, flag in Open Questions, do not edit the storyboard without DeShaun's say-so.

**Web build is unaffected.** `Capacitor.isNativePlatform()` returns `false` in the browser at `https://www.schoolbustracker.org`, so the dynamic import / context call is a no-op there. Confirm by running `npm run dev` and loading the app in a browser — there should be zero console errors and no behavior change.

## Stripe / billing considerations
None.

## Testing approach

**Manual (the bulk of validation for this change):**

1. **Web (`npm run dev`)** — open in Safari/Chrome, confirm no console errors and no broken render. Splash code paths should be inert.
2. **iOS simulator** — cold launch, confirm splash shows, holds while React mounts, fades after auth resolves. Use Xcode's Network Link Conditioner with the "3G" profile to simulate slower load; splash should hold longer, not flash early.
3. **TestFlight on physical device** — DeShaun's regular workflow. Cold-launch tests:
   - Logged-out user (first install): splash → Landing page, no login-page flash mid-transition.
   - Logged-in parent: splash → ParentDashboard, no unauthenticated content flash.
   - Logged-in driver: splash → DriverDashboard, no flash.
   - Logged-in master_admin: splash → AdminDashboard at `/`.
   - Airplane mode launch: splash should hold up to `launchShowDuration: 3000`, then iOS will failsafe-dismiss. Auth query will error and `useAuth().isLoading` will eventually flip to false, triggering our `hide()`. Confirm we don't end up wedged on the splash forever (this is the rollback canary).
4. **Background → foreground** — bring the app back from background; splash should **not** re-show. (`SplashScreen.hide()`'s module-level `hasHidden` guard ensures this.)

**Automated tests:** none added — this is pure native UI timing, not testable in Vitest. Note the absence in the PR description.

## Risk & rollback

**What could break:**

- **Airplane-mode wedge.** If `/api/auth/user` hangs indefinitely without erroring, `isLoading` could stay `true` and the JS-side splash hide would never fire. Mitigation: `launchShowDuration: 3000` is the native failsafe — iOS will force-dismiss after 3s regardless. Verify the auth query's `retry: false` (already set in `client/src/hooks/use-auth.ts:26`) means a network failure resolves to error state quickly, not a hang.
- **Plugin install issue on CI / Railway.** Railway only runs the web build (`dist/public`) — the iOS Pod install only matters on DeShaun's local Mac. Railway deploy is unaffected.
- **Mismatched plugin major version.** Capacitor enforces matching majors. The other Capacitor packages in `package.json` are 8.x, so `@capacitor/splash-screen@^8` is required. If npm pulls a v9 by accident, `npx cap sync ios` will error loudly — easy to catch.
- **LaunchScreen.storyboard color mismatch.** If the storyboard's background isn't `#1e40af`, the user will see a one-frame color blink at the storyboard → plugin handoff. Cosmetic but noticeable. Builder must verify.

**Rollback steps (if TestFlight feedback is worse, not better):**

1. Revert the four touched files (`package.json`, `ios/App/Podfile`, `capacitor.config.ts`, `client/src/main.tsx`, `client/src/App.tsx`) and delete `client/src/lib/splash-context.tsx`.
2. Run `npm install` (removes the splash-screen package from `node_modules` and lockfile).
3. Run `npx cap sync ios` (regenerates the Pod and Capacitor plugin registration without splash-screen).
4. Rebuild in Xcode, ship a new TestFlight build.
5. Repo state will return to current `launchShowDuration: 0` behavior (no JS splash, just the storyboard).

Keep the rollback commit small and isolated so it can be a single `git revert <merge-sha>`.

## Open questions

1. **The prompt says "currently shows for a fixed 2000ms" but the repo currently has `launchShowDuration: 0` (post-commit `6a38f94`) and no `@capacitor/splash-screen` plugin installed at all.** Is DeShaun testing an older TestFlight build than `main`, or did the symptom description carry over from before commit `6a38f94`? Confirm before building — if the current behavior is *already* "flashes too quickly because launchShowDuration is 0 and no JS hide ever fires," this plan is correct. If something else is going on (e.g. a separate launch image lingering), the diagnosis changes.
2. **Minimum-display-time floor:** plan proposes `MIN_DISPLAY_MS = 600`. Acceptable, or does DeShaun want 0 (snap-dismiss when ready) or higher (~1000ms for a more deliberate brand moment)?
3. **Fade duration:** plan proposes `200ms`. Native default is 300ms. Adjust?
4. **Should the splash also show on `App` resume from deep background (cold-launch-like)?** Capacitor's default is no (only on process launch). The `hasHidden` guard preserves that default. Confirm DeShaun is fine with the default behavior.
5. **`LaunchScreen.storyboard` background color** — needs visual inspection (read the file) to confirm `#1e40af`. If it's white or the Capacitor template default, do we edit the storyboard now or in a follow-up?
6. **Web push registration timing** (`client/src/hooks/use-web-push.ts`, called from `App.tsx:29`) runs after auth resolves, same as our new hide trigger. Both fire from the same `useEffect` cascade — no race, but worth noting that splash dismiss and FCM permission prompt could appear back-to-back. Acceptable?
