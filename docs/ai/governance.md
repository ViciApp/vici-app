# Governance

This page defines what agents may, should, and must not do. It applies to
every agent (Claude Code, Cursor, Copilot, Codex, Aider, opencode, …).

## Truth hierarchy

When two sources disagree, the higher one wins:

1. **The code** (`src/**`, `scripts/**`) — current state of reality.
2. **CI workflows** ([`.github/workflows/**`](../../.github/workflows/)) —
   non-negotiable gates that must be green to merge.
3. **CODEOWNERS** ([`.github/CODEOWNERS`](../../.github/CODEOWNERS)) —
   defines who must approve each path.
4. **This file + sibling pages under `docs/ai/`** — policy.
5. [`AGENTS.md`](../../AGENTS.md) — universal entry, points at the above.
6. **Tool-specific layers** ([`CLAUDE.md`](../../CLAUDE.md),
   [`.claude/rules/`](../../.claude/rules/), `.cursor/rules/`,
   `.github/copilot-instructions.md`). These never contradict 1–5.

If an agent finds a contradiction, the agent **stops and asks** instead of
guessing.

**Scoped exception — economy policy.** For the _rules_ of the VXP
economy (which surfaces mint, and the caps / gates / anti-farming
posture that bound them), [`economy.md`](./economy.md) is authoritative
and the code is reconciled **to** it — see its
[reconciliation protocol](./economy.md#reconciliation-protocol--the-rules-drive-the-code).
This inverts tiers 1 and 4 **only** for economy rules; numeric _values_
still live in the constants files (tier 1) and shipped _behaviour_ is
still described by [`PRODUCT.md`](./PRODUCT.md).

## Roles

You can play any of these roles in a single session — most non-trivial PRs
involve all three, in order. Keep them mentally separated.

### Planner

Decompose the task. Surface trade-offs in plain text _before_ editing files.
For anything > ~50 changed lines or touching > 3 files, write a short bullet
plan and confirm scope with the human.

### Implementer

Execute the plan with **targeted edits**. Strictly follow:

- [`frontend/structure.md`](./frontend/structure.md) and
  [`frontend/stack-and-patterns.md`](./frontend/stack-and-patterns.md) for the
  SvelteKit app.
- [`satellite/structure.md`](./satellite/structure.md) and
  [`satellite/patterns.md`](./satellite/patterns.md) for the Juno satellite.

Run the local quality gates from [`pr-and-ci.md`](./pr-and-ci.md) before
declaring done.

### Reviewer

Before opening / merging, self-review against:

- [project-specific commandments](../../AGENTS.md#2-project-specific-commandments)
- [PR conventions](./pr-and-ci.md)
- [Reusability catalog](./frontend/reusability.md) — flag duplication you
  re-introduced.
- [a11y rules](./frontend/a11y.md).

## Boundaries

These paths are **protected**. Agents may read them, but must not modify
them without an explicit ask in the user prompt.

| Path                                                                   | Reason                                                                            | Owner            |
| ---------------------------------------------------------------------- | --------------------------------------------------------------------------------- | ---------------- |
| `.github/workflows/**`                                                 | CI integrity. Only `ci(...)` PRs touch these.                                     | repo maintainers |
| `.github/CODEOWNERS`, `.github/actions/**`                             | Review routing & action policy.                                                   | repo maintainers |
| `package.json` (deps), `package-lock.json`                             | New / upgraded dependencies require explicit approval.                            | repo maintainers |
| `dfx.json`, `canister_ids.json`                                        | Canister wiring.                                                                  | repo maintainers |
| `juno.config.ts`, `juno.collections.json`                              | Collection rules + satellite IDs. Schema drift breaks data + auth.                | repo maintainers |
| `src/satellite/satellite.did`, `src/satellite/satellite_extension.did` | Public Candid interface of the satellite. Generated; regenerate, never hand-edit. | —                |
| `src/satellite/api-schemas.ts`                                         | Generated schema bindings used by `defineQuery` / `defineUpdate`.                 | —                |
| `src/declarations/**`                                                  | **Generated** by `npm run did` from upstream `.did` files.                        | —                |
| `eslint.config.js`, `.prettierrc`, `tsconfig*.json`                    | Lint / format / TS policy.                                                        | repo maintainers |
| `scripts/build/**`, `scripts/lib/**`, `scripts/init/**`                | Reproducible-build + bootstrap pipeline. Touch only when prompted.                | repo maintainers |
| `scripts/*`, `scripts/test/**`                                         | Deploy canisters, move tokens, act as the dfx identity, gate CI or releases.      | repo maintainers |
| `backend/package.json`, `backend/bun.lock`                             | Backend dependencies. Same approval as the root ones.                             | repo maintainers |
| `backend/Dockerfile`, `backend/fly*.toml`                              | Web2 API image and deploy.                                                        | repo maintainers |
| `backend/docker-compose.yml`, `backend/bunfig.toml`                    | Local Postgres stack and the test preload.                                        | repo maintainers |
| `backend/tsconfig.json`                                                | Backend TS policy (the root `tsconfig*.json` glob does not cover it).             | repo maintainers |
| `backend/src/{auth,account,admin,custody,chains,vxp,engine,db}/**`     | Sessions, accounts, roles, custody, chains, VXP, engine and schema.               | repo maintainers |
| `backend/src/env.ts`                                                   | Validated environment and secrets.                                                | repo maintainers |
| `backend/src/routes/{auth,account,admin,claim,engine,vxp,wallet}.ts`   | Routes that issue sessions, move value or expose admin surfaces.                  | repo maintainers |
| `backend/src/lib/{cookie,crypto,keys,rate-limit,email,ic-agent}.ts`    | Session, key, abuse-protection, email and IC identity primitives.                 | repo maintainers |
| `backend/src/declarations/**`                                          | **Generated** Candid bindings for the backend. Regenerate, never hand-edit.       | repo maintainers |
| `backend/scripts/etl/**`, `backend/e2e/**`                             | Legacy data migration; test-only server with fake engine and seed.                | repo maintainers |
| `static/workers/**`                                                    | Synced from `@junobuild/core` by `npm run postinstall`. Don't hand-edit.          | —                |
| `node_modules/`, `target/`, `.svelte-kit/`, `build/`, `out/`, `.dfx/`  | Build output. Never commit.                                                       | —                |
| `../icdc-core/**`                                                      | External repo. Open it as a separate workspace; obey its `AGENTS.md`.             | icdc-core team   |

If a change must touch a protected path, call it out explicitly in the PR
description.

## Capabilities — quick reference

### Allowed without prompting

- Edit any file under `src/lib/**`, `src/routes/**`, `src/satellite/services/**`,
  `src/satellite/utils/**`, and `src/satellite/index.ts`.
- Edit `src/app.css`, `src/app.html`, `src/app.d.ts`, `src/custom-events.d.ts`.
- Add files inside the existing folder taxonomy
  ([FE structure](./frontend/structure.md),
  [satellite structure](./satellite/structure.md)).
- Run `npm run format`, `npm run lint`, `npm run check`, `npm run quality`,
  `npm run dev`, `npm run build`, `npm run did`,
  `npm run juno:functions:build`, `npm run init:icdc` (and its sub-scripts),
  `npm run test:engine-sync`, `npm run deploy`.
- Update these `docs/ai/**` pages when the meta-update rule fires.

### Forbidden without explicit prompt

- Add a new dependency or upgrade one (`package.json`).
- Add a new top-level folder under `src/` or `src/lib/` /
  `src/satellite/`.
- Edit any path in the [Boundaries](#boundaries) table.
- Disable an ESLint rule, suppress a `svelte-check` warning, or use `any` /
  `as unknown as …` to bypass a type.
- Skip / `.skip()` / `.todo()` an existing test once a test runner is wired.
- `git push --force`, amend a pushed commit, rebase to "tidy history", or
  rewrite shared history. "Explicit prompt" means the user names the
  operation directly — any unambiguous phrasing works (e.g.
  "force-push", "force push", "push --force", "push -f", "amend",
  "git commit --amend", "rebase", "git rebase", "rewrite history").
  Task-level delegation like "do what you think is best" or "do what's
  most correct" does **NOT** count. See
  [`pr-and-ci.md#updating-an-existing-pr`](./pr-and-ci.md#updating-an-existing-pr).
- Commit secrets, `.env*` (other than examples), or large binaries.
- Touch `src/satellite/satellite.did` or `src/declarations/**` by hand
  — regenerate via the appropriate scripts (`juno functions build`, `npm run did`).
- Modify the on-chain Rust canisters in `../icdc-core/` from this repo.
  If a change requires a new endpoint there, do that work in the
  `icdc-core` repo, then come back here for the binding regeneration and
  client wiring.

## Meta-update rule

> If a PR introduces a new pattern, new shared component, new shared type,
> new naming convention, new policy, or a new workflow, the PR **MUST**
> also update the relevant page under `docs/ai/**` so the next agent picks
> it up.

How:

1. Identify which page describes the area you changed:
   - Folder taxonomy → `frontend/structure.md` or `satellite/structure.md`.
   - New shared component / util / service / store → `frontend/reusability.md`.
   - New satellite hook / pattern → `satellite/patterns.md`.
   - New test pattern → `frontend/testing.md`.
   - New PR / CI rule → `pr-and-ci.md`.
   - New policy / boundary → this file.
   - New workflow → add a page under `frontend/workflows/` or
     `satellite/workflows/`.
2. Edit that page in the same PR with the smallest possible delta — add a
   bullet, add a row, swap a code sample.
3. Mention the doc update in the PR body under `# Changes`.
4. If the change is structural enough that the existing taxonomy stops
   making sense, open a separate **doc-only** PR first:
   `docs(ai): <reshape>` — and land it before the code PR.

This is what makes the docs _auto-adapting_: every PR is a small
opportunity to keep them honest. Reviewers should reject code PRs that
introduce a new pattern without the matching doc update.

## Writing for agents — meta-rules for `docs/ai/`

These rules govern **how the agentic docs themselves are written**.
They apply equally when a human edits `docs/ai/**` and when an agent
auto-updates it under the [meta-update rule](#meta-update-rule).
Adapted from Addy Osmani, [_The Right Way to Write
AGENTS.md_](https://addyosmani.com/blog/agents-md/).

> **The single test:** can the agent learn this by reading the code,
> running `ls`, opening `package.json`, or grepping? **If yes, do not
> write it down.** Documentation only earns its keep when it carries
> non-discoverable signal.

### Include — only non-discoverable signal

Write a doc entry when, and only when, it captures something the agent
would otherwise have to guess or learn the hard way:

- **Operational gotchas.** Workarounds discoverable only through
  experience (e.g. "tests need `--no-cache` or fixtures leak between
  runs"; "always run `npm run juno:functions:build` after touching
  `src/satellite/index.ts`").
- **Non-obvious tooling.** Commands or scripts that change what the
  agent runs (e.g. "regenerate bindings with `npm run did`, never edit
  `src/declarations/**` by hand").
- **Non-standard patterns to preserve.** Local idioms that look wrong
  but aren't (e.g. "the satellite uses a collection-dispatch table in
  `src/satellite/index.ts` on purpose — don't refactor into per-file
  registrations").
- **Boundaries.** Paths that look editable but aren't — see the
  [Boundaries table](#boundaries).
- **Cross-repo facts.** Things the local code can't tell the agent
  (e.g. "the Rust risk engine lives in `../icdc-core/`").

### Exclude — anything the code already says

If it's already in the code, omit it. Stale duplicates are worse than
absence because they look authoritative.

- **Directory layouts and folder taxonomy** beyond a decision tree
  for placement — `ls` answers this. (Our
  [`structure.md`](./frontend/structure.md) earns its keep with the
  _decision tree_, not the tree listing.)
- **Tech stack overviews.** `package.json` and `tsconfig*.json` are
  authoritative.
- **Generic style guides.** Prettier + ESLint enforce them; the doc
  adds nothing.
- **READMEs copy-pasted from elsewhere.** Link, don't mirror.
- **Architectural narratives** ("this project uses a layered
  architecture…") — the agent already infers this by reading.

### Structure — hierarchical, scoped, layered

Don't put everything in one file. Match doc depth to where the agent
needs it:

1. **Entry layer** — [`AGENTS.md`](../../AGENTS.md) is universal and
   thin. [`CLAUDE.md`](../../CLAUDE.md) is a Claude-only runtime
   wrapper, equally thin.
2. **Area READMEs** — [`docs/ai/frontend/README.md`](./frontend/README.md),
   [`docs/ai/satellite/README.md`](./satellite/README.md),
   [`docs/ai/backend/README.md`](./backend/README.md) — read once per
   session, scoped to the area touched.
3. **Topic pages** — `structure.md`, `stack-and-patterns.md`,
   `patterns.md`, `i18n.md`, `a11y.md`, … — loaded selectively when
   the agent touches that concern.
4. **Workflow pages** — `frontend/workflows/`, `satellite/workflows/`
   — concrete recipes for repeated multi-step tasks.

The agent should never need to load the full corpus to do one task. A
UX-focused agent touching `$lib/components/ui/` and a backend agent
regenerating bindings should pull disjoint slices.

### Tool-specific layers stay thin

Files under [`.claude/rules/`](../../.claude/rules/),
`.cursor/rules/`, `.github/copilot-instructions.md`, and the like:

- Are **pointers** into `docs/ai/`, never replacements.
- May surface 3–5 high-violation reminders so they land in the tool's
  prompt window — no full taxonomies, no code examples, no rewrites.
- Never contradict `docs/ai/` (see
  [truth hierarchy](#truth-hierarchy)).
- Get updated only when the canonical page in `docs/ai/` already
  reflects the new rule.

If a Claude-specific reminder grows past a few lines, that's a signal
the substance belongs in `docs/ai/` — promote it, then re-link.

### Maintenance — friction log, not config

> Every entry is a signal about something in the codebase that's
> confusing enough to trip an agent.

- **Prefer fixing the root cause** over documenting around it. If you
  reach for a doc bullet, first ask whether the friction can be
  removed by an ESLint rule, a rename, a smaller component, a clearer
  filename, a test, or a code comment at the point of confusion.
  Documentation is the last resort, not the first.
- **Stale > absent.** A wrong fact in `docs/ai/` mis-steers every
  future agent. If you spot drift while doing unrelated work, fix the
  doc in the same PR or open a doc-only follow-up.
- **No `/init`-style sweeps.** Don't ask an agent to auto-regenerate
  `docs/ai/` wholesale — the output recapitulates discoverable
  structure (which we don't want) and erases hard-won non-obvious
  notes (which we do). Updates land per-PR via the
  [meta-update rule](#meta-update-rule).
- **Empirical pressure beats intuition.** If a rule keeps being
  violated by agents (or humans) despite being documented, the doc
  isn't the problem — the rule is in the wrong place, or the
  underlying code needs to change. Move it, lift it into a lint rule,
  or refactor the surface area.

### Style

- **Direct, declarative, imperative on rules.** "Do X." "Never Y."
  Mirrors the codebase's brand voice — see
  [`frontend/brand.md`](./frontend/brand.md).
- **Smallest delta wins.** Add a bullet, swap a row, replace one
  example. Don't restructure a whole page when a one-line addition
  works.
- **Link out, don't mirror.** Reference
  [`stack-and-patterns.md`](./frontend/stack-and-patterns.md#identity--auth)
  with a deep link rather than copy-pasting the rule.
- **Cite the code.** When a rule references a real file, link to the
  file at the relevant path — that way edits to the code surface in
  doc reviews via grep.
