<script lang="ts">
	import { Globe } from '@lucide/svelte/icons';
	import { localeStore } from '#lib/stores/locale.store.ts';
	import { t } from '#lib/utils/i18n.utils.ts';

	interface Props {
		/** Native name of the language the translation is in (e.g. `Español`). */
		translatedLanguageLabel: string;
		/** Whether the original (on-chain) text is currently shown. */
		showOriginal: boolean;
		onToggle: () => void;
		/**
		 * `inline`: the full state + link form for the market detail page.
		 * `compact`: a single quiet icon button for cards/decks, where space
		 * is tight: one glyph + a short label that flips the one item.
		 */
		variant?: 'inline' | 'compact';
	}

	const { translatedLanguageLabel, showOriginal, onToggle, variant = 'inline' }: Props = $props();

	const compactLabel = $derived(
		showOriginal
			? t({
					locale: $localeStore,
					key: 'market.translation.view_in',
					params: { language: translatedLanguageLabel }
				})
			: t({ locale: $localeStore, key: 'market.translation.view_original' })
	);
</script>

{#if variant === 'compact'}
	<button
		class="xl-compact"
		data-no-card-gesture="true"
		onclick={(e) => {
			e.stopPropagation();
			onToggle();
		}}
		type="button"
	>
		<Globe aria-hidden="true" size={11} />
		<span>{compactLabel}</span>
	</button>
{:else}
	<div class="xl-toggle">
		<span class="xl-state">
			<Globe aria-hidden="true" size={12} />
			{showOriginal
				? t({ locale: $localeStore, key: 'market.translation.viewing_original' })
				: t({ locale: $localeStore, key: 'market.translation.viewing_translated' })}
		</span>
		<span class="xl-sep" aria-hidden="true">·</span>
		<button class="xl-link" onclick={onToggle} type="button">
			{compactLabel}
		</button>
	</div>
{/if}

<style lang="postcss">
	.xl-toggle {
		display: inline-flex;
		align-items: center;
		gap: 0.5rem;
		margin-top: 0.625rem;
		font-size: 0.6875rem;
	}

	.xl-state {
		display: inline-flex;
		align-items: center;
		gap: 0.3125rem;
		color: var(--text-muted);
		font-weight: 700;
		letter-spacing: var(--tracking-allcaps);
		text-transform: uppercase;
	}

	.xl-sep {
		color: var(--fg-faint);
	}

	/* The original-language access is the smaller, secondary affordance:
	   a quiet underlined link rather than a button-styled control. */
	.xl-link {
		border: 0;
		background: transparent;
		padding: 0;
		cursor: pointer;
		font: inherit;
		font-weight: 600;
		color: var(--text-muted);
		text-decoration: underline;
		text-underline-offset: 2px;
		text-decoration-color: var(--border-strong);
		transition:
			color 0.15s ease,
			text-decoration-color 0.15s ease;
	}

	.xl-link:hover {
		color: var(--accent);
		text-decoration-color: var(--accent);
	}

	/* Compact card/deck form: a single quiet chip-link. Inline-flex so it
	   sits within a card's text column; the glyph keeps it legible as a
	   language affordance at small sizes. */
	.xl-compact {
		display: inline-flex;
		align-items: center;
		gap: 0.3125rem;
		border: 0;
		background: transparent;
		padding: 0;
		cursor: pointer;
		font-family: inherit;
		font-size: 0.6875rem;
		font-weight: 600;
		color: var(--text-muted);
		transition: color 0.15s ease;
	}

	.xl-compact:hover {
		color: var(--accent);
	}
</style>
