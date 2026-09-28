import type { RegistryDid } from '$declarations';
import {
	getSettlementStatus,
	listOrders as listOrdersApi,
	listSeriesTradedVolumes as listSeriesTradedVolumesApi
} from '$lib/api/clearing.api';
import { addSeries, forkSeries, getSeries, listSeries } from '$lib/api/registry.api';
import {
	DAY_IN_MS,
	MILLISECOND_IN_NANOSECONDS,
	PAYOFF_TYPE,
	PRICE_DECIMALS,
	RESOLUTION_CLAUSE_MAX_LENGTH,
	STRIKE,
	USD_DECIMALS,
	VICI_ORACLE_V1
} from '$lib/constants/app.constants';
import { CURRENT_FEATURED_EVENT } from '$lib/constants/featured-event.constants';
import { VICI_ENGINE_ID } from '$lib/constants/icdc.constants';
import type { AppLocale } from '$lib/constants/locale.constants';
import { classificationMacros } from '$lib/constants/market-taxonomy.constants';
import { ActivityType } from '$lib/enums/social';
import { UserRole } from '$lib/enums/user';
import { getSettlementActivities, logActivity } from '$lib/services/activity.services';
import { getIdentityOrAnonymous, safeGetIdentityOnce } from '$lib/services/identity.services';
import {
	listMarketMetadataBySeries,
	listMarketTagsBySeries
} from '$lib/services/market-tags.services';
import { getOrderBook } from '$lib/services/order.services';
import { getProfile } from '$lib/services/profile.services';
import { loadWithCertification } from '$lib/services/query-update.services';
import {
	getSettledSeriesIds,
	loadSettlementOutcomes,
	type SettlementDetails
} from '$lib/services/resolution.services';
import type { Market, MarketId, MarketStatus, Outcome } from '$lib/types/market';
import type { MarketMetadata } from '$lib/types/market-metadata';
import type { Activity } from '$lib/types/social';
import { filterByPlaygroundExpandedDomain } from '$lib/utils/balance-domain.utils';
import { participantMarketIds } from '$lib/utils/featured-event.utils';
import { cacheMarketPrices, readCachedYesProbabilities } from '$lib/utils/market-price-cache.utils';
import {
	calculateCategoricalProbabilities,
	calculateMarketStats,
	mapMarketData,
	parseSettlementOutcome
} from '$lib/utils/market.utils';
import { settlementInputOutcome, settlementInputTimestamp } from '$lib/utils/payoff.utils';
import { refreshMarkets } from '$lib/utils/refresh.utils';
import { parseMarketId } from '$lib/validation/market.validation';
import { isWeb2Backend } from '$lib/web2/backend-mode';
import {
	getEngineSeries as getEngineSeriesWeb2,
	getEngineSettlementStatus as getEngineSettlementStatusWeb2,
	listEngineSeriesVolumes as listEngineSeriesVolumesWeb2,
	listEngineSeries as listEngineSeriesWeb2
} from '$lib/web2/client';
import { getWeb2User } from '$lib/web2/session';
import { isEmptyString, isNullish, nonNullish, notEmptyString, toNullable } from '@dfinity/utils';
import type { Identity } from '@icp-sdk/core/agent';

/**
 * Creates a new prediction market.
 * Only Admins and Creators are authorized.
 */
export const createMarket = async ({
	title,
	resolution,
	description,
	expiryDate,
	outcomes = [],
	payoutUnit: payoutUnitOverride,
	socialReward,
	balanceDomain,
	tradingAccess = [{ Open: null }],
	locale
}: {
	title: string;
	/**
	 * The compulsory on-chain settlement clause (`Resolution.clause`) stating
	 * how this market resolves. The registry rejects an empty or over-long
	 * clause (`ResolutionClauseEmpty` / `ResolutionClauseTooLong`); callers must
	 * supply a non-empty value, which is trimmed and capped at
	 * {@link RESOLUTION_CLAUSE_MAX_LENGTH} here.
	 */
	resolution: string;
	/**
	 * Free-text descriptive blurb. Optional — when omitted (or blank) it falls
	 * back to the {@link resolution} clause, since `AddSeriesParams.description`
	 * is still a required field on chain.
	 */
	description?: string;
	expiryDate: bigint;
	outcomes?: string[];
	payoutUnit?: RegistryDid.PayoutUnit;
	socialReward?: { title: string; description?: string; iconUrl?: string };
	balanceDomain: RegistryDid.BalanceDomain;
	tradingAccess?: RegistryDid.TradingAccess[];
	/**
	 * BCP 47 source language of `title`, `description`, `outcomes`, and
	 * `socialReward`. Stored as metadata on the registry; the canister never
	 * stores translations and treats `None` as `"en"` by default. Off-chain
	 * translations (see `MARKET_TRANSLATIONS` collection) overlay this source
	 * for each user's preferred locale.
	 */
	locale?: AppLocale;
}): Promise<string> => {
	const identity = await safeGetIdentityOnce();

	const domain = balanceDomain;
	const payoutUnit: RegistryDid.PayoutUnit = nonNullish(socialReward)
		? {
				NonMonetary: {
					Social: {
						title: socialReward.title,
						description: toNullable(socialReward.description),
						icon_url: toNullable(socialReward.iconUrl)
					}
				}
			}
		: (payoutUnitOverride ?? { Fiat: { Usd: null } });

	const profileDoc = await getProfile(identity.getPrincipal().toText());

	const { role } = profileDoc.data;
	const isSocialMarket = 'Social' in domain;
	const isEngineCreator = role === UserRole.ADMIN || role === UserRole.CREATOR;

	if (!isEngineCreator && !isSocialMarket) {
		throw new Error(
			'Unauthorized: only admins or creators can create financial markets. ' +
				'Regular users may only create social (bragging-stakes) challenges.'
		);
	}

	// Mirrors the on-chain invariant enforced by the registry (`SocialMarketMustBeRestricted`):
	// a Social market must have at least one `Restricted` policy and may not contain `Open`.
	// Catching it here surfaces a deterministic error to callers instead of an opaque
	// `Failed to add series: {SocialMarketMustBeRestricted: null}` from the canister.
	if (
		isSocialMarket &&
		(tradingAccess.length === 0 || !tradingAccess.every((ta) => 'Restricted' in ta))
	) {
		throw new Error(
			'Social challenges must be restricted to a group (friends or a custom group). ' +
				'Public social challenges are not supported by the registry.'
		);
	}

	const underlying = title
		.trim()
		.toUpperCase()
		.replace(/\s+/g, '_')
		.replace(/[^A-Z0-9_-]/g, '');

	// The registry requires a non-empty resolution clause on every series, so
	// trim + cap it to mirror `ResolutionClauseEmpty` / `ResolutionClauseTooLong`.
	// Fail fast on a blank clause rather than letting the canister reject it.
	const resolutionClause = resolution.trim().slice(0, RESOLUTION_CLAUSE_MAX_LENGTH);

	if (isEmptyString(resolutionClause)) {
		throw new Error('A market requires a non-empty resolution clause.');
	}

	// `description` is optional for callers; on chain it is still required, so
	// fall back to the resolution clause when no blurb is provided.
	const trimmedDescription = description?.trim();
	const descriptionText = notEmptyString(trimmedDescription)
		? trimmedDescription
		: resolutionClause;

	const params: RegistryDid.AddSeriesParams = {
		underlying,
		title,
		description: {
			plain: descriptionText,
			markdown: toNullable(),
			html: toNullable()
		},
		resolution: { clause: resolutionClause },
		expiry_ns: expiryDate * MILLISECOND_IN_NANOSECONDS,
		// `None` registers the series as already live (no future trading-open gate);
		// Vici markets open immediately and close at `expiry_ns`.
		start_ns: toNullable(),
		payout_unit: payoutUnit,
		strike: STRIKE,
		icon_url: toNullable(),
		banner_url: toNullable(),
		price_precision: PRICE_DECIMALS,
		payoff_type: outcomes.length > 0 ? { Categorical: null } : PAYOFF_TYPE,
		outcomes: toNullable(
			outcomes.length > 0
				? outcomes.map((o) => ({
						id: o.trim().toLowerCase().replace(/\s+/g, '-'),
						title: o,
						description: toNullable(),
						icon_url: toNullable()
					}))
				: undefined
		),
		balance_domain: domain,
		oracle_source: VICI_ORACLE_V1,
		trading_access: tradingAccess,
		// Engine tier vs. Social tier on the registry is selected by the presence of
		// `engine_id`. Engine Creators (ADMIN/CREATOR) go through `CreationTier::Creator`
		// on `eng_0`. Regular users creating a Social market must send `None` so the
		// call routes to `CreationTier::Social` instead of being rejected with
		// `EngineRoleNotHeld`.
		engine_id: isEngineCreator ? toNullable(VICI_ENGINE_ID) : toNullable(),
		// BCP 47 source language of the human-readable fields above. `undefined`
		// → `None` on chain, which the canister treats as `"en"`.
		locale: toNullable(locale)
	};

	const seriesId = await addSeries({
		identity,
		params
	});

	await logActivity({
		type: ActivityType.TRADE,
		user: identity.getPrincipal().toText(),
		marketId: seriesId,
		title: `Market created: ${title}`,
		details: descriptionText
	});

	refreshMarkets();

	return seriesId;
};

/**
 * Core market-loading logic: series + enrichment + resolution merge.
 *
 * Accepts an explicit `identity` and `certified` flag so the caller can run this
 * once as an uncertified query (fast) and/or once as a certified update (verified).
 * Callers thread that flag per use: {@link loadMarketsProgressive} and
 * {@link fetchMarketsLite} run uncertified, while {@link getMarketsLite} forces
 * certified for set reads that must match a certified counterpart.
 *
 * Note: Juno-backed calls (`getSettlementActivities`) honor the same flag but tap
 * the satellite datastore, not an ICDC canister.
 */
const fetchMarkets = async ({
	identity,
	certified,
	domain,
	includeOrderBook = true
}: {
	identity: Identity;
	certified: boolean;
	domain: RegistryDid.BalanceDomain;
	// When `false`, skip the per-market `getOrderBook` round-trip and leave
	// probability unknown (no placeholder). Callers that only need the market *set*
	// (id / domain / status / outcome) for filtering — positions, trade
	// history, the calibration deck — pass `false` to avoid an N-wide
	// order-book fan-out they'd immediately discard (see {@link getMarketsLite}).
	includeOrderBook?: boolean;
}): Promise<Market[]> => {
	const [allSeries, settledIds, settlementActivities] = await Promise.all([
		// The catalog is a public engine read: web2 routes it through the HTTP
		// bridge (which runs the same anonymous registry query server-side);
		// the default path is the untouched on-chain call.
		isWeb2Backend() ? listEngineSeriesWeb2() : listSeries({ identity, certified }),
		getSettledSeriesIds({ identity, certified }),
		getSettlementActivities({ certified })
	]);

	// TODO(temporary): until multiple-choice (categorical) markets are fully
	// supported across the UI, only surface binary (boolean) markets. Check the
	// variant explicitly so Call / Put / future payoff types stay out too.
	// Remove this filter to restore non-binary markets.
	const seriesList = allSeries.filter((s) => 'Binary' in s.payoff_type);

	const resolutionMap = buildResolutionMap(settlementActivities);

	const markets = await Promise.all(
		seriesList.map(async (s) => {
			const mid = parseMarketId(s.series_id);
			const isCategorical = 'Categorical' in s.payoff_type;
			const isResolved = settledIds.has(s.series_id);
			const isExpired = s.expiry_ns / MILLISECOND_IN_NANOSECONDS <= BigInt(Date.now());

			// Clearing's `list_settled_series` is the authoritative resolved
			// predicate (a series is settled the moment a settlement plan opens).
			// The `SETTLEMENT` activity row only supplies the outcome label,
			// best-effort: deriving `Resolved` from the bounded ACTIVITIES page
			// made markets "un-resolve" once newer activity pushed the row out
			// of the window.
			const status: MarketStatus = isResolved ? 'Resolved' : isExpired ? 'Expired' : 'Open';
			const { outcome, resolvedAt } = isResolved
				? (resolutionMap[s.series_id] ?? {})
				: { outcome: undefined, resolvedAt: undefined };

			// Lite mode: callers that only filter by the market set don't need
			// book-derived prices. Leave probability unknown (no 0.5 placeholder)
			// and `priceLoaded` false so the UI shows a loading skeleton until a
			// real book read fills it in.
			if (!includeOrderBook) {
				return mapMarketData({
					series: s,
					status,
					outcome,
					resolvedAt
				});
			}

			if (isCategorical && nonNullish(s.outcomes?.[0])) {
				const orders = await listOrdersApi({
					identity,
					certified,
					params: { series_id: toNullable(mid) }
				});
				const categoricalProbabilities = calculateCategoricalProbabilities({
					outcomes: s.outcomes[0],
					orders
				});

				return mapMarketData({
					series: s,
					priceLoaded: true,
					status,
					outcome,
					resolvedAt,
					categoricalProbabilities
				});
			}

			const orders = await getOrderBook({
				marketId: mid,
				domain: s.balance_domain,
				identity,
				certified
			});
			const { midPrice, bids, asks } = calculateMarketStats({
				orders,
				outcome: 'YES'
			});

			// `midPrice` is undefined for an empty book — keep it unknown (no 0.5
			// placeholder); `priceLoaded: true` marks the book as read so the UI
			// shows a no-liquidity dash rather than a perpetual skeleton.
			return mapMarketData({
				series: s,
				yesProbability: midPrice,
				noProbability: nonNullish(midPrice) ? 1 - midPrice : undefined,
				priceLoaded: true,
				bestBid: bids[0]?.price,
				bestAsk: asks[0]?.price,
				bestBidQty: bids[0]?.totalQty,
				bestAskQty: asks[0]?.totalQty,
				status,
				outcome,
				resolvedAt
			});
		})
	);

	// Derive from the unfiltered list: a resolved non-binary series still in
	// `listSeries` is already accounted for, so skip a redundant `getSeries`
	// fetch that the `Binary` guard below would only discard.
	const activeSeriesIds = new Set(allSeries.map((s) => s.series_id));

	const resolvedMarkets = await Promise.all(
		[...settledIds]
			.filter((id) => !activeSeriesIds.has(id))
			.map(async (id) => {
				const series = isWeb2Backend()
					? await getEngineSeriesWeb2(id)
					: await getSeries({ identity, certified, seriesId: id });

				if (isNullish(series)) {
					return;
				}

				// See the binary-only TODO above: skip settled non-binary series too.
				if (!('Binary' in series.payoff_type)) {
					return;
				}

				const { outcome: resolvedOutcome, resolvedAt } = resolutionMap[id] ?? {};
				const yesWon = resolvedOutcome === 'YES';

				return mapMarketData({
					series,
					yesProbability: nonNullish(resolvedOutcome) ? (yesWon ? 1 : 0) : undefined,
					noProbability: nonNullish(resolvedOutcome) ? (yesWon ? 0 : 1) : undefined,
					priceLoaded: true,
					status: 'Resolved',
					outcome: resolvedOutcome,
					resolvedAt
				});
			})
	);

	const items = [...markets, ...resolvedMarkets].filter(nonNullish);

	return filterByPlaygroundExpandedDomain({ items, targetDomain: domain });
};

/**
 * Builds a `ListSeriesParams` that asks the registry for the
 * still-tradeable (unexpired) catalog, with every other filter left open.
 * `only_unexpired: toNullable(true)` tells the canister to drop expired
 * series using its own clock; pagination is left unset so the canister-side
 * paginator
 * (drained in {@link RegistryCanister.listSeries}) returns the full set.
 */
const unexpiredSeriesParams = (): RegistryDid.ListSeriesParams => ({
	strike: toNullable(),
	creator: toNullable(),
	payoff_type: toNullable(),
	payout_unit: toNullable(),
	pagination: toNullable(),
	underlying: toNullable(),
	only_unexpired: toNullable(true),
	// `None` applies no extra window filter — `only_unexpired` already drops
	// expired series, and Vici series carry no future start gate.
	tradeable_now: toNullable(),
	search_term: toNullable(),
	balance_domain: toNullable(),
	oracle_source: toNullable()
});

/**
 * Cheap variant of {@link fetchMarkets} used by the Flow ranking path:
 * builds `Market` view-models straight from the *open* series set,
 * *without* a per-market `getOrderBook` call.
 *
 * Open is derived server-side as `unexpired − settled`:
 *   - the registry's `list_series_with({ only_unexpired: true })` drops
 *     expired series using the canister's own clock (the expiry half of
 *     the "currently tradeable" predicate), and
 *   - clearing's `list_settled_series` is the authoritative resolved set,
 *     subtracted here.
 *
 * This replaces the previous reconstruction that pulled every series and
 * scanned the (capped) global ACTIVITIES log for settlement events — the
 * root cause of Flow-mode slowness, and unsound besides since the activity
 * page was bounded while the catalog was not.
 *
 * Combined with the lazy order-book fetch (ranking only needs tags /
 * metadata / interests, so the orderbook stays unfetched until
 * {@link enrichMarketsWithOrderBook} runs on the top-N winners), this keeps
 * `/flow` entry off the N+1 fan-out.
 */
const fetchOpenBinaryMarketsLite = async ({
	identity,
	certified,
	domain
}: {
	identity: Identity;
	certified: boolean;
	domain: RegistryDid.BalanceDomain;
}): Promise<Market[]> => {
	// Both reads are server-filtered and paginated. The unexpired candidate
	// set is the registry's expiry-filtered catalog; the settled set is
	// clearing's authoritative resolved ids. Domain scoping stays client-side
	// via `filterByPlaygroundExpandedDomain` because ViciXp expands to include
	// Social — narrowing either query by a single `balance_domain` would drop
	// the Social half of the playground feed.
	const [unexpiredSeries, settledIds] = await Promise.all([
		// web2 asks the HTTP bridge for the tradeable-now catalog, which equals
		// the on-chain `only_unexpired` read for this app's series (none carries
		// a future start gate, so tradeable-now reduces to unexpired).
		isWeb2Backend()
			? listEngineSeriesWeb2({ tradeableNow: true })
			: listSeries({ identity, certified, params: unexpiredSeriesParams() }),
		getSettledSeriesIds({ identity, certified })
	]);

	const markets = unexpiredSeries
		.filter((s) => {
			// Flow only shows Binary markets. Check the variant
			// explicitly so Call / Put / future payoff types stay out.
			const isBinary = 'Binary' in s.payoff_type;

			return isBinary && !settledIds.has(s.series_id);
		})
		// Lite mapping: leave probability unknown (`priceLoaded` false) so a card
		// awaiting `enrichMarketsWithOrderBook` shows a loading skeleton instead
		// of a 0.5 placeholder. The price cache may still seed a last-known value
		// downstream (see `loadMarketsProgressive`).
		.map((s) => mapMarketData({ series: s, status: 'Open' }))
		.filter(nonNullish);

	return filterByPlaygroundExpandedDomain({ items: markets, targetDomain: domain });
};

/**
 * Adds book-derived fields (`yesProbability`, `noProbability`,
 * `bestBid`/`bestAsk`) to lite `Market` objects (from
 * {@link fetchOpenBinaryMarketsLite} or {@link fetchMarketsLite}). Callers
 * pass a bounded slice — the Flow deck's top-N, or one
 * {@link loadMarketsProgressive} batch — so we never fan out one request per
 * open series at once.
 */
const enrichMarketsWithOrderBook = async ({
	markets,
	identity,
	certified
}: {
	markets: Market[];
	identity: Identity;
	certified: boolean;
}): Promise<Market[]> => {
	const priced: { id: MarketId; yesProbability: number }[] = [];

	const enriched = await Promise.all(
		markets.map(async (market) => {
			const orders = await getOrderBook({
				marketId: market.id,
				domain: market.balanceDomain,
				identity,
				certified
			}).catch((e: unknown) => {
				// A single failed book read should not collapse the whole deck — let
				// the rest of the cards render. The failing market keeps its unknown
				// probability but is marked `priceLoaded` below, so it shows a
				// no-liquidity dash, never a 0.5 placeholder.
				console.error('Failed to fetch order book for flow market', market.id, e);

				return [] as Awaited<ReturnType<typeof getOrderBook>>;
			});

			const { midPrice, bids, asks } = calculateMarketStats({
				orders,
				outcome: 'YES'
			});

			// `midPrice` is undefined for an empty/failed book — keep it unknown.
			// Only a liquidity-backed mid goes to the persisted seed cache, so a
			// placeholder never clobbers a real last-known price.
			if (nonNullish(midPrice)) {
				priced.push({ id: market.id, yesProbability: midPrice });
			}

			return {
				...market,
				yesProbability: midPrice,
				noProbability: nonNullish(midPrice) ? 1 - midPrice : undefined,
				priceLoaded: true,
				bestBid: bids[0]?.price,
				bestAsk: asks[0]?.price,
				bestBidQty: bids[0]?.totalQty,
				bestAskQty: asks[0]?.totalQty
			};
		})
	);

	cacheMarketPrices(priced);

	return enriched;
};

/**
 * Extracts a `seriesId -> { outcome, resolvedAt }` label map from Juno
 * SETTLEMENT activities. Details are expected to be stringified JSON
 * (`{ outcome, price }`); `resolvedAt` is the activity's own timestamp.
 *
 * Only the outcome *label* and its time come from here — the resolved predicate
 * itself is clearing's `list_settled_series` (see {@link fetchMarkets}) — so a
 * missing or malformed row degrades to `Resolved` with no winner badge, never to
 * an unresolved market. Rows are absent entirely for series settled outside this
 * app's admin flow, and the page is bounded; {@link backfillResolutionOutcomes}
 * repairs both cases from clearing.
 */
const buildResolutionMap = (activities: Activity[]): Record<string, SettlementDetails> =>
	activities
		.filter((a) => a.type === ActivityType.SETTLEMENT && nonNullish(a.marketId))
		.reduce<Record<string, SettlementDetails>>((acc, a) => {
			const { marketId, details, timestamp } = a;

			if (!nonNullish(marketId)) {
				return acc;
			}

			acc[marketId] = {
				outcome: parseSettlementOutcome(details),
				resolvedAt: BigInt(timestamp)
			};

			return acc;
		}, {});

/**
 * Order-book-free fetch: returns the domain-scoped binary market set (open +
 * resolved) but skips the per-market `getOrderBook` fan-out. The price-bearing
 * list path is {@link loadMarketsProgressive} (instant lite render, then
 * background book enrichment).
 *
 * For callers that consume only the market *set* — `id`, `balanceDomain`,
 * `status`, `outcome`, `engineId`, `payoffType` — to filter their own data:
 * positions, trade history, and the calibration deck. These ran the full
 * fan-out purely to derive an id set, multiplying first-load cost by the
 * catalog size; this skips it. Probability fields are NOT meaningful here —
 * open series are seeded neutral 0.5, resolved series keep `mapMarketData`'s
 * defaults — so callers must not read them.
 *
 * Certification is threaded so this composes with `queryAndUpdate`: the
 * uncertified query pass and the certified update pass each fetch the market
 * set at their own level, keeping it in lockstep with the positions / events
 * read it's filtered against (no tearing) without forcing the fast pass to
 * block on a certified catalog. See {@link getMarketsLite} for the one-shot
 * certified variant.
 */
export const fetchMarketsLite = (params: {
	identity: Identity;
	certified: boolean;
	domain: RegistryDid.BalanceDomain;
}): Promise<Market[]> => fetchMarkets({ ...params, includeOrderBook: false });

/**
 * One-shot, certified {@link fetchMarketsLite} for callers outside a
 * `queryAndUpdate` flow (e.g. the calibration deck, which must match a
 * certified settled-id read).
 */
export const getMarketsLite = async (domain: RegistryDid.BalanceDomain): Promise<Market[]> => {
	const identity = await getIdentityOrAnonymous();

	return fetchMarketsLite({ identity, certified: true, domain });
};

// How many order-book reads the progressive list enrichment runs at once. The
// list can span the whole catalog, so an unbounded `Promise.all` would open a
// request per open market and saturate the browser's per-host connection pool
// during the cold-load burst — the very contention this path exists to avoid.
/**
 * Rescales an engine traded-volume figure — whole payout-token notional in
 * `USD_DECIMALS` base units — to a market's own token precision, so it formats
 * like the rest of the UI's `totalVolume` (and matches the detail page's
 * volume). Identity for the common 4-decimal token; only ICP-style 8-decimal
 * markets actually shift.
 */
const scaleVolumeToTokenBase = ({
	usdBaseVolume,
	tokenDecimals
}: {
	usdBaseVolume: bigint;
	tokenDecimals: number;
}): bigint => {
	const diff = tokenDecimals - USD_DECIMALS;

	if (diff === 0) {
		return usdBaseVolume;
	}

	return diff > 0
		? usdBaseVolume * BigInt(10) ** BigInt(diff)
		: usdBaseVolume / BigInt(10) ** BigInt(-diff);
};

/**
 * Fills in each market's `totalVolume` from the engine's market-wide traded
 * volume (Σ qty·price), read for the whole set in a single batch call rather
 * than a per-market round-trip. The figure returns in `USD_DECIMALS` base units
 * and is rescaled to each market's token precision. Fails open: any error
 * leaves the markets' existing `totalVolume` untouched, so the list still
 * renders (cards fall back to the "New" cue).
 *
 * No-op for the anonymous identity: `list_series_traded_volumes` is guarded by
 * `caller_is_not_anonymous`, so a signed-out call can only reject — short-circuit
 * it so a logged-out visitor (e.g. the public homepage feed) paints instantly on
 * the seeded volume rather than waiting on a round-trip that can't succeed.
 */
const enrichMarketsWithVolume = async ({
	markets,
	identity,
	certified
}: {
	markets: Market[];
	identity: Identity;
	certified: boolean;
}): Promise<Market[]> => {
	// The anonymous short-circuit is on-chain-only: the HTTP bridge exposes the
	// volumes read publicly (its server-side call is not anonymous), so web2
	// mode, which holds no signing identity at all, must not skip it.
	if (markets.length === 0 || (!isWeb2Backend() && identity.getPrincipal().isAnonymous())) {
		return markets;
	}

	try {
		const volumes = isWeb2Backend()
			? await listEngineSeriesVolumesWeb2(markets.map(({ id }) => id))
			: await listSeriesTradedVolumesApi({
					identity,
					certified,
					seriesIds: markets.map(({ id }) => id)
				});

		const volumeById = new Map(volumes.map(({ series_id, volume }) => [series_id, volume]));

		return markets.map((market) => {
			const usdBaseVolume = volumeById.get(market.id);

			return isNullish(usdBaseVolume)
				? market
				: {
						...market,
						totalVolume: scaleVolumeToTokenBase({
							usdBaseVolume,
							tokenDecimals: market.token.decimals
						})
					};
		});
	} catch {
		return markets;
	}
};

const MARKETS_ENRICH_BATCH_SIZE = 8;

/**
 * Progressive markets-list loader. Renders instantly from the order-book-free
 * lite set — so first paint and the rest of the shell's cold-load aren't
 * blocked on a catalog-wide book fan-out — then fills in book-derived prices in
 * the background, a bounded batch at a time, invoking `onUpdate` after each so
 * the list "fills in" top-first.
 *
 * Uncertified throughout: the list is a browse surface where the approximate
 * consensus % is enough, and the sort key (`totalVolume`) is series-derived, so
 * prices arriving late never reorder rows. The certified order book is fetched
 * per-market by the detail page ({@link loadMarket}) at trade time, where trust
 * actually matters. This replaces the prior `queryAndUpdate` loader that ran a
 * per-market `getOrderBook` across the whole catalog *twice* (uncertified +
 * certified) on every refresh.
 *
 * `previous` (the caller's last-known set) carries prices forward so a refresh
 * doesn't flash every row back to the neutral 0.5 before re-enriching; pass it
 * omitted/empty for a cold load (or a balance-domain switch, where the prior
 * domain's prices must not leak). Markets without an in-memory prior seed from
 * the persisted last-session prices instead (see `market-price-cache.utils`),
 * so a page refresh paints last-known consensus rather than a wall of 50% —
 * keyed by globally-unique market id, so a domain switch can't surface another
 * domain's price.
 *
 * `isStale` lets the caller abort a run superseded by a balance-domain switch
 * before it writes a stale slice.
 */
/**
 * Fills in the winning outcome for resolved markets the `SETTLEMENT` activity
 * log left unlabelled, reading clearing's authoritative settlement input.
 *
 * Without this a market settled outside the admin UI — or one whose activity row
 * aged out of the bounded page — renders as a permanent "Unknown" badge, and its
 * holders' settled positions can't be priced (`position.utils` needs the
 * outcome). Scoped to the unlabelled subset, so the common case costs nothing;
 * fails open, returning the input rows unchanged when clearing can't be read.
 *
 * Also pins the resolved market's probabilities to its recovered outcome, the
 * same way the phase-1 seeding does for markets that arrived already labelled.
 */
const backfillResolutionOutcomes = async ({
	markets,
	identity,
	certified
}: {
	markets: Market[];
	identity: Identity;
	certified: boolean;
}): Promise<Market[]> => {
	const unlabelled = markets.filter(
		({ status, outcome }) => status === 'Resolved' && isNullish(outcome)
	);

	if (unlabelled.length === 0) {
		return markets;
	}

	const details = await loadSettlementOutcomes({
		seriesIds: unlabelled.map(({ id }) => id),
		identity,
		certified
	});

	if (details.size === 0) {
		return markets;
	}

	return markets.map((market) => {
		const detail = details.get(market.id);

		if (isNullish(detail) || isNullish(detail.outcome)) {
			return market;
		}

		const yesWon = detail.outcome === 'YES';

		return {
			...market,
			outcome: detail.outcome,
			resolvedAt: detail.resolvedAt ?? market.resolvedAt,
			yesProbability: yesWon ? 1 : 0,
			noProbability: yesWon ? 0 : 1,
			priceLoaded: true
		};
	});
};

export const loadMarketsProgressive = async ({
	domain,
	onUpdate,
	previous,
	isStale
}: {
	domain: RegistryDid.BalanceDomain;
	onUpdate: (markets: Market[]) => void;
	previous?: Market[];
	isStale?: () => boolean;
}): Promise<void> => {
	const identity = await getIdentityOrAnonymous();

	// Phase 1 — instant render from the order-book-free set (open + resolved).
	const lite = await fetchMarkets({ identity, certified: false, domain, includeOrderBook: false });

	if (isStale?.()) {
		return;
	}

	// Seed each row's book-derived fields before enrichment:
	//  - a resolved market with a known outcome renders deterministically from
	//    that outcome (YES won → 100/0, NO won → 0/100) — no order-book read;
	//  - everything else overlays last-known prices from `previous` so a refresh
	//    doesn't flash priced rows back to a skeleton while re-enrichment runs;
	//  - with no in-memory prior (cold load, page refresh), the persisted
	//    last-session price takes over — probability only, since stale bid/ask
	//    depth must not masquerade as live liquidity — and a genuinely new market
	//    keeps its unknown probability, rendering a skeleton until enrichment.
	const priceById = new Map((previous ?? []).map((market) => [market.id, market]));
	const cachedYesById = readCachedYesProbabilities();
	const seeded = lite.map((market) => {
		if (market.status === 'Resolved' && nonNullish(market.outcome)) {
			const yesWon = market.outcome === 'YES';

			return {
				...market,
				yesProbability: yesWon ? 1 : 0,
				noProbability: yesWon ? 0 : 1,
				priceLoaded: true
			};
		}

		const prior = priceById.get(market.id);

		if (nonNullish(prior)) {
			return {
				...market,
				yesProbability: prior.yesProbability,
				noProbability: prior.noProbability,
				priceLoaded: prior.priceLoaded,
				bestBid: prior.bestBid,
				bestAsk: prior.bestAsk,
				bestBidQty: prior.bestBidQty,
				bestAskQty: prior.bestAskQty,
				// Carry the last-known volume so a refresh keeps the figure (and the
				// volume-sorted order) until the fresh batch read overwrites it.
				totalVolume: prior.totalVolume
			};
		}

		// A cached last-session price is enough to show a number immediately (no
		// skeleton); enrichment upgrades it in place. With no cache the row keeps
		// its unknown probability and renders a skeleton until enrichment lands.
		const cachedYes = cachedYesById.get(market.id);

		return isNullish(cachedYes)
			? market
			: { ...market, yesProbability: cachedYes, noProbability: 1 - cachedYes };
	});

	// Phase 1.5 — one batch read fills in real traded volume before first paint,
	// so the volume-sorted list lands in its final order instead of reshuffling
	// when volume arrives. Fails open (keeps the seeded / last-known volume).
	const withVolume = await enrichMarketsWithVolume({ markets: seeded, identity, certified: false });

	if (isStale?.()) {
		return;
	}

	onUpdate(withVolume);

	// Phase 1.75 — repair resolved markets the activity log couldn't label, from
	// clearing. Runs behind the painted list and only over the unlabelled subset,
	// so a healthy catalog pays nothing.
	const repaired = await backfillResolutionOutcomes({
		markets: withVolume,
		identity,
		certified: false
	});

	if (isStale?.()) {
		return;
	}

	onUpdate(repaired);

	// Phase 2 — background book enrichment for every non-resolved market (open
	// *and* expired-but-unresolved both carry a live/last book the list prices
	// off). Resolved markets are skipped: they're already pinned to their
	// outcome above. Built on the volume-enriched set, whose `totalVolume` the
	// book enrichment preserves (it only overlays price/book fields).
	const enriched = [...repaired];
	const indexById = new Map(repaired.map((market, index) => [market.id, index]));
	const pending = repaired.filter((market) => market.status !== 'Resolved');

	for (let start = 0; start < pending.length; start += MARKETS_ENRICH_BATCH_SIZE) {
		if (isStale?.()) {
			return;
		}

		const batch = await enrichMarketsWithOrderBook({
			markets: pending.slice(start, start + MARKETS_ENRICH_BATCH_SIZE),
			identity,
			certified: false
		});

		for (const market of batch) {
			const index = indexById.get(market.id);

			if (nonNullish(index)) {
				enriched[index] = market;
			}
		}

		onUpdate([...enriched]);
	}
};

/**
 * Core single-market fetch: threads identity + certified so it composes with
 * {@link loadMarket} / `queryAndUpdate`.
 */
const fetchMarket = async ({
	identity,
	certified,
	marketId
}: {
	identity: Identity;
	certified: boolean;
	marketId: MarketId;
}): Promise<Market | undefined> => {
	// Series + settlement are public engine reads with a web2 HTTP path; the
	// order book has no HTTP surface yet and stays an anonymous on-chain query
	// on both transports (it is publicly readable, so web2 mode still prices).
	const [s, rawOrders, settlementStatus] = await Promise.all([
		isWeb2Backend()
			? getEngineSeriesWeb2(marketId)
			: getSeries({ identity, certified, seriesId: marketId }),
		// In web2 mode the book is the page's only on-chain read, next to two
		// HTTP ones: a failed book read prices the market as unknown (empty
		// book) instead of failing the whole detail and blanking the page.
		isWeb2Backend()
			? getOrderBook({ marketId, identity, certified }).catch((err: unknown) => {
					console.warn('market detail: order book read failed, pricing as unknown', err);

					return [];
				})
			: getOrderBook({ marketId, identity, certified }),
		isWeb2Backend()
			? getEngineSettlementStatusWeb2(marketId)
			: getSettlementStatus({ identity, certified, seriesId: marketId })
	]);

	const { midPrice, bids, asks } = calculateMarketStats({
		orders: rawOrders,
		outcome: 'YES'
	});

	const bestBid = bids[0]?.price;
	const bestAsk = asks[0]?.price;
	const bestBidQty = bids[0]?.totalQty;
	const bestAskQty = asks[0]?.totalQty;

	if (isNullish(s)) {
		return;
	}

	const isCategorical = 'Categorical' in s.payoff_type;
	const categoricalProbabilities: Record<string, number> | undefined =
		isCategorical && nonNullish(s.outcomes?.[0])
			? calculateCategoricalProbabilities({
					outcomes: s.outcomes[0],
					orders: await listOrdersApi({
						identity,
						certified,
						params: { series_id: toNullable(marketId) }
					})
				})
			: undefined;

	// Clearing's settlement view exists from the moment a settlement plan opens
	// — same predicate as the list path's `list_settled_series` — and carries
	// the authoritative settlement input the winning outcome derives from.
	const status: MarketStatus = nonNullish(settlementStatus)
		? 'Resolved'
		: s.expiry_ns / MILLISECOND_IN_NANOSECONDS <= BigInt(Date.now())
			? 'Expired'
			: 'Open';
	const outcome: Outcome | undefined = nonNullish(settlementStatus)
		? settlementInputOutcome(settlementStatus.settlement)
		: undefined;
	const resolvedAt = nonNullish(settlementStatus)
		? settlementInputTimestamp(settlementStatus.settlement)
		: undefined;

	// Resolved markets pin to their outcome (YES won → 1, NO won → 0); everything
	// else uses the live book mid, left unknown for an empty book (no 0.5
	// placeholder). `priceLoaded: true` — this path always reads the book.
	const isResolvedOutcome = status === 'Resolved' && nonNullish(outcome);
	const yesProbability = isResolvedOutcome ? (outcome === 'YES' ? 1 : 0) : midPrice;
	const noProbability = nonNullish(yesProbability) ? 1 - yesProbability : undefined;

	return mapMarketData({
		series: s,
		yesProbability,
		noProbability,
		priceLoaded: true,
		bestBid,
		bestAsk,
		bestBidQty,
		bestAskQty,
		status,
		outcome,
		resolvedAt,
		categoricalProbabilities
	});
};

/**
 * Single-market detail with book, categorical probabilities if applicable, and
 * resolution status from clearing's `get_settlement_status`.
 *
 * Performs a single certified update. Prefer {@link loadMarket} for UI flows
 * that should render fast then upgrade once verified.
 */
export const getMarket = async (marketId: MarketId): Promise<Market | undefined> => {
	const identity = await getIdentityOrAnonymous();

	return fetchMarket({ identity, certified: true, marketId });
};

/**
 * Callback-based variant of {@link getMarket} that fires `onLoad` up to twice:
 * once for the uncertified query, then again for the certified update. Stale
 * query responses that arrive after the update has settled are dropped by the
 * underlying `queryAndUpdate`.
 */
export const loadMarket = ({
	marketId,
	onLoad,
	onUpdateError
}: {
	marketId: MarketId;
	onLoad: (options: { certified: boolean; response: Market | undefined }) => void;
	onUpdateError?: (error: unknown) => void;
}): Promise<void> =>
	loadWithCertification<Market | undefined>({
		request: ({ certified, identity }) => fetchMarket({ identity, certified, marketId }),
		onLoad,
		onUpdateError
	});

/**
 * Editorial-boost magnitude for markets flipped to `suggested = true`.
 * Sits above the interest tier (1000) and the culture-fallback tier
 * (500) so a single admin flag dominates every organic ranking signal
 * — but stays additive, so two suggested markets still order by
 * volume / liquidity / recency between themselves.
 */
const SUGGESTED_BOOST_BASE = 5000;

/**
 * Linear decay window for the suggested boost. After this many ms the
 * editorial weight is fully gone and the market falls back to its
 * organic rank — no admin maintenance required to un-suggest stale
 * picks. Tracked from `metadata.updatedAt` (set on every metadata
 * upsert in `market-metadata.services.ts`).
 */
const SUGGESTED_DECAY_MS = 14 * DAY_IN_MS;

/**
 * Resolves the editorial-boost score for a market. Returns `0` for any
 * of the three "should not promote" cases:
 *   - no metadata, or `suggested === false`
 *   - the market is no longer Open (auto-drop on `Expired` / `Resolved`)
 *   - the boost has fully decayed (older than {@link SUGGESTED_DECAY_MS})
 *
 * Exported so the "Suggested for you" rail (which only wants markets
 * with a non-zero current boost) reuses the same gating rules as the
 * sort tier — single source of truth, no chance of the rail showing a
 * market that the sort already let fall off the top.
 */
export const suggestedScore = ({
	market,
	metadata,
	nowMs = Date.now()
}: {
	market: Market;
	metadata: MarketMetadata | undefined;
	nowMs?: number;
}): number => {
	if (!metadata?.suggested) {
		return 0;
	}

	if (market.status !== 'Open') {
		return 0;
	}

	const ageMs = Math.max(0, nowMs - metadata.updatedAt);
	const remaining = 1 - ageMs / SUGGESTED_DECAY_MS;

	if (remaining <= 0) {
		return 0;
	}

	return SUGGESTED_BOOST_BASE * remaining;
};

/**
 * Score multiplier applied to the Flow markets tied to the user's
 * favourite team (`preferences.favoriteParticipantId`) — a 60% score
 * boost that lifts their country higher in the World Cup deck ranking
 * (a deterministic sort, not a probabilistic draw). See `rankMarkets`.
 */
export const FAVORITE_COUNTRY_BOOST = 1.6;

/**
 * Ranks markets by editorial signal first (admin-flipped `suggested`,
 * linearly decayed over 14 days and auto-dropped on resolve), then
 * user interest, then a culture-fallback boost (so users with no
 * declared interests still get a meaningful feed), with `createdAt`
 * as the final tie-breaker.
 *
 * Earlier revisions also weighted `volumeScore` and `liquidityScore`.
 * Both were removed: `volumeScore` keyed off `Market.totalVolume`,
 * which `mapMarketData` hardcodes to `ZERO` (the field is never
 * populated upstream), so it never contributed. `liquidityScore`
 * needed `bestBid` / `bestAsk`, which the Flow path no longer fetches
 * until *after* ranking — see `getFlowQueue` +
 * `enrichFlowMarketsWithOrderBook`. The dropped tier was a 100-point
 * flag dwarfed by the interest (1000) and suggested (~5000) tiers, so
 * the top-N ordering is effectively unchanged.
 *
 * `tagMappings` is the `seriesId → MarketTag[]` projection produced by
 * {@link listMarketTagsBySeries}; a market matches user interest when
 * *any* of its tags is in the user's declared interest set. The
 * `culture` boost is unchanged from the legacy single-category logic —
 * it now fires when the market carries the `culture` tag and the user
 * either has no interests or explicitly opted into culture.
 *
 * `metadataBySeries` (optional) carries the full `MarketMetadata` doc
 * keyed by `seriesId`. When omitted, the suggested-market boost
 * silently no-ops — every other tier behaves identically, so callers
 * that haven't been migrated to pass metadata see no regression.
 *
 * `favoriteMarketIds` (optional) is the set of featured-event market ids
 * tied to the user's favourite team (`preferences.favoriteParticipantId`,
 * resolved via {@link participantMarketIds}). Markets in this set have
 * their final score multiplied by {@link FAVORITE_COUNTRY_BOOST} so the
 * user's country surfaces higher in the World Cup deck. Empty (no
 * favourite set, or the team has no linked markets) leaves the ranking
 * untouched.
 */
export const rankMarkets = ({
	markets,
	userInterests,
	tagMappings,
	metadataBySeries = {},
	favoriteMarketIds
}: {
	markets: Market[];
	userInterests: Set<string>;
	tagMappings: Record<string, string[]>;
	metadataBySeries?: Record<string, MarketMetadata>;
	favoriteMarketIds?: ReadonlySet<string>;
}): Market[] => {
	const nowMs = Date.now();

	const computeScore = (m: Market): number => {
		const tags = tagMappings[m.id] ?? [];

		const suggested = suggestedScore({ market: m, metadata: metadataBySeries[m.id], nowMs });

		const macros = classificationMacros(tags);
		const interestScore =
			tags.some((tag) => userInterests.has(tag)) || macros.some((macro) => userInterests.has(macro))
				? 1000
				: 0;

		const hasCultureTag = macros.includes('culture');
		const cultureScore =
			hasCultureTag && (userInterests.size === 0 || userInterests.has('culture')) ? 500 : 0;

		// `liquidityScore` and `volumeScore` used to live here but were
		// dropped: `volumeScore` keyed off `Market.totalVolume`, which
		// `mapMarketData` hardcodes to `ZERO`, so it never fired. And
		// the Flow ranking path now ranks before fetching order books
		// (see `getFlowQueue` + `enrichMarketsWithOrderBook`), so
		// `bestBid`/`bestAsk` aren't populated at sort time anyway.
		const recencyScore = Number(m.createdAt) / 1e12;

		const score = suggested + interestScore + cultureScore + recencyScore;

		// Lift the markets tied to the user's favourite team by a flat
		// 60% so their country trends to the top of the deck. Applied as a
		// multiplier on the whole score (not an additive tier) so the
		// boost scales with whatever already ranked the market — a
		// suggested favourite stays ahead of a plain favourite.
		return favoriteMarketIds?.has(m.id) === true ? score * FAVORITE_COUNTRY_BOOST : score;
	};

	return markets
		.map((m) => ({ market: m, score: computeScore(m) }))
		.sort((a, b) => b.score - a.score)
		.map(({ market }) => market);
};

/**
 * Open binary markets ranked for the prediction flow UI using profile
 * interests and categories.
 *
 * The returned markets are *lite*: ranking only needs tags + metadata
 * + interests, so no `getOrderBook` calls are issued here. Callers
 * that want book-derived fields (`yesProbability`, `bestBid`/`bestAsk`)
 * for the cards they actually render should call
 * {@link enrichFlowMarketsWithOrderBook} on the final slice. This is
 * what cuts `/flow` entry from "N order-book fetches over every open
 * series" to "≤MAX_MARKETS book fetches over the top-N winners".
 *
 * `tagMappings` and `metadataBySeries` are optional pre-fetched
 * inputs: callers that already hold these (e.g. `prepareFlow`, which
 * shares them with the signals derivation) can pass them in to avoid
 * a duplicate satellite round-trip. Plain values, promises, or
 * promise-wrapped results all work — `Promise.all` collapses them.
 */
export const getFlowQueue = async ({
	domain,
	tagMappings,
	metadataBySeries
}: {
	domain: RegistryDid.BalanceDomain;
	tagMappings?: Record<string, string[]> | Promise<Record<string, string[]>>;
	metadataBySeries?: Record<string, MarketMetadata> | Promise<Record<string, MarketMetadata>>;
}): Promise<Market[]> => {
	const identity = await getIdentityOrAnonymous();
	// web2 keys profiles by the session's account id: there is no on-chain
	// identity, so the principal above is the anonymous placeholder and owns no
	// profile (a signed-out visitor still falls back to it and reads empty).
	const profileOwner = isWeb2Backend()
		? (getWeb2User()?.id ?? identity.getPrincipal().toText())
		: identity.getPrincipal().toText();

	const [markets, profile, resolvedTags, resolvedMeta] = await Promise.all([
		// The Flow deck is a read-only preview: ranking candidates only needs
		// the open-series list + resolution map, so read them as fast
		// (non-certified) queries instead of paying the ~replicated-update
		// latency on the entry critical path. Certified reads still back the
		// market-detail / trade-execution paths (`fetchMarket`, order placement).
		fetchOpenBinaryMarketsLite({ identity, certified: false, domain }),
		getProfile(profileOwner),
		tagMappings ?? listMarketTagsBySeries().catch(() => ({})),
		metadataBySeries ?? listMarketMetadataBySeries().catch(() => ({}))
	]);

	const userInterests = new Set(profile.data.interests ?? []);

	// Boost the featured-event markets tied to the user's favourite team.
	// Read live off the profile on every build, so a team set or changed
	// after onboarding takes effect on the next deck. Empty when no
	// favourite is set, leaving the ranking untouched.
	const favoriteMarketIds = participantMarketIds({
		event: CURRENT_FEATURED_EVENT,
		participantId: profile.data.preferences?.favoriteParticipantId ?? ''
	});

	return rankMarkets({
		markets,
		userInterests,
		tagMappings: resolvedTags,
		metadataBySeries: resolvedMeta,
		favoriteMarketIds
	});
};

/**
 * Public wrapper around {@link enrichMarketsWithOrderBook} for the Flow
 * pipeline. Resolves the identity once and fans out one parallel book
 * fetch per market — meant to be called with the already-sliced top-N
 * (see `MAX_MARKETS` in `flow-prep.services.ts`), so the network cost
 * is bounded by deck size instead of the number of open series.
 */
export const enrichFlowMarketsWithOrderBook = async (markets: Market[]): Promise<Market[]> => {
	if (markets.length === 0) {
		return markets;
	}

	const identity = await getIdentityOrAnonymous();

	// Non-certified (query) book reads. The deck shows an *indicative*
	// consensus % per card, not a settlement-grade figure, so the fast query
	// path is the right trade-off for the swipe preview.
	//
	// Why this is safe: the value-bearing path is certified *by construction*
	// — `submit_limit_order` / `submit_market_order` / collateral / settlement
	// hardcode `caller({ certified: true })` (see `clearing.canister.ts`), and
	// the clearing canister executes against the real on-chain book. So a
	// falsified query response can mislead a swipe decision but can never move
	// funds or fill at a fake price. The certified book is also read directly
	// on the market-detail / order-placement path, where correctness matters.
	//
	// Known trade-off: the displayed % is the one decision-influencing datum
	// and is unverified at glance-time. If decision-time integrity is ever
	// wanted, lazy-certify only the *focused* card (one certified `getOrderBook`
	// as a card reaches the top of the deck) — do NOT revert all ≤MAX_MARKETS
	// reads to certified, which would just reintroduce the slow fan-out this
	// path exists to remove.
	return enrichMarketsWithOrderBook({ markets, identity, certified: false });
};

/**
 * Forks an existing market into a new restricted-access clone ("circle match").
 *
 * Uses the registry's `fork_series` endpoint so the resulting market carries a
 * `forked_from` reference back to the source. This lineage is what powers the
 * stacked-card UI and lets us enforce per-user fork limits on the backend.
 *
 * The fork inherits the source's title, description, outcomes, expiry,
 * balance domain, payout unit, etc. — the caller only supplies the target
 * group(s) and (optionally) a custom title/description.
 */
export const forkMarket = async ({
	marketId,
	groupIds,
	title,
	description,
	resolution,
	locale
}: {
	marketId: MarketId;
	groupIds: string[];
	title?: string;
	description?: string;
	/**
	 * Optional settlement-clause override for the fork. When omitted, the
	 * registry inherits the source series' resolution (`fork_series` treats a
	 * `None` resolution as "keep the source's"), which is what we want for
	 * "Challenge your friends" forks that don't restate how the market settles.
	 */
	resolution?: string;
	/**
	 * Optional BCP 47 source-language override for the forked market's
	 * `title`/`description`. When omitted, the registry inherits the source
	 * series' locale, which is what we want for non-translating "Challenge
	 * your friends" forks. Pass an explicit value only when the fork
	 * intentionally retitles into a different language.
	 */
	locale?: AppLocale;
}): Promise<string> => {
	if (groupIds.length === 0) {
		throw new Error('Fork requires at least one target group');
	}

	const identity = await safeGetIdentityOnce();

	const trimmedResolution = resolution?.trim();

	const params: RegistryDid.ForkSeriesParams = {
		source_series_id: marketId,
		title: toNullable(title),
		description: toNullable(
			nonNullish(description) ? { plain: description, html: [], markdown: [] } : undefined
		),
		resolution: toNullable(
			notEmptyString(trimmedResolution)
				? { clause: trimmedResolution.slice(0, RESOLUTION_CLAUSE_MAX_LENGTH) }
				: undefined
		),
		trading_access: [{ Restricted: { groups: groupIds } }],
		engine_id: toNullable(VICI_ENGINE_ID),
		locale: toNullable(locale)
	};

	return await forkSeries({ identity, params });
};
