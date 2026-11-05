<script lang="ts">
	import { nonNullish } from '@dfinity/utils';
	import type { Snippet } from 'svelte';
	import ScreenHeader from '#lib/components/layout/ScreenHeader.svelte';

	/**
	 * Shared chrome for **top-level** pages (Markets / Dash / Arena /
	 * Profile): a single compact `ScreenHeader` rendered at all widths,
	 * with an optional top-right action snippet. The header lives inside
	 * the page content column and scrolls under the global navigation;
	 * the bottom nav (`MobileNav`) is mounted globally and is not part of
	 * this scaffold.
	 *
	 * Deliberately no `back` affordance: top-level nav pages don't have
	 * one. Pages that genuinely need back navigation (detail / settings
	 * surfaces) render `ScreenHeader` directly with its `back` prop.
	 */
	interface Props {
		title: string;
		/** Optional metadata line rendered as a single chip below the title
		 *  (e.g. the live streak/window line on Dash, or the featured-event
		 *  name on a WC-focused Markets header). */
		eyebrow?: string;
		right?: Snippet;
		children: Snippet;
	}

	const { title, eyebrow, right, children }: Props = $props();

	const chips = $derived(nonNullish(eyebrow) ? [{ label: eyebrow }] : undefined);
</script>

<ScreenHeader {chips} {right} {title} variant="section" />

{@render children()}
