# AGENTS.md

Canonical entry point for **all** AI coding agents working in this repository (Claude Code, Cursor, Codex, Copilot, Aider, opencode, ...). Read it first, always. It is short on purpose: everything deeper lives under [`docs/ai/`](./docs/ai/README.md).

## 1. What this repo is

Vici is a prediction-market app. Four areas, each with its own area README:

| Area                        | Code                                  | Read once per session                                          |
| --------------------------- | ------------------------------------- | -------------------------------------------------------------- |
| SvelteKit frontend          | `src/lib/`, `src/routes/`, `src/*.ts` | [`docs/ai/frontend/README.md`](./docs/ai/frontend/README.md)   |
| Juno satellite (functions)  | `src/satellite/`                      | [`docs/ai/satellite/README.md`](./docs/ai/satellite/README.md) |
| Web2 API (Bun + Postgres)   | `backend/`                            | [`docs/ai/backend/README.md`](./docs/ai/backend/README.md)     |
| On-chain engine (icdc-core) | separate repo, `../icdc-core/`        | [`docs/ai/engine/README.md`](./docs/ai/engine/README.md)       |

What `ls` and `package.json` cannot tell you:

- **Generated, never hand-edited:** `src/declarations/**` and the vendored `backend/src/declarations/**` (`npm run did`; the hand-written wiring `src/declarations/{index,_factory,_types}.ts` is the exception), `src/satellite/satellite.did`, `satellite_extension.did` and `api-schemas.ts` (`npm run juno:functions:build`), `static/workers/**` (synced from `@junobuild/core` on `postinstall`).
- **The Rust risk engine is in [`../icdc-core/`](https://github.com/AntonioVentilii/icdc-core)**, with its own `AGENTS.md`. Never modify it from here.
- **The local replica is the Juno emulator** (`juno emulator start`). Never run `dfx start`.
- **The app runs on two backends.** The default build talks to the satellite and canisters; `VITE_BACKEND=web2` routes every app domain to the HTTP API in `backend/` (vici.app). Read [`web2-backend-mode.md`](./docs/ai/frontend/web2-backend-mode.md) before touching a service that branches on `isWeb2Backend()`.

The full protected-paths table is in [`governance.md`](./docs/ai/governance.md#boundaries).

## 2. Commands

| What                         | Command (repo root unless noted)              |
| ---------------------------- | --------------------------------------------- |
| Dev server                   | `npm run dev`                                 |
| Format + lint + i18n catalog | `npm run quality`                             |
| Type check (svelte-check)    | `npm run check`                               |
| Pure-logic specs             | `npm test`                                    |
| Satellite functions build    | `npm run juno:functions:build`                |
| Candid bindings              | `npm run did`                                 |
| API type check + tests       | `cd backend && bun run typecheck && bun test` |
| E2E (web2 / web3)            | `npm run e2e:web2` / `npm run e2e`            |

The full gate matrix is [`pr-and-ci.md` § 4](./docs/ai/pr-and-ci.md#4-local-quality-gates).

## 3. The universal standard

The rules every repository shares live in **one place only**: [Officina `standards/code.md`](https://github.com/AntonioVentilii/officina/blob/main/standards/code.md). Read it; it is not repeated here. This file and `docs/ai/**` only add what is specific to Vici.

## 4. Vici-specific rules

1. **Reuse catalogs.** Before adding a shared piece, search the catalog of the area: [frontend](./docs/ai/frontend/reusability.md), [satellite](./docs/ai/satellite/reusability.md), [API](./docs/ai/backend/reusability.md). A new shared piece gets a row in the same PR.
2. **i18n.** Every user-visible string goes through `t({ locale: $localeStore, key })` from [`#lib/utils/i18n.utils.ts`](./src/lib/utils/i18n.utils.ts), with the key in **every** catalog under `src/lib/constants/messages/` (locales: `SUPPORTED_LOCALES` in [`locale.constants.ts`](./src/lib/constants/locale.constants.ts)). Hardcoded English is review-blocking. See [`i18n.md`](./docs/ai/frontend/i18n.md).
3. **A11y.** No clickable `<div>`s; real `<button>` / `<a>`, labelled inputs, decorative icons `aria-hidden`. See [`a11y.md`](./docs/ai/frontend/a11y.md).
4. **Closed taxonomy.** No new top-level folder under `src/`, `src/lib/`, `src/satellite/` or `backend/src/` without an explicit ask. See the `structure.md` of the area.
5. **Terminology.** "prediction", never "bet", in code, comments and copy. Time variables end in `_ms` (business logic) or `_ns` (protocol, idempotency).
6. **No design-source references.** Never cite temporary or external design material (folder or file names, section numbers) in the repo. There is one design, never a "new" or "old" one; cite [`design.md`](./docs/ai/frontend/design.md) instead (§ 7 for Flow Mode), describing behaviour and intent.
7. **ESLint hard policy.** `0n` is `ZERO` from `#lib/constants/app.constants`; `return undefined;` is bare `return;`; null checks use `isNullish` / `nonNullish` from `@dfinity/utils`; imports under `src/**` use the subpath imports (`#lib`, `#declarations`, `#satellite`, `#root`) in `package.json`, never relative paths across folders. When `local-rules/no-bare-svelte-text` fires, route the string through `t(...)`.
8. **Spec-driven development is opt-in, so ask.** For a feature, an improvement or a non-trivial bugfix, mention the [spec workflow](./docs/ai/spec-driven-development/workflow.md) and ask whether to use it; skip it for small changes. When implementing a spec, read [`PRODUCT.md`](./docs/ai/PRODUCT.md) first and update it in the same PR. `Implemented` specs are history, never current behaviour. A satellite spec must cover performance, memory and scalability.
9. **Regenerated files ship with the change.** Touched `src/satellite/**` (or a `#lib/schema/*` it imports)? Run `npm run juno:functions:build` and commit the output. Ran `npm run did`? Commit both declaration trees with the wiring change.
10. **VXP economy rules are the exception to the truth hierarchy:** [`economy.md`](./docs/ai/economy.md) drives the code, not the other way round.

## 5. You are about to... read first

| You are about to...                                   | Read first                                                                                                                                    |
| ----------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------- |
| Open any PR                                           | [`pr-and-ci.md`](./docs/ai/pr-and-ci.md)                                                                                                      |
| Work on a task run by the agent workshop              | [`officina.md`](./docs/ai/officina.md)                                                                                                        |
| Understand shipped product behaviour                  | [`PRODUCT.md`](./docs/ai/PRODUCT.md)                                                                                                          |
| Add or move a frontend file                           | [`frontend/structure.md`](./docs/ai/frontend/structure.md)                                                                                    |
| Write Svelte 5 / runes / TS                           | [`frontend/stack-and-patterns.md`](./docs/ai/frontend/stack-and-patterns.md)                                                                  |
| Add UI or a component                                 | [`frontend/reusability.md`](./docs/ai/frontend/reusability.md), [`workflows/new-component.md`](./docs/ai/frontend/workflows/new-component.md) |
| Add a frontend service / store / API call             | [`frontend/workflows/new-service.md`](./docs/ai/frontend/workflows/new-service.md)                                                            |
| Split or refactor a component                         | [`frontend/workflows/refactor-split.md`](./docs/ai/frontend/workflows/refactor-split.md)                                                      |
| Add or change user-visible copy                       | [`frontend/i18n.md`](./docs/ai/frontend/i18n.md), [`frontend/brand.md`](./docs/ai/frontend/brand.md)                                          |
| Align a screen, token or asset with the design        | [`frontend/design.md`](./docs/ai/frontend/design.md)                                                                                          |
| Touch SEO, sitemap or meta tags                       | [`frontend/seo.md`](./docs/ai/frontend/seo.md)                                                                                                |
| Add a web2 branch to a frontend service               | [`frontend/web2-backend-mode.md`](./docs/ai/frontend/web2-backend-mode.md)                                                                    |
| Add or change frontend / E2E tests                    | [`frontend/testing.md`](./docs/ai/frontend/testing.md)                                                                                        |
| Add a satellite hook / assertion / endpoint           | [`satellite/patterns.md`](./docs/ai/satellite/patterns.md), [`satellite/workflows/`](./docs/ai/satellite/workflows/)                          |
| Touch VXP awards or economy parameters                | [`economy.md`](./docs/ai/economy.md), [`satellite/economy.md`](./docs/ai/satellite/economy.md)                                                |
| Sync something into the icdc-core registry / engine   | [`satellite/workflows/engine-sync.md`](./docs/ai/satellite/workflows/engine-sync.md)                                                          |
| Add an API route, migration or worker job             | [`backend/patterns.md`](./docs/ai/backend/patterns.md), [`backend/workflows/`](./docs/ai/backend/workflows/)                                  |
| Add or change API tests                               | [`backend/testing.md`](./docs/ai/backend/testing.md)                                                                                          |
| Regenerate Candid bindings after an icdc-core release | [`engine/README.md`](./docs/ai/engine/README.md#regenerating)                                                                                 |
| Understand how Vici talks to icdc-core                | [`docs/engine-integration.md`](./docs/engine-integration.md)                                                                                  |
| Reset, repair or operate the Vici engine              | [`.agents/workflows/`](./.agents/workflows/) (`icdc-engine-reset.md`, `icdc-engine-operations.md`)                                            |
| Deploy                                                | [`.agents/workflows/deployment.md`](./.agents/workflows/deployment.md)                                                                        |

## 6. Governance

- **Truth hierarchy** (highest wins): code (`src/**`, `backend/**`, `scripts/**`), then CI ([`.github/workflows/`](./.github/workflows/)), then [CODEOWNERS](./.github/CODEOWNERS), then `docs/ai/**`, then this file, then tool layers ([`CLAUDE.md`](./CLAUDE.md), `.claude/rules/`, and the pointer file of any other tool). On a contradiction, stop and ask. Details: [`governance.md`](./docs/ai/governance.md#truth-hierarchy).
- **Meta-update rule.** A PR that adds a pattern, a shared piece, a naming convention, a policy or a workflow updates the matching `docs/ai/**` page in the same PR. Which page for which change: [the map](./docs/ai/governance.md#meta-update-rule). When editing `docs/ai/**` itself, follow the [writing-for-agents rules](./docs/ai/governance.md#writing-for-agents-meta-rules-for-docsai).

## 7. Tool-specific entry points

Thin layers that point here and never contradict it: [`CLAUDE.md`](./CLAUDE.md) and `.claude/rules/` for Claude Code. Any other tool reads this file; a new tool gets a pointer file of at most 30 lines, never a copy of the rules.
