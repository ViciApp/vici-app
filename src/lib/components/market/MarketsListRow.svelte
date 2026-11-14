<script lang="ts">
	import { isNullish, nonNullish } from '@dfinity/utils';
	import MarketOddsSkeleton from '#lib/components/market/MarketOddsSkeleton.svelte';
	import MarketTranslationToggle from '#lib/components/market/MarketTranslationToggle.svelte';
	import ProbBar from '#lib/components/ui/ProbBar.svelte';
	import { ZERO } from '#lib/constants/app.constants.ts';
	import { AppPath } from '#lib/constants/routes.constants.ts';
	import { TestId } from '#lib/constants/test-ids.constants.ts';
	import { track } from '#lib/services/analytics.services.ts';
	import { localeStore } from '#lib/stores/locale.store.ts';
	import { marketLanguagePreference } from '#lib/stores/market-language.store.ts';
	import { marketTranslations } from '#lib/stores/market-translations.store.ts';
	import type { Market } from '#lib/types/market.ts';
	import { formatToken, probabilityToPercent } from '#lib/utils/format.utils.ts';
	import { t } from '#lib/utils/i18n.utils.ts';
	import { categoryLabel } from '#lib/utils/market-tags.utils.ts';
	import {
		marketDisplayText,
		translatedLanguageLabel
	} from '#lib/utils/market-translation.utils.ts';
	import { resolveAppPath } from '#lib/utils/nav.utils.ts';
	import { tagColor } from '#lib/utils/tag-color.utils.ts';
	import { goto } from '$app/navigation';

	/**
	 * Compact inline row in the Markets list. Rendered as a flush
	 * `card-inline` (hairline-top separator, no card border) so a column
	 * of rows reads as one list. Header pairs the category tag with
	 * `vol · closes`; body is the question; footer sits a `ProbBar`
	 * (shared `ui/ProbBar`) next to the YES %, tinted YES / NO by side.
	 */
	interface Props {
		market: Market;
		tag?: string;
	}

	const { market, tag }: Props = $props();

	const translation = $derived($marketTranslations.get(market.id));

	// Writable `$derived`: re-seeds from the global preference, flippable per
	// row without changing the default.
	let showOriginal = $derived($marketLanguagePreference === 'original');

	const display = $derived(marketDisplayText({ market, translation, showOriginal }));

	const onToggleTranslation = () => {
		showOriginal = !showOriginal;
		track({
			name: 'market_translation_toggled',
			marketId: market.id,
			source: 'card',
			label: showOriginal ? 'original' : 'translated'
		});
	};

	// When the YES probability is unknown we render a skeleton in place of
	// the percentage; the bar falls back to an empty track (0) rather than a
	// misleading 50% fill.
	const hasProbability = $derived(!isNullish(market.yesProbability));
	const yes = $derived(
		isNullish(market.yesProbability) ? 0 : probabilityToPercent(market.yesProbability)
	);
	// Cold-start: a market with no real volume yet reads "New" instead of
	// "0 vol": framing the empty market as an opportunity, never a synthetic
	// crowd. Uses our real volume field only.
	const freshVolume = $derived(market.totalVolume === ZERO);
	const vol = $derived(formatToken({ value: market.totalVolume, unitName: market.token.decimals }));
	const closes = $derived(
		new Date(Number(market.expiryDate)).toLocaleDateString($localeStore, {
			month: 'short',
			day: 'numeric'
		})
	);

	const onClick = () => goto(resolveAppPath(`${AppPath.Markets}/${market.id}`));
</script>

<button class="card-inline" data-tid={TestId.MarketCard} onclick={onClick} type="button">
	<div class="row between">
		{#if tag}
			<span style:color={tagColor(tag)} class="tag"
				>{categoryLabel({ category: tag, variant: 'short', locale: $localeStore })}</span
			>
		{:else}
			<span class="tag">&nbsp;</span>
		{/if}
		<span class="num mute t-eyebrow"
			>{freshVolume
				? t({ locale: $localeStore, key: 'market.detail.stats.new' })
				: `${vol} ${t({ locale: $localeStore, key: 'market.vol_suffix' })}`} · {closes}</span
		>
	</div>
	<div style="margin-top: 8px; font-weight: 600; line-height: 1.35;" class="t-body">
		{display.title}
	</div>
	{#if nonNullish(translation)}
		<div style="margin-top: 4px;">
			<MarketTranslationToggle
				onToggle={onToggleTranslation}
				{showOriginal}
				translatedLanguageLabel={translatedLanguageLabel(translation.locale)}
				variant="compact"
			/>
		</div>
	{/if}
	<div style="margin-top: 12px; gap: 12px;" class="row between">
		<div style="flex: 1;">
			<ProbBar {yes} />
		</div>
		{#if hasProbability}
			<span style:color={yes >= 50 ? 'var(--yes)' : 'var(--no)'} class="num t-body fw-600"
				>{yes}%</span
			>
		{:else}
			<span class="num t-body fw-600"
				><MarketOddsSkeleton variant={market.priceLoaded ? 'empty' : 'loading'} /></span
			>
		{/if}
	</div>
</button>
