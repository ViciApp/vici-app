---
description: hard cutover from the legacy satellite app (vici.market) to the app at vici.app
---

The one-time switch from the legacy Juno app at vici.market to the app at vici.app. The legacy satellite stops taking user writes and every vici.market route sends its visitor to vici.app. vici.app is a new product: no legacy account or data moves over, so a legacy user signs up there like anyone else. Run the steps in order: each one assumes the previous one passed its check.

> [!CAUTION]
> Every step acts on the production satellite. Nothing here runs from CI except the hosting deploy of step 3.

## What applies the shutdown

Nothing in the repo changes production by being merged. One switch, `VITE_LEGACY_SHUTDOWN=true`, read in two places, turns the legacy app off at cutover time:

- **Write freeze:** [`juno.config.ts`](../../juno.config.ts) makes every Datastore and Storage collection writable by controllers only when `juno config apply` runs with the variable set (step 2). Reads stay as they are, so the moved screen keeps working. The rules change through `set_rule`, with no functions upgrade, and the change is reversible.
- **Moved screen:** a legacy (default backend) build made with the variable renders, on every route, "VICI has moved to vici.app" and sends the visitor to the same path on vici.app (`isLegacyShutDown` in `new-app-redirect.services.ts`). `deploy.yml` passes the repository variable `VITE_LEGACY_SHUTDOWN` to the hosting build, so once the variable is set (step 3), every deploy of the satellite, tags included, ships the moved screen.

There is no hosting redirect: the satellite serves an existing asset before any redirect, sends the configured `Location` verbatim (no path), and certifies a redirect only at its literal source path, so a `**` redirect cannot cover the app's routes. The page-level redirect is also what reaches installed apps, whose service worker serves the cached shell whenever the network answers a navigation with anything but a 2xx.

A tab already running the previous bundle never reads the new build on its own. Step 3 moves it with the mechanism that bundle already ships: the satellite is stopped long enough for the tab's next satellite call to fail with "canister is stopped", the maintenance overlay comes up (`maintenance.services.ts`), it probes `HEAD /` every 5 seconds, and once the satellite answers again it calls `window.location.reload()`. The service worker handles navigations network first (`handleNavigation` in `src/service-worker/index.ts`): the reload fetches the new shell from the network, caches it in place of the old one and serves it, so the tab lands on the moved screen. Only a response that is not a 2xx falls back to the cached shell.

## Before you start

- The release to ship is a `v*` tag (call it `vX.Y.Z`).
- Tools: `dfx` (the `av` identity, a satellite controller), the juno CLI ([`.github/juno-cli-version`](../../.github/juno-cli-version)), `gh` with admin rights on the repo.
- Secrets at hand: the Juno Administrator access key (`JUNO_TOKEN`).
- Users already know the date.

From the repo root:

```bash
export SATELLITE_ID="$(npx tsx scripts/lib/satellite-id.ts production)"
```

Optional rehearsal of steps 2 and 3 on the emulator: `juno emulator start`, then `VITE_LEGACY_SHUTDOWN=true JUNO_EMULATOR=true juno config apply --mode development` and `VITE_LEGACY_SHUTDOWN=true npm run dev`; a write from the app must be refused and every route must show the moved screen.

## 1. Safety snapshot before the freeze

The satellite also serves vici.market, so the site is down for the minute this takes. This snapshot is the state before any rule changes; step 3 takes the final one. The IC caps the number of snapshots a canister holds and `dfx canister snapshot create` refuses past the cap; `--replace <snapshot-id>` overwrites an existing one and keeps its id.

```bash
dfx canister stop "$SATELLITE_ID" --network ic --identity av
dfx canister snapshot create "$SATELLITE_ID" --network ic --identity av
dfx canister start "$SATELLITE_ID" --network ic --identity av
dfx canister snapshot list "$SATELLITE_ID" --network ic --identity av
```

**Check:** the new snapshot id is listed (write it down as the pre-freeze snapshot) and `dfx canister status "$SATELLITE_ID" --network ic --identity av` says `Running`. **If the snapshot is refused** for the cap: repeat with `--replace <snapshot-id>` on an older snapshot nobody needs. If no slot can be spared, skip this step: the snapshot of step 3 is the one that must exist. **If `start` fails:** retry it before anything else; the site is down until it runs.

## 2. Freeze legacy writes

```bash
export JUNO_TOKEN=<Administrator access key>
VITE_LEGACY_SHUTDOWN=true juno config apply --mode production
```

Accept the overwrite prompt if the CLI shows one (the repo is the source of truth). **Check:** the CLI reports every collection applied and none rejected; in the Juno Console, Datastore and Storage, every collection shows write "Controllers" and its read permission unchanged; vici.market still loads markets (reads work). **If a collection is rejected:** read the error. A rule created with immutable permissions cannot be changed from the CLI; fix it in the Console and apply again. **To undo** (only to abort the whole cutover): `juno config apply --mode production` without the variable restores today's rules.

Known gap: the freeze covers writes a user makes to a collection. Satellite endpoints that write with the satellite's admin key (league invites, referral codes, analytics) still answer a direct call, and legacy identities can still call the clearing canister directly. Step 3 removes every caller the app had.

## 3. Ship the moved screen

```bash
gh variable set VITE_LEGACY_SHUTDOWN --body true
gh workflow run deploy.yml --ref vX.Y.Z
gh run watch
```

If the release carrying this PR is not cut yet, set the variable first and then merge the release PR: its tag runs `deploy.yml` with the variable.

**Check:** the run is green; a fresh private window on `https://vici.market/` and on a deep link (`https://vici.market/flow`, a market page) lands on the same path on vici.app. **If the legacy app still shows:** confirm the variable (`gh variable list`) and that the tag contains this PR, then dispatch again. **To undo:** `gh variable delete VITE_LEGACY_SHUTDOWN` and dispatch `deploy.yml` on the same tag.

Then move the tabs still running the previous bundle, and take the final snapshot in the same stop. Before stopping, open a signed-in vici.market tab that was loaded before the deploy (keep it in the foreground) to watch.

```bash
dfx canister stop "$SATELLITE_ID" --network ic --identity av
dfx canister snapshot create "$SATELLITE_ID" --network ic --identity av
dfx canister snapshot list "$SATELLITE_ID" --network ic --identity av
# keep it stopped for at least 3 minutes from the stop, then:
dfx canister start "$SATELLITE_ID" --network ic --identity av
```

Why 3 minutes: the app shell's polled satellite reads (`CachedLoader` through `AtomicLoader`: leaderboard, market metadata and tags, following, received reactions) run every 30 seconds, and a browser throttles the timers of a background tab to about once a minute; 3 minutes covers a few rounds of both. Writes are frozen since step 2, so this snapshot is the final state of the legacy data. If `create` is refused for the cap, run it with `--replace <pre-freeze snapshot id>`: this one supersedes it.

**Check:** the snapshot is listed (write it down as the final snapshot); within about 35 seconds of the stop the watched tab shows the maintenance overlay, and within 5 seconds of `start` it reloads onto the moved screen and then vici.app. **If the overlay does not come up:** the tab made no satellite call yet; wait, the window is the point. **If `start` fails:** retry it at once; the site is down until it runs.

Tabs this cannot reach: one that makes no satellite call during the window, such as a signed-out page with no satellite polling, or a background tab the browser froze or throttled past the window. After `start` its satellite calls succeed again, so it does not move by itself: reads keep working, writes are refused by the freeze, and it lands on the moved screen at its next full load (a reload, a new visit, the app reopened).

## 4. Spot checks on vici.app

- A brand-new email signs up.
- A vici.market link (a market, an invite `/i/<code>`) lands on the same page of vici.app.

## After the cutover

- **The satellite serves only the moved screen** until vici.market's DNS moves to a plain path-preserving redirect. Keep the `VITE_LEGACY_SHUTDOWN` variable set, and run any later `juno config apply --mode production` with `VITE_LEGACY_SHUTDOWN=true`: without it the apply reopens writes.
- **Snapshots:** the final one is from step 3; keep it with the pre-freeze one from step 1, if taken.
- **Stopping the satellite:** after the DNS move, when vici.market traffic no longer reaches the canister, `dfx canister stop "$SATELLITE_ID" --network ic --identity av`, then remove the custom domain in the Juno Console and turn off `deploy.yml` and `publish.yml` (`gh workflow disable`), which would otherwise act on a stopped canister at every tag. Keep the canister, its snapshots and its cycles: it is the record of the legacy data.
- **Restoring from a snapshot** (only for data loss on the satellite): `dfx canister stop`, then `dfx canister snapshot load "$SATELLITE_ID" <snapshot-id>`, then `dfx canister start`, each with `--network ic --identity av`.
