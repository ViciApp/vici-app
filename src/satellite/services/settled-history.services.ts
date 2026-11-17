import type { ClearingDid } from '#declarations';
import { CLEARING_CANISTER_ID } from '#lib/constants/canisters.constants.ts';
import { MILLISECOND_IN_NANOSECONDS } from '#lib/constants/time.constants.ts';
import { candidMethod } from '#satellite/utils/candid.utils.ts';
import { nonNullish } from '@dfinity/utils';
import { Principal } from '@icp-sdk/core/principal';
import { call } from '@junobuild/functions/ic-cdk';

/**
 * Settled-call history, read straight from the clearing canister's settlement
 * events via `aggregate_settlement_accuracy`: the one source every award
 * judged on prediction accuracy reads (league battles, the Worlds podium,
 * tournament matches). Never a client-written counter: a caller cannot
 * forge what actually settled on-chain.
 */

/** Settled positions in a window (`calls`) and how many were net positive (`wins`). */
export interface SettledTotals {
	calls: number;
	wins: number;
}

/** Clearing scans at most this many principals per call and truncates a longer set. */
const SETTLEMENT_ACCURACY_MAX_MEMBERS = 10_000;

const settlementAccuracy = async ({
	members,
	fromMs,
	toMs,
	seriesIds
}: {
	members: Principal[];
	fromMs: number;
	toMs: number;
	seriesIds: string[] | undefined;
}): Promise<ClearingDid.SettlementAccuracyEntry[]> => {
	const { argTypes, result } = candidMethod({
		canister: 'clearing',
		method: 'aggregate_settlement_accuracy'
	});

	const params: ClearingDid.AggregateSettlementAccuracyParams = {
		members,
		from_ts: [BigInt(fromMs) * MILLISECOND_IN_NANOSECONDS],
		to_ts: [BigInt(toMs) * MILLISECOND_IN_NANOSECONDS],
		series_ids: nonNullish(seriesIds) ? [seriesIds] : []
	};

	return await call<ClearingDid.SettlementAccuracyEntry[]>({
		canisterId: CLEARING_CANISTER_ID,
		method: 'aggregate_settlement_accuracy',
		args: [[argTypes[0], params]],
		result
	});
};

/**
 * Each member's settled-position totals over `[fromMs, toMs)`, keyed by
 * principal text, scoped to `seriesIds` when present. A member with nothing
 * settled in the window is absent. An empty member set, or an
 * empty-but-present series scope, returns an empty map without a call.
 */
export const settledTotalsByPrincipal = async ({
	members,
	fromMs,
	toMs,
	seriesIds
}: {
	members: Principal[];
	fromMs: number;
	toMs: number;
	seriesIds?: string[];
}): Promise<Map<string, SettledTotals>> => {
	const totals = new Map<string, SettledTotals>();

	if (members.length === 0 || (nonNullish(seriesIds) && seriesIds.length === 0)) {
		return totals;
	}

	// De-duplicated before chunking: clearing only de-duplicates within one call.
	const unique = [...new Set(members.map((member) => member.toText()))].map((text) =>
		Principal.fromText(text)
	);

	const chunks: Principal[][] = [];

	for (let start = 0; start < unique.length; start += SETTLEMENT_ACCURACY_MAX_MEMBERS) {
		chunks.push(unique.slice(start, start + SETTLEMENT_ACCURACY_MAX_MEMBERS));
	}

	const results = await Promise.all(
		chunks.map((chunk) => settlementAccuracy({ members: chunk, fromMs, toMs, seriesIds }))
	);

	for (const entry of results.flat()) {
		const key = entry.principal.toText();
		const previous = totals.get(key) ?? { calls: 0, wins: 0 };

		totals.set(key, {
			calls: previous.calls + Number(entry.settled_count),
			wins: previous.wins + Number(entry.win_count)
		});
	}

	return totals;
};

/** The members' settled-position totals over `[fromMs, toMs)`, summed. */
export const settledTotals = async (params: {
	members: Principal[];
	fromMs: number;
	toMs: number;
	seriesIds?: string[];
}): Promise<SettledTotals> => {
	let calls = 0;
	let wins = 0;

	for (const member of (await settledTotalsByPrincipal(params)).values()) {
		calls += member.calls;
		wins += member.wins;
	}

	return { calls, wins };
};
