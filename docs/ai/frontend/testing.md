# Frontend Testing

> **Status: bootstrap.** No Vitest runner yet; pure-logic specs under
> `src/tests/` run on Node's built-in runner via `npm test` (see
> [Today](#today)) and already follow the layout and naming conventions
> below. The `@dfinity/eslint-config-oisy-wallet/vitest` preset is wired
> into `eslint.config.js`, so once Vitest exists ESLint will already
> understand it; the Vitest-specific parts below (component tests, mocks,
> `tsconfig.spec.json`) are the forward-looking contract until then.
>
> **End-to-end (Playwright) tests are configured.** Two suites: the web2
> one ([E2E against the web2 backend](#e2e-against-the-web2-backend), the
> primary suite, for vici.app) and the Juno one
> ([E2E (Playwright)](#e2e-playwright), for vici.market).

## Today

- **Unit / component tests are not required by CI.** The `checks.yml`
  workflow runs `format`, `lint`, and `check` only.
- **Pure-logic specs run on Node's built-in runner** until Vitest lands:
  `npm test` (`tsx --test`, which resolves the `$lib` alias) picks up
  `src/tests/**/*.spec.ts`. Use `node:test` + `node:assert/strict`, import
  only modules with no Svelte / SvelteKit / env dependencies, and keep the
  mirror-`src/` layout below (`eslint.config.js` lifts
  `vitest/no-import-node-test` for `src/tests/**` only). Run it locally;
  CI does not yet.
- **E2E (Playwright) runs in CI, twice.** `e2e-web2.yml` builds the web2
  bundle and runs it against the real API on every PR and push to `main`
  (`npm run e2e:web2`, see
  [E2E against the web2 backend](#e2e-against-the-web2-backend)); `e2e.yml`
  boots the Juno emulator for the web3 build and runs `npm run e2e:ci` (see
  [E2E (Playwright)](#e2e-playwright)).
- **Bug fixes still benefit from a manual repro.** Document repro steps in
  the PR body's `# Tests` section so a reviewer can verify.
- **Engine sanity** has its own smoke-test script:

  ```bash
  npm run test:engine-sync
  ```

  Use it after touching engine wiring (`scripts/init/init.icdc-engine.sh`,
  `engine-sync.services.ts`, `VICI_ENGINE_ID`). It asserts the engine is
  registered, the satellite is in `admins`, and `allowed_roles` contains
  both `Creator` and `OracleAdmin`. See
  [`.agents/workflows/icdc-engine-reset.md`](../../../.agents/workflows/icdc-engine-reset.md).

## When the first Vitest spec lands

The expected setup:

- **Stack:** Vitest + `@testing-library/svelte` + `jsdom`.
- **Where tests live:** mirror `src/` under `src/tests/`. Never put a
  `.spec.ts` next to the file it tests.
- **Naming:** `*.spec.ts` for the test file, mirroring the source path.
  Reusable mocks under `src/tests/mocks/<thing>.mock.ts`. Reusable test
  helpers under `src/tests/utils/<thing>.test-utils.ts`.
- **Type-check tests:** add a `tsconfig.spec.json` and a `npm run check:tests`
  script.

### What to test (when the runner exists)

| Add tests for                                                      | Don't bother                                          |
| ------------------------------------------------------------------ | ----------------------------------------------------- |
| Pure utils (`*.utils.ts`) — every public function                  | Re-exports, barrels                                   |
| Service modules (`*.services.ts`) — happy path + each error branch | Generated files (`$declarations`)                     |
| Derived stores (`*.derived.ts`) with non-trivial logic             | Throwaway prototypes                                  |
| Reusable components in `$lib/components/ui/`                       | One-off presentational components used in 1 page only |
| Components with logic (any non-trivial branch / event handler)     | —                                                     |
| Schemas / validation modules                                       | —                                                     |
| Bug fixes (write the regression test that fails on `main`)         | —                                                     |

If you fix a bug, **the PR contains a test that fails on `main` and
passes on your branch**. Otherwise it's an "I think this is fine" PR.

### File shape (target convention)

```ts
import { describe, expect, it } from 'vitest';
import { formatBalance } from '$lib/utils/format.utils';
import { ZERO } from '$lib/constants/app.constants';

describe('formatBalance', () => {
	it('returns "0" for zero', () => {
		expect(formatBalance(ZERO, 8)).toEqual('0');
	});

	// … one `it` per behaviour
});
```

Notes (forward-looking):

- One `describe` per module under test, nested `describe` per public
  function.
- One `it` per behaviour — name it from the user/caller perspective.
- Reset mocks in `beforeEach`. Never let test order matter.
- For fetch / canister calls: mock the matching `$lib/api` / `$lib/canisters`
  module rather than stubbing `fetch` directly.

### Component testing

```ts
import { render, screen } from '@testing-library/svelte';
import { describe, expect, it } from 'vitest';
import Button from '$lib/components/ui/Button.svelte';

describe('Button', () => {
	it('renders the label', () => {
		render(Button, { props: { label: 'Confirm' } });
		expect(screen.getByRole('button', { name: 'Confirm' })).toBeInTheDocument();
	});
});
```

Prefer `getByRole`, `getByLabelText`, `getByText` — they exercise the same
semantics as a screen reader.

### Forbidden in tests

- `it.skip` / `describe.skip` / `it.todo` left on `main`.
- Real network calls. Stub `fetch` with `vi.stubGlobal` (and
  `vi.unstubAllGlobals()` in `afterAll`).
- `setTimeout`-based waits. Use `vi.useFakeTimers()` or `await waitFor(...)`.
- Console-noise (`console.log` debug output). Remove before commit.

## Adding the test runner — what would have to happen

This is **not** something an agent should do silently. If a PR genuinely
needs a test runner:

1. Surface the request in the PR description and ask for explicit
   approval to add `vitest`, `@testing-library/svelte`, `jsdom`, and a
   matching `tsconfig.spec.json`.
2. Wire `npm run test`, `npm run test:watch`, and (optionally)
   `npm run test:coverage` in `package.json`.
3. Use the folder layout (`src/tests/` mirroring `src/`) and the
   `*.spec.ts` suffix as anchored above.
4. Add a `test` job to `.github/workflows/checks.yml` and update
   [`pr-and-ci.md`](../pr-and-ci.md) accordingly.
5. **Update this page** in the same PR to flip "bootstrap" → the actual
   policy (no skipped tests on `main`, regression tests for bug fixes,
   etc.). That's the
   [meta-update rule](../governance.md#meta-update-rule) in action.

Until then, this page documents the target shape so the first test
doesn't have to invent it from scratch.

## E2E against the web2 backend

The primary end-to-end suite: the web2 production bundle (`VITE_BACKEND=web2`)
driven against the real HTTP API in [`backend/`](../../../backend/README.md)
on a throwaway Postgres. Specs live under
[`e2e-web2/`](../../../e2e-web2/), config in
[`playwright.web2.config.ts`](../../../playwright.web2.config.ts); the Juno
suite below is untouched and keeps covering the web3 build.

### Stack

- **Frontend:** `vite build` + `vite preview` on `:4173` (the shipped bundle,
  not the dev server), built with `VITE_WEB2_API_URL=http://localhost:8787`.
  Both servers use `localhost` because the session cookie is host-only.
- **API:** `backend/e2e/server.ts` on `:8787`, the production app
  (`src/index.ts`) with its external dependencies swapped through the
  existing test seams: the engine actors and the VXP ledger are the
  deterministic fakes in `backend/e2e/fake-engine.ts` (fixture catalog, one
  settled market, the VXP collateral asset, every account the
  never-deposited empty one; every other method, writes included, rejects),
  and email lands in an in-memory outbox. Both servers boot from Playwright's
  `webServer` (migrate, seed, serve; then build, preview).
- **Seed:** `backend/e2e/seed.ts` imports two legacy accounts through the
  real ETL importer (provisional, `matched_via = 'etl'`) with their exported
  legacy identities, and an admin account. Fixture values live in
  `backend/e2e/fixtures.ts`, import-free so the specs read the same data.
- **Sign-in:** the email one-time code, as a user does it. The specs read the
  code from `GET /__e2e/otp/:email`; the admin drives the beta gate through
  the real admin settings API after an OTP sign-in.
- **Network:** each test's browser context aborts everything except the app
  assets and the API, which covers the reads the web2 build still makes
  on-chain (order books, satellite listings) and anything third-party. No
  request ever reaches mainnet, and the app is asserted to degrade on those
  reads.
- **Stack health:** an auto fixture (`e2e-web2/support/fixtures.ts`) fails
  any test that saw an uncaught page error, an API 5xx, an engine read
  answering 4xx/5xx, or a `Web2 API error (5xx)` logged by the app,
  whatever the spec itself asserted.

The test-only hooks and why they cannot run in production are in
[`backend/README.md`](../../../backend/README.md#end-to-end-stack-test-only).

### Layout

```text
e2e-web2/
├── pages/web2-app.page.ts  # sign-in / sign-up / sign-out, shell locators
├── support/fixtures.ts     # network seal, stack health, backend + admin helpers
├── support/urls.ts         # the two local origins
├── adoption.spec.ts        # legacy email adopts the imported account
├── beta-gate.spec.ts       # allowlist refusal, allowNewUsers, legacy hold, ?e=legacy
├── dash.spec.ts            # empty engine account renders, no failing reads
├── markets.spec.ts         # list + detail from the fake engine, settled outcome
├── sign-out.spec.ts        # session revoked server-side, app gated again
└── signup.spec.ts          # new user: onboarding handle + email code
```

### Conventions

- **Assertions, no screenshots.** The suite pins behaviour, not pixels.
- **Fresh identities per test** (`uniqueEmail`, `uniqueHandle`): runs share
  one database, locally re-runs included. Seeded accounts are written so a
  re-run converges (an adopted account stays adopted).
- **Wait on the onboarding handoff** (`Web2AppPage.signUp` does) before a
  full page load after sign-up: the claimed handle is written by an async
  drain, and reloading mid-write re-hydrates a profile-less account.
- **Leave the beta gate open.** Use the `admin` fixture to set it; its
  teardown clears it even when the spec fails.
- **The backend rate limiter** keys every local request on one IP; the
  `backend` fixture resets it per test.

### Local commands

```bash
cd backend && docker compose up -d && cd ..   # Postgres on localhost:5432
npm run e2e:web2                              # builds, boots both servers, runs
npm run e2e:web2:report                       # HTML report after a CI-style run
```

`E2E_DATABASE_URL` overrides the database (it must be a loopback host; the
server's boot guard refuses anything else). Outside CI, Playwright reuses
servers already listening on `:4173` / `:8787`, so stop stale ones after
changing backend code or rebuild-relevant frontend code.

### CI

[`.github/workflows/e2e-web2.yml`](../../../.github/workflows/e2e-web2.yml)
runs on every pull request, every push to `main`, the merge queue and manual
dispatch, with no path filter: the suite spans the frontend, the backend and
their contract. Concurrency cancels a superseded PR run. It starts a
`postgres:16` service, installs npm (cached by `prepare`), Bun (install cache)
and Chromium (browser cache keyed on the Playwright version), then runs
`npm run e2e:web2`. One retry on CI; the report ships as
`playwright-report-web2`, raw results as `test-results-web2` on failure. It
needs no secrets.

## E2E (Playwright)

End-to-end tests live under [`e2e/`](../../../e2e/) and are driven by
[Playwright](https://playwright.dev/). They exercise the real frontend
against a local [Juno emulator](https://juno.build/docs/guides/local-development),
which boots a `junobuild/satellite` container with Internet Identity
pre-deployed.

### Stack

- **Runner:** `@playwright/test`.
- **Auth:** the dev-only mock identity exposed by `@junobuild/core`'s
  `signIn({ dev: {} })`, surfaced through the `SignInDev` button in
  [`SignInProviderStack.svelte`](../../../src/lib/components/authn/SignInProviderStack.svelte)
  (only rendered when `isDev()`). This is the path Juno's official E2E
  guide recommends and what `@junobuild/emulator-playwright` uses under
  the hood. It exercises the real `onAuthStateChange` pipeline — same
  store, same nav chrome, same Settings sign-out — without depending on
  the Internet Identity popup, which is brittle in a containerized
  emulator (the II canister version drifts vs. driver libraries). A
  follow-up PR can add real II coverage on top of this base if needed.
- **New-user flow:** signing in with no profile routes through the
  `/signup` onboarding (handle → auth) before the app shell.
  `HomePage.signInAsDevUser()` drives that end-to-end; the signed-in surface
  lives at `/flow`, and the markets board at `/app` (`AppPath.Home`). The
  signed-in account control carries `data-tid="user-menu"` on both the
  desktop nav handle and the mobile pillnav profile tab, so
  `[data-tid="user-menu"]:visible` resolves to one control per viewport.
- **The dev principal is shared, not fresh per spec.** `signIn({ dev: {} })`
  resolves to ONE principal for the whole CI run (it changes only on a fresh
  emulator boot), and the suite is serial against a never-reset satellite. So
  the FIRST `signInAsDevUser` already bootstraps a profile for that principal
  — and because the empty handle field auto-claims its pool suggestion, that
  first sign-in also COMPLETES onboarding for it. Every later spec therefore
  sees a fully-onboarded **returning** user, not a new one. A spec that needs
  the genuine new-user path must restore the pristine state itself: sign in,
  call `HomePage.resetDevProfile()` (the dev-only `window.__viciE2E`
  hard-delete hook installed by the `(app)` layout, see
  [`src/lib/dev/e2e-reset.ts`](../../../src/lib/dev/e2e-reset.ts)), then sign
  out — the next sign-in then bootstraps fresh. `onboarding.spec.ts` does
  exactly this.
- **Sign-ups are opted open.** The default (legacy) build turns new accounts
  away to the new app (see `web2-backend-mode.md`, "New accounts on the legacy
  build"). `playwright.config.ts` seeds the dev-only
  `E2E_OPEN_SIGNUPS_STORAGE_KEY` localStorage flag through `storageState` so
  every spec keeps the `/signup` onboarding; a production bundle ignores it.
  `moved-to-new-app.spec.ts` runs without it (empty `storageState`, or the key
  removed mid-test) to assert the moved screen. The satellite side of the rule
  exempts the emulator's satellite id, so profile creation still works there.
- **Backend:** Juno emulator started by `juno emulator start --headless`.
  The Juno CLI's `--emulator` flag is only valid with `--mode development`,
  so E2E reuses development mode but exports `JUNO_EMULATOR=true`, which
  makes [`juno.config.ts`](../../../juno.config.ts) swap `ids.development`
  to the emulator's predictable satellite ID
  (`jx5yt-yyaaa-aaaal-abzbq-cai`). Without that env flag, the dev satellite
  ID still points at the real remote dev satellite.
- **icdc-core canisters:** deployed by **`dfx`** into the same PocketIC
  instance the Juno emulator is running. The local `network` in
  [`dfx.json`](../../../dfx.json) already points at `127.0.0.1:5987` — the
  same port Juno's emulator listens on — so `dfx deploy --network local`
  works against the running emulator without extra plumbing. WASMs are
  pulled from the
  [`AntonioVentilii/icdc-core`](https://github.com/AntonioVentilii/icdc-core)
  GitHub releases (no Rust toolchain in CI). After deploy, CI runs
  `init.clearing`, `init.icdc-engine`, and `init.registry` — the same
  scripts that back the local `npm run init:icdc` flow — so the home feed
  has 20 markets seeded from
  [`scripts/data/markets.json`](../../../scripts/data/markets.json).
- **Frontend:** the dev server (`npm run dev`) — booted automatically by
  Playwright's `webServer` config.

### Layout

```text
e2e/
├── pages/                # Page-Object Model classes
│   └── home.page.ts
├── snapshots/            # Playwright visual baselines, committed
├── auth.spec.ts          # dev sign-in (via onboarding) + Settings sign-out
├── homepage.spec.ts      # signed-in markets board: loading + loaded
├── invite.spec.ts        # /join + /i invite-link landing (anonymous)
├── moved-to-new-app.spec.ts # legacy build: /signup + no-profile sign-in go to the new app
├── navigation.spec.ts    # auth-gate redirects + signed-in page snapshots
└── onboarding.spec.ts    # /signup beats → handle persists to the profile
```

### Visual snapshots

The snapshot specs end with `await expect(page).toHaveScreenshot(...)` — that's
the same flow `oisy-wallet` and `gix-components` use: the PNG baselines
live under [`e2e/snapshots/`](../../../e2e/snapshots/) and **are
committed to the repo**, so any visual regression shows up directly in
the PR diff.

The CI script (`npm run e2e:ci`) runs Playwright with
`--update-snapshots=changed`. That means:

- **First time** the test sees a name (no baseline yet) → Playwright
  writes the PNG. The workflow detects the change under
  `e2e/snapshots/`, commits it, and pushes the commit back to the PR
  branch (via [`./.github/actions/add-and-commit`](../../../.github/actions/add-and-commit/action.yml)
  using `secrets.GITHUB_TOKEN`).
- **Subsequent runs** that diff against the baseline → Playwright
  rewrites the PNG, and the same auto-commit step pushes the update.
  The reviewer sees the new screenshot in the PR diff and either
  accepts or rejects the visual change.
- **Fork PRs** can't be pushed to from `GITHUB_TOKEN`, so the changed
  baselines are still uploaded as the `snapshots-update` artifact;
  contributors can download them and commit manually.

Pushes from `GITHUB_TOKEN` deliberately don't re-trigger the workflow,
so the snapshot commit doesn't loop into another E2E run.

Because this policy auto-accepts any diff, a **flaky** snapshot
manifests as constant baseline churn — a fresh "🤖 chore(e2e): update
Playwright snapshots" commit on every push — rather than a failing
test. If that's happening, fix the flake at the source (see
[Keeping snapshots stable](#keeping-snapshots-stable)); don't paper
over it.

### Keeping snapshots stable

`playwright.config.ts` configures `expect.toHaveScreenshot` with:

- `animations: 'disabled'` — kills CSS animations / transitions.
- `caret: 'hide'` — hides the input caret.
- `threshold: 0.3` — tolerates minor anti-aliasing / font-hinting
  differences without flapping.

When a region of the page is genuinely non-deterministic (random
principals from dev sign-in, generated avatars), mask it. Playwright
overlays the masked element's bounding box with a magenta rectangle:

```ts
await expect(page).toHaveScreenshot('logged-in.png', {
	fullPage: true,
	mask: [home.userMenu]
});
```

⚠️ `mask` does NOT pin variable-width text. The magenta rectangle takes
the size of the element's bounding box, so a chip that renders `"7d 14h"`
on one run and `"6d 23h"` on the next produces a different-sized
rectangle and the snapshot diffs anyway. For wall-clock-relative text
(the `MarketTimeRemaining` chip is the canonical example) and for any
other element whose text varies per CI run (notably the shortened
principal rendered by `CopyableAddress` — Juno's dev mock identity is
deterministic within a CI run but the PocketIC emulator container
mints a different principal on every fresh boot), overwrite the
`textContent` to a fixed string before screenshot — call
`home.stabilizeForSnapshot()` (defined in
[`e2e/pages/home.page.ts`](../../../e2e/pages/home.page.ts)), which
waits for `document.fonts.ready` and pins every time-remaining chip
and principal-display element
to a constant placeholder:

```ts
await home.stabilizeForSnapshot();

await expect(page).toHaveScreenshot('homepage-logged-in.png', {
	fullPage: true,
	mask: [home.userMenu]
});
```

If you add a new wall-clock-relative element, extend
`stabilizeForSnapshot` there rather than reaching for another `mask`.

To capture a transient state deterministically — e.g. the markets-feed
**skeletons**, which would otherwise be replaced by real data within
~100ms once the registry responds — stall the upstream request inside
`page.route()` and release it explicitly once the screenshot is taken:

```ts
let releaseStall!: () => void;
const stalled = new Promise<void>((resolve) => {
	releaseStall = resolve;
});

// Match every API version: the SDK uses v3 for `query` / `read_state` and
// v4 for `call`. A v3-only glob lets v4 update calls leak past the stall.
await page.route('**/api/*/canister/g5pxl-pyaaa-aaaaj-qqhoq-cai/**', async (route) => {
	await stalled;
	await route.abort();
});

try {
	await home.goto();
	await expect(home.marketCardSkeleton.first()).toBeVisible();
	await expect(page).toHaveScreenshot('homepage-loading.png', { fullPage: true });
} finally {
	releaseStall();
}
```

The pending promise keeps the feed in its loading state long enough for
Playwright to render skeletons and snapshot, then the `finally` releases
every blocked route handler so they `route.abort()` and unwind. No
long-lived timers, no orphan promises.

CI runs on `ubuntu-24.04` only, so committed snapshots use the Linux
suffix Playwright auto-appends. Snapshots generated locally on macOS /
Windows get a different suffix and don't collide — but **don't commit
them**; they'll just bloat the repo and won't be checked by CI.

- **One spec per high-level user-facing flow.** Don't co-locate specs with
  components.
- **Page objects** wrap selectors and high-level actions so structural
  changes update one file, not every spec.
- **Selectors** go through `page.getByTestId(TestId.X)`. Playwright is
  configured with `testIdAttribute: 'data-tid'`, so a component opts in
  by exposing `data-tid={TestId.X}`. The catalog of IDs lives in
  [`src/lib/constants/test-ids.constants.ts`](../../../src/lib/constants/test-ids.constants.ts).
  **Add a new entry only when an E2E test references it** — keep the
  enum minimal.
- **Imports across the boundary:** specs and page objects under `e2e/`
  use **relative** imports (e.g. `../src/lib/constants/test-ids.constants`).
  The `local-rules/no-relative-imports` ESLint rule that bans relative
  imports under `src/**` does not apply here.

### Local commands

```bash
# Boot the Juno emulator (Docker image junobuild/satellite)
export JUNO_EMULATOR=true
juno emulator start
juno login --emulator --mode development
juno config apply --mode development

# In another terminal — run all specs (installs browsers on first run)
JUNO_EMULATOR=true npm run e2e

# Open the HTML report after a CI-style run
npm run e2e:report
```

`JUNO_EMULATOR=true` is what flips `ids.development` in
[`juno.config.ts`](../../../juno.config.ts) to the emulator satellite.
Without it the CLI / dev server would aim at the real remote dev
satellite — the E2E run would either fail loudly or, worse, write to
the real satellite. The CI workflow sets the env at the job level so
contributors don't have to think about it.

The `webServer` block in `playwright.config.ts` boots `npm run dev` on
:5173 automatically when you run `npm run e2e`.

### CI

The [`.github/workflows/e2e.yml`](../../../.github/workflows/e2e.yml)
workflow runs unconditionally on pushes to `main`, nightly, and on
`workflow_dispatch`. On a **pull request** and in a **`merge_group`**
the `check-e2e-changes` paths-filter job skips the suite unless the
change touches `e2e/**`, `playwright.config.ts`, the workflow,
`dfx.json`, `juno.config.ts`, or `scripts/**`; `e2e-tests-pass` still
reports green when skipped. The `run-e2e-snapshots` label forces it on,
on a PR only. Concurrency is grouped on the ref so pushing a new commit
to a PR cancels the in-flight run.

The job installs the Juno CLI, starts the emulator headlessly, applies
the development-mode config, builds + upgrades the satellite functions
WASM, then runs `npm run e2e:ci`. The HTML report is uploaded as the
`playwright-report` artifact (always); raw results ship as
`test-results` only on failure.

### Resilience against infra flakes

The suite talks to a real Vite dev server which proxies HTTP traffic to
a PocketIC instance (the Juno emulator). Two failure modes have been
observed and the suite guards against both:

1. **Endpoint not reachable at startup** — the emulator failed to boot,
   or the dev server crashed before any spec ran. Caught by
   [`e2e/global-setup.ts`](../../../e2e/global-setup.ts), which pings
   `http://localhost:5173/` and `http://127.0.0.1:5987/` with a short
   retry loop and throws a clear "X was not reachable" error. Without
   this guard you'd get 13 identical `Timeout 30000ms exceeded` failures
   inside `home.page.ts` and have to read traces to figure out the
   emulator was dead the whole time.
2. **Proxy enters a sticky `socket hang up` / `ECONNRESET` state
   mid-suite** — the Vite dev server's HTTP proxy to the IC boundary
   node stops resolving canister calls, often for the rest of the run.
   `HomePage.signInAsDevUser` auto-retries once with a `page.reload()`
   in between; the reload opens a fresh browser context against the
   proxy and often recovers. If the second attempt also fails, the
   error message names the proxy as the likely cause so triage doesn't
   chase a UI red herring.

If a CI run fails with a string of identical mobile timeouts on
`getByTestId('user-menu')` / `getByTestId('market-card')`, suspect the
mid-run proxy flake before suspecting the diff. Confirm by checking the
Playwright trace for `ECONNRESET` in the network panel; rerun the job
with `gh run rerun <run-id> --failed`.

Top-level `retries: 2` is **not** bumped to 3 — the mid-run flake
persists past Playwright-level retries (they share the same poisoned
connection pool), so the cost (more runtime, harder 45-minute workflow
cap) outweighs the benefit. The fix has to be at the per-test recovery
layer (the `signInAsDevUser` retry-with-reload above) or by replacing
Vite's HTTP proxy with a more resilient connector — outside this
testing layer's scope.

### Forbidden in E2E

- `test.skip` left on `main`. Either remove the test or make it pass.
- Hard-coded waits (`page.waitForTimeout(...)`). Use `expect(locator).toBeVisible()`
  / `toHaveText()` with the configured `actionTimeout` instead.
- Real network calls outside the emulator. The whole point of the
  emulator is reproducibility.
- Logging in by stuffing identities into `localStorage` / `IndexedDB`.
  Use the `SignInDev` button via the `HomePage` page object instead —
  that's the same path the dev runtime uses.

### Adding a new E2E test

1. Add an entry to `TestId` only if the new test needs a stable hook the
   surrounding components don't already expose.
2. Add `data-tid={TestId.X}` on the smallest meaningful element.
3. Extend the relevant page object (`e2e/pages/*.page.ts`) — never
   reach into selectors from the spec directly.
4. Write the spec under `e2e/<flow>.spec.ts`. For flows that need a
   signed-in user, drive `HomePage.openSignInModal()` followed by
   `HomePage.signInDevButton.click()` (or wrap that in a page-object
   helper if it gets repetitive).
5. Run `npm run e2e` locally before pushing.
