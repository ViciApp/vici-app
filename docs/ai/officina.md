# Officina: how agent work runs on this repo

[Officina](https://github.com/AntonioVentilii/officina) is the workshop that runs agent work
against this repository: it writes specs, builds changes on a branch, reviews them, and hands the
result to people to verify and merge. This page is what the team needs to know; the config it
enforces lives in [`.github/officina.yml`](../../.github/officina.yml).

Officina never replaces this repo's rules. It works through a GitHub App that pushes branches and
opens pull requests, and the branch ruleset applies unchanged: CI must pass, Copilot reviews, review
threads must be resolved, and a code owner approves before anything merges.

## How a change flows

1. **Spec.** An agent reads `AGENTS.md`, the area README and the real code, then writes a spec in
   the repo's [template](./spec-driven-development/template.md). A missing product or technical
   decision stops the work with a question rather than a guess.
2. **Approval.** A person approves the spec. Who that is depends on the lane (below).
3. **Build.** An agent implements the approved spec on `officina/task-<number>`, runs
   `npm run quality` and `npm run check`, and pushes. Officina then reads the real diff from GitHub
   and opens the pull request.
4. **Review.** Two agents review independently: one checks the diff against the spec, one checks
   correctness and conventions. Neither wrote the code.
5. **Verify and merge.** A checklist says what to look at. A person verifies, and a code owner
   merges as usual.

Each step runs in a sandbox with its own spending cap, and a result is only applied if the task is
still in the state the agent worked on.

## Lanes

The lane comes from the paths a change actually touches, computed from the diff. The stricter lane
always wins, and a lane never loosens on its own.

| Lane         | What it covers                                                                                | Agents build? | Who approves                                                 |
| ------------ | --------------------------------------------------------------------------------------------- | ------------- | ------------------------------------------------------------ |
| **green**    | user-facing copy (`src/lib/constants/messages/**`)                                            | yes           | the requester, plus a product approver once that role exists |
| **standard** | everything else, mostly frontend and web2 backend work                                        | yes           | the owner; product too for user-visible changes              |
| **red**      | satellite, generated bindings, canister wiring, CI, dependencies, money, identity, legal copy | **no**        | the owner, and a person implements it                        |

Red paths are the protected paths from
[`governance.md`](./governance.md#boundaries), plus the money, identity and legal files, the backend
routes that issue sessions or move value, the session and key primitives, and every deploy file. Agents that
only read get a GitHub token that cannot push, so the boundary is enforced by GitHub, not by a
prompt. If a build ever touches a red path anyway, the task stops and asks the owner.

## What agents may never do

- Merge anything, or approve their own work.
- Push to any branch other than their task branch.
- Change CI workflows, branch rules or dependencies.
- Touch the satellite, generated files, canister wiring, or money, identity and legal code.
- Deploy: releases stay tag-based and human-started.

## Today, and what comes next

Officina is in its first phase. Today the owner starts tasks and records approvals with its CLI, and
progress is visible in its database and in the pull requests it opens. The request form, the shared
board, notifications and approvals by non-developers come next; the lane policies above are already
written for that, which is why the green lane names a product approver even though nobody holds that
role yet. A requirement nobody can meet is waived automatically and recorded as waived.

## When the config changes

Edit [`.github/officina.yml`](../../.github/officina.yml) like any other file: a merge into `main`
refreshes what Officina enforces. An invalid config is rejected and the previous one stays in force,
so a typo cannot silently widen what agents may do.
