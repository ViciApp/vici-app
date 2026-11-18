<script lang="ts">
	import { isNullish, nonNullish } from '@dfinity/utils';
	import MarketProbabilitySkeleton from '#lib/components/market/MarketProbabilitySkeleton.svelte';
	import MarketTranslationToggle from '#lib/components/market/MarketTranslationToggle.svelte';
	import ProbBar from '#lib/components/ui/ProbBar.svelte';
	import { ZERO } from '#lib/constants/app.constants.ts';
	import { AppPath } from '#lib/constants/routes.constants.ts';
	import { track } from '#lib/services/analytics.services.ts';
	import { localeStore } from '#lib/stores/locale.store.ts';
	import { marketLanguagePreference } from '#lib/stores/market-language.store.ts';
	import { marketTranslations } from '#lib/stores/market-translations.store.ts';
	import type { Market } from '#lib/types/market.ts';
	import { formatVolume } from '#lib/utils/format.utils.ts';
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
	 * Fixed-width (280 px) market card used in the Saved / Trending
	 * rails on the markets page. Header row carries the category tag
	 * + volume; body is the question; footer pairs the YES % with
	 * `YES / NO` mini-tags above a `ProbBar` (shared `ui/ProbBar`).
	 */
	interface Props {
		market: Market;
		tag?: string;
	}

	const { market, tag }: Props = $props();

	const translation = $derived($marketTranslations.get(market.id));

	// Writable `$derived`: re-seeds from the global preference, flippable per
	// card without changing the default.
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
		isNullish(market.yesProbability) ? 0 : Math.round(market.yesProbability * 100)
	);
	// Cold-start: a market with no real volume yet reads "New" instead of
	// "0 VXP": framing the empty market as an opportunity, never a synthetic
	// crowd. Uses our real volume field only.
	const freshVolume = $derived(market.totalVolume === ZERO);
	const vol = $derived(
		formatVolume({
			volume: market.totalVolume,
			decimals: market.token.decimals,
			symbol: market.token.symbol
		})
	);

	const onClick = () => goto(resolveAppPath(`${AppPath.Markets}/${market.id}`));
</script>

<div
	style="flex: 0 0 280px; cursor: pointer; gap: 0; background: linear-gradient(180deg, var(--bg-surface), var(--bg-base));"
	class="card-surface"
	onclick={onClick}
	onkeydown={(event) => {
		if (event.key === 'Enter' || event.key === ' ') {
			event.preventDefault();
			onClick();
		}
	}}
	role="button"
	tabindex="0"
>
	<div class="row between">
		{#if tag}
			<span style:color={tagColor(tag)} class="tag"
				>{categoryLabel({ category: tag, variant: 'short', locale: $localeStore })}</span
			>
		{:else}
			<span class="tag">&nbsp;</span>
		{/if}
		<span class="num mute t-eyebrow"
			>{freshVolume ? t({ locale: $localeStore, key: 'market.detail.stats.new' }) : vol}</span
		>
	</div>
	<div
		style="margin-top: 12px; font-size: 15px; font-weight: 600; line-height: 1.3; min-height: 58px;"
	>
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
	<div style="margin-top: 14px;" class="row between">
		{#if hasProbability}
			<span style:color="var(--yes)" style:font-weight="600" class="num yes t-h4">{yes}%</span>
		{:else}
			<span style:font-weight="600" class="num t-h4"
				><MarketProbabilitySkeleton variant={market.priceLoaded ? 'empty' : 'loading'} /></span
			>
		{/if}
		<span style="gap: 4px;" class="row">
			<span class="tag yes">{t({ locale: $localeStore, key: 'outcome.yes' })}</span>
			<span class="tag no">{t({ locale: $localeStore, key: 'outcome.no' })}</span>
		</span>
	</div>
	<div style="margin-top: 8px;">
		<ProbBar {yes} />
	</div>
</div>
