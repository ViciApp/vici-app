// League-battle scoring from real settled clearing history. Each side's
// score is its members' settled-call accuracy over the battle window, read
// straight from the clearing canister's settlement events, never from a
// client-written counter. Members are mapped to their on-chain principals:
// the derived custodial identity plus any linked legacy principals, so
// history from before an account was matched still counts.

import { isNullish, nonNullish, toNullable } from '@dfinity/utils';
import { Principal } from '@icp-sdk/core/principal';
import { query, tx } from '../db/client';
import { aggregateSettlementAccuracy } from '../engine/clearing';
import { userIcPrincipalText } from '../lib/keys';
import { msToNs } from '../lib/time';
import { seriesIdsForTag } from '../markets/tag-index';
import {
	BATTLE_SCOPE_DEFAULT,
	battleAccuracyPct,
	BattleError,
	deriveBattleWinner,
	getBattle,
	shapeBattle,
	type Battle,
	type BattleWinner
} from './battles';
import { getLeagueMember } from './members';
import type { BattleScope } from './stats';

/** Every on-chain principal a set of league members can have settled under:
 * each member's derived custodial principal plus their linked legacy ones. */
const memberPrincipals = async (leagueId: string): Promise<Principal[]> => {
	const rows = await query<{ member_user_id: string; principal: string | null }>(
		`select m.member_user_id, lp.principal
		 from league_members m
		 left join legacy_principals lp on lp.user_id = m.member_user_id
		 where m.league_id = $1`,
		[leagueId]
	);

	const principals = new Set<string>();

	for (const row of rows) {
		principals.add(userIcPrincipalText(row.member_user_id));

		if (nonNullish(row.principal)) {
			principals.add(row.principal);
		}
	}

	return [...principals].map((text) => Principal.fromText(text));
};

/** The series allow-list for a scope: undefined = every series counts; a tag
 * scope reads its index bucket, and an empty bucket scores the battle as a
 * void face-off rather than silently counting every market. */
const scopeSeriesIds = async (scope: BattleScope): Promise<string[] | undefined> => {
	if (scope === 'all') {
		return;
	}

	return await seriesIdsForTag(scope);
};

interface SideTotals {
	calls: number;
	wins: number;
}

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

	const entries = await aggregateSettlementAccuracy({
		members,
		from_ts: toNullable(msToNs(fromMs)),
		to_ts: toNullable(msToNs(toMs)),
		series_ids: isNullish(seriesIds) ? [] : [seriesIds]
	});

	let calls = 0;
	let wins = 0;

	for (const entry of entries) {
		calls += Number(entry.settled_count);
		wins += Number(entry.win_count);
	}

	return { calls, wins };
};

interface BattleScoreline {
	scoreA: number;
	scoreB: number;
	callsA: number;
	callsB: number;
	winner: BattleWinner;
}

const computeScoreline = async ({
	battle,
	toMs
}: {
	battle: Battle;
	toMs: number;
}): Promise<BattleScoreline> => {
	const scope: BattleScope = battle.scope ?? BATTLE_SCOPE_DEFAULT;
	const seriesIds = await scopeSeriesIds(scope);

	const [a, b] = await Promise.all([
		sideTotals({
			members: await memberPrincipals(battle.sideA),
			fromMs: battle.kickoffMs,
			toMs,
			seriesIds
		}),
		sideTotals({
			members: await memberPrincipals(battle.sideB),
			fromMs: battle.kickoffMs,
			toMs,
			seriesIds
		})
	]);

	const scoreA = battleAccuracyPct(a);
	const scoreB = battleAccuracyPct(b);

	return {
		scoreA,
		scoreB,
		callsA: a.calls,
		callsB: b.calls,
		winner: deriveBattleWinner({ scoreA, scoreB, callsA: a.calls, callsB: b.calls })
	};
};

const isMemberOfEitherSide = async ({
	battle,
	userId
}: {
	battle: Battle;
	userId: string;
}): Promise<boolean> => {
	for (const leagueId of [battle.sideA, battle.sideB]) {
		if (nonNullish(await getLeagueMember({ leagueId, memberUserId: userId }))) {
			return true;
		}
	}

	return false;
};

/**
 * Resolve a settled league battle (in_flight -> resolved) from clearing
 * settlement history. Idempotent: an already-resolved battle is returned
 * unchanged without a write. Throws when the battle is unknown, not a
 * league, not yet settled, or the caller is not a member of either side.
 */
export const resolveBattleFromSettlements = async ({
	battleId,
	callerId,
	nowMs = Date.now()
}: {
	battleId: string;
	callerId: string;
	nowMs?: number;
}): Promise<Battle> => {
	const battle = await getBattle(battleId);

	if (isNullish(battle)) {
		throw new BattleError(`Battle "${battleId}" not found.`);
	}

	if (battle.state === 'resolved') {
		return battle;
	}

	if (battle.kind !== 'league') {
		throw new BattleError('Only league battles resolve from settlement history.');
	}

	if (battle.state !== 'in_flight') {
		throw new BattleError(`Battle "${battleId}" is ${battle.state}, not in flight.`);
	}

	if (!(await isMemberOfEitherSide({ battle, userId: callerId }))) {
		throw new BattleError('Only a member of either side can resolve a battle.');
	}

	if (nowMs < battle.settleMs) {
		throw new BattleError('Battle has not reached its settle time yet.');
	}

	const { scoreA, scoreB, callsA, callsB, winner } = await computeScoreline({
		battle,
		toMs: battle.settleMs
	});

	// The write re-checks the state under the transaction: a concurrent
	// resolver that committed first wins and this write becomes a no-op read.
	return await tx(async (q) => {
		await q(`select 1 from battles where id = $1 for update`, [battleId]);

		const current = await getBattle(battleId, q);

		if (isNullish(current)) {
			throw new BattleError(`Battle "${battleId}" not found.`);
		}

		if (current.state === 'resolved') {
			return current;
		}

		const rows = await q<Parameters<typeof shapeBattle>[0]>(
			`update battles set state = 'resolved', score_a = $2, score_b = $3, calls_a = $4,
			   calls_b = $5, winner = $6, resolved_at_ms = $7, updated_at = now()
			 where id = $1
			 returning id, kind, side_a, side_b, proposer_user_id, state,
			   kickoff_ms::text, settle_ms::text, scope, amount, trash_talk,
			   respond_by_ms::text, responded_at_ms::text, baseline_a, baseline_b,
			   score_a, score_b, calls_a, calls_b, winner, resolved_at_ms::text`,
			[battleId, scoreA, scoreB, callsA, callsB, winner, nowMs]
		);
		const [row] = rows;

		if (isNullish(row)) {
			throw new BattleError('battle resolve returned no row.');
		}

		return shapeBattle(row);
	});
};

export interface BattleLiveScore {
	scoreA: number;
	scoreB: number;
	callsA: number;
	callsB: number;
	leader: BattleWinner;
}

/**
 * Provisional standings of an in-flight league battle over
 * [kickoffMs, now): the same accuracy arithmetic as resolution, strictly
 * read-only. Undefined for a battle that cannot be scored live (unknown,
 * non-league, not in flight) or a non-member caller.
 */
export const readBattleLiveScore = async ({
	battleId,
	callerId,
	nowMs = Date.now()
}: {
	battleId: string;
	callerId: string;
	nowMs?: number;
}): Promise<BattleLiveScore | undefined> => {
	const battle = await getBattle(battleId);

	if (
		isNullish(battle) ||
		battle.kind !== 'league' ||
		battle.state !== 'in_flight' ||
		!(await isMemberOfEitherSide({ battle, userId: callerId }))
	) {
		return;
	}

	const { scoreA, scoreB, callsA, callsB, winner } = await computeScoreline({
		battle,
		toMs: nowMs
	});

	return { scoreA, scoreB, callsA, callsB, leader: winner };
};
