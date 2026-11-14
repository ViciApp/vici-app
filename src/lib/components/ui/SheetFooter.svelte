<script lang="ts">
	import type { Snippet } from 'svelte';

	/**
	 * Docked action-bar footer for bottom sheets and full-screen panels.
	 *
	 * A `flex-shrink: 0` strip that stays pinned at the bottom while the
	 * body scrolls under it: a top hairline rule, comfortable top spacing,
	 * and a bottom padding that clears the device safe area plus the iOS
	 * native bottom bar via `--docked-footer-inset` (the
	 * single source for that inset). Hosts add their own base padding on
	 * top of the inset via the `base` prop, so the CTA never hides behind
	 * device chrome on a long body.
	 *
	 * The action layout is owned by the caller's `children` snippet, mirroring
	 * the existing sheet-footer contract: enable `row` for the shared
	 * horizontal flex + gap, or leave it off and let the children own their
	 * own layout. Horizontal padding is inherited from the host surface by
	 * default; pass `sidePadding` for a standalone panel that needs its own.
	 */
	interface Props {
		/** Action buttons / controls rendered inside the bar. */
		children: Snippet;
		/**
		 * Base bottom padding added on top of `--docked-footer-inset`
		 * (CSS length). Match the host's metric, e.g. `0px` when the host
		 * surface already pads its sides and only the inset is needed.
		 */
		base?: string;
		/**
		 * Horizontal padding (CSS length). Omit to inherit the host's side
		 * inset (the default for footers nested in an already-padded sheet).
		 */
		sidePadding?: string;
		/** Lay the children out as a horizontal flex row with a shared gap. */
		row?: boolean;
		/** Gap between row actions (CSS length). Only applies when `row`. */
		gap?: string;
	}

	const { children, base = '1.1rem', sidePadding, row = false, gap = '0.6rem' }: Props = $props();
</script>

<div
	style:--sheet-footer-base={base}
	style:--sheet-footer-side={sidePadding}
	style:--sheet-footer-gap={gap}
	class="sheet-footer"
	class:row
>
	{@render children()}
</div>

<style lang="postcss">
	/* Non-scrolling docked footer: a `flex-shrink: 0` strip kept after the
	 * scrolling body so a primary CTA stays in view on a long body. Carries
	 * the safe-area + iOS bottom-bar inset (`--docked-footer-inset`)
	 * itself, plus a hairline rule + top spacing separating it from the
	 * content above. */
	.sheet-footer {
		flex-shrink: 0;
		padding-top: 0.7rem;
		padding-right: var(--sheet-footer-side, 0px);
		padding-bottom: calc(var(--sheet-footer-base, 1.1rem) + var(--docked-footer-inset));
		padding-left: var(--sheet-footer-side, 0px);
		margin-top: 0.2rem;
		border-top: 1px solid color-mix(in srgb, var(--border-base) 60%, transparent);
	}

	.sheet-footer.row {
		display: flex;
		gap: var(--sheet-footer-gap, 0.6rem);
	}
</style>
