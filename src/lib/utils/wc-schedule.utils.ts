import type { Market } from '#lib/types/market.ts';
import { isNullish } from '@dfinity/utils';

/**
 * Release gating driven by each market's on-chain trading-window start
 * (`start_ns`, surfaced as {@link Market.startDate}). A scheduled market is
 * discoverable on-chain but withheld from every feed surface (Flow deck, Markets
 * board) until its start instant; a market with no start is live and always
 * shown.
 *
 * The gate keys on `startDate` alone, never on tags: World Cup and topical
 * drops alike schedule per-wave `start_ns`.
 */

/**
 * Whether a market is revealed right now under its release start. Reveal is
 * inclusive at the start (`now >= startDate`). `now` is the client clock (ms),
 * so this best-effort tracks the on-chain trading gate rather than guaranteeing
 * it: under clock skew or a near-boundary race the UI can reveal a beat early,
 * and a trade then rejects with `SeriesNotStarted`. A market with no `startDate`
 * is live from registration and always revealed. Compared as `bigint` so a
 * far-future timestamp can never lose precision through a `Number` round-trip.
 */
export const isMarketRevealed = ({
	startDate,
	now
}: {
	startDate?: bigint;
	now: number;
}): boolean => isNullish(startDate) || BigInt(Math.trunc(now)) >= startDate;

/**
 * Drops any market whose release start hasn't arrived yet (see module doc:
 * applies to every market, not just World-Cup ones). Safe over any
 * mixed-category list. `tagsByMarket` is retained for call-site compatibility
 * only; tags no longer change gating behaviour.
 */
export const filterScheduledWcMarkets = ({
	markets,
	tagsByMarket,
	now
}: {
	markets: Market[];
	tagsByMarket: Record<string, string[]>;
	now: number;
}): Market[] => {
	// Retained for call-site compatibility; tags no longer affect gating.
	void tagsByMarket;

	return markets.filter((market) => isMarketRevealed({ startDate: market.startDate, now }));
};
