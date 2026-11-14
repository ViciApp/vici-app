<script lang="ts">
	import { isNullish, nonNullish } from '@dfinity/utils';
	import ScreenHeader from '#lib/components/layout/ScreenHeader.svelte';
	import MarketProbabilitySkeleton from '#lib/components/market/MarketProbabilitySkeleton.svelte';
	import MarketTitleSkeleton from '#lib/components/market/MarketTitleSkeleton.svelte';
	import OpenOrdersTable from '#lib/components/portfolio/OpenOrdersTable.svelte';
	import PortfolioAllocationCard from '#lib/components/portfolio/PortfolioAllocationCard.svelte';
	import PortfolioEmptyState from '#lib/components/portfolio/PortfolioEmptyState.svelte';
	import PortfolioHero from '#lib/components/portfolio/PortfolioHero.svelte';
	import PortfolioPerformanceCard from '#lib/components/portfolio/PortfolioPerformanceCard.svelte';
	import {
		EMPTY_VALUE,
		MILLISECOND_IN_NANOSECONDS,
		USD_DECIMALS
	} from '#lib/constants/app.constants.ts';
	import { primaryMicro } from '#lib/constants/market-taxonomy.constants.ts';
	import { AppPath } from '#lib/constants/routes.constants.ts';
	import { VXP_TOKEN } from '#lib/constants/tokens/tokens.ic.constants.ts';
	import { marketTags } from '#lib/derived/market-tags.derived.ts';
	import { markets, marketsNotInitialized } from '#lib/derived/markets.derived.ts';
	import { orders, ordersNotInitialized } from '#lib/derived/orders.derived.ts';
	import { playgroundVxpUnitMode } from '#lib/derived/playground.derived.ts';
	import { positions, positionsNotInitialized } from '#lib/derived/positions.derived.ts';
	import {
		decisiveSettledCount,
		resolvedPositions,
		resolvedPositionsNotInitialized
	} from '#lib/derived/resolved-positions.derived.ts';
	import { tradeHistoryNotInitialized } from '#lib/derived/trade-history.derived.ts';
	import { vxpHoldingsTotal } from '#lib/derived/vxp-holdings.derived.ts';
	import { localeStore } from '#lib/stores/locale.store.ts';
	import { displayMarkets } from '#lib/stores/market-translations.store.ts';
	import { userStore } from '#lib/stores/user.store.ts';
	import type { Position, ResolvedPosition } from '#lib/types/position.ts';
	import { displayAccuracyPct } from '#lib/utils/accuracy.utils.ts';
	import { decimalFixedValueToNumber, relativeAgoBucketFromMs } from '#lib/utils/format.utils.ts';
	import { t } from '#lib/utils/i18n.utils.ts';
	import { goBack, resolveAppPath } from '#lib/utils/nav.utils.ts';
	import {
		formatPositionPnLWithOptionalUnit,
		formatVxpBalance
	} from '#lib/utils/playground-display.utils.ts';
	import { calculatePositionPnL, positionEntryProbability } from '#lib/utils/portfolio.utils.ts';
	import { refreshOrders, refreshPositions } from '#lib/utils/refresh.utils.ts';
	import { inferResolvedOutcomeId } from '#lib/utils/resolved-position.utils.ts';
	import { tagColor } from '#lib/utils/tag-color.utils.ts';

	/**
	 * Portfolio page: single-page hero + flat lists.
	 *
	 * Layout (top → bottom)
	 * - `ScreenHeader`, back control + centered title "Portfolio".
	 * - Hero card (left-aligned, gradient surface): TOTAL HOLDINGS
	 *   eyebrow, 38 px VXP balance + unit, 3-col stat row
	 *   (Unrealized P&L · 7D Accuracy · Rank).
	 * - Performance · 30D card with signed % delta and sparkline of
	 *   cumulative realised PnL over 30 days. Hidden when the user has
	 *   no settled VXP events in window.
	 * - Allocation card: per-tag share of open VXP capital, top 5 +
	 *   Other, sorted by descending share. Hidden when no open VXP
	 *   positions.
	 * - Active calls: flat list with per-category accent tag + side
	 *   tag, market title, "Entry X% → Y%" entry-to-current probability,
	 *   and signed "+N VXP · +M%" PnL (delta also expressed as
	 *   price-move %).
	 * - Recent history: flat resolved rows (title, side tag, "Xd ago",
	 *   WIN/LOSS label, signed +VXP).
	 * - Open orders: same card shape as active calls, with the order's
	 *   limit price + qty in place of the entry → current strip, plus
	 *   an inline cancel button.
	 *
	 * Rank: not yet served by the satellite, rendered as `EMPTY_VALUE`
	 * placeholder, mirroring the Dash page treatment.
	 */

	const refreshing = $derived(
		$positionsNotInitialized ||
			$tradeHistoryNotInitialized ||
			$marketsNotInitialized ||
			$ordersNotInitialized ||
			$resolvedPositionsNotInitialized
	);

	const onOrdersRefresh = () => {
		refreshOrders();
		refreshPositions();
	};

	// Markets in the reader's language (see `displayMarkets`); every numeric /
	// status field is the untouched canonical value, so this is the right source
	// for both the row titles and the PnL / probability math below.
	const getMarketById = (id: string) => $displayMarkets.get(id);

	// Live positions whose market hasn't resolved yet. The clearing canister
	// deletes positions on settlement, so anything still in `$positions` is
	// by definition unresolved, but keep the explicit filter so a brief
	// staleness window (positions seen before the market list catches up)
	// can't show a settled row in the Active section.
	const openPositions = $derived(
		$positions.filter((pos) => getMarketById(pos.marketId)?.status !== 'Resolved')
	);

	// ── Hero VXP balance ─────────────────────────────────────────────

	// Total Holdings = free wallet balance + backed collateral, shared with
	// the Dash and Wallet surfaces (see `vxp-holdings.derived`). Combining
	// the legs avoids a user with all VXP in open positions showing
	// "0 VXP" despite owning plenty.
	const vxpBalanceDisplay = $derived(
		formatVxpBalance({ value: $vxpHoldingsTotal, decimals: VXP_TOKEN.decimals })
	);

	// Performance card uses the *total* holdings as its denominator so
	// the % delta tracks the same number the hero shows.
	const vxpBalanceNumber = $derived(
		decimalFixedValueToNumber({ value: $vxpHoldingsTotal, decimals: VXP_TOKEN.decimals })
	);

	// ── 3-col mini stats (Unrealized P&L · 7D Accuracy · Rank) ───────

	const unrealizedPnl = $derived.by((): number =>
		openPositions.reduce<number>((acc, pos) => {
			const market = getMarketById(pos.marketId);

			if (isNullish(market) || market.token.symbol !== VXP_TOKEN.symbol) {
				return acc;
			}

			const pnl = calculatePositionPnL({ position: pos, market });

			// Skip positions whose value is still unknown (book not read / empty)
			// instead of treating them as 0; see `calculatePositionValue`.
			return nonNullish(pnl) ? acc + pnl : acc;
		}, 0)
	);

	const unrealizedPnlDirection = $derived.by((): 'positive' | 'negative' | 'flat' => {
		if (unrealizedPnl > 0) {
			return 'positive';
		}

		if (unrealizedPnl < 0) {
			return 'negative';
		}

		return 'flat';
	});

	const unrealizedPnlDisplay = $derived.by((): string => {
		if (unrealizedPnl === 0) {
			return `0 ${VXP_TOKEN.symbol}`;
		}

		const positive = unrealizedPnl > 0;
		const sign = positive ? '+' : '−';
		const abs = positive ? unrealizedPnl : -unrealizedPnl;

		return `${sign}${abs.toFixed(0)} ${VXP_TOKEN.symbol}`;
	});

	// `profile.accuracy` is persisted as a 0..100 percentage (see
	// `profile.services.ts` `calculateAndSyncStats`). Render directly:
	// multiplying by 100 here gave 10000% for a fully-accurate user.
	const accuracyValue = $derived($userStore.profile?.accuracy ?? 0);

	// A user with no settled predictions yet shows an optimistic 100% rather
	// than a misleading 0% (display-only; see `displayAccuracyPct`). This is
	// always the viewer's own portfolio, so the `resolvedPositions`-derived
	// count is the right gate.
	const accuracyDisplay = $derived(
		`${displayAccuracyPct({
			accuracy: accuracyValue,
			settledCount: $decisiveSettledCount,
			initialized: !$resolvedPositionsNotInitialized
		})}%`
	);

	// ── Active-call row helpers ──────────────────────────────────────

	const positionPnl = (pos: Position): number | undefined =>
		calculatePositionPnL({ position: pos, market: getMarketById(pos.marketId) });

	const formatRowPnl = (pnl: number): string =>
		formatPositionPnLWithOptionalUnit({
			pnl,
			playground: $playgroundVxpUnitMode
		});

	const formatProb = (p: number): string => `${(p * 100).toFixed(0)}%`;

	const sideLabel = (pos: Position): string => {
		const market = getMarketById(pos.marketId);

		return market?.outcomes?.find((o) => o.id === pos.outcomeId)?.title ?? pos.outcomeId;
	};

	const categoryLabel = (marketId: string): string | null => {
		const micro = primaryMicro($marketTags[marketId] ?? []);

		return nonNullish(micro) ? micro.toUpperCase() : null;
	};

	/**
	 * Per-category accent for the row tag chip. Falls back to the
	 * laurel-gold default when the market has no recognised micro: same
	 * fallback `tagColor()` uses internally.
	 */
	const categoryAccent = (marketId: string): string => {
		const micro = primaryMicro($marketTags[marketId] ?? []);

		return tagColor(micro ?? '');
	};

	// Current implied probability for the position's side, or `undefined` when
	// the market's probability is unknown (book not read / empty). Never coerce
	// the unknown state to a fabricated 0%; callers render a placeholder.
	const positionSideProb = (pos: Position): number | undefined => {
		const market = getMarketById(pos.marketId);
		const yesProb = market?.yesProbability;

		if (isNullish(yesProb)) {
			return;
		}

		return pos.outcomeId === 'YES' ? yesProb : 1 - yesProb;
	};

	const positionEntryProb = (pos: Position): number | undefined =>
		positionEntryProbability({ position: pos, market: getMarketById(pos.marketId) });

	const positionMoveDisplay = (pos: Position): string | undefined => {
		const entry = positionEntryProb(pos);
		const current = positionSideProb(pos);

		if (isNullish(entry) || isNullish(current)) {
			return;
		}

		const pctMove = (current - entry) * 100;
		const sign = pctMove >= 0 ? '+' : '−';

		return `${sign}${Math.abs(pctMove).toFixed(1)}%`;
	};

	// ── Recent-history row helpers ───────────────────────────────────

	/**
	 * Realized PnL in VXP units (clearing-USD scale → number) for a
	 * settled-event-derived row. Matches `formatPositionPnLWithOptionalUnit`
	 * shape so the row formatter can stay symmetric with the Active list.
	 */
	const resolvedPnlNumber = (resolved: ResolvedPosition): number =>
		decimalFixedValueToNumber({ value: resolved.realizedPnlUsd, decimals: USD_DECIMALS });

	const formatResolvedRowPnl = (resolved: ResolvedPosition): string =>
		formatPositionPnLWithOptionalUnit({
			pnl: resolvedPnlNumber(resolved),
			playground: $playgroundVxpUnitMode
		});

	/**
	 * Display side label for a resolved row. Side-inference rules live in
	 * `inferResolvedOutcomeId`: see that helper for the per-payoff-type
	 * fallback behavior (binary losers map to the opposite outcome,
	 * categorical losers stay unknown).
	 */
	const resolvedSideLabel = (resolved: ResolvedPosition): string => {
		const market = getMarketById(resolved.marketId);
		const outcomeId = inferResolvedOutcomeId({ resolved, market });

		if (isNullish(outcomeId)) {
			return EMPTY_VALUE;
		}

		return market?.outcomes?.find((o) => o.id === outcomeId)?.title ?? outcomeId;
	};

	/**
	 * Maps the inferred outcome to the visual side-tag bucket (yes / no /
	 * hold) used by the row chip styles.
	 */
	const resolvedSideKey = (resolved: ResolvedPosition): 'yes' | 'no' | 'hold' => {
		const market = getMarketById(resolved.marketId);
		const outcomeId = inferResolvedOutcomeId({ resolved, market });

		if (outcomeId === 'YES') {
			return 'yes';
		}

		if (outcomeId === 'NO') {
			return 'no';
		}

		return 'hold';
	};

	/**
	 * Approximate "Xd ago" / "Xh ago" timestamp for the Recent-history
	 * block. Uses the Settled event's own `timestampNs` carried on the
	 * `ResolvedPosition`; no fallback needed because the record exists
	 * iff a Settled event produced it.
	 */
	const resolvedAgoDisplay = (resolved: ResolvedPosition): string => {
		const { unit, value } = relativeAgoBucketFromMs({
			timestampMs: Number(resolved.timestampNs / MILLISECOND_IN_NANOSECONDS)
		});

		if (unit === 'now') {
			return t({ locale: $localeStore, key: 'portfolio.row.ago_just_now' });
		}

		if (unit === 'days') {
			return t({
				locale: $localeStore,
				key: 'portfolio.row.ago_days',
				params: { days: String(value) }
			});
		}

		return t({
			locale: $localeStore,
			key: 'portfolio.row.ago_hours',
			params: { hours: String(value) }
		});
	};
</script>

<div class="portfolio-page">
	<ScreenHeader
		back={{
			label: t({ locale: $localeStore, key: 'portfolio.back' }),
			onBack: () => goBack(resolveAppPath(AppPath.Dash))
		}}
		title={t({ locale: $localeStore, key: 'portfolio.title' })}
	/>

	<PortfolioHero
		{accuracyDisplay}
		{unrealizedPnlDirection}
		{unrealizedPnlDisplay}
		{vxpBalanceDisplay}
	/>

	<PortfolioPerformanceCard
		markets={$markets}
		resolvedPositions={$resolvedPositions}
		vxpBalance={vxpBalanceNumber}
	/>

	<PortfolioAllocationCard marketTags={$marketTags} markets={$markets} positions={openPositions} />

	{#if refreshing && openPositions.length === 0 && $resolvedPositions.length === 0 && $orders.length === 0}
		<section class="portfolio-section">
			<div class="portfolio-skeleton"></div>
			<div class="portfolio-skeleton"></div>
			<div class="portfolio-skeleton"></div>
		</section>
	{:else if openPositions.length === 0 && $resolvedPositions.length === 0 && $orders.length === 0}
		<PortfolioEmptyState />
	{:else}
		{#if openPositions.length > 0}
			<section class="portfolio-section">
				<header class="portfolio-section-head">
					<h2 class="portfolio-section-title">
						{t({ locale: $localeStore, key: 'portfolio.section.active' })}
					</h2>
					<span class="num portfolio-section-count">{openPositions.length}</span>
				</header>

				<ul class="portfolio-list portfolio-list-inline">
					{#each openPositions as pos (`${pos.marketId}::${pos.outcomeId}`)}
						{@const market = getMarketById(pos.marketId)}
						{@const pnl = positionPnl(pos)}
						{@const sideKey =
							pos.outcomeId === 'YES' ? 'yes' : pos.outcomeId === 'NO' ? 'no' : 'hold'}
						{@const entry = positionEntryProb(pos)}
						{@const current = positionSideProb(pos)}
						{@const move = positionMoveDisplay(pos)}
						{@const probabilityVariant = market?.priceLoaded === true ? 'empty' : 'loading'}
						{@const catLabel = categoryLabel(pos.marketId)}
						{@const catAccent = categoryAccent(pos.marketId)}

						<li>
							<a
								class="portfolio-row portfolio-row-card portfolio-row-inline"
								aria-label={$marketsNotInitialized && isNullish(market)
									? t({ locale: $localeStore, key: 'ui.loading' })
									: (market?.title ?? t({ locale: $localeStore, key: 'portfolio.unknown_market' }))}
								href="{AppPath.Markets}/{pos.marketId}"
							>
								<div class="portfolio-row-tags">
									{#if catLabel}
										<span style:color={catAccent} class="portfolio-row-cat">{catLabel}</span>
									{:else}
										<span class="portfolio-row-cat is-dim">{EMPTY_VALUE}</span>
									{/if}
									<span class="portfolio-row-side portfolio-row-side-{sideKey}">
										{sideLabel(pos)}
									</span>
								</div>
								<div class="portfolio-row-title">
									{#if $marketsNotInitialized && isNullish(market)}
										<MarketTitleSkeleton />
									{:else}
										{market?.title ?? t({ locale: $localeStore, key: 'portfolio.unknown_market' })}
									{/if}
								</div>
								<div class="portfolio-row-meta">
									<span class="num portfolio-row-prob">
										{#if isNullish(current)}
											<MarketProbabilitySkeleton variant={probabilityVariant} />
										{:else if nonNullish(entry)}
											{t({
												locale: $localeStore,
												key: 'portfolio.row.entry_to_current',
												params: { entry: formatProb(entry), current: formatProb(current) }
											})}
										{:else}
											{t({
												locale: $localeStore,
												key: 'portfolio.row.payout_at',
												params: { prob: formatProb(current) }
											})}
										{/if}
									</span>
									<span
										class="num portfolio-row-pnl"
										class:is-negative={nonNullish(pnl) && pnl < 0}
										class:is-positive={nonNullish(pnl) && pnl >= 0}
									>
										{#if isNullish(pnl)}
											<MarketProbabilitySkeleton variant={probabilityVariant} />
										{:else}
											{formatRowPnl(pnl)}{#if nonNullish(move)}<span class="portfolio-row-move">
													· {move}</span
												>{/if}
										{/if}
									</span>
								</div>
							</a>
						</li>
					{/each}
				</ul>
			</section>
		{/if}

		{#if $resolvedPositions.length > 0}
			<section class="portfolio-section">
				<header class="portfolio-section-head">
					<h2 class="portfolio-section-title">
						{t({ locale: $localeStore, key: 'portfolio.section.recent_history' })}
					</h2>
					<span class="portfolio-section-more">
						{t({ locale: $localeStore, key: 'portfolio.section.see_all' })}
					</span>
				</header>

				<ul class="portfolio-list">
					{#each $resolvedPositions as resolved (resolved.eventId)}
						{@const market = getMarketById(resolved.marketId)}
						{@const pnl = resolvedPnlNumber(resolved)}
						{@const sideKey = resolvedSideKey(resolved)}
						{@const resultKey =
							resolved.result === 'won' ? 'win' : resolved.result === 'lost' ? 'loss' : 'neutral'}

						<li>
							<a class="portfolio-history-row" href="{AppPath.Markets}/{resolved.marketId}">
								<div class="portfolio-history-body">
									<div class="portfolio-history-title">
										{#if $marketsNotInitialized && isNullish(market)}
											<MarketTitleSkeleton />
										{:else}
											{market?.title ??
												t({ locale: $localeStore, key: 'portfolio.unknown_market' })}
										{/if}
									</div>
									<div class="portfolio-history-meta">
										<span class="portfolio-row-side portfolio-row-side-{sideKey}">
											{resolvedSideLabel(resolved)}
										</span>
										<span class="num portfolio-history-ago">{resolvedAgoDisplay(resolved)}</span>
									</div>
								</div>
								<div class="portfolio-history-end">
									<span class="portfolio-history-result portfolio-history-result-{resultKey}">
										{#if resolved.result === 'won'}
											{t({ locale: $localeStore, key: 'portfolio.row.win' })}
										{:else if resolved.result === 'lost'}
											{t({ locale: $localeStore, key: 'portfolio.row.loss' })}
										{:else}
											{EMPTY_VALUE}
										{/if}
									</span>
									<span
										class="num portfolio-history-pnl"
										class:is-negative={pnl < 0}
										class:is-positive={pnl >= 0}
									>
										{formatResolvedRowPnl(resolved)}
									</span>
								</div>
							</a>
						</li>
					{/each}
				</ul>
			</section>
		{/if}

		{#if $orders.length > 0}
			<section class="portfolio-section">
				<header class="portfolio-section-head">
					<h2 class="portfolio-section-title">
						{t({ locale: $localeStore, key: 'portfolio.orders.title' })}
					</h2>
					<span class="num portfolio-section-count">{$orders.length}</span>
				</header>
				<OpenOrdersTable
					markets={[...$displayMarkets.values()]}
					onRefresh={onOrdersRefresh}
					orders={$orders}
				/>
			</section>
		{/if}
	{/if}
</div>

<style lang="postcss">
	.portfolio-page {
		display: flex;
		flex-direction: column;
		gap: 1.25rem;
		padding: 0 1.25rem 6rem;
	}

	.portfolio-section {
		display: flex;
		flex-direction: column;
		gap: 0.625rem;
	}

	.portfolio-section-head {
		display: flex;
		align-items: baseline;
		justify-content: space-between;
		gap: 0.5rem;
	}

	.portfolio-section-title {
		margin: 0;
		font-size: 15px;
		font-weight: 600;
		letter-spacing: -0.01em;
		color: var(--text-base);
	}

	.portfolio-section-count {
		font-size: var(--t-12);
		color: var(--text-muted);
	}

	.portfolio-section-more {
		font-size: var(--t-12);
		font-weight: 600;
		color: var(--accent);
	}

	.portfolio-list {
		display: flex;
		flex-direction: column;
		gap: 0.5rem;
		margin: 0;
		padding: 0;
		list-style: none;
	}

	.portfolio-row {
		display: flex;
		align-items: center;
		gap: 0.75rem;
		padding: 0.75rem 0.875rem;
		text-decoration: none;
		color: inherit;
		background: var(--bg-popover);
		border: 1px solid var(--border-base);
		border-radius: var(--r-12);
		transition: border-color var(--d-hover) var(--ease-vici);
	}

	.portfolio-row:hover {
		border-color: var(--border-strong);
	}

	.portfolio-row-card {
		display: flex;
		flex-direction: column;
		/* Reset the `align-items: center` inherited from `.portfolio-row`
		   (which is set for the side-by-side resolved row). On the
		   column-layout card we need children to stretch full width so
		   the inner `.portfolio-row-tags` / `.portfolio-row-meta` rows
		   can put their `justify-content: space-between` to use. */
		align-items: stretch;
		gap: 0.5rem;
		padding: 0.875rem;
	}

	/* Active calls render as hairline-separated inline rows (no card
	   chrome) rather than bordered chips: transparent surface, a top
	   border between rows, square corners, and a subtle hover tint:
	   the inline-row treatment shared with other list surfaces. */
	.portfolio-row-inline {
		background: transparent;
		border: 0;
		border-top: 1px solid var(--border-base);
		border-radius: 0;
		padding: 1rem 0;
		transition: background var(--d-hover) var(--ease-vici);
	}

	.portfolio-list-inline li:first-child .portfolio-row-inline {
		border-top: 0;
		padding-top: 0;
	}

	.portfolio-list-inline li:last-child .portfolio-row-inline {
		padding-bottom: 0;
	}

	.portfolio-row-inline:hover {
		border-color: var(--border-base);
		background: color-mix(in srgb, var(--text-base) 3%, transparent);
	}

	.portfolio-row-tags {
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: 0.5rem;
	}

	.portfolio-row-cat {
		display: inline-flex;
		align-items: center;
		gap: 4px;
		padding: 3px 7px;
		font-family: var(--font-mono);
		font-size: 10px;
		font-weight: 700;
		letter-spacing: 0.08em;
		text-transform: uppercase;
		color: var(--text-muted);
		background: color-mix(in srgb, var(--text-base) 6%, transparent);
		border-radius: var(--r-4);
	}

	.portfolio-row-cat.is-dim {
		opacity: 0.5;
	}

	.portfolio-row-title {
		font-size: var(--t-13);
		font-weight: 600;
		line-height: 1.4;
		color: var(--text-base);
		display: -webkit-box;
		-webkit-box-orient: vertical;
		-webkit-line-clamp: 2;
		overflow: hidden;
	}

	.portfolio-row-side {
		display: inline-flex;
		flex: 0 0 auto;
		align-items: center;
		gap: 4px;
		padding: 3px 7px;
		font-family: var(--font-mono);
		font-size: 10px;
		font-weight: 700;
		letter-spacing: 0.08em;
		text-transform: uppercase;
		border-radius: var(--r-4);
		background: color-mix(in srgb, var(--text-base) 6%, transparent);
		color: var(--text-muted);
	}

	.portfolio-row-side-yes {
		color: var(--yes);
		background: var(--yes-wash);
	}

	.portfolio-row-side-no {
		color: var(--no);
		background: var(--no-wash);
	}

	.portfolio-row-side-hold {
		color: var(--text-muted);
	}

	.portfolio-row-meta {
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: 0.5rem;
	}

	.portfolio-row-prob {
		font-size: var(--text-eyebrow, 11px);
		letter-spacing: 0.08em;
		text-transform: uppercase;
		color: var(--text-muted);
	}

	.portfolio-row-pnl {
		font-size: var(--t-13);
		font-weight: 600;
		color: var(--text-muted);
	}

	.portfolio-row-pnl.is-positive {
		color: var(--yes);
	}

	.portfolio-row-pnl.is-negative {
		color: var(--no);
	}

	.portfolio-row-move {
		font-weight: 500;
		opacity: 0.85;
	}

	.portfolio-history-row {
		display: flex;
		align-items: center;
		gap: 0.75rem;
		padding: 0.625rem 0.75rem;
		text-decoration: none;
		color: inherit;
		background: var(--bg-raised, var(--bg-popover));
		border: 1px solid var(--border-base);
		border-radius: var(--r-12);
		transition: border-color var(--d-hover) var(--ease-vici);
	}

	.portfolio-history-row:hover {
		border-color: var(--border-strong);
	}

	.portfolio-history-body {
		display: flex;
		flex-direction: column;
		gap: 0.125rem;
		flex: 1;
		min-width: 0;
	}

	.portfolio-history-title {
		font-size: var(--t-12);
		font-weight: 500;
		color: var(--text-base);
		white-space: nowrap;
		overflow: hidden;
		text-overflow: ellipsis;
	}

	.portfolio-history-meta {
		display: flex;
		align-items: center;
		gap: 0.375rem;
	}

	.portfolio-history-ago {
		font-size: var(--text-eyebrow, 11px);
		letter-spacing: var(--tracking-wide);
		color: var(--text-muted);
	}

	.portfolio-history-end {
		display: flex;
		flex-direction: column;
		align-items: flex-end;
		gap: 0.125rem;
	}

	.portfolio-history-result {
		font-family: var(--font-mono);
		font-size: 9.5px;
		font-weight: 700;
		letter-spacing: 0.08em;
		text-transform: uppercase;
		color: var(--text-muted);
	}

	.portfolio-history-result-win {
		color: var(--yes);
	}

	.portfolio-history-result-loss {
		color: var(--no);
	}

	.portfolio-history-pnl {
		font-size: var(--text-eyebrow, 11px);
		font-weight: 600;
		color: var(--text-muted);
	}

	.portfolio-history-pnl.is-positive {
		color: var(--yes);
	}

	.portfolio-history-pnl.is-negative {
		color: var(--no);
	}

	.portfolio-skeleton {
		height: 4rem;
		background: var(--bg-popover);
		border: 1px solid var(--border-base);
		border-radius: var(--r-12);
		opacity: 0.6;
	}

	:global(.portfolio-orders) {
		margin-top: 0.25rem;
	}
</style>
