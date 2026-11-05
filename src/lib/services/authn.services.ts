import { settleSeries } from '#lib/api/clearing.api.ts';
import { PRICE_DECIMALS, VICI_ORACLE_V1 } from '#lib/constants/app.constants.ts';
import { ActivityType } from '#lib/enums/social.ts';
import { logActivity } from '#lib/services/activity.services.ts';
import { safeGetIdentityOnce } from '#lib/services/identity.services.ts';
import type { MarketId, Outcome } from '#lib/types/market.ts';
import { binaryPayoff } from '#lib/utils/payoff.utils.ts';
import { refreshMarkets } from '#lib/utils/refresh.utils.ts';
import type { ClearingDid } from '$declarations';
import { isNullish, nowInBigIntNanoSeconds, toNullable } from '@dfinity/utils';

/**
 * Binary resolution path: settles on-chain from YES/NO, logs settlement activity, refreshes markets.
 */
export const resolveMarket = async ({
	marketId,
	outcome
}: {
	marketId: MarketId;
	outcome: Outcome;
}): Promise<void> => {
	const identity = await safeGetIdentityOnce();

	const settlementPrice = binaryPayoff(outcome);

	if (isNullish(settlementPrice)) {
		throw new Error('Market cancellation not implemented yet');
	}

	const params: ClearingDid.SettleSeriesParams = {
		series_id: marketId,
		settlement: {
			Price: {
				decimal: {
					value: settlementPrice,
					decimals: PRICE_DECIMALS
				},
				timestamp: toNullable(nowInBigIntNanoSeconds()),
				oracle_id: toNullable(VICI_ORACLE_V1)
			}
		}
	};

	// Trigger on-chain settlement. We deliberately do NOT swallow errors here:
	// settlement failure must surface to the caller so the admin UI can render
	// the error state instead of showing a false success. The Juno activity row
	// is only written AFTER on-chain settlement succeeds, otherwise the UI would
	// start showing the market as "Resolved" even though nothing settled.
	await settleSeries({
		identity,
		params
	});

	await logActivity({
		type: ActivityType.SETTLEMENT,
		user: identity.getPrincipal().toText(),
		marketId,
		title: `Market Resolved: ${outcome}`,
		// TODO: parse with built-in bigint instead of string
		details: JSON.stringify({ outcome, price: settlementPrice.toString() })
	});

	refreshMarkets();
};
