<script lang="ts">
	import { isNullish, nonNullish } from '@dfinity/utils';
	import { ZERO } from '#lib/constants/app.constants.ts';
	import { localeStore } from '#lib/stores/locale.store.ts';
	import type { Market } from '#lib/types/market.ts';
	import type { Position, ResolvedPosition } from '#lib/types/position.ts';
	import { formatLongDate, formatToken } from '#lib/utils/format.utils.ts';
	import { t } from '#lib/utils/i18n.utils.ts';
	import { marketBookLiquidity } from '#lib/utils/market.utils.ts';
	import { inferResolvedOutcomeId } from '#lib/utils/resolved-position.utils.ts';

	interface Props {
		market: Market;
		positions: Position[];
		/**
		 * Resolved-position records for this market, sourced from the user's
		 * `Settled` event stream. Used as a fallback for "MY CALL" once the
		 * clearing canister has removed the live `Position` row at
		 * settlement. Optional so non-resolved-market call sites don't have
		 * to thread it through.
		 */
		resolvedForMarket?: ResolvedPosition[];
		/**
		 * `true` while the viewer's positions for this market are still being
		 * read (signed-in only). Drives a pulse in the MY CALL tile so it
		 * doesn't flash an empty `—` before the position read lands. Once the
		 * read resolves the real call (or genuine "no call") shows.
		 */
		myCallLoading?: boolean;
		/**
		 * Market-wide traded volume in payout-token base units, or `undefined`
		 * while the trade-history read is still draining. Drives a pulse in the
		 * VOLUME tile on first load; `ZERO` reads as the cold-start "New" state.
		 */
		volume?: bigint;
	}

	const {
		market,
		positions,
		resolvedForMarket = [],
		myCallLoading = false,
		volume
	}: Props = $props();

	const { expiryDate, token } = $derived(market);

	// Liquidity = value resting at the top of the book (`marketBookLiquidity`),
	// reflecting the live maker quotes rather than a volume proxy. ZERO only
	// when neither side has a resting level, which reads as the "be first" cue.
	const liquidity = $derived(marketBookLiquidity(market));

	const userActivePosition = $derived(
		positions.find((p) => p.marketId === market.id && p.netQty !== ZERO)
	);

	/**
	 * Recover the user's side from the resolution event stream when the
	 * live position is gone. Inference rules: winners' exact side,
	 * binary losers' opposite side, categorical losers unknown: live
	 * in `inferResolvedOutcomeId` so they stay aligned with the
	 * Portfolio row helpers.
	 */
	const resolvedMyCall = $derived.by((): string | null => {
		if (resolvedForMarket.length === 0) {
			return null;
		}

		// Prefer a winner (they carry the exact outcomeId) so the helper
		// returns immediately; otherwise any entry works since the
		// binary-loser fallback only depends on `market.outcome`.
		const seed = resolvedForMarket.find((r) => r.result === 'won') ?? resolvedForMarket[0];

		return inferResolvedOutcomeId({ resolved: seed, market }) ?? null;
	});

	const myCall = $derived(userActivePosition?.outcomeId ?? resolvedMyCall);

	// Cold-start: an untraded market reads "New" instead of "0 VXP", and an
	// empty book reads "Be first". Both use real values (traded notional, book
	// depth): never a synthetic crowd. The copy is suppressed (suffix dropped,
	// tile muted) so the grid frames the empty market as an opportunity. Volume
	// is `undefined` until its read drains, which holds the tile in a pulse.
	const volumeLoading = $derived(isNullish(volume));
	const freshVolume = $derived(nonNullish(volume) && volume === ZERO);
	const freshLiquidity = $derived(liquidity === ZERO);

	// Hold the MY CALL tile in a loading state until the position read lands,
	// but only when there's nothing to show yet; a known call (live or from
	// the resolved fallback) renders immediately.
	const myCallPending = $derived(myCallLoading && isNullish(myCall));

	const stats = $derived([
		{
			labelKey: 'market.detail.stats.volume' as const,
			value: freshVolume
				? t({ locale: $localeStore, key: 'market.detail.stats.new' })
				: formatToken({ value: volume ?? ZERO, unitName: token.decimals }),
			suffix: freshVolume ? '' : token.symbol,
			mute: freshVolume,
			loading: volumeLoading
		},
		{
			labelKey: 'market.detail.stats.liquidity' as const,
			value: freshLiquidity
				? t({ locale: $localeStore, key: 'market.detail.stats.be_first' })
				: formatToken({ value: liquidity, unitName: token.decimals }),
			suffix: freshLiquidity ? '' : token.symbol,
			mute: freshLiquidity,
			loading: false
		},
		{
			labelKey: 'market.detail.stats.closes' as const,
			value: formatLongDate({ date: expiryDate, locale: $localeStore }),
			suffix: '',
			mute: false,
			loading: false
		},
		{
			labelKey: 'market.detail.stats.my_call' as const,
			value:
				myCall === 'YES'
					? t({ locale: $localeStore, key: 'outcome.yes' })
					: myCall === 'NO'
						? t({ locale: $localeStore, key: 'outcome.no' })
						: (myCall ?? '—'),
			suffix: '',
			mute: isNullish(myCall),
			loading: myCallPending
		}
	]);
</script>

<!-- 2×2 stats grid: VOLUME / LIQUIDITY / CLOSES / MY CALL.
     The fourth tile is muted when the user has
     no active position so the grid reads as "you haven't called yet"
     instead of an empty space. -->
<div class="market-stats-grid">
	{#each stats as stat (stat.labelKey)}
		<div class="market-stats-cell" aria-busy={stat.loading}>
			<span class="market-stats-eyebrow">
				{t({ locale: $localeStore, key: stat.labelKey })}
			</span>
			<div class="market-stats-value-row">
				{#if stat.loading}
					<span class="market-stats-skeleton" aria-hidden="true"></span>
				{:else}
					<span class="num market-stats-value" class:is-mute={stat.mute}>{stat.value}</span>
					{#if stat.suffix !== ''}
						<span class="market-stats-suffix">{stat.suffix}</span>
					{/if}
				{/if}
			</div>
		</div>
	{/each}
</div>

<style lang="postcss">
	.market-stats-grid {
		display: grid;
		grid-template-columns: 1fr 1fr;
		gap: 0.5rem;
		padding: 0.25rem 1.25rem 0.75rem;
	}

	.market-stats-cell {
		min-width: 0;
		padding: 0.875rem;
		border: 1px solid var(--border-base);
		border-radius: var(--r-12);
		background: color-mix(in srgb, var(--bg-surface) 86%, transparent);
		box-shadow: var(--inset-hi);
	}

	.market-stats-eyebrow {
		color: var(--text-muted);
		font-size: var(--t-10);
		font-weight: 700;
		letter-spacing: var(--tracking-allcaps);
		text-transform: uppercase;
	}

	.market-stats-value-row {
		display: flex;
		align-items: baseline;
		gap: 0.25rem;
		margin-top: 0.375rem;
	}

	.market-stats-value {
		color: var(--text-base);
		font-size: var(--t-16);
		font-weight: 600;
		letter-spacing: var(--tracking-snug);
		/* Long values (e.g. `December 31, 2026` in the CLOSES tile)
		   wrap to multiple lines instead of truncating with an
		   ellipsis. Earlier `white-space: nowrap` + `text-overflow:
		   ellipsis` ate the year on every locale that produces a
		   double-digit day. */
		overflow-wrap: anywhere;
	}

	.market-stats-value.is-mute {
		color: var(--text-muted);
	}

	/* Tile-level loading pulse: mirrors the market-detail skeleton's block
	   so a tile still resolving (e.g. MY CALL waiting on the position read)
	   shows a shimmer instead of a placeholder value. */
	.market-stats-skeleton {
		display: block;
		width: 2.75rem;
		height: 1rem;
		border-radius: var(--r-8);
		background: color-mix(in srgb, var(--text-muted) 16%, transparent);
		animation: market-stats-pulse 1.4s ease-in-out infinite;
	}

	@keyframes market-stats-pulse {
		0%,
		100% {
			opacity: 0.55;
		}
		50% {
			opacity: 0.9;
		}
	}

	@media (prefers-reduced-motion: reduce) {
		.market-stats-skeleton {
			animation: none;
		}
	}

	.market-stats-suffix {
		color: var(--text-muted);
		font-size: var(--t-12);
		font-weight: 700;
	}
</style>
