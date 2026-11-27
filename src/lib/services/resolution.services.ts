import type { ClearingDid } from '#declarations';
import type { Outcome } from '#lib/types/market.ts';
import { settlementInputOutcome, settlementInputTimestamp } from '#lib/utils/payoff.utils.ts';
import {
	listEngineSettledSeries as listEngineSettledSeriesWeb2,
	listEngineSettlementStatuses as listEngineSettlementStatusesWeb2
} from '#lib/web2/client.ts';

/**
 * Fetches the authoritative set of settled (resolved) series ids from
 * clearing, the single source of truth for resolution, through the public
 * HTTP bridge.
 *
 * Front ends subtract this from the registry's open/unexpired catalog to
 * derive the open set (open = unexpired - settled). The bridge read is
 * unfiltered by domain, which is safe: series ids are globally unique, so the
 * extra ids can never match another domain's markets in the caller's
 * subtraction. A failed read degrades to the empty set: every catalog load
 * awaits this set, so throwing would blank every market list instead of just
 * skipping the settled filter.
 */
export const getSettledSeriesIds = async (): Promise<Set<string>> => {
	try {
		return new Set(await listEngineSettledSeriesWeb2());
	} catch (err: unknown) {
		console.warn('Settled series read failed, skipping the settled filter', err);

		return new Set();
	}
};

/**
 * Resolution label + settlement time for one series, read from clearing rather
 * than from the `SETTLEMENT` activity log.
 */
export interface SettlementDetails {
	outcome?: Outcome;
	/** Settlement timestamp in ms, when the on-chain input carries one. */
	resolvedAt?: bigint;
}

const settlementDetails = ({
	settlement
}: ClearingDid.SettlementStatusView): SettlementDetails => ({
	outcome: settlementInputOutcome(settlement),
	resolvedAt: settlementInputTimestamp(settlement)
});

/**
 * Authoritative resolution labels for the given settled series, read from
 * clearing's settlement status through the HTTP bridge.
 *
 * The bulk label source is the `SETTLEMENT` activity log, which is only
 * *best-effort*: it holds a bounded page, and a row exists at all only when the
 * settlement went through this app's admin flow; a series settled by a script
 * or by a controller call has none. Both cases render as "settled, outcome
 * unknown". This reads the winning outcome from the same on-chain
 * `SettlementInput` the payouts were computed from, so the label can't drift
 * from the money.
 *
 * One capped bulk request (a per-series fan-out across the settled catalog
 * runs the API out of memory), so callers should scope this to the series they
 * actually need labels for and run it off the critical path.
 */
export const loadSettlementOutcomes = async ({
	seriesIds
}: {
	seriesIds: string[];
}): Promise<Map<string, SettlementDetails>> => {
	const details = new Map<string, SettlementDetails>();

	for (const status of await listEngineSettlementStatusesWeb2(seriesIds)) {
		details.set(status.series_id, settlementDetails(status));
	}

	return details;
};
