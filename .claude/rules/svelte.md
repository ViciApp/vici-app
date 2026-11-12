# Svelte 5 (Claude pointer)

`docs/ai/` is the source of truth. This card only surfaces a few
high-violation reminders so they land in Claude's prompt; for anything
substantive, read the canonical doc.

**Read first:**
[`docs/ai/frontend/stack-and-patterns.md`](../../docs/ai/frontend/stack-and-patterns.md):
Svelte 5 idioms (runes, props shape, effect hygiene, anti-patterns).

**Easy-to-miss rules:**

- This is Svelte 5 with **runes**: no `export let`, no `$:`.
- Props: named `interface Props` + destructure (no inline type literals,
  no `$bindable` unless required).
- **No hidden reactive captures:** a top-level IIFE whose body reads a
  `$props()` value or `$state` binding freezes that value at init:
  `svelte-check` does **not** catch this. Use `$derived` /
  `$derived.by`. See
  [Reactive reads: no hidden captures](../../docs/ai/frontend/stack-and-patterns.md#reactive-reads-no-hidden-captures).
