# AI Agents Documentation

This is the long-form documentation that backs the agent entry points
([`AGENTS.md`](../../AGENTS.md) and [`CLAUDE.md`](../../CLAUDE.md)).

If you are an agent: do **not** read everything. Read the entry point first
(`AGENTS.md`), then jump to the specific page you need. The folder layout
is whatever `ls docs/ai/` shows; the routing tables in `AGENTS.md` § 3–5
tell you which page covers which task.

## Audience

- **AI agents** (Claude Code, Cursor, Copilot, Codex, Aider, opencode, …).
- **Humans** giving instructions to those agents — including non-engineers
  writing prompts for small visual / copy / refactor PRs.

## Maintenance — auto-adapting

These docs **must auto-adapt**. When you (agent or human) introduce a new
pattern, naming convention, shared component, shared type, or workflow,
update the relevant page in the **same PR** as the code change. See the
[meta-update rule](./governance.md#meta-update-rule).

## Product context & specs

- [`PRODUCT.md`](./PRODUCT.md) — living description of shipped product
  behaviour. Updated in the **same PR** as any behaviour change.
- [`spec-driven-development/workflow.md`](./spec-driven-development/workflow.md)
  — spec-first workflow for net-new features, improvements, and
  non-trivial bugfixes. Specs carry a status; once `Implemented` they
  are decision records, not current truth.
- [`officina.md`](./officina.md) — how the agent workshop runs work on
  this repo: lanes, who approves what, and what agents may never
  touch. Its config lives in [`.github/officina.yml`](../../.github/officina.yml).

## Operational runbooks

Step-by-step ops runbooks (deployment, engine reset, engine ops) live
under [`.agents/workflows/`](../../.agents/workflows/) and are linked
from the satellite + backend sections of `docs/ai/`.

If two pages disagree, the page under `docs/ai/` wins (see the
[truth hierarchy](./governance.md#truth-hierarchy)). Surface the
disagreement in a PR.
