# Perf + security merge checklist

Used by the reviewer agent on every diff before merge (CLAUDE.md, Perf + security merge gate). Critical/high = no merge.

**How to grade.** For every line the diff touches, answer PASS / FAIL / N/A with `file:line` evidence. A FAIL takes the line's severity unless the evidence makes it worse. Lines the diff doesn't touch are N/A. Issues listed under "Known open items" at the bottom are the baseline: don't re-report them unless the diff makes them worse or adds a new instance.

Terms: `isMasterAdminUser` (power checks only), `isUnscopedMaster` (the tenant bypass: a master who is not impersonating), `companyScope`, `isOutsideCallerTenant` and `hasId` live in `server/tenant.ts`; `getCaller(req)`, `isDriverInCompany` / `isSchoolInCompany` / `isRouteInCompany` and `checkStudentForeignKeys` are at the top of `server/routes.ts`. "Record-by-id" = `PATCH` / `PUT` / `DELETE` / `GET …/:id`.

## 1. Tenant safety (T)

| ID | Check | Sev | Source |
|---|---|---|---|
| T-1 | Every record-by-id handler fetches the record and returns 404 when it is missing or when the caller is outside its company (`!isUnscopedMaster(user) && record.companyId !== user.companyId`, or `isOutsideCallerTenant`). | critical | [S2 API1] [S5] [S8 CWE-639] |
| T-2 | The cross-tenant case returns **404, never 403**, and the tenant 404 runs before any role 403 that would reveal the target exists. | high | [S2 API1] [S8 CWE-200] |
| T-3 | Every create forces `companyId = user.companyId ?? null` after `zodSchema.parse`; a `companyId` in the body is never used. | critical | [S2 API3] [S4] |
| T-4 | Every list GET uses `companyScope(user)`, returns `[]` on `null`, and passes the scope to `storage.getAll*`, with no fail-open fallback (`user.companyId \|\| undefined`, `sql\`1=1\``, or a `where` that becomes `undefined` when the value is missing). | critical | [S4] [S5 deny-by-default] |
| T-5 | Every foreign-key id taken from the body, params or query (studentId, routeId, stopId, busId, driverId, schoolId, parentId) is fetched and its `companyId` checked against the caller's (or the target record's) company before use; a driverId must also be a driver role. | critical | [S2 API1] [S8 CWE-639] [S4] |
| T-6 | Null company never matches null: a non-master caller or a record with `companyId` null matches nothing (use the `is*InCompany` / `isOutsideCallerTenant` helpers, not a bare `!==`). | high | [S5 exit-safely] |
| T-7 | Update schemas are allow-lists (`.pick(...)`, or `insert*Schema.omit({ companyId, ... }).partial()`); no `req.body` spread into an update; `companyId`, `role`, `isActive`, `assignedRouteId`, plan / Stripe fields and `_masterAdmin*` can't be set from a body. | critical | [S2 API3] [S8 CWE-915] |
| T-8 | Any storage method that reads or writes by raw id has a tenant check at its call site (storage methods don't scope). | critical | [S4] [S5 every-request] |
| T-9 | Parent reads go through `getLinkedStudentsByParentId`, and parents reach buses, routes, stops and locations only for linked children. | high | [S2 API1] [S5] [P] |
| T-10 | Tenant decisions in new or changed code use `getCaller(req)` (or `req.user`), which carry the impersonation overlay, never a re-fetch that drops the overlay (a bare `storage.getUser(req.user.id)`); a diff never adds a new re-fetch-then-scope site (DUP-2). | high | [S4] |
| T-11 | Tenant data cached on the client is either keyed by company or wiped on logout / impersonation (`queryClient.clear()` and the full reload stay in place). | medium | [S4] |

## 2. Auth & session (S)

| ID | Check | Sev | Source |
|---|---|---|---|
| S-1 | Every new route is behind `isAuthenticated` unless it is deliberately public, and public routes are named in the PR. | critical | [S8 CWE-306] [S1 A07] |
| S-2 | Staff routes check the role (`isAdminRole` / `isDriverRole` / `isMasterAdmin` middleware), deny by default (no trailing `else` that serves everyone, parents included), and an unknown role gets 403. | high | [S2 API5] [S5 deny-by-default] [S8 CWE-862] |
| S-3 | The HF3 company gate is intact: the allow-list in `server/authGate.ts` only grows with a stated reason, and `isActive` plus company status/approval are still read per request in `deserializeUser`. | critical | [S5 every-request] |
| S-4 | State-changing `/api` requests stay behind the HF3 Origin guard (`isCrossSiteWriteBlocked`) and JSON-only bodies; no `express.urlencoded` / text parser is added and no GET changes state. | critical | [S8 CWE-352] [S3] [S10] |
| S-5 | CORS keeps the explicit `ALLOWED_ORIGINS` list with `credentials: true` (no `*`, no reflected origin, no loose regex), and `tests/cors.test.ts` changes with the list. | high | [S10] [S1 A02] |
| S-6 | The session cookie stays `httpOnly`, `secure` in production, with no `Domain`, and `sameSite: 'none'` only together with `secure`. | high | [S6] [S11] |
| S-7 | The session id is regenerated on every privilege change (login, impersonation start/stop, role or password change), and logout destroys the server session and turns off this device's push token (sent by the app) plus the caller's web tokens, never the user's other devices or another user's tokens. | high | [S6 renew-session-id] |
| S-8 | Auth and link-code responses don't reveal whether an email or account exists (same message and status), and the deactivated message only shows after a correct password. | medium | [S1 A07] [S8 CWE-200] |
| S-9 | Login, register, password reset, invites and link-code generate/redeem use `authLimiter` / `registerLimiter` or an equivalent limiter. | high | [S9] [S2 API4] [S2 API6] [S8 CWE-770] |
| S-10 | Role grants follow least privilege: a role can't grant above itself (a `driver_admin` can't mint `admin`), and no user can change their own `companyId` or escalate their own role. | critical | [S5 least-privilege] |
| S-11 | Stripe: the webhook keeps its raw body before `express.json()` and `constructEvent` with a nonzero tolerance; handlers are idempotent on `event.id`; Checkout uses server-side price/plan and fixed redirect URLs, never values from the body. | critical | [S15] [S1 A08] [S2 API6] |

## 3. Data exposure & logging (S)

| ID | Check | Sev | Source |
|---|---|---|---|
| S-12 | Responses send only the fields the client needs: no full `users` rows, reset/invite tokens, device tokens, session data, or other users' contact details. | high | [S2 API3] [S8 CWE-200] |
| S-13 | No `console.*` line logs passwords, access/reset/invite tokens, link codes, device tokens, cookies or session ids, auth headers, Stripe payloads, exact child locations, student PII, unmasked emails, or any request/response body. | high | [S7 data-to-exclude] [S1 A09] |
| S-14 | Error responses carry no `err.message` from internals, stack traces, SQL or Drizzle errors; details are logged server-side only. | medium | [S1 A10] [S9] [S8 CWE-200] |
| S-15 | No secrets in code, docs or tests (`sk_`, `whsec_`, `AIza`, service-account JSON, URLs with credentials, tokens); they come from `process.env` only, and no `.env*` file is committed. | critical | [S1 A04] [S9] |
| S-16 | New security-relevant paths (auth failures, cross-tenant 404s, role/invite/deactivate/approve/suspend, impersonation start/stop) log who/what/when with the acting user id, the real master-admin id when impersonating, and `companyId`. | low | [S7 which-events] [S4] |
| S-17 | User-supplied strings (names, emails, company names, slugs) are never interpolated raw into log lines or HTML email; they are escaped, or the log is structured. | medium | [S7 log-injection] [S8 CWE-79] |

## 4. Input & injection (S)

| ID | Check | Sev | Source |
|---|---|---|---|
| S-18 | Every write (POST / PUT / PATCH) parses its body with a Zod schema, and a `ZodError` returns 400 in the established `{ message, errors }` shape. | high | [S8 CWE-20] [S2 API3] |
| S-19 | Queries use Drizzle builders or tagged `sql\`\`` with bound values: no `sql.raw()`, no string-built SQL, and unbindable identifiers (sort column, direction, timezone) are allow-listed. | critical | [S1 A05] [S8 CWE-89] |
| S-20 | Bodies stay JSON-only with a bounded size (the default 100 kB or an explicit `limit`). | medium | [S3] [S2 API4] |
| S-21 | User text is never rendered with `dangerouslySetInnerHTML`, and `href`s / redirects built from data are allow-listed. | high | [S8 CWE-79] [S9] |
| S-22 | Outbound requests use a fixed host or allow-list (never a URL from input) and set a timeout. | high | [S2 API7] [S8 CWE-918] [S1 A01] |
| S-23 | Any file upload checks type by content, caps size, uses server-chosen names and stores outside static/executable paths (none exist today). | high | [S8 CWE-434] [S3] |

## 5. Performance & leaks (P)

| ID | Check | Sev | Source |
|---|---|---|---|
| P-1 | Every `setInterval`, `setTimeout`, `window`/`document` listener and socket opened in an effect is cleared or removed in the effect's cleanup. | medium | [S12] |
| P-2 | Async effects guard stale results (an `ignore` flag or `AbortController`), with no `setState` after unmount and no in-flight write after duty-off. | medium | [S12] |
| P-3 | Every Capacitor `addListener` handle is `.remove()`d on cleanup or logout, every `watchPosition` has a `clearWatch`, and the `permissionDeniedRef` short-circuit stays. | medium | [S12] [P] |
| P-4 | No global short `refetchInterval` is added; each polling interval is justified (at least 15 s; about 30 s for driver location) and paused when the screen is hidden or the driver is off duty. | medium | [S2 API4] [S12] |
| P-5 | No N+1: no `Promise.all(list.map(... storage.getX ...))`; use `getSchoolsByIds` / `getRoutesByIds` / `getRouteStopsByIds` / `getBusesByRouteIds` / `enrichStudentsWithSchoolAndRoute`. | medium | [S2 API4] [P] |
| P-6 | List endpoints, especially polled ones, are bounded by a LIMIT, pagination or a date window, never a whole table. | medium | [S2 API4] [S8 CWE-770] |
| P-7 | A new filtered or joined column (and `companyId` on a new tenant table) has an index. | medium | [P] |
| P-8 | Day-boundary queries compare `(col AT TIME ZONE ${tz})::date` with the company timezone; no `setHours(0,0,0,0)` or `DATE()` on plain timestamps. | high | [P] |
| P-9 | The shared `pool` / `db` from `server/db.ts` is reused (no new Pool per request), and any module-level Map, array or cache has a size cap or TTL. | medium | [S14] [S8 CWE-770] |
| P-10 | Derived state is computed in render or `useMemo`, not copied into state by an effect. | low | [S13] |

## 6. Migrations (M)

| ID | Check | Sev | Source |
|---|---|---|---|
| M-1 | `shared/schema.ts` table changes are additive by default: a nullable or defaulted column, a new table or an index. | high | [G] |
| M-2 | A destructive change (drop/rename a column or table, narrow a type, add NOT NULL to an existing column, change a unique key) has a PR call-out, a verified Railway backup taken just before, a written rollback plan, and a staged rollout when a backfill is needed. | critical | [G] |
| M-3 | The change is rehearsed on staging (`Postgres-cKuC`) with `npm run db:push` first, reading the statements Drizzle Kit prints; `--force` is never used against production, and SHELL applies it only with DeShaun's OK. | high | [G] [P] |
| M-4 | A new tenant-owned table carries `companyId` → `companies.id` with an index, and its unique constraints are `(companyId, x)`, not `x` alone. | high | [S4] [G] |
| M-5 | A new tenant-sensitive column (`companyId`, `role`, `isActive`, Stripe ids, `_masterAdmin*`) is added to the omit/pick list of every update schema in the same PR. | critical | [S2 API3] [G] |
| M-6 | A data fix or backfill is an idempotent script in `scripts/`, runs per company, never copies values across companies, is reviewed like code, and runs once with DeShaun's OK. | medium | [G] |

## 7. Tests required to merge (X)

| ID | Check | Sev | Source |
|---|---|---|---|
| X-1 | Every new or changed tenant query path has an HTTP-level cross-tenant test under `tests/integration/` that calls the real handler as company A and asserts company B's data is absent (list `[]`), untouched (404 by id), not written (stored `companyId` is A) or not mass-assigned. | high | [S5 test-cases] [G] |
| X-2 | Each tenant test names the clause whose deletion turns it red (in the `it(...)` title or a comment), and the author confirmed it by commenting the clause out. | high | [G] |
| X-3 | The foreign row can reach the query: foreign `companyId` with local FKs, or a local record with a foreign FK; the test asserts the seed really landed in B before asserting the zero. | high | [G] |
| X-4 | Auth cases are covered: no session → 401, another company → 404 / `[]`, wrong role → 403, and a null-company caller → `[]` on list paths. | medium | [G] |

## 8. Dependencies (S)

| ID | Check | Sev | Source |
|---|---|---|---|
| S-24 | `npm audit --audit-level=high` shows no new high or critical advisory compared with `main`. | high | [S1 A03] [S9] |
| S-25 | A new dependency is named in an approved plan, comes from a maintained source, and the lockfile is updated by npm (no hand edits). | medium | [S1 A03] |

## Known open items (baseline on `main` at `0ce7825`)

These are existing issues, re-checked in code after HF1 (`ffee2c8`), HF3 (`05656a4`) and HF2 (`594f8b6`). **Don't re-report them** unless the diff makes them worse or adds a new instance. When a fix lands, move its row to "Closed" with the commit. IDs refer to the READER audits (SEC-n security, LEAK-n perf/leaks, DUP-n duplicates).

| Line | Open item | IDs | Where (current `main`) |
|---|---|---|---|
| T-1 | Record-by-id handlers without a tenant check | SEC-21, SEC-22, SEC-28, SEC-40 | `PATCH /api/admin-requests/:id/acknowledge` + `/complete`; `DELETE /api/notifications/:id`; `DELETE` / `PATCH …/read` `/api/system-notifications/:id`; `GET /api/drivers/:id/invitation-status`; `GET /api/routes/:routeId/schools`; `PUT /api/routes/:routeId/schools/reorder` |
| T-2 | Cross-tenant or ownership 403s that reveal a record exists | (R1 route table) | parent paths of GET/PUT/DELETE `/api/students/:id` |
| T-5 | Foreign-key ids from the body not tenant-checked | SEC-33 | `POST /api/buses` (`driverId`/`currentRouteId`) |
| T-7 | Raw `req.body` into an update | SEC-26 | `PATCH /api/schools/:id` → `storage.updateSchool(id, req.body)` |
| T-9, S-2 | Parents (any non-driver) get every company bus/route; staff routes without a role check | SEC-29, SEC-21 | `GET /api/buses` and `GET /api/routes` else-branches; `GET /api/attendance`, `GET /api/admin-requests`, admin-requests ack/complete |
| S-5 | `http://localhost` is allowed with credentials in production (also used by the HF3 Origin guard) | SEC-44 | `ALLOWED_ORIGINS` in `server/index.ts` |
| S-7, S-16 | Impersonation start/stop doesn't regenerate the session and isn't logged; password reset doesn't revoke other sessions | SEC-41, SEC-45 | `/api/master-admin/impersonate/:companyId`, `/stop-impersonating`; `/api/auth/reset-password` |
| S-6 | Default cookie name `connect.sid`; no server-side absolute session timeout (7-day TTL only) | (gaps S2n, S5n) | `getSession` in `server/customAuth.ts` |
| S-9 | No rate limiter on link-code redeem; codes use `Math.random` | SEC-24 | `POST /api/link-child`; `generateUniqueCode` |
| S-11 | Stripe webhook not idempotent (no `event.id` dedupe or ordering guard); Checkout takes `priceId` / `successUrl` / `cancelUrl` from the body | SEC-35, SEC-38 | `server/webhookHandlers.ts`; `POST /api/business/create-checkout-session` |
| S-12 | Coworkers' email, phone and licence returned to drivers | SEC-29 | `GET /api/driver-profiles-checkin` |
| S-13 | Bodies and responses in logs | SEC-36 (part), LEAK-11 | `POST /api/buses` logs the body and validated data; the `server/index.ts` response logger appends `JSON.stringify(capturedJsonResponse)`; `emailService.ts` logs `ADMIN_EMAIL` |
| S-14 | Internal error text returned to clients | SEC-37 | `server/index.ts` error handler returns `err.message` on 500; `POST /api/buses` returns `error.message` / request data; route validation returns `details` |
| S-16, S-17 | No audit log for privilege actions; free-text logs; names interpolated into HTML email | SEC-45, SEC-46 | role change, approve/suspend/reject, impersonation; `server/emailService.ts` templates |
| — | No `helmet`, `x-powered-by` on | SEC-34 | `server/index.ts` |
| P-2 | Async effects without stale-result guards | LEAK-15, LEAK-17 | `admin-dashboard.tsx` `TotalStopsDisplay`; driver location POST after duty-off |
| P-4 | Global 15 s `refetchInterval`; 5 s driver polls | LEAK-2, LEAK-3, LEAK-12 | `client/src/lib/queryClient.ts`; `driver-dashboard.tsx` routes/buses queries |
| P-5 | N+1 loops | LEAK-6, LEAK-9, LEAK-20, LEAK-21 | `GET /api/reports/journeys`, `GET /api/check-in/waiting/:routeId`, `getConversationsForUser`, `markAllNotificationsRead`, `reorderRouteSchool` |
| P-6 | Unbounded lists on polled endpoints | LEAK-1 (LIMIT only), LEAK-6, LEAK-7, LEAK-9, LEAK-14 | `getDriverShiftReports`, `getNotificationsForParent`, `getSystemNotificationsFor*`, `getConversation`; `GET /api/available-buses` reads every on-duty driver (all tenants, ids only) |
| P-7 | Q8/Q17b filters with no index (indexes are a schema change; later schema task) | Q8 | needs an index on `parent_notifications(target_parent_id)`, `students(route_id, school_id)` and `students(route_id, stop_id)` (`getNotificationsForParent`, `getParentRecipientsForRouteEvent`); T4a: `device_tokens(token)` and `device_tokens(user_id)` (`registerDeviceToken`, logout, `getDeviceTokensForUsers`) |
| P-9 | Session store opens a second pool | LEAK-16 | `new PgStore({ conString })` in `server/customAuth.ts` |
| X-1 | Older tenant unit tests check helper policy, not handlers | (gaps A5) | `tests/multi-tenant.test.ts` (older tests). The copied helpers are gone: tests import the real ones from `server/tenant.ts` (`92d4d8b`; the last copy, in `tests/parent-features.test.ts`, went in Q7 `8f4cddb`). The Q4 harness is on `main` (`fa85158`), so new paths use `tests/integration/` |
| S-24 | Existing `npm audit` baseline (32 advisories) | Q2 | dependency plan |

**Closed since the audit (verified in code; 27 IDs, plus part of SEC-45):**
- **HF1 `ffee2c8` (10):** SEC-6, SEC-9, SEC-10, SEC-13, SEC-16, SEC-23, DUP-1, DUP-3, DUP-7, DUP-8. It also closed parts of LEAK-1 (tenant scope), SEC-25, SEC-28 and SEC-36 (by deleting dead routes) and SEC-46 (invite argument order).
- **HF2 `594f8b6` (12):** SEC-1, SEC-2, SEC-3, SEC-4, SEC-5, SEC-11, SEC-12, SEC-14, SEC-15, SEC-17, SEC-20, SEC-27. It also closed part of SEC-36 (route log dumps, masked emails).
- **HF3 `05656a4` (4):** SEC-7, SEC-8, SEC-18, SEC-19.
- **Q40 (dev1):** the 17 record-by-id handlers that used `!isUnscopedMaster(user) && record.companyId !== user.companyId` now use `isOutsideCallerTenant` (a no-company caller matches nothing; T-1, T-4, T-6), and `POST /api/routes/:routeId/stops` checks the body `schoolId` against the route's company (T-5, part of SEC-33).
- **Q18 + Q22 (dev1 `bdc026a`..):** SEC-47, SEC-49, SEC-50 (on-duty drivers, messages, confirm-boarded / confirm-dropoff, send-invitation, `PATCH /api/drivers/:id`, route-school link, driver contacts now use `isOutsideCallerTenant` / `companyScope`; a null-company caller matches nothing); the `POST /api/messages` 403 is now the missing-recipient 404 (T-2); `POST /api/link-child` refuses another company's code like an unknown code; the duty toggle returns only `{ id, isOnDuty, dutyStartTime }` (S-12). Admin alerts (`POST /api/notifications`, E7): local Zod body (S-18), `routeId` / `busId` tenant-checked (T-5), and push goes to exactly the parents who see the alert in the app (`getAlertRecipients`, `dc401da`).
- **Q8 + Q17b (dev1 `09c94d1`..):** SEC-25 (arrival `schoolId`, departure `visitId`, stop-completed `routeStopId`/`routeId` are tenant-checked; its other sites went in HF1), LEAK-5 and LEAK-8 (one batched recipient query + one bulk insert). Also the parent/driver system-notification read leak (a row with a `recipientId` is shown only to that user) and targeted parent notices (`targetParentId`) reaching only their target.
- **Q7 `8f4cddb`:** DUP-2 and the impersonation-scoping part of SEC-45 (T-10, T-4): `getCaller(req)` keeps the overlay on re-fetch, and `companyScope`/`isOutsideCallerTenant` use `isUnscopedMaster`, so an impersonating master is scoped to the impersonated company. SEC-45's session-regeneration and audit-log parts (S-7, S-16 rows) stay open.
- **T1 push transport (`dev2/work`):** LEAK-18 (S-22): APNs goes over HTTP/2 to an allow-listed host (`APNS_ENVIRONMENT`), with a 10 s timeout per APNs request and per FCM batch.

## Sources

- **[S1]** OWASP Top 10:2025 (A01–A10). https://top10.owasp.org/2025
- **[S2]** OWASP API Security Top 10, 2023 (API1 BOLA … API10). https://api-security.owasp.org/editions/2023/en/0x11-t10
- **[S3]** OWASP Cheat Sheet: Node.js Security. https://cheatsheetseries.owasp.org/cheatsheets/Nodejs_Security_Cheat_Sheet.html
- **[S4]** OWASP Cheat Sheet: Multi-Tenant Application Security. https://cheatsheetseries.owasp.org/cheatsheets/Multi_Tenant_Security_Cheat_Sheet.html
- **[S5]** OWASP Cheat Sheet: Authorization. https://cheatsheetseries.owasp.org/cheatsheets/Authorization_Cheat_Sheet.html
  - deny-by-default: …#deny-by-default
  - every-request: …#validate-the-permissions-on-every-request
  - exit-safely: …#exit-safely-when-authorization-checks-fail
  - least-privilege: …#enforce-least-privileges
  - test-cases: …#create-unit-and-integration-test-cases-for-authorization-logic
- **[S6]** OWASP Cheat Sheet: Session Management. https://cheatsheetseries.owasp.org/cheatsheets/Session_Management_Cheat_Sheet.html
  - renew-session-id: …#renew-the-session-id-after-any-privilege-level-change
- **[S7]** OWASP Cheat Sheet: Logging. https://cheatsheetseries.owasp.org/cheatsheets/Logging_Cheat_Sheet.html
  - which-events: …#which-events-to-log
  - log-injection: …#log-injection
  - data-to-exclude: the "Data to exclude" section
- **[S8]** MITRE/CISA CWE Top 25, 2025: CWE-79, -89, -352, -862, -434, -863, -20, -200, -306, -918, -639, -770, plus CWE-915 (mass assignment). https://cwe.mitre.org/top25/archive/2025/2025_cwe_top25.html
- **[S9]** Express: Production Best Practices, Security. https://expressjs.com/en/advanced/best-practice-security.html
- **[S10]** MDN: Cross-Origin Resource Sharing (CORS). https://developer.mozilla.org/en-US/docs/Web/HTTP/Guides/CORS
- **[S11]** MDN: Set-Cookie. https://developer.mozilla.org/en-US/docs/Web/HTTP/Reference/Headers/Set-Cookie
- **[S12]** React: Synchronizing with Effects. https://react.dev/learn/synchronizing-with-effects
- **[S13]** React: You Might Not Need an Effect. https://react.dev/learn/you-might-not-need-an-effect
- **[S14]** Node.js Learn: Diagnostics, Memory. https://nodejs.org/en/learn/diagnostics/memory
- **[S15]** Stripe: Webhooks. https://docs.stripe.com/webhooks
- **[P]** Project rules: this repo's `CLAUDE.md` (enforcement patterns, "Pitfalls learnt the hard way": N+1 helpers, day-boundary queries, geolocation, cross-tenant FK ids).
- **[G]** Tenant-test and migration rules for this stack (READER R6, adapted from the team's GymHub tenant-safety checklist): the "name the clause whose deletion turns it red" root rule, foreign-row reachability, and `db:push` migration safety. They rest on [S4] and [S5 test-cases].
