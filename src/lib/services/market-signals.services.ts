import type { ClearingDid, RegistryDid } from '#declarations';
import { listMarketTagsBySeries } from '#lib/services/market-tags.services.ts';
import { getUserTradeHistory } from '#lib/services/trade.services.ts';
import type { UserMarketSignals } from '#lib/types/market-signals.ts';
import { deriveUserMarketSignals } from '#lib/utils/market-signals.utils.ts';

/**
 * The viewer-relative market signals (per-category accuracy, prior calls),
 * derived from the viewer's own trade history.
 *
 * `tagMappings` is an optional pre-fetched input: callers that
 * already hold tags from another fetch (e.g. `prepareFlow` shares
 * them with the queue ranking) can pass them in to avoid a
 * duplicate round-trip.
 *
 * `tradeHistory` is likewise an optional pre-fetched input: callers
 * that already derived the viewer's executed events for another
 * purpose (e.g. `prepareFlow` excludes already-called markets from
 * the deck) pass them in so the history round-trip isn't issued twice.
 */
export const getUserMarketSignals = async ({
	domain,
	tagMappings,
	tradeHistory
}: {
	domain: RegistryDid.BalanceDomain;
	tagMappings?: Record<string, string[]> | Promise<Record<string, string[]>>;
	tradeHistory?: ClearingDid.Event[] | Promise<ClearingDid.Event[]>;
}): Promise<UserMarketSignals> => {
	const [events, resolvedTags] = await Promise.all([
		tradeHistory ?? getUserTradeHistory(domain),
		tagMappings ?? listMarketTagsBySeries().catch(() => ({}))
	]);

	return deriveUserMarketSignals({ events, tagMappings: resolvedTags });
};
