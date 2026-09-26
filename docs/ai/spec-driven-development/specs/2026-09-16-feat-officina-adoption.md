# Spec: Adopt Officina for vici-app

This spec follows the workflow defined in
`docs/ai/spec-driven-development/workflow.md`.

Status: Draft

## Goal

The Vici team, developers and non-developers, requests, specs, builds, reviews and verifies vici-app changes together through Officina, a collaborative agent workshop with a shared board. Humans approve specs, verify results and merge; agents do the drafting, building and reviewing inside risk lanes. Success is fewer human minutes per merged change and more requests coming from people who don't write code.

Officina itself is a separate product (`AntonioVentilii/officina`, MIT) with its own design document. This spec covers only what vici-app needs to adopt it: the project config, the docs agents read, and the dry run.

## Context

- **Officina's design** (roles, lifecycle, agent roles, lanes, approval policies, runner, security) is defined in Officina's `docs/architecture.md`. Nothing here restates it; this spec binds it to vici-app.
- **Collaboration model.** Roles live in Officina, not in repo permissions. `AntonioVentilii` (`admin`) is the only account with write access; org members `gioseagle` (Gio) and `cryptimotheus` (Tim) have `read`. GitHub requires write access for a code owner, so every merge still needs `AntonioVentilii`, whose merge approval Officina submits with his own GitHub user token.
- **Ruleset `main`** (id 13619156): squash only, code-owner review, resolved threads, Copilot review, CodeQL, code quality, required check `checks-pass`, and extra approval for unattributed changes. Officina works inside these rules and never bypasses them.
- **Runner.** Managed Agents sessions clone the repo through the Anthropic-side git proxy, so no GitHub token enters the sandbox. vici-app needs **no new workflow file** and no new repository secret for the primary runner.
- **Agent inputs that already exist:** `AGENTS.md`, `docs/ai/**`, the spec template `docs/ai/spec-driven-development/template.md`, the PR template `.github/pull_request_template.md`, protected paths in `docs/ai/governance.md#boundaries`.
- **Local gates:** `npm run quality` and `npm run check`; no `test` script. `.github/actions/prepare` shows the setup (`npm ci`, `npm run prepare`, Node from `.node-version`).
- **Public repository.** Issue text is untrusted. Officina acts only on dispatch from its engine, and treats mirrored issue text as data.

## Scope

1. **Install the Officina GitHub App** on `ViciApp/vici-app` (contents and pull requests read/write, issues read/write, checks read; no workflows or administration permission).
2. **`.github/officina.yml`**, the project config:

```yaml
version: 1
docs:
  entry: AGENTS.md
  spec_template: docs/ai/spec-driven-development/template.md
  spec_dir: docs/ai/spec-driven-development/specs
  pr_template: .github/pull_request_template.md
setup: ['npm ci', 'npm run prepare']
verify: ['npm run quality', 'npm run check']
lanes:
  red:
    agents_build: false
    approvals:
      spec_review: [{ role: owner }]
    paths:
      # docs/ai/governance.md#boundaries
      - '.github/**'
      - 'package.json'
      - 'package-lock.json'
      - 'dfx.json'
      - 'canister_ids.json'
      - 'juno.config.ts'
      - 'juno.collections.json'
      - 'src/satellite/**'
      - 'src/declarations/**'
      - 'static/workers/**'
      - 'eslint.config.js'
      - '.prettierrc'
      - 'tsconfig*.json'
      - 'local-rules/**'
      - 'scripts/build/**'
      - 'scripts/lib/**'
      - 'scripts/init/**'
      # money, identity, legal
      - 'src/lib/constants/vxp-economy.constants.ts'
      - 'src/lib/constants/vxp-onboarding.constants.ts'
      - 'src/lib/constants/flow-rewards.constants.ts'
      - 'src/lib/constants/legal-docs.constants.ts'
      - 'src/lib/components/authn/**'
      - 'src/lib/services/identity*.ts'
      - 'src/lib/schema/auth-identity.schema.ts'
      # web2 backend: auth, custody, chains, VXP, engine, schema, deploy
      - 'backend/package.json'
      - 'backend/bun.lock'
      - 'backend/Dockerfile'
      - 'backend/fly*.toml'
      - 'backend/src/auth/**'
      - 'backend/src/custody/**'
      - 'backend/src/chains/**'
      - 'backend/src/vxp/**'
      - 'backend/src/engine/**'
      - 'backend/src/db/**'
      - 'backend/src/declarations/**'
  standard:
    paths: ['**']
    wip: 3
    diff_lines: 800
    budget_usd: 25
    approvals:
      spec_review: [{ role: owner }]
      verifying: [{ domain: product, when: user_visible }, { role: owner }]
  green:
    paths: ['src/lib/constants/messages/**']
    wip: 5
    diff_lines: 600
    budget_usd: 5
    approvals:
      spec_review: [{ requester: true }, { domain: product }]
      verifying: [{ requester: true }]
```

3. **`docs/ai/officina.md`**: how the team works with Officina on vici-app (requesting, lanes, who approves what, what agents may never touch, how to take over a task from an agent). Add a row to the `AGENTS.md` section 3 table and one line to `workflow.md`: specs produced in Officina follow this workflow, are reviewed as spec versions in Officina, and are committed with the implementation PR.
4. **Members in Officina** (not in the repo): `AntonioVentilii` as owner; Gio and Tim as contributors with the `product` approval domain.
5. **Dry run**: three real tasks, one per lane, each with at least two members taking part.

### Out of scope

- Building Officina itself (its own repository and phases).
- Changing the ruleset, CODEOWNERS or collaborator permissions.
- Per-PR preview deploys for the web2 app: Officina phase 1 reads a preview link once vici-app provides one.
- Market decks: deck JSONs are not repo files and publishing needs the controller identity.
- Other Vici repositories (icdc-core, vici-maker, vici-courier, vici-cockpit).

## Linked issues

Searched open issues for factory, agent, automation, spec, contribution, preview, intake, issue template and CODEOWNERS: none related. No closing keyword.

## Analytics

No product analytics: this adds no user-visible surface to the app. Officina records its own delivery metrics (human minutes per merged change, lead time, rework rate, cost per change, share of requests from non-developers) on its metrics page.

## Technical requirements (CI / agent access)

- **Security.** The GitHub App has no `workflows` or `administration` permission, so agents cannot change CI or branch rules. Agents push only `officina/*` branches. Red-lane paths block agent builds, and Officina rechecks the real diff after every build round. No deploy secret (`JUNO_TOKEN`, `FLY_API_TOKEN_*`) is exposed to Officina.
- **Cost.** Per-step budgets from the lane config (`budget_usd`); a step that reaches its budget pauses and asks the owner.
- **Compatibility.** No satellite, schema or binding change. The adoption PR touches `.github/**` (a protected path) and is a `ci(...)` PR.

## Implementation outline

1. Install the Officina GitHub App on the repository.
2. Add `.github/officina.yml` as above.
3. Add `docs/ai/officina.md`; link it from `AGENTS.md` section 3 and from `workflow.md`.
4. Invite Gio and Tim in Officina with their roles.
5. Dry run: a copy change requested by Gio (green), a small frontend fix requested by Tim (standard), and a satellite request (red) that must stop before any agent build.
6. Record what the dry run changed in this spec's Decisions, then flip the status.

## Acceptance criteria

- [ ] `.github/officina.yml` validates against Officina's config schema.
- [ ] A green copy request from a contributor reaches a PR touching only `src/lib/constants/messages/**`, with every locale catalog updated, verified by the requester using the before/after table, passing `checks-pass`.
- [ ] A standard request produces a spec in the vici-app template shape (`Status`, `Linked issues`, `Analytics` present), approved per policy before any build starts.
- [ ] PR bodies use the `# Motivation` / `# Changes` / `# Tests` headings and end with `Closes #<issue>`.
- [ ] A red request never starts an agent build.
- [ ] Every approval in the dry run is attributed to a named member and a specific spec version or commit.
- [ ] `docs/ai/officina.md` is linked from `AGENTS.md`; `npm run quality` and `npm run check` pass on the adoption PR.

## Decisions

- **Product verification for user-visible standard changes stays in the policy.** Today nobody holds the `product` domain, so Officina waives that requirement and records it as waived; the owner's approval is enough. When someone is given the `product` domain, their approval becomes required with no config change. Collaboration is designed in from day one, and the workshop still works for a single person.
