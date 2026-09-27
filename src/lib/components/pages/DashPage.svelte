<script lang="ts">
	import { isNullish, nonNullish } from '@dfinity/utils';
	/**
	 * Dash screen — a glanceable, three-zone surface over the user's real
	 * performance, stack, and calls:
	 *
	 *   1 · Performance — the accuracy hero (big mono number), a swipeable
	 *       accuracy trend (7 / 30 / 90-day windows), the session delta + streak,
	 *       and a global ⇄ friends benchmark toggle.
	 *   2 · Stack       — the holdings card; tapping opens a breakdown sheet
	 *       (Your VXP hero + Available / In-play split).
	 *   3 · Calls       — an Open / Resolved segmented toggle over compact call
	 *       rows with status dots and an inline "see all".
	 *
	 * Before any call has settled the same framework renders the Day-0/Day-1
	 * calibrating state (see {@link DashBuildZero}). Every figure is read from
	 * the real stores; the only synthesised data is the accuracy trail (no
	 * per-window time-series is persisted yet — see `dash-trend.utils`).
	 */
	import { onMount } from 'svelte';
	import { goto } from '$app/navigation';
	import { resolve } from '$app/paths';
	import type { ClearingDid } from '$declarations';
	import DashBuildHero from '$lib/components/dash/DashBuildHero.svelte';
	import DashBuildZero, { type ZeroMarketRow } from '$lib/components/dash/DashBuildZero.svelte';
	import DashCallsZone, {
		type OpenCallRow,
		type ResolvedCallRow
	} from '$lib/components/dash/DashCallsZone.svelte';
	import DashResolutionBanner from '$lib/components/dash/DashResolutionBanner.svelte';
	import DashStackCard from '$lib/components/dash/DashStackCard.svelte';
	import DashStackSheet from '$lib/components/dash/DashStackSheet.svelte';
	import ResolutionReveal from '$lib/components/market/ResolutionReveal.svelte';
	import { USD_DECIMALS, ZERO } from '$lib/constants/app.constants';
	import { primaryMicro } from '$lib/constants/market-taxonomy.constants';
	import { AppPath } from '$lib/constants/routes.constants';
	import { balanceDomain } from '$lib/derived/balance-domain.derived';
	import { marketTags } from '$lib/derived/market-tags.derived';
	import { orders } from '$lib/derived/orders.derived';
	import { positions } from '$lib/derived/positions.derived';
	import {
		resolvedPositions,
		resolvedPositionsNotInitialized
	} from '$lib/derived/resolved-positions.derived';
	import {
		vxpBacked,
		vxpHoldingsNotInitialized,
		vxpHoldingsTotal,
		vxpSpendable
	} from '$lib/derived/vxp-holdings.derived';
	import { getProfile, syncMyStats } from '$lib/services/profile.services';
	import { loadMyUserStats } from '$lib/services/user-stats.services';
	import { friendsListStore } from '$lib/stores/friends.store';
	import { markResolutionsSeen, maturedResolutions } from '$lib/stores/inbox.store';
	import { localeStore } from '$lib/stores/locale.store';
	import { displayMarkets } from '$lib/stores/market-translations.store';
	import { profilesStore } from '$lib/stores/profiles.store';
	import { userStore } from '$lib/stores/user.store';
	import type { Market } from '$lib/types/market';
	import type { UserStatsDoc } from '$lib/types/user-stats';
	import {
		decimalFixedValueToNumber,
		formatRelativeAgoShort,
		probabilityToPercent
	} from '$lib/utils/format.utils';
	import { t } from '$lib/utils/i18n.utils';
	import { categoryLabel } from '$lib/utils/market-tags.utils';
	import { formatVxpBalance, formatWholeVxpMagnitude } from '$lib/utils/playground-display.utils';
	import { inferResolvedOutcomeId } from '$lib/utils/resolved-position.utils';

	// ─── Reactive backend reads ────────────────────────────────────────
	const profile = $derived($userStore.profile);
	const totalTrades = $derived(profile?.totalTrades ?? 0);
	// `profile.accuracy` is persisted as a 0..100 percentage.
	const accuracyValue = $derived(profile?.accuracy ?? 0);
	const accuracyPct = $derived(accuracyValue.toFixed(1));
	const streak = $derived(profile?.dailyStreak ?? 0);

	let userStats = $state<UserStatsDoc | undefined>(undefined);

	// ─── Holdings (playground / VXP domain) ────────────────────────────
	const holdingsDisplay = $derived(
		formatVxpBalance({ value: $vxpHoldingsTotal, decimals: USD_DECIMALS })
	);
	const availableDisplay = $derived(
		formatVxpBalance({ value: $vxpSpendable, decimals: USD_DECIMALS })
	);
	const inPlayDisplay = $derived(formatVxpBalance({ value: $vxpBacked, decimals: USD_DECIMALS }));

	// ─── Markets ───────────────────────────────────────────────────────
	// Markets in the reader's language (see `displayMarkets`) — every numeric /
	// status field is the untouched canonical value, so the call-row math and
	// `isUnresolved` status checks below read from it unchanged.
	const marketById = $derived($displayMarkets);

	// Short, year-stripped close label so the row end stays compact.
	const timerOf = (market: Market): string => {
		const expiry = Number(market.expiryDate);

		if (!Number.isFinite(expiry) || expiry <= Date.now()) {
			return t({ locale: $localeStore, key: 'dash.build.timer_closed' });
		}

		const days = Math.ceil((expiry - Date.now()) / (1000 * 60 * 60 * 24));

		return days <= 1
			? t({ locale: $localeStore, key: 'dash.active.hours_left', params: { count: 24 } })
			: t({ locale: $localeStore, key: 'dash.active.days_left', params: { count: days } });
	};

	const categoryOf = (market: Market): string => {
		const micro = primaryMicro($marketTags[market.id] ?? []);

		return nonNullish(micro)
			? categoryLabel({ category: micro, variant: 'full', locale: $localeStore })
			: t({ locale: $localeStore, key: 'dash.build.category_fallback' });
	};

	// Day-0/1 market context — "{category} · {pct}% YES" from live consensus.
	// When the probability is still unknown (book not yet read or empty; see
	// `Market.yesProbability`) we drop the "{pct}% YES" clause and show the
	// bare category rather than a fabricated "0% YES" / "NaN%".
	const crowdContextOf = (market: Market): string => {
		const { yesProbability } = market;

		if (isNullish(yesProbability)) {
			return categoryOf(market);
		}

		return t({
			locale: $localeStore,
			key: 'dash.build.zero_crowd_ctx',
			params: { category: categoryOf(market), pct: probabilityToPercent(yesProbability) }
		});
	};

	// ─── Positions / orders ────────────────────────────────────────────
	// The clearing canister deletes positions on settlement, so anything in
	// `$positions` is normally unresolved — but a market can flip to
	// `Resolved` before its settlement lands (and before the stores catch
	// up). Filter that window out so a decided call never shows as an open
	// "Closing" row; it surfaces in the Resolved tab once its settlement
	// event arrives. Mirrors the Active-section filter in `PortfolioPage`.
	const isUnresolved = (marketId: string): boolean =>
		marketById.get(marketId)?.status !== 'Resolved';
	const activePositionsAll = $derived($positions.filter(({ marketId }) => isUnresolved(marketId)));
	const openOrdersAll = $derived($orders.filter(({ series_id }) => isUnresolved(series_id)));
	const liveCallCount = $derived(activePositionsAll.length + openOrdersAll.length);

	// A resting limit order reads as YES exposure when buying, NO when selling —
	// mirrors how `OpenOrdersTable` labels the same orders.
	const orderSide = (order: ClearingDid.LimitOrder): 'YES' | 'NO' =>
		'Buy' in order.side ? 'YES' : 'NO';

	// Open call rows — soonest-expiring first. Live positions AND resting limit
	// orders both count as open calls, so the Open tab stays consistent with
	// `liveCallCount` / the Day-0 gating (a user holding only limit orders must
	// not see the "no live calls" empty state).
	const openCalls = $derived.by<OpenCallRow[]>(() => {
		const positionRows = activePositionsAll
			.map((position) => ({ position, market: marketById.get(position.marketId) }))
			.filter((entry): entry is { position: (typeof activePositionsAll)[number]; market: Market } =>
				nonNullish(entry.market)
			)
			.map(({ position, market }) => ({
				market,
				row: {
					key: position.marketId,
					question: market.title,
					side: position.outcomeId === 'YES' ? ('YES' as const) : ('NO' as const),
					context: categoryOf(market),
					timer: timerOf(market),
					marketId: market.id
				}
			}));

		const orderRows = openOrdersAll
			.map((order) => ({ order, market: marketById.get(order.series_id) }))
			.filter((entry): entry is { order: ClearingDid.LimitOrder; market: Market } =>
				nonNullish(entry.market)
			)
			.map(({ order, market }) => ({
				market,
				row: {
					key: order.order_id,
					question: market.title,
					side: orderSide(order),
					context: categoryOf(market),
					timer: timerOf(market),
					marketId: market.id
				}
			}));

		return [...positionRows, ...orderRows]
			.sort((a, b) => Number(a.market.expiryDate) - Number(b.market.expiryDate))
			.map(({ row }) => row);
	});

	// ─── Resolved calls ────────────────────────────────────────────────
	const wins = $derived($resolvedPositions.filter((r) => r.result === 'won').length);
	const losses = $derived($resolvedPositions.filter((r) => r.result === 'lost').length);
	const settledTotal = $derived(wins + losses);

	const resolvedCalls = $derived.by<ResolvedCallRow[]>(() =>
		$resolvedPositions
			.filter((row) => row.result !== 'neutral')
			.map((row) => {
				const market = marketById.get(row.marketId);
				const outcomeId = inferResolvedOutcomeId({ resolved: row, market });
				const side = outcomeId === 'YES' ? 'YES' : outcomeId === 'NO' ? 'NO' : undefined;
				const settledAtMs = Number(row.timestampNs / 1_000_000n);
				const won = row.result === 'won';
				const pnl = decimalFixedValueToNumber({
					value: row.realizedPnlUsd,
					decimals: USD_DECIMALS
				});

				return {
					key: `${row.marketId}-${settledAtMs}`,
					question: market?.title ?? row.marketId,
					side,
					context: t({
						locale: $localeStore,
						key: 'dash.past.row_ctx_when',
						params: { when: formatRelativeAgoShort({ timestampMs: settledAtMs }) }
					}),
					end: `${won ? '+' : '−'}${formatWholeVxpMagnitude(pnl)}`,
					won,
					marketId: market ? row.marketId : undefined
				};
			})
	);

	// ─── Friends benchmark ─────────────────────────────────────────────
	// Join the social graph with cached profiles to count how many friends the
	// user is at-or-ahead-of on accuracy. Only friends whose profile is cached
	// (and so carry a comparable accuracy) are counted.
	const friendAccuracies = $derived.by<number[]>(() => {
		const me = $userStore.user?.owner;
		const cache = $profilesStore;

		return $friendsListStore
			.map((relation) => relation.participants.find((p) => p !== me))
			.filter((owner): owner is string => nonNullish(owner))
			.map((owner) => cache.get(owner)?.accuracy)
			.filter((acc): acc is number => nonNullish(acc));
	});
	const friendsTotal = $derived(friendAccuracies.length);
	const friendsAhead = $derived(friendAccuracies.filter((acc) => accuracyValue >= acc).length);

	// ─── Stack: today's delta + breakdown sheet ────────────────────────
	const recentSettlements = $derived(userStats?.recentSettlements ?? []);

	// `user_stats` is fetched after mount, so the TODAY figure pulses a
	// placeholder until the doc lands — distinct from a loaded-but-quiet window,
	// which reads a real `0` rather than skeleton.
	const todayLoading = $derived(isNullish(userStats));

	// Net VXP across the recent settlement window: wins add their payout, losses
	// have no payout (the stake is already gone), so a quiet/loss-only window
	// reads 0. `null` only when there is no settlement data at all.
	const todayDelta = $derived.by<number | null>(() => {
		if (recentSettlements.length === 0) {
			return null;
		}

		return Math.round(recentSettlements.reduce((sum, s) => sum + (s.win ? s.vxp : 0), 0));
	});

	let sheetOpen = $state(false);

	// ─── Session delta ─────────────────────────────────────────────────
	const sessionDelta = $derived.by<number | null>(() => {
		const sc = recentSettlements.length;

		if (sc === 0) {
			return null;
		}

		const sw = recentSettlements.filter((s) => s.win).length;
		const priorCalls = totalTrades - sc;

		if (priorCalls < 1) {
			return null;
		}

		const priorWins = Math.max(0, Math.round(accuracyValue * totalTrades) - sw);
		const priorAcc = priorWins / priorCalls;

		return Math.round((accuracyValue - priorAcc) * 1000) / 10;
	});

	// ─── Resolution digest banner ──────────────────────────────────────
	const digest = $derived($maturedResolutions);
	let revealOpen = $state(false);
	let revealSnapshot = $state($maturedResolutions);

	const openReveal = (): void => {
		revealSnapshot = $maturedResolutions;
		revealOpen = true;
	};

	const onRevealReview = (): void => {
		markResolutionsSeen();
		revealOpen = false;
	};

	const onRevealDismiss = (): void => {
		markResolutionsSeen();
		revealOpen = false;
		void goto(resolve(AppPath.Flow));
	};

	// ─── Three-state gate ──────────────────────────────────────────────
	const resolvedPosNotInit = $derived($resolvedPositionsNotInitialized);
	const callsPlaced = $derived(Math.max(totalTrades, liveCallCount + settledTotal));
	const isDay0 = $derived(callsPlaced === 0);
	const isDay1Pending = $derived(!isDay0 && settledTotal === 0);

	// ─── Zero-state markets ────────────────────────────────────────────
	// Open markets, most-traded first — the starter list (Day 0) and the
	// "add another while you wait" pair (Day 1).
	const openMarketsByVolume = $derived.by<Market[]>(() =>
		[...$displayMarkets.values()]
			.filter((m) => m.status === 'Open')
			.sort((a, b) => {
				if (b.totalVolume === a.totalVolume) {
					return 0;
				}

				return b.totalVolume > a.totalVolume ? 1 : -1;
			})
	);
	const toZeroRow = (market: Market): ZeroMarketRow => ({
		marketId: market.id,
		question: market.title,
		context: crowdContextOf(market),
		timer: timerOf(market)
	});

	const starterRows = $derived(openMarketsByVolume.slice(0, 3).map(toZeroRow));
	const moreRows = $derived(openMarketsByVolume.slice(0, 2).map(toZeroRow));

	// Day-1 calibrating caption — names when the soonest-expiring live position
	// settles. The in-flight list itself is the full `openCalls` set below.
	const firstCallEntry = $derived.by<{ market: Market } | undefined>(() => {
		const [position] = [...activePositionsAll].sort((a, b) => {
			const ma = marketById.get(a.marketId);
			const mb = marketById.get(b.marketId);

			return Number(ma?.expiryDate ?? ZERO) - Number(mb?.expiryDate ?? ZERO);
		});
		const market = position ? marketById.get(position.marketId) : undefined;

		if (isNullish(position) || isNullish(market)) {
			return;
		}

		return { market };
	});
	const firstCallTimer = $derived(
		firstCallEntry ? timerOf(firstCallEntry.market) : (openCalls[0]?.timer ?? '')
	);

	onMount(async () => {
		if (isNullish(profile)) {
			return;
		}

		try {
			await syncMyStats({ domain: $balanceDomain });
			const profileDoc = await getProfile(profile.owner);
			userStore.update((s) => ({ ...s, profile: profileDoc.data }));
		} catch (err) {
			console.error('DashPage: failed to recompute stats', err);
		}

		try {
			userStats = await loadMyUserStats(profile.owner);
		} catch (err) {
			console.error('DashPage: failed to load user_stats', err);
		}
	});
</script>

<!-- No titled page header: the accuracy hero is the dashboard masthead, so the
     content leads directly with the performance zone (the streak shows inline
     inside the hero). The page heading is kept for assistive tech only, so the
     document outline still has a top-level h1 without a visible title. -->
<h1 class="sr-only">{t({ locale: $localeStore, key: 'dash.title' })}</h1>
{#if resolvedPosNotInit && callsPlaced > 0}
	<!-- LOADING · trade-history not yet initialized — gating on `settledTotal`
		     here would misroute a returning user to Day-1. Render nothing until
		     the resolved-positions store is ready (the window is brief). -->
{:else if isDay0 || isDay1Pending}
	<div class="db-screen">
		<DashBuildZero
			day1={isDay1Pending}
			{firstCallTimer}
			{holdingsDisplay}
			{inPlayDisplay}
			loading={$vxpHoldingsNotInitialized}
			{moreRows}
			onOpen={() => (sheetOpen = true)}
			{openCalls}
			pendingCount={liveCallCount}
			{starterRows}
		/>
	</div>
{:else}
	<div class="db-screen">
		<!-- Resolution banner · while-you-were-away -->
		{#if digest.count > 0}
			<DashResolutionBanner {digest} onOpen={openReveal} />
		{/if}

		<div class="db-body">
			<!-- ZONE 1 · PERFORMANCE -->
			<DashBuildHero
				{accuracyPct}
				{accuracyValue}
				{friendsAhead}
				{friendsTotal}
				{sessionDelta}
				{streak}
			/>

			<!-- ZONE 2 · STACK -->
			<DashStackCard
				{holdingsDisplay}
				{inPlayDisplay}
				loading={$vxpHoldingsNotInitialized}
				onOpen={() => (sheetOpen = true)}
				{todayDelta}
				{todayLoading}
			/>

			<!-- ZONE 3 · CALLS -->
			<DashCallsZone {openCalls} {resolvedCalls} resolvedTotal={settledTotal} />
		</div>

		<div style:height="28px"></div>
	</div>
{/if}

<DashStackSheet
	{availableDisplay}
	availableValue={$vxpSpendable}
	{holdingsDisplay}
	{inPlayDisplay}
	inPlayValue={$vxpBacked}
	isOpen={sheetOpen}
	onClose={() => (sheetOpen = false)}
	openCallCount={liveCallCount}
/>

{#if revealOpen}
	<ResolutionReveal data={revealSnapshot} onDismiss={onRevealDismiss} onReview={onRevealReview} />
{/if}

<style lang="postcss">
	.sr-only {
		position: absolute;
		width: 1px;
		height: 1px;
		padding: 0;
		margin: -1px;
		overflow: hidden;
		clip: rect(0, 0, 0, 0);
		white-space: nowrap;
		border: 0;
	}
</style>
