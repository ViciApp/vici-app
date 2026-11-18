import { VXP_TOKEN } from '#lib/constants/tokens/tokens.ic.constants.ts';
import { markets } from '#lib/derived/markets.derived.ts';
import { tradeHistory } from '#lib/derived/trade-history.derived.ts';
import type { MarketId } from '#lib/types/market.ts';
import type { Transaction } from '#lib/types/wallet.ts';
import { mapClearingEventToTransaction } from '#lib/utils/transactions.utils.ts';
import { derived, type Readable } from 'svelte/store';

/**
 * Clearing trade-history events projected into the unified `Transaction`
 * shape, pairing each event with its market to resolve the (VXP-denominated)
 * settlement token. The Wallet page merges these with the paged ICRC ledger
 * rows it holds locally; this store owns only the pure clearing → wallet-row
 * projection over the shared `tradeHistory` + `markets` stores.
 */
export const clearingTransactions: Readable<Transaction[]> = derived(
	[tradeHistory, markets],
	([$tradeHistory, $markets]) => {
		if ($tradeHistory.length === 0) {
			return [];
		}

		const marketById = new Map($markets.map((m) => [m.id, m] as const));

		return $tradeHistory.map((event) => {
			const market = marketById.get(event.series_id as MarketId);
			const token = market?.token ?? VXP_TOKEN;

			return mapClearingEventToTransaction({
				event,
				token,
				user: event.user.toText()
			});
		});
	}
);
