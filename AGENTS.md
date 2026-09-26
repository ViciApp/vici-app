# AGENTS.md

Canonical entry point for **all** AI coding agents working in this repository
(Claude Code, Cursor, OpenAI Codex / GPT, Aider, GitHub Copilot, Continue,
opencode, …). If your tool reads `AGENTS.md` automatically, this is the right
file. If it doesn't, point it here.

> **Read this first. Always.** It is short on purpose. Everything deeper lives
> under [`docs/ai/`](./docs/ai/) and is linked below.

---

## 1. What this repo is

Vici is a prediction-market platform on the Internet Computer. The repo is
multi-stack but **frontend-heavy**. The on-chain risk engine lives in a
separate repo ([`icdc-core`](https://github.com/AntonioVentilii/icdc-core),
typically checked out at `../icdc-core/`).

What `ls`, `package.json`, and `tsconfig*.json` already tell you, this file
will not. What they cannot tell you:

- **`src/declarations/**`is generated** by`npm run did`from upstream`.did` files. Never hand-edit.
- **`src/satellite/satellite.did`, `satellite_extension.did`, and
  `api-schemas.ts` are generated** by `npm run juno:functions:build`.
- **`static/workers/**`is synced from`@junobuild/core`by`npm run postinstall`\*\* — don't hand-edit.
- **The risk engine is in [`../icdc-core/`](../icdc-core/)** — a separate
  repo with its own `AGENTS.md`. Don't try to modify Rust from this repo.
- **Local replica is the Juno emulator.** Never run `dfx start`.

The full restricted-paths table lives in
[`docs/ai/governance.md`](./docs/ai/governance.md#boundaries).

---

## 2. Project-specific commandments

Universal "be a good agent" rules (atomic PRs, small diffs, no `any`, no
new deps without approval, no force-pushing without an explicit named
ask) are enforced via CI, eslint, the boundary table in
[`governance.md`](./docs/ai/governance.md), and the PR template in
[`pr-and-ci.md`](./docs/ai/pr-and-ci.md). What is **specific to Vici**:

1. **Reuse over rebuild.** Before adding a new component / util / constant /
   service / store, search
   [`docs/ai/frontend/reusability.md`](./docs/ai/frontend/reusability.md).
   If you add a new shared one, extend the catalog in the same PR.
2. **A11y.** No bare clickable `<div>`s. Real `<button>` / `<a>` elements,
   labelled inputs, decorative icons `aria-hidden`. See
   [`docs/ai/frontend/a11y.md`](./docs/ai/frontend/a11y.md).
3. **i18n is non-negotiable.** Every user-visible string goes through
   `t({ locale: $localeStore, key })` from
   [`$lib/utils/i18n.utils`](./src/lib/utils/i18n.utils.ts). Add the key to
   **every** locale catalog under `src/lib/constants/messages/` — never
   just `en.ts`. The supported locales are declared once in
   [`$lib/constants/locale.constants`](./src/lib/constants/locale.constants.ts)
   (`SUPPORTED_LOCALES`). The full workflow lives in
   [`docs/ai/frontend/i18n.md`](./docs/ai/frontend/i18n.md). Hardcoded
   English strings in templates are a review-blocking smell, not a
   stylistic preference.
4. **The folder taxonomy is closed.** No new top-level folders under
   `src/` or `src/lib/` without explicit ask. New code goes in the folder
   that already owns the concern — see
   [`docs/ai/frontend/structure.md`](./docs/ai/frontend/structure.md) and
   [`docs/ai/satellite/structure.md`](./docs/ai/satellite/structure.md).
5. **Terminology.** Use **"prediction"**, never "bet" — in code, comments,
   and user-visible copy. Time variables end in `_ms` (milliseconds,
   business logic) or `_ns` (nanoseconds, protocol / idempotency).
   **Never reference temporary or external design source materials** —
   folder names, file names (e.g. spec exports), or section numbers from
   those files — anywhere in the repo. The product reflects **the**
   design — there is no "new", "old", "redesigned", or "previous"
   design. When a code comment needs to cite a rule, point at
   [`docs/ai/frontend/design.md`](./docs/ai/frontend/design.md) (§ 7 for
   Flow Mode); describe behaviour and intent, not its source.
6. **Eslint disallowed list is hard policy.** `0n` literal → `ZERO` from
   `$lib/constants/app.constants`. `return undefined;` → bare `return;`.
   `local-rules/no-relative-imports` is `error` under `src/**` — use the
   aliases declared in [`svelte.config.js`](./svelte.config.js).
   `local-rules/no-bare-svelte-text` flags hardcoded English in any
   `.svelte` file that already imports `$lib/utils/i18n.utils` — when it
   fires, route the string through `t(...)` instead of disabling the rule.
7. **Run the local gates** ([`pr-and-ci.md`](./docs/ai/pr-and-ci.md#local-quality-gates))
   before opening a PR. Catalog drift across locales is caught by
   `npm run check:i18n` (auto-runs as part of `npm run lint`).

---

## 3. Where to look (frontend)

| You're about to…                                   | Read first                                                                                       |
| -------------------------------------------------- | ------------------------------------------------------------------------------------------------ |
| Open any PR                                        | [`docs/ai/pr-and-ci.md`](./docs/ai/pr-and-ci.md)                                                 |
| Spec or implement a feature spec-first             | [`docs/ai/spec-driven-development/workflow.md`](./docs/ai/spec-driven-development/workflow.md)   |
| Work on a task run by the agent workshop           | [`docs/ai/officina.md`](./docs/ai/officina.md)                                                   |
| Understand shipped product behaviour               | [`docs/ai/PRODUCT.md`](./docs/ai/PRODUCT.md)                                                     |
| Touch any frontend file                            | [`docs/ai/frontend/README.md`](./docs/ai/frontend/README.md)                                     |
| Add or move a file                                 | [`docs/ai/frontend/structure.md`](./docs/ai/frontend/structure.md)                               |
| Write Svelte 5 / runes / TS                        | [`docs/ai/frontend/stack-and-patterns.md`](./docs/ai/frontend/stack-and-patterns.md)             |
| Add UI                                             | [`docs/ai/frontend/reusability.md`](./docs/ai/frontend/reusability.md)                           |
| Add a Svelte component                             | [`docs/ai/frontend/workflows/new-component.md`](./docs/ai/frontend/workflows/new-component.md)   |
| Add an API call / service / store                  | [`docs/ai/frontend/workflows/new-service.md`](./docs/ai/frontend/workflows/new-service.md)       |
| Split / refactor a component                       | [`docs/ai/frontend/workflows/refactor-split.md`](./docs/ai/frontend/workflows/refactor-split.md) |
| Add user-visible text or interactive elements      | [`docs/ai/frontend/a11y.md`](./docs/ai/frontend/a11y.md)                                         |
| Add or change any user-visible copy / locale       | [`docs/ai/frontend/i18n.md`](./docs/ai/frontend/i18n.md)                                         |
| Align a screen / token / asset with the app design | [`docs/ai/frontend/design.md`](./docs/ai/frontend/design.md)                                     |
| Add or change tests                                | [`docs/ai/frontend/testing.md`](./docs/ai/frontend/testing.md)                                   |

---

## 4. Where to look (Juno satellite)

The Juno satellite (`src/satellite/`) holds TypeScript hooks, assertions, and
typed queries/updates that run on the satellite canister. It is **not** the
on-chain risk engine — that lives in `../icdc-core/`.

| You're about to…                                                           | Read first                                                                                     |
| -------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------- |
| Touch any satellite file                                                   | [`docs/ai/satellite/README.md`](./docs/ai/satellite/README.md)                                 |
| Add a hook / assertion / typed endpoint                                    | [`docs/ai/satellite/patterns.md`](./docs/ai/satellite/patterns.md)                             |
| Touch VXP awards / economy parameters                                      | [`docs/ai/satellite/economy.md`](./docs/ai/satellite/economy.md)                               |
| Add a hook (`onSetDoc` / `onDeleteDoc`)                                    | [`docs/ai/satellite/workflows/new-hook.md`](./docs/ai/satellite/workflows/new-hook.md)         |
| Add a typed `defineQuery` / `defineUpdate`                                 | [`docs/ai/satellite/workflows/new-endpoint.md`](./docs/ai/satellite/workflows/new-endpoint.md) |
| Sync something into the icdc-core registry / Vici engine                   | [`docs/ai/satellite/workflows/engine-sync.md`](./docs/ai/satellite/workflows/engine-sync.md)   |
| Reset / repair the registry + engine grants (local / staging / production) | [`.agents/workflows/icdc-engine-reset.md`](./.agents/workflows/icdc-engine-reset.md)           |
| Spec a satellite change (perf / memory / scalability are mandatory)        | [`docs/ai/spec-driven-development/workflow.md`](./docs/ai/spec-driven-development/workflow.md) |

---

## 5. Where to look (backend / risk engine — `../icdc-core/`)

The Rust canisters that power Vici (Clearing + Registry + Shared) live in
[`../icdc-core/`](../icdc-core/). **Do not** modify Rust under
`src/declarations/**` here — those are generated bindings.

| You're about to…                                              | Read                                                                                           |
| ------------------------------------------------------------- | ---------------------------------------------------------------------------------------------- |
| Understand how Vici talks to icdc-core (Engine model, oracle) | [`docs/engine-integration.md`](./docs/engine-integration.md)                                   |
| Touch the on-chain registry / clearing / minter canisters     | Open `../icdc-core/`. See its [`AGENTS.md`](../icdc-core/AGENTS.md) first.                     |
| Regenerate Candid bindings after an icdc-core upgrade         | [`docs/ai/backend/README.md`](./docs/ai/backend/README.md#regenerating)                        |
| Day-2 ops on the Vici engine (grant/revoke/audit)             | [`.agents/workflows/icdc-engine-operations.md`](./.agents/workflows/icdc-engine-operations.md) |

`docs/ai/backend/README.md` is a thin pointer file: the source of truth for
backend conventions is `../icdc-core/`.

---

## 6. Governance & meta

- **Truth hierarchy** (highest wins on conflict):
  1. **Code** (`src/**`, `scripts/**`) — current state of the world.
  2. **CI** ([`.github/workflows/**`](./.github/workflows/)) — non-negotiable
     checks.
  3. **CODEOWNERS** ([`.github/CODEOWNERS`](./.github/CODEOWNERS)) — review
     routing.
  4. [`docs/ai/governance.md`](./docs/ai/governance.md) — policies & boundaries.
  5. This file (`AGENTS.md`) — universal entry.
  6. Tool-specific layers ([`CLAUDE.md`](./CLAUDE.md),
     `.claude/rules/`, `.cursor/rules/`,
     `.github/copilot-instructions.md`) — never contradict the above.
- **Auto-adapting docs.** When a PR introduces a new pattern, convention,
  shared component, shared type, workflow, or policy, the agent **MUST**
  update the relevant `docs/ai/**` file in the same PR. See
  [`docs/ai/governance.md#meta-update-rule`](./docs/ai/governance.md#meta-update-rule).
  When editing `docs/ai/**` itself, follow the
  [writing-for-agents rules](./docs/ai/governance.md#writing-for-agents--meta-rules-for-docsai)
  — only non-discoverable signal goes in, tool-specific layers stay thin.

---

## 7. Tool-specific entry points

These are thin layers on top of this file. They never contradict it.

- **Claude Code / Anthropic:** [`CLAUDE.md`](./CLAUDE.md).
- **Cursor:** drop a rule under `.cursor/rules/` that points here.
- **GitHub Copilot:** drop `.github/copilot-instructions.md` that points here.
- **OpenAI Codex / Aider / opencode / Continue / …:** read this file
  (`AGENTS.md`).

If you add a new agent / tool, add a tiny pointer file (≤ 30 lines) here that
references this `AGENTS.md` — do **not** duplicate the rules.
