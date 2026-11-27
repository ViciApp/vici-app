import type { RegistryDid } from '#declarations';
import { anonymousIdentity } from '#lib/services/identity.services.ts';
import { fetchMarketsLite } from '#lib/services/market.services.ts';
import type { MarketId } from '#lib/types/market.ts';
import type { Position } from '#lib/types/position.ts';
import { filterByMarketIds } from '#lib/utils/balance-domain.utils.ts';
import { mapPositionData } from '#lib/utils/position.utils.ts';
import { listEnginePositions as listEnginePositionsApi } from '#lib/web2/client.ts';
import { getSessionUser } from '#lib/web2/session.ts';
import { isNullish } from '@dfinity/utils';

/**
 * The signed-in user's positions, limited to the markets {@link fetchMarketsLite}
 * returns (the currently visible catalog).
 */
const fetchPositions = async (domain: RegistryDid.BalanceDomain): Promise<Position[]> => {
	const [positions, markets] = await Promise.all([
		listEnginePositionsApi(),
		// Order-book-free: only the market id set is needed to filter positions
		// to the currently visible markets.
		fetchMarketsLite({ identity: anonymousIdentity(), certified: true, domain })
	]);

	const marketIds = new Set(markets.map((m) => m.id));

	return filterByMarketIds({ items: positions, marketIds }).map(mapPositionData);
};

/**
 * All positions for the signed-in user, limited to markets returned by
 * {@link fetchMarketsLite}. Returns `[]` when nobody is signed in.
 */
export const getPositions = async (domain: RegistryDid.BalanceDomain): Promise<Position[]> => {
	if (isNullish(getSessionUser())) {
		return [];
	}

	return await fetchPositions(domain);
};

/**
 * Callback-based variant of {@link getPositions}. No-op when nobody is signed
 * in. The API answers once, so the single response is the final
 * (`certified: true`) pass.
 */
export const loadPositions = async ({
	domain,
	onLoad,
	onUpdateError
}: {
	domain: RegistryDid.BalanceDomain;
	onLoad: (options: { certified: boolean; response: Position[] }) => void;
	onUpdateError?: (error: unknown) => void;
}): Promise<void> => {
	if (isNullish(getSessionUser())) {
		return;
	}

	try {
		onLoad({ certified: true, response: await fetchPositions(domain) });
	} catch (err: unknown) {
		onUpdateError?.(err);
	}
};

/**
 * Positions for a single market id. Returns `[]` when nobody is signed in.
 */
export const getPositionsForMarket = async (targetSeriesId: MarketId): Promise<Position[]> => {
	if (isNullish(getSessionUser())) {
		return [];
	}

	const positions = await listEnginePositionsApi();

	return positions.filter((p) => p.series_id === targetSeriesId).map(mapPositionData);
};
