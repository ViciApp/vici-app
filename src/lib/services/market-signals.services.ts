import { getFollowedLean } from '#lib/services/followed-lean.services.ts';
import { listMarketTagsBySeries } from '#lib/services/market-tags.services.ts';
import { getFollowing } from '#lib/services/relation-queries.services.ts';
import { getUserTradeHistory } from '#lib/services/trade.services.ts';
import type { UserMarketSignals } from '#lib/types/market-signals.ts';
import type { MarketId } from '#lib/types/market.ts';
import { deriveUserMarketSignals } from '#lib/utils/market-signals.utils.ts';
import type { ClearingDid, RegistryDid } from '$declarations';

/**
 * `marketIds` scopes the per-market `followedLean` fan-out to the markets the
 * viewer is actually looking at — the sliced Flow deck, or the single market on
 * a detail page — rather than every tagged series in the catalog. Without it the
 * query both wastes round-trips on markets the viewer can't see and (capped at
 * `MAX_MARKETS`) can drop the lean for markets they *can*. Accepts a promise so
 * Flow can derive it from the still-resolving queue without serialising the
 * deck-independent fetches below.
 *
 * `tagMappings` is an optional pre-fetched input: callers that
 * already hold tags from another fetch (e.g. `prepareFlow` shares
 * them with the queue ranking) can pass them in to avoid a
 * duplicate satellite round-trip.
 *
 * `tradeHistory` is likewise an optional pre-fetched input: callers
 * that already derived the viewer's executed events for another
 * purpose (e.g. `prepareFlow` excludes already-called markets from
 * the deck) pass them in so the certified history round-trip isn't
 * issued twice.
 */
export const getUserMarketSignals = async ({
	domain,
	marketIds,
	tagMappings,
	tradeHistory
}: {
	domain: RegistryDid.BalanceDomain;
	marketIds: MarketId[] | Promise<MarketId[]>;
	tagMappings?: Record<string, string[]> | Promise<Record<string, string[]>>;
	tradeHistory?: ClearingDid.Event[] | Promise<ClearingDid.Event[]>;
}): Promise<UserMarketSignals> => {
	const [events, resolvedTags, following] = await Promise.all([
		tradeHistory ?? getUserTradeHistory(domain),
		tagMappings ?? listMarketTagsBySeries().catch(() => ({})),
		getFollowing().catch(() => [])
	]);

	// Real, privacy-preserving friends-lean: the clearing canister aggregates
	// the YES/NO split of the viewer's followed set per market, returning
	// counts only (no identities/sides). Scoped to the markets actually being
	// rendered (`marketIds`). Fails open to an empty map so the rest of the
	// signals still render and the card falls back gracefully.
	const followedLean =
		following.length > 0
			? await getFollowedLean({
					following,
					seriesIds: await marketIds
				}).catch(() => ({}))
			: {};

	return {
		...deriveUserMarketSignals({ events, tagMappings: resolvedTags }),
		followedLean
	};
};
