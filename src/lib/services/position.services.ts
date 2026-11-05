import type { RegistryDid } from '#declarations';
import { getPositions as getPositionsApi } from '#lib/api/clearing.api.ts';
import { getIdentity, web2PlaceholderIdentity } from '#lib/services/identity.services.ts';
import { fetchMarketsLite } from '#lib/services/market.services.ts';
import { loadWithCertification } from '#lib/services/query-update.services.ts';
import type { MarketId } from '#lib/types/market.ts';
import type { Position } from '#lib/types/position.ts';
import { filterByMarketIds } from '#lib/utils/balance-domain.utils.ts';
import { mapPositionData } from '#lib/utils/position.utils.ts';
import { isWeb2Backend } from '#lib/web2/backend-mode.ts';
import { listEnginePositions as listEnginePositionsWeb2 } from '#lib/web2/client.ts';
import { getWeb2User } from '#lib/web2/session.ts';
import { isNullish } from '@dfinity/utils';
import type { Identity } from '@icp-sdk/core/agent';

/**
 * Core positions fetch: threads identity + certified so it composes with
 * {@link loadPositions} / `queryAndUpdate`.
 */
const fetchPositions = async ({
	identity,
	certified,
	domain
}: {
	identity: Identity;
	certified: boolean;
	domain: RegistryDid.BalanceDomain;
}): Promise<Position[]> => {
	const [positions, markets] = await Promise.all([
		isWeb2Backend() ? listEnginePositionsWeb2() : getPositionsApi({ identity, certified }),
		// Order-book-free: we only need the market id set to filter positions to
		// the currently visible markets. Threads the pass's own `certified` so the
		// uncertified query pass isn't blocked on a certified catalog, while each
		// pass stays self-consistent (no tearing).
		fetchMarketsLite({ identity, certified, domain })
	]);

	const marketIds = new Set(markets.map((m) => m.id));

	return filterByMarketIds({ items: positions, marketIds }).map(mapPositionData);
};

/**
 * All positions for the signed-in user, limited to markets returned by {@link fetchMarketsLite}.
 *
 * Performs a single certified update. Prefer {@link loadPositions} for UI flows
 * that should render fast then upgrade to a certified result.
 */
export const getPositions = async (domain: RegistryDid.BalanceDomain): Promise<Position[]> => {
	// web2 gates on the cookie session; the Juno identity path never runs.
	if (isWeb2Backend()) {
		if (isNullish(getWeb2User())) {
			return [];
		}

		return fetchPositions({ identity: web2PlaceholderIdentity(), certified: true, domain });
	}

	const identity = await getIdentity();

	if (isNullish(identity)) {
		return [];
	}

	return fetchPositions({ identity, certified: true, domain });
};

/**
 * Callback-based variant of {@link getPositions}. No-op when the user is not
 * signed in (mirrors `getPositions` returning `[]`).
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
	// web2 reads once: no query/update pair exists on that transport, so the
	// single response is the final (`certified: true`) pass.
	if (isWeb2Backend()) {
		if (isNullish(getWeb2User())) {
			return;
		}

		try {
			onLoad({
				certified: true,
				response: await fetchPositions({
					identity: web2PlaceholderIdentity(),
					certified: true,
					domain
				})
			});
		} catch (err: unknown) {
			onUpdateError?.(err);
		}

		return;
	}

	const identity = await getIdentity();

	if (isNullish(identity)) {
		return;
	}

	return loadWithCertification<Position[]>({
		identity,
		request: ({ certified, identity: reqIdentity }) =>
			fetchPositions({ identity: reqIdentity, certified, domain }),
		onLoad,
		onUpdateError
	});
};

/**
 * Positions for a single market id.
 *
 * Performs a single certified update. Prefer {@link loadPositionsForMarket}
 * for UI flows that should render fast then upgrade to a certified result.
 */
export const getPositionsForMarket = async (targetSeriesId: MarketId): Promise<Position[]> => {
	if (isWeb2Backend()) {
		if (isNullish(getWeb2User())) {
			return [];
		}

		return fetchPositionsForMarket({
			identity: web2PlaceholderIdentity(),
			certified: true,
			marketId: targetSeriesId
		});
	}

	const identity = await getIdentity();

	if (isNullish(identity)) {
		return [];
	}

	return fetchPositionsForMarket({ identity, certified: true, marketId: targetSeriesId });
};

const fetchPositionsForMarket = async ({
	identity,
	certified,
	marketId
}: {
	identity: Identity;
	certified: boolean;
	marketId: MarketId;
}): Promise<Position[]> => {
	const positions = isWeb2Backend()
		? await listEnginePositionsWeb2()
		: await getPositionsApi({ identity, certified });

	return positions.filter((p) => p.series_id === marketId).map(mapPositionData);
};

/**
 * Callback-based variant of {@link getPositionsForMarket}. No-op when the
 * user is not signed in.
 */
export const loadPositionsForMarket = async ({
	marketId,
	onLoad,
	onUpdateError
}: {
	marketId: MarketId;
	onLoad: (options: { certified: boolean; response: Position[] }) => void;
	onUpdateError?: (error: unknown) => void;
}): Promise<void> => {
	// Single-pass web2 read, delivered as the final (`certified: true`) pass.
	if (isWeb2Backend()) {
		if (isNullish(getWeb2User())) {
			return;
		}

		try {
			onLoad({
				certified: true,
				response: await fetchPositionsForMarket({
					identity: web2PlaceholderIdentity(),
					certified: true,
					marketId
				})
			});
		} catch (err: unknown) {
			onUpdateError?.(err);
		}

		return;
	}

	const identity = await getIdentity();

	if (isNullish(identity)) {
		return;
	}

	return loadWithCertification<Position[]>({
		identity,
		request: ({ certified, identity: reqIdentity }) =>
			fetchPositionsForMarket({ identity: reqIdentity, certified, marketId }),
		onLoad,
		onUpdateError
	});
};
