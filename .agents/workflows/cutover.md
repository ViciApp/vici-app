---
description: hard cutover from the legacy satellite app (vici.market) to the web2 app (vici.app)
---

The one-time switch from the legacy Juno app at vici.market to the web2 app at vici.app. The legacy satellite stops taking user writes, its last data moves into Postgres, accounts without an email get one by hand, clearing accounts move to their custodial principals, and vici.app opens to everyone. Run the steps in order: each one assumes the previous one passed its check.

> [!CAUTION]
> Every step from 2 on acts on production: the satellite, the clearing canister, the web2 Postgres. Nothing here runs from CI except the hosting deploy of step 4.

## What applies the shutdown

Nothing in the repo changes production by being merged. One switch, `VITE_LEGACY_SHUTDOWN=true`, read in two places, turns the legacy app off at cutover time. Nobody signs in on vici.market after it, existing accounts included: the product continues on vici.app.

- **Write freeze:** [`juno.config.ts`](../../juno.config.ts) makes every Datastore and Storage collection writable by controllers only when `juno config apply` runs with the variable set (step 3). The rules change through `set_rule`, with no functions upgrade, and the change is reversible.
- **Sign-in lock:** the same apply sets the satellite's authentication config to an allowlist (`allowedCallers`) holding only the satellite ids, and leaves the Google provider out (`legacySignInLock` in `juno.config.ts`). The satellite then refuses every Datastore and Storage call from a user, signed in or anonymous, reads included: sign-in reads or creates the caller's `#user` doc, so it fails for every account, and a session an old tab already holds can no longer read or write a collection. The custom satellite endpoints are not gated by it (see the known gap in step 3). Without Google the satellite stops minting OpenID delegations. Controllers and admin access keys are exempt, so the ETL export (admin key) and the Console keep working, and hosting is served outside the allowlist, so the moved screen loads. It goes through `set_auth_config`, with no functions upgrade, and is reversible.
- **Moved screen:** a legacy (default backend) build made with the variable renders, on every route, "VICI has moved to vici.app" and sends the visitor to the vici.app landing, `https://vici.app/`, whatever path they opened (`isLegacyShutDown` and `newAppLandingUrl` in `new-app-redirect.services.ts`). Never a legacy path such as `/signin`: vici.app has no public sign-in. `deploy.yml` passes the repository variable `VITE_LEGACY_SHUTDOWN` to the hosting build, so once the variable is set (step 4), every deploy of the satellite, tags included, ships the moved screen.

There is no hosting redirect: the satellite serves an existing asset before any redirect, sends the configured `Location` verbatim (no path), and certifies a redirect only at its literal source path, so a `**` redirect cannot cover the app's routes. The page-level redirect is also what reaches installed apps, whose service worker serves the cached shell whenever the network answers a navigation with anything but a 2xx.

A tab already running the previous bundle never reads the new build on its own. Step 4 moves it with the mechanism that bundle already ships: the satellite is stopped long enough for the tab's next satellite call to fail with "canister is stopped", the maintenance overlay comes up (`maintenance.services.ts`), it probes `HEAD /` every 5 seconds, and once the satellite answers again it calls `window.location.reload()`. The service worker handles navigations network first (`handleNavigation` in `src/service-worker/index.ts`): the reload fetches the new shell from the network, caches it in place of the old one and serves it, so the tab lands on the moved screen. Only a response that is not a 2xx falls back to the cached shell.

## Before you start

- This PR's code is in a `v*` release tag (call it `vX.Y.Z`), and the cutover scripts (`backend/scripts/cutover/`) are on the checkout you run from.
- Tools: `dfx` (the `av` identity, a satellite controller), the juno CLI ([`.github/juno-cli-version`](../../.github/juno-cli-version)), `bun`, `gh` with admin rights on the repo, `jq`.
- Secrets at hand: the Juno Administrator access key (`JUNO_TOKEN`), the satellite admin PEM for the ETL (`ETL_SATELLITE_PEM`), the clearing controller PEM (`CUTOVER_CONTROLLER_PEM`), the production `DATABASE_URL`, and `ROOT_SECRET` (the same value as the `vici-app-backend` Fly secret, from the team's secret store).
- An admin account on vici.app, signed in, for step 8.
- Users already know the date. Between step 4 and step 8, legacy users who reach vici.app are held back by the beta gate (`legacy_account_pending`), so keep that window short.

From the repo root:

```bash
export SATELLITE_ID="$(npx tsx scripts/lib/satellite-id.ts production)"
export CLEARING_CANISTER_ID="$(jq -r '.canisters.clearing.remote.id.ic' dfx.json)"
```

Optional rehearsal of steps 3 and 4 on the emulator: `juno emulator start`, then `VITE_LEGACY_SHUTDOWN=true JUNO_EMULATOR=true juno config apply --mode development` and `VITE_LEGACY_SHUTDOWN=true npm run dev`; a sign-in and a write from the app must be refused and every route must show the moved screen.

## 1. Confirm the clearing canister can reassign accounts

```bash
dfx canister metadata clearing candid:service --network ic | grep admin_reassign_account
```

**Check:** the line prints. **If not:** stop. The clearing upgrade did not land; without it step 7 cannot run, and nothing has changed yet.

## 2. Safety snapshot before the freeze

The satellite also serves vici.market, so the site is down for the minute this takes. This snapshot is the state before any rule changes; step 4 takes the final one. The IC caps the number of snapshots a canister holds and `dfx canister snapshot create` refuses past the cap; `--replace <snapshot-id>` overwrites an existing one and keeps its id.

```bash
dfx canister stop "$SATELLITE_ID" --network ic --identity av
dfx canister snapshot create "$SATELLITE_ID" --network ic --identity av
dfx canister start "$SATELLITE_ID" --network ic --identity av
dfx canister snapshot list "$SATELLITE_ID" --network ic --identity av
```

**Check:** the new snapshot id is listed (write it down as the pre-freeze snapshot) and `dfx canister status "$SATELLITE_ID" --network ic --identity av` says `Running`. **If the snapshot is refused** for the cap: repeat with `--replace <snapshot-id>` on an older snapshot nobody needs. If no slot can be spared, skip this step: the snapshot of step 4 is the one that must exist. **If `start` fails:** retry it before anything else; the site is down until it runs.

## 3. Freeze legacy writes

```bash
export JUNO_TOKEN=<Administrator access key>
VITE_LEGACY_SHUTDOWN=true juno config apply --mode production
```

Accept the overwrite prompt if the CLI shows one (the repo is the source of truth). **Check:** the CLI reports every collection and the authentication config applied, none rejected; in the Juno Console, Datastore and Storage, every collection shows write "Controllers" and its read permission unchanged; in Authentication, Google is off and the allowed callers are exactly the two satellite ids; signing in on vici.market fails. From here until step 4 ships the moved screen, the legacy app shows errors to anyone still on it, which is the intent: keep the gap short. **If a collection is rejected:** read the error. A rule created with immutable permissions cannot be changed from the CLI; fix it in the Console and apply again. **To undo** (only to abort the whole cutover): `juno config apply --mode production` without the variable restores today's rules.

Known gap: the freeze and the lock cover the Datastore and Storage calls a user makes. Custom satellite endpoints (`defineQuery` / `defineUpdate`) are outside both: the public ones still answer a direct call, anonymous or signed in, including reads such as the leaderboard and those that write with the satellite's admin key (league invites, referral codes, analytics). Closing them needs a satellite functions upgrade. Separately, a legacy identity with a delegation it already holds (OpenID delegations live up to 7 days, Internet Identity ones are minted by II) can still call the clearing canister directly until step 7 moves its account. Step 4 removes every caller the app had.

## 4. Ship the moved screen

```bash
gh variable set VITE_LEGACY_SHUTDOWN --body true
gh workflow run deploy.yml --ref vX.Y.Z
gh run watch
```

If the release carrying this PR is not cut yet, set the variable first and then merge the release PR: its tag runs `deploy.yml` with the variable.

**Check:** the run is green; a fresh private window on `https://vici.market/` and on a deep link (`https://vici.market/flow`, a market page) lands on `https://vici.app/`. **If the legacy app still shows:** confirm the variable (`gh variable list`) and that the tag contains this PR, then dispatch again. **To undo:** `gh variable delete VITE_LEGACY_SHUTDOWN` and dispatch `deploy.yml` on the same tag.

Then move the tabs still running the previous bundle, and take the final snapshot in the same stop. Before stopping, open a signed-in vici.market tab that was loaded before the deploy (keep it in the foreground) to watch.

```bash
dfx canister stop "$SATELLITE_ID" --network ic --identity av
dfx canister snapshot create "$SATELLITE_ID" --network ic --identity av
dfx canister snapshot list "$SATELLITE_ID" --network ic --identity av
# keep it stopped for at least 3 minutes from the stop, then:
dfx canister start "$SATELLITE_ID" --network ic --identity av
```

Why 3 minutes: the app shell's polled satellite reads (`CachedLoader` through `AtomicLoader`: leaderboard, market metadata and tags, following, received reactions) run every 30 seconds, and a browser throttles the timers of a background tab to about once a minute; 3 minutes covers a few rounds of both. Writes are frozen since step 3, so this snapshot is the final state of the legacy data. If `create` is refused for the cap, run it with `--replace <pre-freeze snapshot id>`: this one supersedes it.

**Check:** the snapshot is listed (write it down as the final snapshot); within about 35 seconds of the stop the watched tab shows the maintenance overlay, and within 5 seconds of `start` it reloads onto the moved screen and then vici.app. **If the overlay does not come up:** the tab made no satellite call yet; wait, the window is the point. **If `start` fails:** retry it at once; the site is down until it runs.

Tabs this cannot reach: one that makes no satellite call during the window, such as a signed-out page with no satellite polling, or a background tab the browser froze or throttled past the window. After `start` its satellite calls succeed again, so it does not move by itself: reads keep working, writes are refused by the freeze, and it lands on the moved screen at its next full load (a reload, a new visit, the app reopened).

## 5. Final delta ETL

From `backend/`, with `DATABASE_URL`, `ETL_SATELLITE_PEM` and `ETL_SATELLITE_ID="$SATELLITE_ID"` exported (see [`backend/README.md`](../../backend/README.md#data-migration-etl)):

```bash
bun run migrate
bun run etl:drain-auth
bun run etl:export -- ./etl-export-delta --fresh
bun run etl:import -- ./etl-export-delta
bun run etl:images
bun run etl:verify -- ./etl-export-delta
```

**Check:** `etl:verify` reports matching counts (satellite, JSONL, Postgres) for every collection it maps and no failed spot check. **If a step fails:** every script is idempotent and resumable, so fix the cause and rerun that step and the ones after it. `etl:drain-auth` is the last run of the drain: running it again after step 6 wipes the emails step 6 assigns.

## 6. Give an email to the accounts that have none

Passkey and Internet Identity accounts have no email to adopt on first login, so the team assigns one by hand. From `backend/`:

```bash
bun run cutover:list-unmatched ./cutover-unmatched.csv
# the team fills the email column, then:
bun run cutover:assign-emails ./cutover-unmatched.csv
bun run cutover:assign-emails ./cutover-unmatched.csv --execute
```

**Check:** the dry run lists exactly the rows the team filled, with no error; `--execute` reports them written; `cutover:list-unmatched` run again leaves only the accounts nobody could reach. **If `etl:drain-auth` ever runs again:** run `cutover:assign-emails ... --execute` again right after it.

## 7. Move clearing accounts to their custodial principals

From `backend/`:

```bash
export CUTOVER_CONTROLLER_PEM=/path/to/clearing-controller.pem
export ROOT_SECRET=...
export IC_HOST=https://icp-api.io
export CLEARING_CANISTER_ID
bun run cutover:reassign
bun run cutover:reassign --execute
```

Review the dry run first: each legacy principal maps to the custodial principal of the account it was imported into, and no account appears twice. **Check:** `--execute` reports no failures. **If some fail:** replay `--execute` until a run is clean, and look into any account that keeps failing before step 8.

## 8. Open vici.app to legacy accounts

In the browser console of `https://vici.app`, signed in as an admin:

```js
const url = 'https://api.vici.app/api/v1/admin/settings/beta_gate';
const init = { credentials: 'include', headers: { 'content-type': 'application/json' } };
await fetch(url, init).then((r) => r.json());
await fetch(url, {
	...init,
	method: 'PUT',
	body: JSON.stringify({ value: { enabled: false, emails: [] } })
}).then((r) => r.json());
```

**Check:** the PUT answers the setting with `enabled: false`, and a second GET returns the same. **If it answers 401 or 403:** the session is not an admin one; sign in again with the admin account.

## 9. Spot checks on vici.app

- An email account from the legacy app signs in and finds its handle, avatar, VXP, positions and leagues.
- An account that got its email in step 6 signs in with it and finds the same.
- A market page shows its history; a league shows its cover image.
- A brand-new email signs up.
- A vici.market link (a market, an invite `/i/<code>`) lands on the same page of vici.app.

Anything missing: rerun the step that owns it (5 for data, 6 for emails, 7 for positions). The beta gate can go back on with the same PUT and `enabled: true` while you fix it.

## After the cutover

- **The satellite serves only the moved screen** until vici.market's DNS moves to a plain path-preserving redirect. Keep the `VITE_LEGACY_SHUTDOWN` variable set, and run any later `juno config apply --mode production` with `VITE_LEGACY_SHUTDOWN=true`: without it the apply reopens writes and sign-in.
- **Snapshots:** the final one is from step 4; keep it with the pre-freeze one from step 2, if taken.
- **Stopping the satellite:** after the DNS move, when vici.market traffic no longer reaches the canister, `dfx canister stop "$SATELLITE_ID" --network ic --identity av`, then remove the custom domain in the Juno Console and turn off `deploy.yml` and `publish.yml` (`gh workflow disable`), which would otherwise act on a stopped canister at every tag. Keep the canister, its snapshots and its cycles: it is the record of the legacy data.
- **Restoring from a snapshot** (only for data loss on the satellite): `dfx canister stop`, then `dfx canister snapshot load "$SATELLITE_ID" <snapshot-id>`, then `dfx canister start`, each with `--network ic --identity av`.
