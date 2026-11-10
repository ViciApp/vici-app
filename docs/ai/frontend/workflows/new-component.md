# Workflow: Add a new Svelte component

Use this when you need a new `.svelte` file. Don't use it when an existing
shared component (see [`../reusability.md`](../reusability.md)) already
covers the use case.

## Steps

1. **Decide the layer.** Use the
   [decision tree](../structure.md#where-to-put-new-files-decision-tree):
   - Generic primitive missing from `#lib/components/ui/` →
     `#lib/components/ui/<Name>.svelte` (rare — most primitives already exist).
   - Feature component → `#lib/components/<feature>/<Name>.svelte`.
   - Page-level shell composed in the single SvelteKit route →
     `#lib/components/pages/<Name>.svelte`.
2. **Pick the name.** PascalCase, descriptive, no `Component` / `Widget`
   suffix. Reflects role, not appearance (`MarketResolutionPanel`, not
   `BluePanel`).
3. **Sketch props first.** Always use a named `interface Props` above
   the destructure — see
   [`stack-and-patterns.md#props-shape`](../stack-and-patterns.md#props-shape).

   ```ts
   interface Props {
   	market: Market;
   	highlight?: boolean;
   	onSelect?: (id: Market['id']) => void;
   }

   let { market, highlight = false, onSelect = () => {} }: Props = $props();
   ```

   - All props typed via `interface Props`.
   - Required props first, optional / defaulted after.
   - Callbacks default to a no-op (`() => {}`).
   - **Avoid `$bindable`** unless explicitly required — prefer a callback
     prop.

4. **Compose, don't reinvent.** Build on `#lib/components/ui/` (`Button`,
   `Card`, `Modal`, `Dialog`, `Tabs`, `Switch`, `Table`, `Banner`,
   `EmptyState`, `LoadingSpinner`, `PopOver`, …). Pull existing icons from
   `#lib/components/icons/` or `@lucide/svelte` before adding new ones.
   Use snippets (`{#snippet}` + `{@render}`) for repeating intra-component
   markup.
5. **Style with the project's tokens.** Look at the closest neighbour's
   classes. Use the design tokens from
   [`src/app.css`](../../../../src/app.css) via the matching Tailwind
   utilities (`bg-card`, `text-card-foreground`, `border-card-border`, …).
   No raw hex. See
   [`stack-and-patterns.md#tailwind-v4--design-tokens`](../stack-and-patterns.md#tailwind-v4--design-tokens).
6. **a11y.** Real `<button>` / `<a>` elements. Labels on every input.
   Decorative icons `aria-hidden="true"`, icon-only buttons get an
   `aria-label`. See [`a11y.md`](../a11y.md).
7. **Terminology.** Use **"prediction"**, never "bet". Time variables
   end in `_ms` or `_ns` — see
   [`structure.md#time-variables--ms--ns`](../structure.md#time-variables--_ms--_ns).
8. **Test ID** if the component is targeted by future tests:
   `data-tid="<kebab-case>"`. (When a test-IDs constants file lands,
   move it there — see [`reusability.md`](../reusability.md).)
9. **Tests** if the component lives in `#lib/components/ui/` or has
   non-trivial logic. See [`testing.md`](../testing.md) — note the
   bootstrap status.
10. **Catalog update** if the component goes into `#lib/components/ui/`
    or introduces a new pattern future agents should reuse — add a row
    to [`reusability.md`](../reusability.md). This is the
    [meta-update rule](../../governance.md#meta-update-rule).
11. **Run quality gates** (`npm run quality && npm run check`).
12. **Open the PR** with the right title:
    - New feature visible to users → `feat(<scope>): …` or `feat: …`.
    - Restructure / extract with no behaviour change →
      `refactor(<scope>): …`.
    - Pure visual update → `style(<scope>): …`.

## Skeleton

```svelte
<script lang="ts">
	import Button from '#lib/components/ui/Button.svelte';
	import Card from '#lib/components/ui/Card.svelte';
	import type { Market } from '#lib/types/market.ts';

	interface Props {
		market: Market;
		highlight?: boolean;
		onSelect?: (id: Market['id']) => void;
	}

	let { market, highlight = false, onSelect = () => {} }: Props = $props();

	let isClosed = $derived(market.status === 'CLOSED');
</script>

<Card variant={highlight ? 'highlight' : 'default'}>
	<header class="flex items-center justify-between">
		<h3 class="text-card-foreground">{market.title}</h3>
		{#if isClosed}
			<span aria-label="Closed market">·</span>
		{/if}
	</header>

	<Button onclick={() => onSelect(market.id)} aria-label={`Open ${market.title}`}>Open</Button>
</Card>
```

## Common mistakes (don't)

- A new `<div class="…card…">` that duplicates `#lib/components/ui/Card`.
- Hard-coded colour (`bg-[#0f0]`) instead of the project's token classes.
- A wrapper that only re-exports another component.
- Logic in the markup that should be a `$derived`.
- Reading from a store deep inside the markup instead of a top-level
  `$derived` / store reference.
- The word "bet" anywhere a user might see it.
- Missing `_ms` / `_ns` suffix on a time-typed prop.
