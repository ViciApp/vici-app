# Frontend AI Guide

If you are about to touch anything under `src/lib/`, `src/routes/`, or the
top-level `src/*.{css,html,d.ts}` files, this is your starting point. Read
it once per session.

> Higher up the chain: [`AGENTS.md`](../../../AGENTS.md) → [`docs/ai/`](../README.md).

## Vici-specific things to check (every change)

Generic agent hygiene (read first, run lint/check,
[scoped PRs](https://github.com/AntonioVentilii/officina/blob/main/standards/code.md#2-scoped)) is in
[`AGENTS.md`](../../../AGENTS.md) and [`pr-and-ci.md`](../pr-and-ci.md).
What is specific to Vici:

- [ ] **Reuse:** I checked [`reusability.md`](./reusability.md) for an
      existing component / util / store / service before creating one. If
      I added a new shared one, I updated the catalog in the same PR.
- [ ] **Terminology:** **prediction**, never "bet". `_ms` for milliseconds,
      `_ns` for nanoseconds.
- [ ] **A11y:** no bare clickable `<div>`s; labelled inputs; `aria-hidden`
      on decorative icons. See [`a11y.md`](./a11y.md).
- [ ] **Eslint landmines:** no `0n` literals (use `ZERO`); no relative
      imports across folders under `src/`; no `return undefined;`; no
      direct `null`/`undefined` comparisons (use `isNullish` /
      `nonNullish` from `@dfinity/utils`).
- [ ] **Design rule:** I did **not** reference any temporary or external
      design source material (folder name, file name, section number) in
      code, comments, commit message, or PR body.
- [ ] **Brand:** copy reads in the VICI register (terse, declarative,
      no emoji, imperative on buttons) and any new colour / type / glyph
      is sourced from the tokens in [`brand.md`](./brand.md). See
      [voice & tone](./brand.md#2-voice--tone) and
      [no emoji ever](./brand.md#23-no-emoji-ever).
- [ ] **Meta-update:** if I introduced a new pattern / shared component /
      shared type / workflow, I updated `docs/ai/**` in the same PR
      ([meta-update rule](../governance.md#meta-update-rule)).

## Stack & layout

The stack is `package.json`; the folder layout is `ls src/lib/`. Use the
[`structure.md`](./structure.md) decision tree to place new files, and
[`stack-and-patterns.md`](./stack-and-patterns.md) for Svelte 5 / TS / Tailwind
idioms.

Non-obvious points the codebase will not tell you:

- ESLint's local rule `local-rules/no-relative-imports` is **`error`** under
  `src/**`; always import via the subpath imports in
  [`package.json`](../../../package.json) `imports`.
- `0n` and `return undefined;` are eslint-flagged; use `ZERO` from
  `#lib/constants/app.constants` and bare `return;`.
- Pure-logic specs run on Node's built-in runner (`npm test`); there is no
  component-test runner yet. [`testing.md`](./testing.md) is the contract.
- The crawler-facing surface (sitemap + per-market meta pages) is generated
  at deploy time, not at runtime; see [`seo.md`](./seo.md) before touching
  `src/app.html` head tags, `robots.txt`, or the hosting `predeploy` chain.
- A build-time backend seam (`VITE_BACKEND`) can route migrated domains to
  the repo's HTTP API; the default is unchanged current behavior. Read
  [`web2-backend-mode.md`](./web2-backend-mode.md) before adding any
  `isWeb2Backend()` branch.

## What "good" looks like in this repo

A 10x change is small, focused, and reuses what's there. Recent merged PRs
to learn from (from `git log` on `main`):

- `fix(collateral): use nanoid for operation IDs (replaces insecure Math.random fallback)`
  (#75): single bug, contained fix, calls out the security angle.
- `feat: count docs instead of list` (#65): single primitive change, swaps
  an O(n) read for the dedicated counter.
- `feat: upgrade juno functions v0.9 and drop candid for ledger transfer`
  (#64): single dependency upgrade, removes an old code path in the same
  step because it's part of the upgrade.
- `fix: market resolution & settlement UX` (#51): bounded UX fix.

If your PR doesn't look like one of those (single verb, single concern,
small diff), reconsider scope before continuing.
