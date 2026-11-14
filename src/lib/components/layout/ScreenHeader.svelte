<script lang="ts">
	import { nonNullish } from '@dfinity/utils';
	import { ChevronLeft } from '@lucide/svelte/icons';
	import type { Snippet } from 'svelte';

	interface BackAction {
		/** Localized aria-label for the back control (callers pass the
		 *  already-translated string, so the header stays i18n-neutral). */
		label: string;
		onBack: () => void;
	}

	/**
	 * The single compact header for every screen. A 50px bar that lives
	 * inside the page content column at all widths; it never sets its own
	 * `position: sticky` so it scrolls under the global navigation chrome
	 * rather than fighting the desktop nav's sticky.
	 *
	 * Two title treatments:
	 *  - `section`: a tight sans title (default) for utility screens.
	 *  - `editorial`: the serif-italic wordmark treatment, with an optional
	 *    brand-accent span for the second half of the phrase.
	 *
	 * Metadata renders as a row of mono chips below the bar; a trailing
	 * `right` snippet hosts edge actions (notifications, settings, …).
	 */
	interface Props {
		/** Page title. Omit it for back-only bars whose title lives in an
		 *  editorial hero below the bar (detail surfaces); the heading
		 *  element is then skipped so there is no empty `<h1>`. */
		title?: string;
		variant?: 'section' | 'editorial';
		/** Editorial-only: a brand-accent fragment appended to `title`
		 *  (e.g. "Veni · Vidi ·" + accent "Vici"). Ignored for `section`. */
		accent?: string;
		/** Metadata pills rendered below the bar. `accent` tints the border
		 *  with the brand colour. */
		chips?: { label: string; accent?: boolean }[];
		/** Back affordance: renders an inline circle button before the
		 *  title when supplied. Top-level pages omit it. */
		back?: BackAction;
		/** Trailing edge actions (icon buttons, bell, …). */
		right?: Snippet;
	}

	const { title, variant = 'section', accent, chips, back, right }: Props = $props();

	// A chips-only header (no title / back / action) omits the empty bar
	// entirely so the chip row reads as content rather than a hollow 50px
	// strip: used by surfaces whose only context is a chip (e.g. the
	// featured-event chip on Markets).
	const showBar = $derived(nonNullish(title) || nonNullish(back) || nonNullish(right));

	const handleBack = () => {
		back?.onBack();
	};
</script>

<div class="screen-header">
	{#if showBar}
		<div class="screen-header-bar" class:is-section-bar={variant === 'section'}>
			{#if back}
				<button
					class="appbar-icon-btn screen-header-back"
					aria-label={back.label}
					onclick={handleBack}
					type="button"
				>
					<ChevronLeft aria-hidden="true" size={18} strokeWidth={1.8} />
				</button>
			{:else if variant === 'section'}
				<!-- Holds the leading grid column so a section title stays centred
			     between the (absent) back disc and the trailing action. -->
				<span class="screen-header-edge" aria-hidden="true"></span>
			{/if}

			{#if nonNullish(title) && variant === 'editorial'}
				<h1 class="screen-header-title is-editorial">
					<span class="serif-italic">{title}</span>{#if accent}<span class="screen-header-accent"
							>{accent}</span
						>{/if}
				</h1>
			{:else if nonNullish(title)}
				<h1 class="screen-header-title is-section">{title}</h1>
			{:else}
				<span class="screen-header-spacer" aria-hidden="true"></span>
			{/if}

			{#if right}
				<div class="screen-header-right">{@render right()}</div>
			{:else if variant === 'section'}
				<!-- Trailing grid column placeholder: keeps the centred title
				     symmetric when there is no edge action. -->
				<span class="screen-header-edge" aria-hidden="true"></span>
			{/if}
		</div>
	{/if}

	{#if chips && chips.length > 0}
		<div class="screen-header-chips">
			{#each chips as chip, i (i)}
				<span class="screen-header-chip" class:is-accent={chip.accent}>{chip.label}</span>
			{/each}
		</div>
	{/if}
</div>

<style lang="postcss">
	.screen-header {
		display: flex;
		flex-direction: column;
	}

	.screen-header-bar {
		display: flex;
		box-sizing: border-box;
		min-height: 50px;
		align-items: center;
		gap: 0.75rem;
		padding: 4px var(--spacing-edge);
	}

	/* Utility section titles centre between the leading back disc and the
	   trailing action via a symmetric [edge · title · edge] grid. Editorial
	   entity heroes keep the flex layout above so they stay left-aligned. */
	.screen-header-bar.is-section-bar {
		display: grid;
		grid-template-columns: 1fr auto 1fr;
	}

	.screen-header-bar.is-section-bar > .screen-header-back {
		justify-self: start;
	}

	.screen-header-bar.is-section-bar > .screen-header-right {
		justify-self: end;
	}

	/* Zero-width seat for an absent back / action so the centre column is
	   flanked by equal tracks and the title stays optically centred. */
	.screen-header-edge {
		width: 0;
		min-width: 0;
	}

	/* The back control is a tighter circle than the default appbar button
	   so it reads as inline with the title rather than an edge action. */
	.screen-header-back {
		flex: none;
		width: 36px;
		height: 36px;
		padding: 0;
	}

	/* Fills the bar when there is no title (back-only bars whose title
	   lives in an editorial hero below) so a trailing `right` action stays
	   flush to the edge. */
	.screen-header-spacer {
		flex: 1;
		min-width: 0;
	}

	.screen-header-title {
		margin: 0;
		flex: 1;
		min-width: 0;
		overflow: hidden;
		color: var(--text-base);
		text-overflow: ellipsis;
		white-space: nowrap;
	}

	.screen-header-title.is-section {
		font-size: var(--t-20);
		font-weight: 600;
		letter-spacing: var(--tracking-snug);
	}

	/* In the section grid the title is the auto centre column: drop the
	   flex-grow inherited from `.screen-header-title` so it sizes to its
	   text and `justify-self` keeps it centred. */
	.is-section-bar .screen-header-title.is-section {
		flex: none;
		justify-self: center;
		text-align: center;
	}

	.screen-header-title.is-editorial {
		font-size: var(--t-24);
		font-weight: 400;
		letter-spacing: var(--tracking-tight);
	}

	.screen-header-accent {
		color: var(--color-primary);
	}

	.screen-header-right {
		display: inline-flex;
		flex: none;
		align-items: center;
		justify-content: flex-end;
		gap: 0.375rem;
	}

	/* Edge action discs mirror the leading back disc: a 36×36 circle so the
	   trailing affordance reads as the right-side twin of the back control.
	   The base `.appbar-icon-btn` already supplies the transparent circle +
	   foreground-wash hover that adapts across themes. */
	.screen-header-right :global(.appbar-icon-btn) {
		width: 36px;
		height: 36px;
		padding: 0;
	}

	.screen-header-chips {
		display: flex;
		gap: 6px;
		padding: 0 var(--spacing-edge) 10px;
		overflow-x: auto;
		scrollbar-width: none;
	}

	.screen-header-chips::-webkit-scrollbar {
		display: none;
	}

	.screen-header-chip {
		flex: none;
		padding: 4px 10px;
		border: 1px solid var(--border-base);
		border-radius: var(--r-pill);
		color: var(--text-muted);
		font-family: var(--font-mono);
		font-size: var(--t-11);
		white-space: nowrap;
	}

	.screen-header-chip.is-accent {
		border-color: color-mix(in srgb, var(--color-primary) 45%, var(--border-base));
		color: var(--text-base);
	}
</style>
