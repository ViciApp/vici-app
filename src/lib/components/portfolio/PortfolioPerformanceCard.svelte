<script lang="ts">
	import { nonNullish } from '@dfinity/utils';
	import {
		DAY_IN_MS,
		MILLISECOND_IN_NANOSECONDS,
		USD_DECIMALS
	} from '#lib/constants/app.constants.ts';
	import { VXP_TOKEN } from '#lib/constants/tokens/tokens.ic.constants.ts';
	import { localeStore } from '#lib/stores/locale.store.ts';
	import type { Market } from '#lib/types/market.ts';
	import type { ResolvedPosition } from '#lib/types/position.ts';
	import { decimalFixedValueToNumber } from '#lib/utils/format.utils.ts';
	import { t } from '#lib/utils/i18n.utils.ts';

	/**
	 * Portfolio · Performance · 30D
	 *
	 * Builds a 30-day cumulative realised-PnL sparkline from the user's
	 * `Settled` event stream on VXP markets, plus a header percentage
	 * delta relative to the current VXP balance.
	 *
	 * Reads from `resolvedPositions` rather than joining `tradeHistory`
	 * against live `positions`, because the clearing canister deletes
	 * positions at settlement: joining there would silently drop every
	 * historical resolution. Each `ResolvedPosition` already carries the
	 * realized PnL (`realizedPnlUsd`, signed `cashflow_usd` in clearing
	 * USD units) and the settlement timestamp, so we can attribute each
	 * one directly to a day bucket.
	 *
	 * Renders nothing when there are no settled VXP positions in the
	 * window, which keeps the Portfolio page tidy for new users.
	 */
	interface Props {
		resolvedPositions: ResolvedPosition[];
		markets: Market[];
		vxpBalance: number;
	}

	const WINDOW_DAYS = 30;
	const W = 320;
	const H = 72;

	const { resolvedPositions, markets, vxpBalance }: Props = $props();

	const getMarketById = (id: string) => markets.find((m) => m.id === id);

	/**
	 * Per-day realised PnL across the 30-day window. Index 0 = today − 29,
	 * index 29 = today. One `ResolvedPosition` contributes once to the
	 * day bucket of its settlement timestamp.
	 */
	const dailyPnl = $derived.by((): number[] => {
		const buckets = new Array<number>(WINDOW_DAYS).fill(0);
		const cutoffMs = Date.now() - WINDOW_DAYS * DAY_IN_MS;
		const todayStartMs = Math.floor(Date.now() / DAY_IN_MS) * DAY_IN_MS;

		resolvedPositions.forEach((resolved) => {
			const market = getMarketById(resolved.marketId);
			const isVxpMarket = nonNullish(market) && market.token.symbol === VXP_TOKEN.symbol;

			if (!isVxpMarket) {
				return;
			}

			const tsMs = Number(resolved.timestampNs / MILLISECOND_IN_NANOSECONDS);

			if (tsMs < cutoffMs) {
				return;
			}

			const dayIndex =
				WINDOW_DAYS -
				1 -
				Math.floor((todayStartMs - Math.floor(tsMs / DAY_IN_MS) * DAY_IN_MS) / DAY_IN_MS);

			if (dayIndex < 0 || dayIndex >= WINDOW_DAYS) {
				return;
			}

			buckets[dayIndex] += decimalFixedValueToNumber({
				value: resolved.realizedPnlUsd,
				decimals: USD_DECIMALS
			});
		});

		return buckets;
	});

	const cumulative = $derived.by((): number[] => {
		let running = 0;

		return dailyPnl.map((d) => (running += d));
	});

	const totalPnl = $derived(cumulative.length > 0 ? cumulative[cumulative.length - 1] : 0);

	const hasData = $derived(dailyPnl.some((d) => d !== 0));

	const deltaPct = $derived.by((): number => {
		if (vxpBalance <= 0 || !hasData) {
			return 0;
		}

		return (totalPnl / vxpBalance) * 100;
	});

	const deltaSign = $derived(totalPnl >= 0 ? '+' : '−');

	const deltaDisplay = $derived(`${deltaSign}${Math.abs(deltaPct).toFixed(1)}%`);

	const linePath = $derived.by((): string => {
		if (!hasData) {
			return '';
		}

		const min = Math.min(0, ...cumulative);
		const max = Math.max(0, ...cumulative);
		const span = max - min || 1;

		return cumulative
			.map((value, index) => {
				const x = (index / (cumulative.length - 1)) * W;
				const y = H - ((value - min) / span) * H;

				return `${index === 0 ? 'M' : 'L'}${x.toFixed(1)},${y.toFixed(1)}`;
			})
			.join(' ');
	});

	const areaPath = $derived(linePath === '' ? '' : `${linePath} L${W},${H} L0,${H} Z`);

	const isPositive = $derived(totalPnl >= 0);
</script>

{#if hasData}
	<section class="perf-card">
		<header class="perf-head">
			<p class="eyebrow perf-eyebrow">
				{t({ locale: $localeStore, key: 'portfolio.performance.eyebrow' })}
			</p>
			<span class="num perf-delta" class:is-negative={!isPositive} class:is-positive={isPositive}>
				{deltaDisplay}
			</span>
		</header>

		<svg class="perf-spark" aria-hidden="true" preserveAspectRatio="none" viewBox="0 0 {W} {H}">
			<defs>
				<linearGradient id="portfolioPerfGrad" x1="0" x2="0" y1="0" y2="1">
					<stop
						offset="0%"
						stop-color={isPositive ? 'var(--yes, #6fe0b6)' : 'var(--no, #ff6b6b)'}
						stop-opacity="0.32"
					/>
					<stop
						offset="100%"
						stop-color={isPositive ? 'var(--yes, #6fe0b6)' : 'var(--no, #ff6b6b)'}
						stop-opacity="0"
					/>
				</linearGradient>
			</defs>
			<path d={areaPath} fill="url(#portfolioPerfGrad)" />
			<path
				d={linePath}
				fill="none"
				stroke={isPositive ? 'var(--yes, #6fe0b6)' : 'var(--no, #ff6b6b)'}
				stroke-width="1.5"
			/>
		</svg>
	</section>
{/if}

<style lang="postcss">
	.perf-card {
		display: flex;
		flex-direction: column;
		gap: 0;
		padding: 1.25rem;
		background: var(--bg-surface);
		border: 1px solid var(--border-base);
		border-radius: var(--r-12);
		box-shadow: var(--inset-hi);
	}

	.perf-head {
		display: flex;
		align-items: baseline;
		justify-content: space-between;
		gap: 0.5rem;
	}

	.perf-eyebrow {
		margin: 0;
		color: var(--text-muted);
	}

	.perf-delta {
		font-size: var(--t-12);
		font-weight: 600;
		color: var(--text-muted);
	}

	.perf-delta.is-positive {
		color: var(--yes);
	}

	.perf-delta.is-negative {
		color: var(--no);
	}

	.perf-spark {
		display: block;
		width: 100%;
		height: 72px;
		margin-top: 0.625rem;
	}
</style>
