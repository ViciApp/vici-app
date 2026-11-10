# CLAUDE.md

Claude Code runtime layer. It holds no rules of its own.

> **First step, always:** read [`AGENTS.md`](./AGENTS.md), then the area README of the code you are touching (the table in its § 1). The universal standard it links and [`docs/ai/`](./docs/ai/README.md) are the source of truth.

The cards under [`.claude/rules/`](./.claude/rules/) are thin pointers into `docs/ai/` that surface a few high-violation reminders in Claude's prompt. They never override `docs/ai/` (see the [truth hierarchy](./docs/ai/governance.md#truth-hierarchy)); new substance lands in `docs/ai/` first, and a card only links it.
