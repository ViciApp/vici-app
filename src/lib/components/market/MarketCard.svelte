<script lang="ts">
	import { nonNullish } from '@dfinity/utils';
	import { Clock, Users } from '@lucide/svelte/icons';
	import { fly } from 'svelte/transition';
	import BinaryProbabilities from '#lib/components/market/BinaryProbabilities.svelte';
	import CategoricalProbabilities from '#lib/components/market/CategoricalProbabilities.svelte';
	import MarketTranslationToggle from '#lib/components/market/MarketTranslationToggle.svelte';
	import OutcomeBadge from '#lib/components/market/OutcomeBadge.svelte';
	import SuggestedBadge from '#lib/components/market/SuggestedBadge.svelte';
	import SavedMarketToggle from '#lib/components/saved-markets/SavedMarketToggle.svelte';
	import Badge from '#lib/components/ui/Badge.svelte';
	import Card from '#lib/components/ui/Card.svelte';
	import { AppPath } from '#lib/constants/routes.constants.ts';
	import { TestId } from '#lib/constants/test-ids.constants.ts';
	import { track } from '#lib/services/analytics.services.ts';
	import { localeStore } from '#lib/stores/locale.store.ts';
	import { marketLanguagePreference } from '#lib/stores/market-language.store.ts';
	import { marketTranslations } from '#lib/stores/market-translations.store.ts';
	import type { MarketMetadata } from '#lib/types/market-metadata.ts';
	import type { Market } from '#lib/types/market.ts';
	import { isSocial } from '#lib/utils/balance-domain.utils.ts';
	import { isMarketSuggested } from '#lib/utils/flow-card-display.utils.ts';
	import { t } from '#lib/utils/i18n.utils.ts';
	import { categoryLabel } from '#lib/utils/market-tags.utils.ts';
	import {
		marketDisplayText,
		translatedLanguageLabel
	} from '#lib/utils/market-translation.utils.ts';
	import { getOutcomeVariant, getTimeRemaining } from '#lib/utils/market.utils.ts';
	import { resolveAppPath } from '#lib/utils/nav.utils.ts';
	import { prefersReducedMotion } from '#lib/utils/reduced-motion.utils.ts';
	import { tagColor } from '#lib/utils/tag-color.utils.ts';
	import { goto } from '$app/navigation';

	interface Props {
		market: Market;
		index?: number;
		metadata?: MarketMetadata;
		/**
		 * Primary category id for this market — a taxonomy micro (e.g.
		 * `bitcoin`, `soccer`) or macro. When supplied, renders a colored
		 * category chip at the start of the header strip — mirrors the
		 * MarketRow pattern so the category accent reads at a glance on the
		 * list. Optional so call sites that don't have tags hydrated yet stay
		 * backward-compatible.
		 */
		tag?: string;
	}

	const { market, index = 0, metadata, tag }: Props = $props();

	// Resolved translation for this market in the active locale (or undefined
	// when none exists), bulk-hydrated by the markets page. Its presence gates
	// the quick toggle.
	const translation = $derived($marketTranslations.get(market.id));

	// Per-item quick-toggle state, seeded from the global preference and
	// flippable for this one card without changing the default. As a writable
	// `$derived` it re-seeds whenever the global preference changes, while an
	// `onToggle` flip stays local to this card.
	let showOriginal = $derived($marketLanguagePreference === 'original');

	const display = $derived(marketDisplayText({ market, translation, showOriginal }));

	// Translated outcome titles keyed by id, for CategoricalProbabilities.
	// Empty (every outcome falls back to its original) when no translation is
	// active or the market is binary.
	const translatedOutcomeTitles = $derived(
		Object.fromEntries((market.outcomes ?? []).map((o) => [o.id, display.outcomeTitle(o.id)]))
	);

	const onToggleTranslation = () => {
		showOriginal = !showOriginal;
		track({
			name: 'market_translation_toggled',
			marketId: market.id,
			source: 'card',
			label: showOriginal ? 'original' : 'translated'
		});
	};

	const isChallenge = $derived(isSocial(market.balanceDomain));
	const isResolved = $derived(market.status === 'Resolved');
	const showSuggested = $derived(isMarketSuggested({ market, metadata }));

	const resolvedOutcomeLabel = (outcome: string): string => {
		if (outcome === 'YES') {
			return t({ locale: $localeStore, key: 'outcome.yes_won' });
		}

		if (outcome === 'NO') {
			return t({ locale: $localeStore, key: 'outcome.no_won' });
		}

		if (outcome === 'CANCELED') {
			return t({ locale: $localeStore, key: 'outcome.canceled' });
		}

		return display.outcomeTitle(outcome) || outcome;
	};
</script>

<div
	class="h-full w-full"
	in:fly={prefersReducedMotion()
		? { duration: 0 }
		: { y: 12, duration: 320, delay: Math.min(index * 35, 210) }}
>
	<Card
		class="group border-border hover:border-border-strong bg-card/85 shadow-card hover:bg-card h-full w-full overflow-hidden border transition-all hover:-translate-y-0.5"
		onclick={() => goto(resolveAppPath(`${AppPath.Markets}/${market.id}`))}
		onkeydown={(e) => e.key === 'Enter' && goto(resolveAppPath(`${AppPath.Markets}/${market.id}`))}
		padding="none"
		role="button"
		variant="default"
	>
		<div class="flex h-full w-full flex-col text-left">
			<div class="flex flex-1 flex-col gap-4 p-4 sm:p-5">
				<div class="flex flex-wrap items-center justify-between gap-3">
					<div class="flex flex-wrap items-center gap-1.5">
						{#if tag}
							<span
								style:color={tagColor(tag)}
								style:background-color="color-mix(in srgb, {tagColor(tag)} 12%, transparent)"
								style:border="1px solid color-mix(in srgb, {tagColor(tag)} 28%, transparent)"
								class="eyebrow-xs market-card-tag inline-flex items-center rounded px-1.5 py-0.5"
							>
								{categoryLabel({ category: tag, variant: 'short', locale: $localeStore })}
							</span>
						{/if}
						{#if showSuggested}
							<SuggestedBadge />
						{/if}
						<OutcomeBadge status={market.status} />
						{#if isResolved && nonNullish(market.outcome)}
							<Badge variant={getOutcomeVariant(market.outcome)}>
								{resolvedOutcomeLabel(market.outcome)}
							</Badge>
						{/if}
						{#if isChallenge}
							<span
								class="border-laurel/25 bg-laurel-glow text-laurel eyebrow-xs inline-flex items-center gap-1 rounded-full border px-2 py-0.5"
							>
								<Users aria-hidden="true" size={10} />
								{t({ locale: $localeStore, key: 'card.challenge' })}
							</span>
						{/if}
						{#if market.payoffType === 'Categorical'}
							<span
								class="border-foreground/25 text-foreground bg-foreground/8 eyebrow-xs rounded-full border px-2 py-0.5"
							>
								{t({ locale: $localeStore, key: 'card.multiple' })}
							</span>
						{/if}
						{#if market.isInviteOnly}
							<Badge size="sm" variant="warning">
								{t({ locale: $localeStore, key: 'markets.filter.access.closed' })}
							</Badge>
						{/if}
					</div>

					<div class="flex items-center gap-2">
						<SavedMarketToggle marketId={market.id} size="sm" />
						<div class="text-muted-foreground/70 flex items-center gap-1.5">
							<Clock aria-hidden="true" size={13} />
							<span
								class="num text-[11px] font-bold whitespace-nowrap"
								data-tid={TestId.MarketTimeRemaining}
							>
								{getTimeRemaining(market.expiryDate)}
							</span>
						</div>
					</div>
				</div>

				<div class="space-y-2">
					<h3
						class="text-foreground group-hover:text-primary font-display text-[15px] leading-snug font-semibold tracking-tight transition-colors sm:text-base"
					>
						{display.title}
					</h3>
					<p class="text-muted-foreground line-clamp-2 text-xs leading-relaxed sm:text-sm">
						{display.description}
					</p>
					{#if nonNullish(translation)}
						<MarketTranslationToggle
							onToggle={onToggleTranslation}
							{showOriginal}
							translatedLanguageLabel={translatedLanguageLabel(translation.locale)}
							variant="compact"
						/>
					{/if}
				</div>

				<div class="mt-auto space-y-4">
					<div class="grid grid-cols-2 gap-2.5">
						{#if market.payoffType === 'Binary'}
							<BinaryProbabilities
								noProbability={market.noProbability}
								priceLoaded={market.priceLoaded}
								winningOutcome={isResolved ? market.outcome : undefined}
								yesProbability={market.yesProbability}
							/>
						{:else}
							<CategoricalProbabilities
								outcomes={market.outcomes ?? []}
								translatedTitles={translatedOutcomeTitles}
								winningOutcomeId={isResolved ? market.outcome : undefined}
							/>
						{/if}
					</div>
				</div>
			</div>
		</div>
	</Card>
</div>
