# Frontend Testing

> **Status: bootstrap.** No Vitest runner yet; pure-logic specs under
> `src/tests/` run on Node's built-in runner via `npm test` (see
> [Today](#today)) and already follow the layout and naming conventions
> below. The `@dfinity/eslint-config-oisy-wallet/vitest` preset is wired
> into `eslint.config.js`, so once Vitest exists ESLint will already
> understand it; the Vitest-specific parts below (component tests, mocks,
> `tsconfig.spec.json`) are the forward-looking contract until then.
>
> **End-to-end (Playwright) tests are configured**: see
> [E2E against the API](#e2e-against-the-api).

## Today

- **Pure-logic specs are required by CI; there is no component test
  runner yet.** The `checks.yml` workflow runs `format`, `lint`, `check`
  and `test`. The one spec under `src/tests/lib/components/`
  (`authn/Authn.spec.ts`) reads the component's source as text.
- **Pure-logic specs run on Node's built-in runner** until Vitest lands:
  `npm test` (`tsx --test`, which resolves the `#lib` alias) picks up
  `src/tests/**/*.spec.ts`. Use `node:test` + `node:assert/strict`, import
  only modules with no Svelte / SvelteKit / env dependencies, and keep the
  mirror-`src/` layout below (`eslint.config.js` lifts
  `vitest/no-import-node-test` for `src/tests/**` only). CI runs it in the
  `test` job. One exception: a `*.svelte.ts` class whose only Svelte
  dependency is the `$state` rune can be tested by defining a plain
  `$state` stand-in on `globalThis` before importing it dynamically (see
  `src/tests/lib/stores/wallet-history-pager.spec.ts`); it covers the
  logic, not reactivity.
- **E2E (Playwright) runs in CI.** `e2e.yml` builds the production
  bundle and runs it against the real API on every PR and push to `main`
  (`npm run e2e`, see
  [E2E against the API](#e2e-against-the-api)).
- **Bug fixes still benefit from a manual repro.** Document repro steps in
  the PR body's `# Tests` section so a reviewer can verify.

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

| Add tests for                                                     | Don't bother                                          |
| ----------------------------------------------------------------- | ----------------------------------------------------- |
| Pure utils (`*.utils.ts`): every public function                  | Re-exports, barrels                                   |
| Service modules (`*.services.ts`): happy path + each error branch | Generated files (`#declarations`)                     |
| Derived stores (`*.derived.ts`) with non-trivial logic            | Throwaway prototypes                                  |
| Reusable components in `#lib/components/ui/`                      | One-off presentational components used in 1 page only |
| Components with logic (any non-trivial branch / event handler)    | -                                                     |
| Schemas / validation modules                                      | -                                                     |
| Bug fixes (write the regression test that fails on `main`)        | -                                                     |

If you fix a bug, **the PR contains a test that fails on `main` and
passes on your branch**. Otherwise it's an "I think this is fine" PR.

### File shape (target convention)

```ts
import { describe, expect, it } from 'vitest';
import { formatBalance } from '#lib/utils/format.utils.ts';
import { ZERO } from '#lib/constants/app.constants.ts';

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
- One `it` per behaviour; name it from the user/caller perspective.
- Reset mocks in `beforeEach`. Never let test order matter.
- For fetch / canister calls: mock the matching `#lib/api` / `#lib/canisters`
  module rather than stubbing `fetch` directly.

### Component testing

```ts
import { render, screen } from '@testing-library/svelte';
import { describe, expect, it } from 'vitest';
import Button from '#lib/components/ui/Button.svelte';

describe('Button', () => {
	it('renders the label', () => {
		render(Button, { props: { label: 'Confirm' } });
		expect(screen.getByRole('button', { name: 'Confirm' })).toBeInTheDocument();
	});
});
```

Prefer `getByRole`, `getByLabelText`, `getByText`; they exercise the same
semantics as a screen reader.

### Forbidden in tests

- `it.skip` / `describe.skip` / `it.todo` left on `main`.
- Real network calls. Stub `fetch` with `vi.stubGlobal` (and
  `vi.unstubAllGlobals()` in `afterAll`).
- `setTimeout`-based waits. Use `vi.useFakeTimers()` or `await waitFor(...)`.
- Console-noise (`console.log` debug output). Remove before commit.

## Adding Vitest: what is left

`npm test`, the `src/tests/` layout, the `*.spec.ts` suffix and the `test`
job in `checks.yml` already exist. Moving to Vitest is **not** something an
agent should do silently. If a PR genuinely needs it:

1. Surface the request in the PR description and ask for explicit
   approval to add `vitest`, `@testing-library/svelte`, `jsdom`, and a
   matching `tsconfig.spec.json`.
2. Point `npm test` at Vitest, port the existing `node:test` specs, and
   drop the `vitest/no-import-node-test` override in `eslint.config.js`.
   Update the `test` row in [`pr-and-ci.md`](../pr-and-ci.md).
3. **Update this page** in the same PR to flip "bootstrap" → the actual
   policy (no skipped tests on `main`, regression tests for bug fixes,
   etc.). That's the
   [meta-update rule](../governance.md#meta-update-rule) in action.

Until then, this page documents the target shape so the first Vitest spec
doesn't have to invent it from scratch.

## E2E against the API

The end-to-end suite: the production bundle driven against the real HTTP API in [`backend/`](../../../backend/README.md)
on a throwaway Postgres. Specs live under
[`e2e/`](../../../e2e/), config in
[`playwright.config.ts`](../../../playwright.config.ts).

### Stack

- **Frontend:** `vite build` + `vite preview` on `:4173` (the shipped bundle,
  not the dev server), built with `VITE_API_URL=http://localhost:8787`.
  Both servers use `localhost` because the session cookie is host-only.
- **API:** `backend/e2e/server.ts` on `:8787`, the production app
  (`src/index.ts`) with its external dependencies swapped through the
  existing test seams: the engine actors and the VXP ledger are the
  deterministic fakes in `backend/e2e/fake-engine.ts` (fixture catalog, one
  settled market, the VXP collateral asset, ledgers and collateral deposits
  that enforce the real allowance and domain rules, every account the
  never-deposited empty one until a deposit lands; every other method, other
  writes included, rejects), and email lands in an in-memory outbox. Both
  servers boot from Playwright's
  `webServer` (migrate, seed, serve; then build, preview).
- **Seed:** `backend/e2e/seed.ts` writes two legacy accounts (provisional,
  `matched_via = 'etl'`) with their legacy identities, and an admin account. Fixture values live in
  `backend/e2e/fixtures.ts`, import-free so the specs read the same data.
- **Sign-in:** the email one-time code, as a user does it. The specs read the
  code from `GET /__e2e/otp/:email`; the admin drives the beta gate through
  the real admin settings API after an OTP sign-in.
- **Network:** each test's browser context aborts everything except the app
  assets and the API, which covers the reads the app still makes
  on-chain (the order books) and anything third-party. No
  request ever reaches mainnet, and the app is asserted to degrade on those
  reads.
- **Stack health:** an auto fixture (`e2e/support/fixtures.ts`) fails
  any test that saw an uncaught page error, an API 5xx, an engine read
  answering 4xx/5xx, or an `API error (5xx)` logged by the app,
  whatever the spec itself asserted.

The test-only hooks and why they cannot run in production are in
[`backend/README.md`](../../../backend/README.md#end-to-end-stack-test-only).

### Layout

```text
e2e/
├── pages/app.page.ts       # sign-in / sign-up / sign-out, shell locators
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
- **Wait on the onboarding handoff** (`AppPage.signUp` does) before a
  full page load after sign-up: the claimed handle is written by an async
  drain, and reloading mid-write re-hydrates a profile-less account.
- **Leave the beta gate open.** Use the `admin` fixture to set it; its
  teardown clears it even when the spec fails.
- **The backend rate limiter** keys every local request on one IP; the
  `backend` fixture resets it per test.

### Local commands

```bash
cd backend && docker compose up -d && cd ..   # Postgres on localhost:5432
npm run e2e                                   # installs Chromium, builds, boots both servers, runs
npm run e2e:report                            # HTML report after a CI-style run
```

`E2E_DATABASE_URL` overrides the database. It must be a loopback host: the
API server is started through `bun run e2e:stack` (in `backend/`), which runs
the boot guard as a preflight before `migrate`, so a shared or production
database is refused before anything connects to it. Outside CI, Playwright reuses
servers already listening on `:4173` / `:8787`, so stop stale ones after
changing backend code or rebuild-relevant frontend code.

### CI

[`.github/workflows/e2e.yml`](../../../.github/workflows/e2e.yml)
runs on every pull request, every push to `main`, the merge queue and manual
dispatch, with no path filter: the suite spans the frontend, the backend and
their contract. Concurrency cancels a superseded PR run. It starts a
`postgres:16` service, installs npm (cached by `prepare`), Bun (install cache)
and Chromium (browser cache keyed on the Playwright version), then runs
`npm run e2e:ci` (the same suite without the browser install, which CI
does in its own cached step). One retry on CI; the report ships as
`playwright-report`, raw results as `test-results` on failure. It
needs no secrets.
