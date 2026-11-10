# Staging

Staging is a full copy of the app on Railway with its **own** Postgres, filled only with **synthetic** data from `scripts/seed-staging.ts`. It is never a copy of production: production holds children's names, home stops and live locations.

> **Service names.** Staging's database service is **`Postgres-cKuC`**. **`Postgres`** is production's. Every staging command below uses `--service Postgres-cKuC`, and the staging app's variable reference is `${{Postgres-cKuC.DATABASE_URL}}`. If a command doesn't name `Postgres-cKuC`, don't run it against staging.

- **Staging URL:** https://school-bus-tracker-staging.up.railway.app
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
| `STRIPE_SECRET_KEY`, `STRIPE_PUBLISHABLE_KEY`, `VITE_STRIPE_PUBLISHABLE_KEY`, `STRIPE_WEBHOOK_SECRET` | live keys | **test-mode** keys, plus a test-mode webhook endpoint at `https://school-bus-tracker-staging.up.railway.app/api/stripe/webhook` |
| `RESEND_API_KEY`, `RESEND_FROM_EMAIL` | set | **unset** (email off: sends fail softly and are logged) |
| `APNS_KEY_ID`, `APNS_TEAM_ID`, `APNS_PRIVATE_KEY`, `APNS_BUNDLE_ID`, `FIREBASE_SERVICE_ACCOUNT`, `VITE_FIREBASE_*` | set | **unset** (push off) |
| `PRODUCTION_SERVER_URL`, `REPL_ID` | unset | unset |

**On staging, Stripe is in test mode, and email and push are off.** No real person gets mail or a push from staging.

## Apply the schema and (re)seed

Do this in a **plain terminal**, never in a Claude window, and never via the `!` prefix: that records into the session transcript. Paste the commands **one line at a time**; there are no comments inside the blocks, because zsh treats a pasted `#` comment as arguments.

Staging Postgres has no public URL on purpose; don't turn on TCP Proxy. You reach it through a local tunnel that `railway connect` opens on `127.0.0.1:6544`.

**The tunnel line decides which database you reach.** It must name `Postgres-cKuC` and `--environment staging`. If it doesn't, don't run anything after it.

**Before you start:**
- **Point the app at its database.** The staging **app** service's `DATABASE_URL` must be the reference `${{Postgres-cKuC.DATABASE_URL}}` (fixed in the dashboard on 2026-11-10). Check it in the Railway dashboard before reseeding.
- The seed's `MASTER_ADMIN_EMAIL` check only works if that variable is exported in **this** terminal: `railway run --service Postgres-cKuC` injects the database's variables, not the app's. Step 4 exports it (the same value as the staging app's `MASTER_ADMIN_EMAIL`).

**1. Link the project and select staging.** Pick the School Bus project when `railway link` asks. `railway status` must show environment **staging**; if it doesn't, stop.

```sh
cd ~/Projects/school-bus-tracker
railway link
railway environment staging
railway status
```

**2. Open the tunnel in the background.** The first line starts it, the second remembers its process id, and `jobs` must show it as **running**. The tunnel prints the staging DB password and a full connection URL when it starts, so its output goes to `/dev/null`: nowhere on screen and in no file.

```sh
railway connect Postgres-cKuC --environment staging --tunnel-only --port 6544 > /dev/null 2>&1 &
TUNNEL_PID=$!
jobs
```

If `jobs` shows the tunnel as `exit 1`, the port is usually already in use by an old tunnel. Find it with the line below and stop it with `kill <the PID it shows>` (replace the placeholder including the angle brackets), or use another port in every line of this section.

```sh
lsof -nP -iTCP:6544 -sTCP:LISTEN
```

If it still fails, rerun the tunnel with the filter below to see its error. Ctrl-C to stop. It hides the password and URL lines, so error messages still show.

```sh
railway connect Postgres-cKuC --environment staging --tunnel-only --port 6544 2>&1 | grep -viE 'password|postgres(ql)?://'
```

Wait a few seconds, then check the tunnel is up. It must print `tunnel-up`; run it again if it fails straight after step 2.

```sh
sleep 5
nc -z 127.0.0.1 6544 && echo tunnel-up
```

**3. Apply the schema.** `db:push` has no data guard of its own, which is why the tunnel line must name staging.

```sh
railway run --environment staging --service Postgres-cKuC sh -c 'DATABASE_URL="postgresql://$PGUSER:$PGPASSWORD@127.0.0.1:6544/$PGDATABASE" npm run db:push'
```

The single quotes stop your terminal from expanding `$PGUSER`, `$PGPASSWORD` and `$PGDATABASE`. They reach `sh` unchanged and `railway run` fills them in with `Postgres-cKuC`'s own values, so the password stays out of your command line and shell history. The tunnel itself does print it, which is why step 2 sends the tunnel's output to `/dev/null`.

**If the database was empty,** restart the staging app service in the Railway dashboard now, so it creates the master admin from its `MASTER_ADMIN_EMAIL` / `MASTER_ADMIN_PASSWORD` on boot. Log in at https://school-bus-tracker-staging.up.railway.app as that master admin before you seed.

**4. Export the staging master-admin email and read the seed password.** In the first line, replace `REPLACE-WITH-STAGING-MASTER-EMAIL` with the staging master-admin email, keeping the single quotes around it. The second line waits for you to type a staging-only password (at least 12 characters) and press Enter; `read -rs` doesn't echo it, which keeps it out of shell history. The third line must print **12 or more**. If it prints `0`, the `read` was skipped (this happens when several lines are pasted at once): run the second line again on its own.

```sh
export MASTER_ADMIN_EMAIL='REPLACE-WITH-STAGING-MASTER-EMAIL'
read -rs STAGING_SEED_PASSWORD && export STAGING_SEED_PASSWORD
echo ${#STAGING_SEED_PASSWORD}
```

**5. Seed.** It can be re-run, because every row is upserted. Through the tunnel it prints `host=127.0.0.1`; that's expected, and the company and user guards below still refuse any database that holds anything but seed data.

```sh
railway run --environment staging --service Postgres-cKuC sh -c 'DATABASE_URL="postgresql://$PGUSER:$PGPASSWORD@127.0.0.1:6544/$PGDATABASE" SEED_TARGET=staging npx tsx scripts/seed-staging.ts'
```

**6. Close the tunnel.** Stop it, then check the port is free: the `lsof` line must print nothing. If it still lists an `ssh` process, stop that too with `kill <that PID>` (replace the placeholder including the angle brackets); on 2026-11-10 the tunnel's `ssh` child outlived the `railway` process.

```sh
kill $TUNNEL_PID
lsof -nP -iTCP:6544 -sTCP:LISTEN
```

Older runs may have left `/tmp/sbt-tunnel.log`; delete it with `rm -f /tmp/sbt-tunnel.log`.

**Alternative: two terminals.** Instead of step 2, open a second plain terminal and leave this running in it. It stays open, with no output, until you press Ctrl-C.

```sh
railway connect Postgres-cKuC --environment staging --tunnel-only --port 6544 > /dev/null 2>&1
```

Then run steps 1 and 3–5 in the first terminal. At the end, close the second terminal's tunnel with Ctrl-C, then run step 6's `lsof` line (and its `ssh` cleanup) instead of `kill $TUNNEL_PID`.

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
VITE_API_BASE_URL=https://school-bus-tracker-staging.up.railway.app npm run build && npx cap sync ios
```

Then open `ios/App/App.xcworkspace` in Xcode and run on a device. Log in with a seeded login above.

## Point the iOS app back at production

Rebuild without the variable, which falls back to `https://www.schoolbustracker.org`:

```sh
npm run build && npx cap sync ios
```

Check first that `VITE_API_BASE_URL` isn't still exported in that terminal (`echo $VITE_API_BASE_URL` prints nothing) and isn't in a local `.env`. Then run from Xcode again. Never ship a TestFlight or App Store build made while pointed at staging.
