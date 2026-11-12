import type { ClearingDid } from '#declarations';
import { CLEARING_CANISTER_ID } from '#lib/constants/canisters.constants.ts';
import { Collection } from '#lib/constants/collections.constants.ts';
import {
	BATTLE_SCOPE_DEFAULT,
	battleAccuracyPct,
	deriveBattleWinner,
	type BattleDoc,
	type BattleScope,
	type BattleWinner
} from '#lib/types/battle.ts';
import type { LeagueMemberDoc } from '#lib/types/league-member.ts';
import { controllerCaller } from '#satellite/services/authz.services.ts';
import { seriesIdsForTag } from '#satellite/services/market-tag-index.services.ts';
import { candidMethod } from '#satellite/utils/candid.utils.ts';
import { escapeRegex } from '#satellite/utils/regex.utils.ts';
import { isNullish, nonNullish } from '@dfinity/utils';
import { Principal } from '@icp-sdk/core/principal';
import { call, msgCaller, time } from '@junobuild/functions/ic-cdk';
import {
	decodeDocData,
	encodeDocData,
	getDocStore,
	listDocsStore,
	setDocStore
} from '@junobuild/functions/sdk';

/**
 * League-battle resolution from real settled-call history (controller-trusted).
 *
 * A league battle scores each side on its members' prediction accuracy over the
 * battle window. The figure is read straight from the clearing canister's
 * settlement events — the on-chain source of truth for what actually settled —
 * via {@link aggregate_settlement_accuracy}, never from a client-written
 * counter. Because an assert cannot make the inter-canister call to re-derive
 * the score, resolution is **controller-trusted**: this endpoint (running as the
 * satellite) computes the scoreline and writes the resolved doc as a controller,
 * and {@link assertSetBattle} accepts an `in_flight → resolved` league write
 * only from a controller. A client cannot forge a result.
 *
 * Membership is read at resolve time (the league's *current* members), which is
 * also the liveness model: Juno has no scheduler, so a settled battle resolves
 * the first time any member of either side opens it and the FE calls this.
 */

const MS_PER_NS = 1_000_000n;

const nowMs = (): number => Number(time() / MS_PER_NS);

/** A satellite controller principal — the `caller` for the controller-trusted resolved write. */
const adminCaller = (): Uint8Array => controllerCaller('battle resolution');

/**
 * Current member principals of a league. The `league_members` key is
 * `${leagueId}/${principal}`, so the scan is anchored to that prefix with a
 * key matcher — the datastore skips (and never decodes) rows for other
 * leagues, keeping this O(this-league's-members) rather than O(all-members).
 */
const leagueMemberPrincipals = ({
	leagueId,
	caller
}: {
	leagueId: string;
	caller: Uint8Array;
}): Principal[] => {
	const prefix = `${leagueId}/`;

	const { items } = listDocsStore({
		collection: Collection.LEAGUE_MEMBERS,
		caller,
		params: { matcher: { key: `^${escapeRegex(prefix)}` } }
	});

	const principals: Principal[] = [];

	for (const [key, item] of items) {
		if (key.startsWith(prefix)) {
			try {
				const member = decodeDocData<LeagueMemberDoc>(item.data);

				if (member.leagueId === leagueId) {
					principals.push(Principal.fromText(member.member));
				}
			} catch {
				// A malformed row can't contribute a member — skip it.
			}
		}
	}

	return principals;
};

/**
 * The series allow-list for a battle scope. `'all'` returns `undefined` (no
 * filter — every series counts); a market-tag scope returns that tag's series
 * set read straight from the `market_tag_index` bucket — O(matching-series),
 * not a scan of the whole `market_metadata` collection. An unscoped (empty)
 * bucket yields an empty set, which correctly scores the battle as a void
 * face-off rather than silently counting every market.
 */
const scopeSeriesIds = ({
	scope,
	caller
}: {
	scope: BattleScope;
	caller: Uint8Array;
}): string[] | undefined => {
	if (scope === 'all') {
		return;
	}

	return seriesIdsForTag({ tag: scope, caller });
};

/** Per-side settled-call totals over a window, summed across the side's members. */
interface SideTotals {
	/** Settled positions in the window — the battle's `calls`. */
	calls: number;
	/** Net-positive settlements — the battle's `wins`. */
	wins: number;
}

/**
 * Sum a side's members' settled-position win/total counts over `[fromMs,
 * toMs)`, scoped to `seriesIds` when present, by calling the clearing canister.
 * An empty member set (or an empty-but-present series scope) returns zeroes
 * without a call.
 */
const sideTotals = async ({
	members,
	fromMs,
	toMs,
	seriesIds
}: {
	members: Principal[];
	fromMs: number;
	toMs: number;
	seriesIds: string[] | undefined;
}): Promise<SideTotals> => {
	if (members.length === 0 || (nonNullish(seriesIds) && seriesIds.length === 0)) {
		return { calls: 0, wins: 0 };
	}

	const { argTypes, result } = candidMethod({
		canister: 'clearing',
		method: 'aggregate_settlement_accuracy'
	});

	const params: ClearingDid.AggregateSettlementAccuracyParams = {
		members,
		from_ts: [BigInt(fromMs) * MS_PER_NS],
		to_ts: [BigInt(toMs) * MS_PER_NS],
		series_ids: nonNullish(seriesIds) ? [seriesIds] : []
	};

	const entries = await call<ClearingDid.SettlementAccuracyEntry[]>({
		canisterId: CLEARING_CANISTER_ID,
		method: 'aggregate_settlement_accuracy',
		args: [[argTypes[0], params]],
		result
	});

	let calls = 0;
	let wins = 0;

	for (const entry of entries) {
		calls += Number(entry.settled_count);
		wins += Number(entry.win_count);
	}

	return { calls, wins };
};

/** The windowed scoreline both sides over `[fromMs, toMs)`, from clearing. */
interface BattleScoreline {
	scoreA: number;
	scoreB: number;
	callsA: number;
	callsB: number;
	winner: BattleWinner;
}

const computeScoreline = async ({
	battle,
	toMs,
	caller
}: {
	battle: BattleDoc;
	toMs: number;
	caller: Uint8Array;
}): Promise<BattleScoreline> => {
	const scope: BattleScope = battle.scope ?? BATTLE_SCOPE_DEFAULT;
	const seriesIds = scopeSeriesIds({ scope, caller });

	const [a, b] = await Promise.all([
		sideTotals({
			members: leagueMemberPrincipals({ leagueId: battle.sideA, caller }),
			fromMs: battle.kickoffMs,
			toMs,
			seriesIds
		}),
		sideTotals({
			members: leagueMemberPrincipals({ leagueId: battle.sideB, caller }),
			fromMs: battle.kickoffMs,
			toMs,
			seriesIds
		})
	]);

	const scoreA = battleAccuracyPct({ calls: a.calls, wins: a.wins });
	const scoreB = battleAccuracyPct({ calls: b.calls, wins: b.wins });

	return {
		scoreA,
		scoreB,
		callsA: a.calls,
		callsB: b.calls,
		winner: deriveBattleWinner({ scoreA, scoreB, callsA: a.calls, callsB: b.calls })
	};
};

/** Whether `caller` is a current member of either side — the resolve/live-read liveness gate. */
const isMemberOfEitherSide = ({
	battle,
	caller
}: {
	battle: BattleDoc;
	caller: Uint8Array;
}): boolean => {
	const callerText = Principal.fromUint8Array(caller).toText();

	return [battle.sideA, battle.sideB].some((leagueId) =>
		nonNullish(
			getDocStore({
				collection: Collection.LEAGUE_MEMBERS,
				key: `${leagueId}/${callerText}`,
				caller
			})
		)
	);
};

/**
 * Resolve a settled league battle (`in_flight → resolved`) from clearing
 * settlement history. Idempotent — an already-resolved battle is returned
 * unchanged without a write. Throws when the battle is unknown, not a league,
 * not yet settled, or the caller is not a member of either side.
 */
export const resolveBattleFromSettlementsFn = async ({
	battleId
}: {
	battleId: string;
}): Promise<BattleDoc> => {
	const caller = msgCaller().toUint8Array();

	const existing = getDocStore({
		collection: Collection.BATTLES,
		key: battleId,
		caller
	});

	if (isNullish(existing)) {
		throw new Error(`Battle "${battleId}" not found.`);
	}

	const battle = decodeDocData<BattleDoc>(existing.data);

	if (battle.state === 'resolved') {
		return battle;
	}

	if (battle.kind !== 'league') {
		throw new Error('Only league battles resolve from settlement history.');
	}

	if (battle.state !== 'in_flight') {
		throw new Error(`Battle "${battleId}" is ${battle.state}, not in flight.`);
	}

	if (!isMemberOfEitherSide({ battle, caller })) {
		throw new Error('Only a member of either side can resolve a battle.');
	}

	const settleMs = nowMs();

	if (settleMs < battle.settleMs) {
		throw new Error('Battle has not reached its settle time yet.');
	}

	const { scoreA, scoreB, callsA, callsB, winner } = await computeScoreline({
		battle,
		toMs: battle.settleMs,
		caller
	});

	const resolved: BattleDoc = {
		...battle,
		state: 'resolved',
		scoreA,
		scoreB,
		callsA,
		callsB,
		winner,
		resolvedAtMs: settleMs
	};

	// Controller-trusted write: the resolved scoreline is derived above from
	// clearing, so the assert accepts it from a controller without re-deriving.
	const admin = adminCaller();

	setDocStore({
		collection: Collection.BATTLES,
		key: battleId,
		caller: admin,
		doc: {
			data: encodeDocData(resolved),
			version: existing.version
		}
	});

	return resolved;
};

/** Provisional standings of an in-flight league battle. */
export interface BattleLiveScore {
	scoreA: number;
	scoreB: number;
	callsA: number;
	callsB: number;
	leader: BattleWinner;
}

/**
 * Project the current standings of an in-flight league battle from clearing —
 * the same accuracy arithmetic as resolution, over `[kickoffMs, now)`, but
 * strictly read-only (it never writes the doc). Returns `undefined` for a
 * battle that can't be scored live (unknown, non-league, not in flight) or when
 * the caller is not a member of either side.
 */
export const readBattleLiveScoreFn = async ({
	battleId
}: {
	battleId: string;
}): Promise<BattleLiveScore | undefined> => {
	const caller = msgCaller().toUint8Array();

	const existing = getDocStore({
		collection: Collection.BATTLES,
		key: battleId,
		caller
	});

	if (isNullish(existing)) {
		return;
	}

	const battle = decodeDocData<BattleDoc>(existing.data);

	if (
		battle.kind !== 'league' ||
		battle.state !== 'in_flight' ||
		!isMemberOfEitherSide({ battle, caller })
	) {
		return;
	}

	const { scoreA, scoreB, callsA, callsB, winner } = await computeScoreline({
		battle,
		toMs: nowMs(),
		caller
	});

	return { scoreA, scoreB, callsA, callsB, leader: winner };
};
