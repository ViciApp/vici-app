<script lang="ts">
	/**
	 * Stand-in for a market's odds when the probability is unknown: rendered in
	 * place of the percentage so the UI never shows a misleading 0.5 placeholder.
	 *
	 * - `loading`: the order book hasn't been read yet → pulsing bar (`aria-busy`).
	 * - `empty`: the book was read and has no liquidity → a neutral dash.
	 *
	 * Encapsulating both states (and their i18n labels) here keeps consumers like
	 * `BinaryProbabilities` free of an `i18n.utils` import, so their literal
	 * "Yes"/"No" copy stays clear of `no-bare-svelte-text`.
	 */
	import { localeStore } from '#lib/stores/locale.store.ts';
	import { t } from '#lib/utils/i18n.utils.ts';

	interface Props {
		variant?: 'loading' | 'empty';
	}

	const { variant = 'loading' }: Props = $props();

	const label = $derived(
		variant === 'empty'
			? t({ locale: $localeStore, key: 'market.odds.no_liquidity' })
			: t({ locale: $localeStore, key: 'market.odds.loading' })
	);
</script>

{#if variant === 'empty'}
	<span class="text-muted-foreground" aria-label={label}>—</span>
{:else}
	<span class="inline-flex items-center" aria-busy="true" aria-label={label} role="status">
		<span class="bg-muted-foreground/30 h-[1em] w-12 animate-pulse rounded-md" aria-hidden="true"
		></span>
	</span>
{/if}
