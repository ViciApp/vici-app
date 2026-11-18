import { VICI_EVENTS } from '#lib/constants/events.constants.ts';
import { emit } from '#lib/utils/events.utils.ts';

export const refreshMarkets = () => {
	emit({ message: VICI_EVENTS.REFRESH_MARKETS });
};

export const refreshPositions = () => {
	emit({ message: VICI_EVENTS.REFRESH_POSITIONS });
};

export const refreshOrders = () => {
	emit({ message: VICI_EVENTS.REFRESH_ORDERS });
};

export const refreshAllBalances = () => {
	emit({ message: VICI_EVENTS.REFRESH_BALANCES });

	emit({ message: VICI_EVENTS.REFRESH_COLLATERALS });
};

/**
 * Re-projects every `MarketMetadata` doc into the cached `seriesId →
 * MarketTag[]` map. Fire this after editing a market's tags so the
 * detail header, FlowCard artwork, Markets feed ranking, and any other
 * surface reading from `marketTagsStore` picks up the change without a
 * full page reload.
 */
export const refreshMarketTags = () => {
	emit({ message: VICI_EVENTS.REFRESH_MARKET_TAGS });
};

/**
 * Re-projects every `MarketMetadata` doc into the cached `seriesId →
 * MarketMetadata` map. Fire this after editing any field on a market's
 * metadata (whyNow, events, suggested) so the per-card Featured chip,
 * the suggested-market boost in `rankMarkets`, and the "Suggested for
 * you" rail pick up the change without a full page reload.
 */
export const refreshMarketMetadata = () => {
	emit({ message: VICI_EVENTS.REFRESH_MARKET_METADATA });
};
