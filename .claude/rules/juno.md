# Juno satellite (Claude pointer)

`docs/ai/` is the source of truth. This card only surfaces a few
high-violation reminders so they land in Claude's prompt; for anything
substantive, read the canonical docs.

**Read first:**

- Overview, gotchas, local dev →
  [`docs/ai/satellite/README.md`](../../docs/ai/satellite/README.md)
- Folder taxonomy, collections wiring →
  [`docs/ai/satellite/structure.md`](../../docs/ai/satellite/structure.md)
- Canonical hook / assert / endpoint shapes →
  [`docs/ai/satellite/patterns.md`](../../docs/ai/satellite/patterns.md)
- Workflows (new hook, new endpoint, engine sync) →
  [`docs/ai/satellite/workflows/`](../../docs/ai/satellite/workflows/)
- External: [Juno LLM Documentation](https://juno.build/llms-full.txt)

**Easy-to-miss rules:**

- **`@junobuild/core` is FE-only**: never import it from
  `src/satellite/`. Satellite code uses `@junobuild/functions` directly.
- **Local replica is the Juno emulator** (`juno emulator start`):
  never `dfx start`.
- **Collection names live in TWO places that must stay in sync:**
  [`juno.config.ts`](../../juno.config.ts) and the typed
  `Collection` enum in
  [`src/lib/constants/collections.constants.ts`](../../src/lib/constants/collections.constants.ts).
- **Generated files** (`satellite.did`, `satellite_extension.did`,
  `api-schemas.ts`, `static/workers/**`) are never hand-edited.
