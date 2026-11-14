import { DAY_IN_MS } from '#lib/constants/app.constants.ts';
import { get as storageGet, set as storageSet } from '#lib/utils/storage.utils.ts';
import { isNullish, nonNullish } from '@dfinity/utils';

/**
 * Last-known book-derived probabilities, persisted so a fresh page load can
 * seed market cards with the previous session's consensus instead of the
 * neutral 0.5 while the per-market order-book enrichment catches up (see
 * `loadMarketsProgressive`). Display-only seed data: it must never feed stake
 * math or order placement: those read the live (certified) book.
 *
 * Deliberately not identity-scoped (no entry in
 * `reconcileIdentityScopedStorage`): a book mid is public consensus data,
 * identical for every viewer, so it survives sign-in/out unchanged.
 *
 * Keyed by market id (the registry series id), which is globally unique
 * across balance domains: a domain switch can't surface another domain's
 * price because its market set carries different ids.
 */
const MARKET_PRICES_STORAGE_KEY = 'vici.market-prices.v1';

/**
 * A day-old consensus is still a far more honest first paint than a flat
 * 50%, but beyond that the seed starts reading as live data on a market that
 * may have long moved: let it lapse back to neutral.
 */
const MARKET_PRICE_TTL_MS = DAY_IN_MS;

interface CachedMarketPrice {
	yesProbability: number;
	atMs: number;
}

type MarketPriceCache = Record<string, CachedMarketPrice>;

const isCachedMarketPrice = (value: unknown): value is CachedMarketPrice =>
	nonNullish(value) &&
	// Reject NaN / Infinity / out-of-range: a corrupt or hand-edited entry
	// must not render as a >100% or negative consensus.
	Number.isFinite((value as CachedMarketPrice).yesProbability) &&
	(value as CachedMarketPrice).yesProbability >= 0 &&
	(value as CachedMarketPrice).yesProbability <= 1 &&
	Number.isFinite((value as CachedMarketPrice).atMs);

/**
 * The persisted cache with malformed and expired entries dropped. Shared by
 * read and write so every write also prunes: the cache stays bounded by the
 * set of markets enriched within the TTL window, no separate sweep needed.
 */
const readFreshCache = (): MarketPriceCache => {
	const raw = storageGet<MarketPriceCache>({ key: MARKET_PRICES_STORAGE_KEY });

	if (isNullish(raw) || typeof raw !== 'object') {
		return {};
	}

	const nowMs = Date.now();

	return Object.fromEntries(
		Object.entries(raw).filter(
			([, entry]) => isCachedMarketPrice(entry) && nowMs - entry.atMs <= MARKET_PRICE_TTL_MS
		)
	);
};

/**
 * Fresh (non-expired) last-known YES probabilities, keyed by market id.
 * Plain-`string` keyed on purpose: the branded `MarketId` can't be recovered
 * from persisted JSON without re-validating, and as a display-only seed the
 * id is only ever used to *look up* (branded ids are assignable to `string`);
 * an unparseable key simply never matches a live market.
 */
export const readCachedYesProbabilities = (): Map<string, number> =>
	new Map(Object.entries(readFreshCache()).map(([id, { yesProbability }]) => [id, yesProbability]));

/**
 * Merge book-derived probabilities into the persisted cache. Best-effort
 * (see `storage.utils`). Callers must only pass prices backed by a real book
 * mid: never the 0.5 fallback an empty or failed fetch degrades to, which
 * would clobber a real last-known price with the placeholder.
 */
export const cacheMarketPrices = (prices: { id: string; yesProbability: number }[]): void => {
	if (prices.length === 0) {
		return;
	}

	const atMs = Date.now();
	const next = readFreshCache();

	for (const { id, yesProbability } of prices) {
		next[id] = { yesProbability, atMs };
	}

	storageSet({ key: MARKET_PRICES_STORAGE_KEY, value: next });
};
