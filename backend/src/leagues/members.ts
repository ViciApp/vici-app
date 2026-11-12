// League membership lifecycle: join (self via invite code, or owner-added),
// role changes, leave and kick. The write discipline the satellite enforced
// on the `(league, member)` key carries over: a member writes only their own
// row, the owner writes anyone's, the `owner` role is reserved for the
// league's owner column, and the owner row can never be deleted (transfer
// ownership first).

import { isNullish, nonNullish } from '@dfinity/utils';
import { query, tx, type TxQuery } from '../db/client';
import {
	LeagueError,
	getLeague,
	lookupLeagueByInvite,
	shapeMember,
	type LeagueMember,
	type LeagueMemberRole,
	type LeagueMemberRow
} from './leagues';

const LEAGUE_MEMBER_ROLES: readonly LeagueMemberRole[] = ['owner', 'admin', 'member'];

export const getLeagueMember = async (
	{
		leagueId,
		memberUserId
	}: {
		leagueId: string;
		memberUserId: string;
	},
	q: TxQuery = query
): Promise<LeagueMember | undefined> => {
	const rows = await q<LeagueMemberRow>(
		`select league_id, member_user_id, joined_at_ms::text, role from league_members
		 where league_id = $1 and member_user_id = $2`,
		[leagueId, memberUserId]
	);

	return nonNullish(rows[0]) ? shapeMember(rows[0]) : undefined;
};

export const isLeagueMember = async ({
	leagueId,
	userId
}: {
	leagueId: string;
	userId: string;
}): Promise<boolean> => nonNullish(await getLeagueMember({ leagueId, memberUserId: userId }));

/** Join by invite code: the self-join path. Idempotent on re-join (the
 * existing row is returned unchanged, identity fields preserved). */
export const joinLeagueByInvite = async ({
	inviteCode,
	userId,
	nowMs = Date.now()
}: {
	inviteCode: string;
	userId: string;
	nowMs?: number;
}): Promise<LeagueMember> => {
	const league = await lookupLeagueByInvite(inviteCode);

	if (isNullish(league)) {
		throw new LeagueError('invalid_invite_code');
	}

	return await upsertLeagueMember({
		leagueId: league.id,
		callerId: userId,
		memberUserId: userId,
		role: 'member',
		nowMs
	});
};

/**
 * Write a membership row under the satellite's authorisation model: self-join
 * (member = caller, role 'member') or the league owner writing any row. The
 * `owner` role is reserved for the league's owner; role changes on existing
 * rows are owner-only; joinedAtMs is write-once.
 */
export const upsertLeagueMember = async ({
	leagueId,
	callerId,
	memberUserId,
	role,
	nowMs = Date.now()
}: {
	leagueId: string;
	callerId: string;
	memberUserId: string;
	role: LeagueMemberRole;
	nowMs?: number;
}): Promise<LeagueMember> => {
	if (!LEAGUE_MEMBER_ROLES.includes(role)) {
		throw new LeagueError(
			`league_members role must be one of ${LEAGUE_MEMBER_ROLES.join(' | ')} (got "${role}").`
		);
	}

	return await tx(async (q) => {
		const league = await getLeague(leagueId, q);

		if (isNullish(league)) {
			throw new LeagueError(`league_members references unknown league "${leagueId}".`);
		}

		const callerIsOwner = league.ownerUserId === callerId;
		const callerIsSelf = memberUserId === callerId;

		if (!callerIsSelf && !callerIsOwner) {
			throw new LeagueError(
				'league_members may only be written by the member themselves or the league owner.'
			);
		}

		if (role === 'owner' && memberUserId !== league.ownerUserId) {
			throw new LeagueError(
				'league_members role="owner" is reserved for the league owner principal.'
			);
		}

		const existing = await q<LeagueMemberRow>(
			`select league_id, member_user_id, joined_at_ms::text, role from league_members
			 where league_id = $1 and member_user_id = $2`,
			[leagueId, memberUserId]
		);
		const [current] = existing;

		if (isNullish(current)) {
			const rows = await q<LeagueMemberRow>(
				`insert into league_members (league_id, member_user_id, joined_at_ms, role)
				 values ($1, $2, $3, $4)
				 returning league_id, member_user_id, joined_at_ms::text, role`,
				[leagueId, memberUserId, nowMs, role]
			);
			const [row] = rows;

			if (isNullish(row)) {
				throw new LeagueError('league_members insert returned no row.');
			}

			return shapeMember(row);
		}

		// Identity fields (league, member, joinedAtMs) are write-once; the only
		// mutable field is the role, and changing it requires the owner.
		if (current.role !== role && !callerIsOwner) {
			throw new LeagueError('league_members role changes require the league owner.');
		}

		const rows = await q<LeagueMemberRow>(
			`update league_members set role = $3
			 where league_id = $1 and member_user_id = $2
			 returning league_id, member_user_id, joined_at_ms::text, role`,
			[leagueId, memberUserId, role]
		);
		const [row] = rows;

		if (isNullish(row)) {
			throw new LeagueError('league_members update returned no row.');
		}

		return shapeMember(row);
	});
};

/**
 * Leave / kick. The owner row cannot be removed (a league always has an
 * owner); either the member themselves or the league owner can remove a row.
 * Admins deliberately cannot kick. An orphaned row whose league is gone can
 * be cleaned up by anyone.
 */
export const removeLeagueMember = async ({
	leagueId,
	callerId,
	memberUserId
}: {
	leagueId: string;
	callerId: string;
	memberUserId: string;
}): Promise<{ ok: boolean }> =>
	await tx(async (q) => {
		const existing = await q<LeagueMemberRow>(
			`select league_id, member_user_id, joined_at_ms::text, role from league_members
			 where league_id = $1 and member_user_id = $2`,
			[leagueId, memberUserId]
		);
		const [current] = existing;

		if (isNullish(current)) {
			return { ok: true };
		}

		if (current.role === 'owner') {
			throw new LeagueError(
				'league_members owner row cannot be deleted (transfer ownership first).'
			);
		}

		const league = await getLeague(leagueId, q);

		// Orphaned membership (league already gone): let anyone clean it up.
		if (nonNullish(league)) {
			const callerIsSelf = memberUserId === callerId;
			const callerIsOwner = league.ownerUserId === callerId;

			if (!callerIsSelf && !callerIsOwner) {
				throw new LeagueError(
					'league_members may only be removed by the member themselves or the league owner.'
				);
			}
		}

		await q(`delete from league_members where league_id = $1 and member_user_id = $2`, [
			leagueId,
			memberUserId
		]);

		return { ok: true };
	});
