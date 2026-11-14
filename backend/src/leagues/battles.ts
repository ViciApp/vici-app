// Battles: time-bound competitions between two leagues or two users (duels),
// driven by a forward-only state machine
// (proposed -> accepted -> in_flight -> resolved, with declined / expired as
// proposal terminals). The per-transition authorisation and the write-once
// field discipline the satellite assert enforced are applied here inside one
// transaction per transition; league scores come from settlement history via
// the resolution module, duel scores are manual with the winner derived from
// the arithmetic.

import { isNullish, nonNullish } from '@dfinity/utils';
import { query, tx, type TxQuery } from '../db/client';
import { DAY_IN_MS, optionalMs } from '../lib/time';
import { getLeague } from './leagues';
import { getLeagueMember } from './members';
import {
	getLeagueStats,
	isBattleScope,
	leagueStatsBucket,
	type BattleScope,
	type CategoryBucket
} from './stats';

export class BattleError extends Error {}

export type BattleKind = 'league' | 'duel';
export type BattleState =
	'proposed' | 'accepted' | 'in_flight' | 'resolved' | 'declined' | 'expired';
export type BattleWinner = 'A' | 'B' | 'draw';

export const BATTLE_AMOUNT_MIN = 0;
export const BATTLE_AMOUNT_MAX = 500;
export const BATTLE_TRASH_TALK_MAX_LENGTH = 60;
export const BATTLE_RESPOND_BY_MS = 3 * DAY_IN_MS;
export const BATTLE_SCOPE_DEFAULT: BattleScope = 'all';

export interface Battle {
	id: string;
	kind: BattleKind;
	sideA: string;
	sideB: string;
	proposerUserId: string;
	state: BattleState;
	kickoffMs: number;
	settleMs: number;
	scope?: BattleScope;
	amount?: number;
	trashTalk?: string;
	respondByMs?: number;
	respondedAtMs?: number;
	baselineA?: CategoryBucket;
	baselineB?: CategoryBucket;
	scoreA?: number;
	scoreB?: number;
	callsA?: number;
	callsB?: number;
	winner?: BattleWinner;
	resolvedAtMs?: number;
}

interface BattleRow {
	id: string;
	kind: BattleKind;
	side_a: string;
	side_b: string;
	proposer_user_id: string;
	state: BattleState;
	kickoff_ms: string;
	settle_ms: string;
	scope: string | null;
	amount: number | null;
	trash_talk: string | null;
	respond_by_ms: string | null;
	responded_at_ms: string | null;
	baseline_a: CategoryBucket | null;
	baseline_b: CategoryBucket | null;
	score_a: number | null;
	score_b: number | null;
	calls_a: number | null;
	calls_b: number | null;
	winner: BattleWinner | null;
	resolved_at_ms: string | null;
}

const BATTLE_COLUMNS = `id, kind, side_a, side_b, proposer_user_id, state,
	kickoff_ms::text, settle_ms::text, scope, amount, trash_talk,
	respond_by_ms::text, responded_at_ms::text, baseline_a, baseline_b,
	score_a, score_b, calls_a, calls_b, winner, resolved_at_ms::text`;

export const shapeBattle = (row: BattleRow): Battle => ({
	id: row.id,
	kind: row.kind,
	sideA: row.side_a,
	sideB: row.side_b,
	proposerUserId: row.proposer_user_id,
	state: row.state,
	kickoffMs: Number(row.kickoff_ms),
	settleMs: Number(row.settle_ms),
	scope: nonNullish(row.scope) ? (row.scope as BattleScope) : undefined,
	amount: row.amount ?? undefined,
	trashTalk: row.trash_talk ?? undefined,
	respondByMs: optionalMs(row.respond_by_ms),
	respondedAtMs: optionalMs(row.responded_at_ms),
	baselineA: row.baseline_a ?? undefined,
	baselineB: row.baseline_b ?? undefined,
	scoreA: row.score_a ?? undefined,
	scoreB: row.score_b ?? undefined,
	callsA: row.calls_a ?? undefined,
	callsB: row.calls_b ?? undefined,
	winner: row.winner ?? undefined,
	resolvedAtMs: optionalMs(row.resolved_at_ms)
});

/** Window accuracy as an integer 0-100 percentage; zero windowed calls
 * scores zero (the side forfeits the face-off). */
export const battleAccuracyPct = ({ calls, wins }: CategoryBucket): number =>
	calls > 0 ? Math.round((wins / calls) * 100) : 0;

/** Winner from both sides' window results: accuracy first, prediction volume
 * as the tie-break, draw when both are level. */
export const deriveBattleWinner = ({
	scoreA,
	scoreB,
	callsA,
	callsB
}: {
	scoreA: number;
	scoreB: number;
	callsA: number;
	callsB: number;
}): BattleWinner => {
	if (scoreA !== scoreB) {
		return scoreA > scoreB ? 'A' : 'B';
	}

	if (callsA !== callsB) {
		return callsA > callsB ? 'A' : 'B';
	}

	return 'draw';
};

export const getBattle = async (
	battleId: string,
	q: TxQuery = query
): Promise<Battle | undefined> => {
	const rows = await q<BattleRow>(`select ${BATTLE_COLUMNS} from battles where id = $1`, [
		battleId
	]);

	return nonNullish(rows[0]) ? shapeBattle(rows[0]) : undefined;
};

const lockBattle = async (battleId: string, q: TxQuery): Promise<Battle> => {
	await q(`select 1 from battles where id = $1 for update`, [battleId]);

	const battle = await getBattle(battleId, q);

	if (isNullish(battle)) {
		throw new BattleError(`Battle "${battleId}" not found.`);
	}

	return battle;
};

/** Owner-or-admin command authority over a league side. */
const isLeagueOwnerOrAdmin = async ({
	leagueId,
	userId,
	q
}: {
	leagueId: string;
	userId: string;
	q: TxQuery;
}): Promise<boolean> => {
	const league = await getLeague(leagueId, q);

	if (nonNullish(league) && league.ownerUserId === userId) {
		return true;
	}

	const member = await getLeagueMember({ leagueId, memberUserId: userId }, q);

	return member?.role === 'admin';
};

/** Battle command authority for a side: league battles widen to
 * owner-or-admin, duels stay a bare user compare. */
const isSideOwner = async ({
	battleKind,
	side,
	userId,
	q
}: {
	battleKind: BattleKind;
	side: string;
	userId: string;
	q: TxQuery;
}): Promise<boolean> =>
	battleKind === 'league'
		? await isLeagueOwnerOrAdmin({ leagueId: side, userId, q })
		: side === userId;

const isMemberOfSide = async ({
	leagueId,
	userId,
	q
}: {
	leagueId: string;
	userId: string;
	q: TxQuery;
}): Promise<boolean> => nonNullish(await getLeagueMember({ leagueId, memberUserId: userId }, q));

const readBaseline = async ({
	leagueId,
	scope,
	q
}: {
	leagueId: string;
	scope: BattleScope;
	q: TxQuery;
}): Promise<CategoryBucket> =>
	leagueStatsBucket({ stats: await getLeagueStats(leagueId, q), scope });

const updateBattle = async ({
	q,
	battleId,
	fields
}: {
	q: TxQuery;
	battleId: string;
	fields: Record<string, unknown>;
}): Promise<Battle> => {
	const keys = Object.keys(fields);
	const assignments = keys.map((key, index) => `${key} = $${index + 2}`).join(', ');
	const rows = await q<BattleRow>(
		`update battles set ${assignments}, updated_at = now() where id = $1
		 returning ${BATTLE_COLUMNS}`,
		[battleId, ...keys.map((key) => fields[key])]
	);
	const [row] = rows;

	if (isNullish(row)) {
		throw new BattleError('battle update returned no row.');
	}

	return shapeBattle(row);
};

/**
 * Propose a battle. League: the caller must be an owner or admin of sideA and
 * sideB must be challengeable (an Open league, or one the caller is a member
 * of). Duel: sideA is the caller. The respond-by deadline is stamped as
 * now + 3 days.
 */
export const proposeBattle = async ({
	id,
	kind,
	sideA,
	sideB,
	proposerUserId,
	kickoffMs,
	settleMs,
	scope,
	amount,
	trashTalk,
	nowMs = Date.now()
}: {
	id: string;
	kind: BattleKind;
	sideA: string;
	sideB: string;
	proposerUserId: string;
	kickoffMs: number;
	settleMs: number;
	scope?: string;
	amount?: number;
	trashTalk?: string;
	nowMs?: number;
}): Promise<Battle> => {
	if (kind !== 'league' && kind !== 'duel') {
		throw new BattleError(`battles kind must be league | duel (got "${kind}").`);
	}

	if (kickoffMs >= settleMs) {
		throw new BattleError('battles kickoffMs must be strictly before settleMs.');
	}

	if (nonNullish(scope) && !isBattleScope(scope)) {
		throw new BattleError(`battles scope "${scope}" is not a known scope.`);
	}

	if (
		nonNullish(amount) &&
		(!Number.isFinite(amount) || amount < BATTLE_AMOUNT_MIN || amount > BATTLE_AMOUNT_MAX)
	) {
		throw new BattleError(
			`battles amount must be within [${BATTLE_AMOUNT_MIN}, ${BATTLE_AMOUNT_MAX}] (got ${amount}).`
		);
	}

	if (nonNullish(trashTalk) && trashTalk.length > BATTLE_TRASH_TALK_MAX_LENGTH) {
		throw new BattleError(
			`battles trashTalk must be at most ${BATTLE_TRASH_TALK_MAX_LENGTH} characters.`
		);
	}

	return await tx(async (q) => {
		if (kind === 'league') {
			if (!(await isSideOwner({ battleKind: kind, side: sideA, userId: proposerUserId, q }))) {
				throw new BattleError('battles proposer must be an owner or admin of sideA.');
			}

			const sideBLeague = await getLeague(sideB, q);

			if (isNullish(sideBLeague)) {
				throw new BattleError('battles sideB league not found.');
			}

			const challengeable =
				sideBLeague.privacy === 'open' ||
				(await isMemberOfSide({ leagueId: sideB, userId: proposerUserId, q }));

			if (!challengeable) {
				throw new BattleError(
					'battles sideB must be an OPEN league or one the proposer is a member of.'
				);
			}
		} else if (sideA !== proposerUserId) {
			throw new BattleError('battles proposer must be sideA for kind="duel".');
		}

		// `wager` gets the same value while machines of the previous release,
		// which read only that column, can still serve (migration 0021).
		const rows = await q<BattleRow>(
			`insert into battles (id, kind, side_a, side_b, proposer_user_id, state, kickoff_ms,
			   settle_ms, scope, amount, wager, trash_talk, respond_by_ms)
			 values ($1, $2, $3, $4, $5, 'proposed', $6, $7, $8, $9, $9, $10, $11)
			 returning ${BATTLE_COLUMNS}`,
			[
				id,
				kind,
				sideA,
				sideB,
				proposerUserId,
				kickoffMs,
				settleMs,
				scope ?? null,
				amount ?? null,
				trashTalk ?? null,
				nowMs + BATTLE_RESPOND_BY_MS
			]
		);
		const [row] = rows;

		if (isNullish(row)) {
			throw new BattleError('battle insert returned no row.');
		}

		return shapeBattle(row);
	});
};

/** Duel accept: proposed -> accepted, by the sideB user. The window stays as
 * proposed; the kickoff is a separate later transition. */
export const acceptDuel = async ({
	battleId,
	callerId
}: {
	battleId: string;
	callerId: string;
}): Promise<Battle> =>
	await tx(async (q) => {
		const battle = await lockBattle(battleId, q);

		if (battle.state !== 'proposed') {
			throw new BattleError(`battles ${battle.state} -> accepted is not a valid transition.`);
		}

		if (battle.kind !== 'duel') {
			throw new BattleError('league battles accept fuses the kickoff (use accept-league).');
		}

		if (battle.sideB !== callerId) {
			throw new BattleError('battles accept requires sideB owner.');
		}

		return await updateBattle({ q, battleId, fields: { state: 'accepted' } });
	});

/**
 * League accept: proposed -> in_flight in one step. The window starts at
 * acceptance (kickoff = now, the proposed duration preserved) and both sides'
 * league_stats buckets are stamped as the frozen baselines.
 */
export const acceptLeagueBattle = async ({
	battleId,
	callerId,
	nowMs = Date.now()
}: {
	battleId: string;
	callerId: string;
	nowMs?: number;
}): Promise<Battle> =>
	await tx(async (q) => {
		const battle = await lockBattle(battleId, q);

		if (battle.state !== 'proposed') {
			throw new BattleError(`battles ${battle.state} -> in_flight is not a valid accept.`);
		}

		if (battle.kind !== 'league') {
			throw new BattleError('only league battles go proposed -> in_flight (duels accept first).');
		}

		if (!(await isSideOwner({ battleKind: 'league', side: battle.sideB, userId: callerId, q }))) {
			throw new BattleError('battles accept requires a sideB owner or admin.');
		}

		const scope = battle.scope ?? BATTLE_SCOPE_DEFAULT;
		const durationMs = battle.settleMs - battle.kickoffMs;
		const baselineA = await readBaseline({ leagueId: battle.sideA, scope, q });
		const baselineB = await readBaseline({ leagueId: battle.sideB, scope, q });

		return await updateBattle({
			q,
			battleId,
			fields: {
				state: 'in_flight',
				kickoff_ms: nowMs,
				settle_ms: nowMs + durationMs,
				responded_at_ms: nowMs,
				baseline_a: JSON.stringify(baselineA),
				baseline_b: JSON.stringify(baselineB)
			}
		});
	});

/** Decline: proposed -> declined by the challenged side; terminal. */
export const declineBattle = async ({
	battleId,
	callerId,
	nowMs = Date.now()
}: {
	battleId: string;
	callerId: string;
	nowMs?: number;
}): Promise<Battle> =>
	await tx(async (q) => {
		const battle = await lockBattle(battleId, q);

		if (battle.state !== 'proposed') {
			throw new BattleError(`battles ${battle.state} -> declined is not a valid transition.`);
		}

		if (
			!(await isSideOwner({ battleKind: battle.kind, side: battle.sideB, userId: callerId, q }))
		) {
			throw new BattleError('battles decline requires the sideB owner or admin.');
		}

		return await updateBattle({
			q,
			battleId,
			fields: { state: 'declined', responded_at_ms: nowMs }
		});
	});

/** Lazy expiry once the respond-by deadline passed, by either side's owner
 * or admin. Legacy rows without respondByMs fall back to kickoffMs. */
export const expireBattle = async ({
	battleId,
	callerId,
	nowMs = Date.now()
}: {
	battleId: string;
	callerId: string;
	nowMs?: number;
}): Promise<Battle> =>
	await tx(async (q) => {
		const battle = await lockBattle(battleId, q);

		if (battle.state !== 'proposed') {
			throw new BattleError(`battles ${battle.state} -> expired is not a valid transition.`);
		}

		const authorised =
			(await isSideOwner({ battleKind: battle.kind, side: battle.sideA, userId: callerId, q })) ||
			(await isSideOwner({ battleKind: battle.kind, side: battle.sideB, userId: callerId, q }));

		if (!authorised) {
			throw new BattleError('battles expire requires a sideA or sideB owner or admin.');
		}

		if (nowMs < (battle.respondByMs ?? battle.kickoffMs)) {
			throw new BattleError('battles cannot expire before respondByMs.');
		}

		return await updateBattle({ q, battleId, fields: { state: 'expired' } });
	});

/** Kickoff: accepted -> in_flight by either side's owner, once the window
 * opens. League battles stamp the frozen baselines; duels carry none. */
export const kickoffBattle = async ({
	battleId,
	callerId,
	nowMs = Date.now()
}: {
	battleId: string;
	callerId: string;
	nowMs?: number;
}): Promise<Battle> =>
	await tx(async (q) => {
		const battle = await lockBattle(battleId, q);

		if (battle.state !== 'accepted') {
			throw new BattleError(`battles ${battle.state} -> in_flight is not a valid kickoff.`);
		}

		const authorised =
			(await isSideOwner({ battleKind: battle.kind, side: battle.sideA, userId: callerId, q })) ||
			(await isSideOwner({ battleKind: battle.kind, side: battle.sideB, userId: callerId, q }));

		if (!authorised) {
			throw new BattleError('battles kickoff requires sideA or sideB owner.');
		}

		if (nowMs < battle.kickoffMs) {
			throw new BattleError('battles cannot kick off before kickoffMs.');
		}

		if (battle.kind !== 'league') {
			return await updateBattle({ q, battleId, fields: { state: 'in_flight' } });
		}

		const scope = battle.scope ?? BATTLE_SCOPE_DEFAULT;
		const baselineA = await readBaseline({ leagueId: battle.sideA, scope, q });
		const baselineB = await readBaseline({ leagueId: battle.sideB, scope, q });

		return await updateBattle({
			q,
			battleId,
			fields: {
				state: 'in_flight',
				baseline_a: JSON.stringify(baselineA),
				baseline_b: JSON.stringify(baselineB)
			}
		});
	});

/**
 * Restart a baseline-less in-flight league battle (a row imported without a
 * kickoff snapshot can neither show standings nor resolve): any member of
 * either side reopens the window from now, the original duration preserved,
 * with fresh baselines. Only valid while the row lacks baselines.
 */
export const restartBattle = async ({
	battleId,
	callerId,
	nowMs = Date.now()
}: {
	battleId: string;
	callerId: string;
	nowMs?: number;
}): Promise<Battle> =>
	await tx(async (q) => {
		const battle = await lockBattle(battleId, q);

		if (battle.state !== 'in_flight' || battle.kind !== 'league') {
			throw new BattleError('battles restart applies only to in-flight league battles.');
		}

		if (nonNullish(battle.baselineA) || nonNullish(battle.baselineB)) {
			throw new BattleError('battles restart is only valid while the row lacks baselines.');
		}

		const isMember =
			(await isMemberOfSide({ leagueId: battle.sideA, userId: callerId, q })) ||
			(await isMemberOfSide({ leagueId: battle.sideB, userId: callerId, q }));

		if (!isMember) {
			throw new BattleError('battles restart requires a sideA or sideB member.');
		}

		const scope = battle.scope ?? BATTLE_SCOPE_DEFAULT;
		const durationMs = battle.settleMs - battle.kickoffMs;
		const baselineA = await readBaseline({ leagueId: battle.sideA, scope, q });
		const baselineB = await readBaseline({ leagueId: battle.sideB, scope, q });

		return await updateBattle({
			q,
			battleId,
			fields: {
				kickoff_ms: nowMs,
				settle_ms: nowMs + durationMs,
				baseline_a: JSON.stringify(baselineA),
				baseline_b: JSON.stringify(baselineB)
			}
		});
	});

/** Duel resolve: a side owner posts manual scores once the window closed;
 * the winner comes from the arithmetic, never the writer. */
export const resolveDuel = async ({
	battleId,
	callerId,
	scoreA,
	scoreB,
	nowMs = Date.now()
}: {
	battleId: string;
	callerId: string;
	scoreA: number;
	scoreB: number;
	nowMs?: number;
}): Promise<Battle> =>
	await tx(async (q) => {
		const battle = await lockBattle(battleId, q);

		if (battle.state !== 'in_flight') {
			throw new BattleError(`battles ${battle.state} -> resolved is not a valid transition.`);
		}

		if (battle.kind !== 'duel') {
			throw new BattleError('league battles resolve from settlement history, not manual scores.');
		}

		if (battle.sideA !== callerId && battle.sideB !== callerId) {
			throw new BattleError('duel battles resolve requires a sideA or sideB owner.');
		}

		if (nowMs < battle.settleMs) {
			throw new BattleError('battles cannot resolve before settleMs.');
		}

		if (
			!Number.isInteger(scoreA) ||
			!Number.isInteger(scoreB) ||
			scoreA < 0 ||
			scoreA > 100 ||
			scoreB < 0 ||
			scoreB > 100
		) {
			throw new BattleError('battles scores must be integer percentages in [0, 100].');
		}

		const winner: BattleWinner = scoreA > scoreB ? 'A' : scoreA < scoreB ? 'B' : 'draw';

		return await updateBattle({
			q,
			battleId,
			fields: {
				state: 'resolved',
				score_a: scoreA,
				score_b: scoreB,
				winner,
				resolved_at_ms: nowMs
			}
		});
	});

/** Retract: hard-delete, proposer-only, while still proposed. Anything past
 * `proposed` is shared history and immutable. */
export const retractBattle = async ({
	battleId,
	callerId
}: {
	battleId: string;
	callerId: string;
}): Promise<{ ok: boolean }> =>
	await tx(async (q) => {
		const battle = await getBattle(battleId, q);

		if (isNullish(battle)) {
			return { ok: true };
		}

		if (battle.proposerUserId !== callerId) {
			throw new BattleError('battles may only be retracted by the original proposer.');
		}

		if (battle.state !== 'proposed') {
			throw new BattleError(
				`battles in state="${battle.state}" are immutable history; retract is only valid while proposed.`
			);
		}

		await q(`delete from battles where id = $1`, [battleId]);

		return { ok: true };
	});

/** Battles referencing a league on either side, kickoff ascending. */
export const listLeagueBattles = async (leagueId: string): Promise<Battle[]> => {
	const rows = await query<BattleRow>(
		`select ${BATTLE_COLUMNS} from battles
		 where kind = 'league' and (side_a = $1 or side_b = $1)
		 order by kickoff_ms asc`,
		[leagueId]
	);

	return rows.map(shapeBattle);
};

/** Every battle involving the caller: duels by user id on either side,
 * league battles through leagues the caller owns. Kickoff ascending. */
export const listMyBattles = async (userId: string): Promise<Battle[]> => {
	const rows = await query<BattleRow>(
		`select ${BATTLE_COLUMNS} from battles b
		 where (b.kind = 'duel' and (b.side_a = $1::text or b.side_b = $1::text))
		    or (b.kind = 'league' and exists (
		          select 1 from leagues l
		          where l.owner_user_id = $1::uuid and l.id in (b.side_a, b.side_b)))
		 order by b.kickoff_ms asc`,
		[userId]
	);

	return rows.map(shapeBattle);
};

export interface MyBattleStats {
	boutsWon: number;
}

/** Count of resolved battles the caller's side won (draws excluded): duels
 * by user match, league bouts by owning the winning league. */
export const getMyBattleStats = async (userId: string): Promise<MyBattleStats> => {
	const rows = await query<{ count: string }>(
		`select count(*)::text as count from battles b
		 where b.state = 'resolved' and b.winner in ('A', 'B')
		   and (
		     (b.kind = 'duel'
		      and (case when b.winner = 'A' then b.side_a else b.side_b end) = $1::text)
		     or
		     (b.kind = 'league' and exists (
		        select 1 from leagues l
		        where l.owner_user_id = $1::uuid
		          and l.id = (case when b.winner = 'A' then b.side_a else b.side_b end)))
		   )`,
		[userId]
	);

	return { boutsWon: Number(rows[0]?.count ?? 0) };
};
