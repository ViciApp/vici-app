# Workflow: Split / refactor a component

The repo strongly favours small, composable components. Splitting an
oversized component is one of the most common — and most welcome — kinds
of PR.

## When to split

Yes if any apply:

- A `.svelte` file is > ~250 lines, or has > ~5 distinct visual sections.
- The same markup pattern is repeated within the file (loop body
  duplicating layout).
- Conditional branches in the markup that render very different UIs
  (`{#if mode === 'X'} … {:else if mode === 'Y'} …`).
- A logical sub-block is reused (or about to be) elsewhere.
- A pure helper has snuck inside a component — extract to `*.utils.ts`.

No if:

- The component is small and cohesive — splitting adds noise, not signal.
- The "split" is just renaming.
- You'd be introducing a wrapper that only re-exports a child.

## Rules

1. **Scope.** A split PR changes structure only: **no behaviour
   change**, no design change, no copy change. If you spot one, split it
   into a follow-up PR.
2. **Stable visible output.** The rendered DOM (or at least the
   user-facing behaviour) must be identical before / after. Existing
   manual repro steps should stay the same.
3. **Same folder, same feature.** Children of a split live next to the
   parent. Cross-feature promotion (e.g. moving a child to
   `#lib/components/ui/`) happens only when a second caller appears in
   the same PR.
4. **Type contracts at the seam.** Each new child has an explicit
   `interface Props` — no implicit `any`.
5. **Snippets over wrapper components for _intra-file_ repetition.** If
   the duplicated chunk only makes sense inside the parent, use
   `{#snippet}` + `{@render}` instead of a new file.
6. **Don't migrate Svelte 4 → Svelte 5 in the same PR** unless that _is_
   the PR. Migration is a different
   `refactor(<scope>): migrate <X> to runes` change.
7. **Don't change copy.** "Bet" → "prediction" is a separate
   `refactor(<scope>): rename bet → prediction` PR — even if you spot it
   while splitting.

## Steps

1. **Map the parent.** List the visual / logical sections (e.g.
   `Header`, `Filters`, `Search`, `EmptyState`, `Footer`).
2. **Plan the split.** Decide which sections become:
   - Snippets (intra-file).
   - Sibling components in the same `#lib/components/<feature>/` folder.
   - Promoted to `#lib/components/ui/` (rare in a single PR; only when
     a second caller materialises).
3. **Identify the seam.** For each new component:
   - What props does it need?
   - What callbacks / events does it raise?
   - What state does it own vs. receive?
     Aim for the smallest interface that lets the parent reassemble the
     feature.
4. **Move incrementally.** One sub-component per commit if possible; CI
   should stay green at every step.
5. **Update test IDs** if the split changes which element a `data-tid`
   is anchored on. Keep IDs stable wherever possible.
6. **Update the catalog** in [`../reusability.md`](../reusability.md)
   only when a new sub-component lands in `#lib/components/ui/` or
   introduces a reusable pattern.
7. **Run quality gates** (`npm run quality && npm run check`).
8. **Open the PR** with the title:
   `refactor(<feature>): split <ParentComponent> into <description>`
   or `refactor(<feature>): extract <ChildComponent>`.
   In the body, list the new files created and confirm "no behaviour
   change". Include a short manual / screenshot proof if the surface is
   visual.

## Anti-patterns

- Splitting _and_ changing styles in the same PR.
- Splitting _and_ renaming files / props in unrelated places.
- Hoisting a sub-component to `#lib/components/ui/` based on
  speculation it might be reused.
- Creating an `index.ts` barrel just to re-export the new files.
- Leaving the original parent file untouched but importing the children
  with no consolidation — the parent should look noticeably leaner.
- Replacing "bet" with "prediction" in the same PR (separate refactor).
- Migrating Svelte 4 syntax (`export let`, `$:`, `on:click`) in the same
  PR (separate refactor).
