# Officina: how agent work runs on this repo

[Officina](https://github.com/AntonioVentilii/officina) is the workshop that runs agent work
against this repository: it writes specs, builds changes on a branch, reviews them, and hands the
result to people to verify and merge. This page is what the team needs to know; the config it
enforces lives in [`.github/officina.yml`](../../.github/officina.yml).

Officina never replaces this repo's rules. It works through a GitHub App that pushes branches and
opens pull requests, and the branch ruleset applies unchanged: CI must pass, Copilot reviews, review
threads must be resolved, and a code owner approves before anything merges.

## Who uses it

Everyone works on the shared board, a web page; nobody needs the repository or a terminal. A
contributor (for example someone from product or marketing) files a request in plain words, answers
the interviewer's follow-up questions, follows the task through the columns (Requests, Plan,
Building, Check, Done), and checks the result when the lane asks for it. Owners and maintainers also
see costs, pull request links, agent runs and learnings.

Roles live in Officina, not in GitHub permissions. An approval domain (such as `product`) is given
when someone is invited. A person who connects GitHub on the board can approve and merge from it;
on this repo that approval only satisfies the ruleset when it comes from a code owner
([`CODEOWNERS`](../../.github/CODEOWNERS)).

## How a change flows

1. **Request.** Someone describes the outcome on the board. The interviewer asks up to four
   questions, then the request waits for triage.
2. **Spec.** An agent reads `AGENTS.md`, the area README and the real code, then writes a spec in
   the repo's [template](./spec-driven-development/template.md). A missing product or technical
   decision stops the work with a question rather than a guess.
3. **Approval.** A person approves the spec, in every lane. Who that is depends on the lane (below).
4. **Build.** An agent implements the approved spec on `officina/task-<number>`, runs the `verify`
   commands from the config (`npm run quality`, `npm run check`, `npm test` and the backend
   typecheck), and pushes. Officina then reads the real diff from GitHub and opens the pull request.
5. **Review.** Two agents review independently: one checks the diff against the spec, one checks
   correctness and conventions. Neither wrote the code. Copilot reviews the pull request too.
6. **Check and merge.** A checklist says what to look at. A person checks the result, unless the
   lane allows auto-verify (below), and a code owner's approval lets GitHub merge it.

Each step runs in a sandbox with its own spending cap, and a result is only applied if the task is
still in the state the agent worked on.

## Review comments go back to the builder

A Copilot review with inline comments, or a person's "request changes" review, sends the task back
to the builder with those comments (`path:line`) as notes. A plain comment does nothing. Once the
fix is reviewed and verified again, Officina resolves the threads of the reviews it forwarded, so
the "resolved threads" rule does not block the merge. A review of an older commit than the task's
current head is ignored, because it was about code that is no longer there.

## What a merge ships

Nothing. Merging into `main` deploys nothing (`release.on_merge: nothing` in the config): releases
run from `v*` tags (`deploy.yml`, `publish.yml`), which are cut when a person merges the
release-please pull request, and `web2-deploy.yml` is started by hand. Officina never touches the
release pull request.

## Lanes

The lane comes from the paths a change actually touches, computed from the diff. The stricter lane
always wins, and a lane never loosens on its own.

| Lane         | What it covers                                                                                              | Agents build? | Who approves                                                                      |
| ------------ | ----------------------------------------------------------------------------------------------------------- | ------------- | --------------------------------------------------------------------------------- |
| **green**    | user-facing copy (`src/lib/constants/messages/**`)                                                          | yes           | spec: the requester, plus a product approver once that role exists; result: below |
| **standard** | everything else, mostly frontend and web2 backend work                                                      | yes           | the owner; product too for user-visible changes                                   |
| **red**      | satellite, generated bindings, canister wiring, CI, dependencies, scripts, money, identity, deploy and more | **no**        | the owner, and a person implements it                                             |

Red paths are the protected paths from
[`governance.md`](./governance.md#boundaries), plus the money, identity and legal files, the canister
and ledger ids, the backend routes and modules that issue sessions, move value or administer
accounts, the session and key primitives, every deploy and release file, and the agent instructions
under `.agents/` and `.claude/`. Agents that only read get a GitHub token that cannot push, so the
boundary is enforced by GitHub, not by a prompt. If a build ever touches a red path anyway, the task
stops and asks the owner.

**Auto-verify (green only).** Because a merge ships nothing, a copy change can skip the person's
check: when the chooser judges the result needs no more than a glance and adds no requirement,
Officina turns on GitHub auto-merge instead of waiting for someone to verify. The spec is still
approved by people, and the branch rules still decide: CI, resolved threads and the code-owner
review. With `CODEOWNERS` covering every path, the pull request lands once a code owner approves it
on GitHub.

A requirement nobody can meet yet is waived automatically and recorded as waived. That is why the
green lane names a product approver although nobody holds that domain today.

## What agents may never do

- Merge anything, or approve their own work.
- Push to any branch other than their task branch.
- Change CI workflows, branch rules or dependencies.
- Touch the satellite, generated files, canister wiring, or money, identity and legal code.
- Deploy: releases stay tag-based and human-started.

## What the builder cannot run

The sandbox has no running Postgres, and ten backend suites still fail instead of skipping without
one, so the backend `bun test` runs only in `backend-checks.yml`. The `satellite-schema` drift check
also stays in CI: its fix lands in `src/satellite/**`, a red path. When either fails, the task goes
back to the builder or stops for the owner.

## When the config changes

Edit [`.github/officina.yml`](../../.github/officina.yml) like any other file: a merge into `main`
refreshes what Officina enforces. An invalid config is rejected and the previous one stays in force,
so a typo cannot silently widen what agents may do.
