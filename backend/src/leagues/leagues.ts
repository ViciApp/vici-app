// Leagues: user-created social cohorts joined by a 6-char invite code. The
// identity rules the satellite assert enforced (name/description bounds,
// write-once invite code and emblem, owner-only edits, privacy vocabulary)
// live here as pre-write validation; ownership transfer and disband are
// single transactions instead of ordered doc writes.

import { isNullish, nonNullish } from '@dfinity/utils';
import { randomInt } from 'node:crypto';
import { query, tx, type TxQuery } from '../db/client';

export class LeagueError extends Error {}

export type LeaguePrivacy = 'open' | 'private';
export type LeagueMemberRole = 'owner' | 'admin' | 'member';

export const LEAGUE_NAME_MIN_LENGTH = 3;
export const LEAGUE_NAME_MAX_LENGTH = 40;
export const LEAGUE_DESCRIPTION_MAX_LENGTH = 240;
export const LEAGUE_INVITE_CODE_REGEX = /^[A-Z0-9]{6}$/;

/** Emblem glyphs the owner picks from; frozen after creation. */
export const LEAGUE_EMBLEMS = ['⚔', '☼', '✦', '✧', '◎', '⌬', '⊿', '☆'] as const;

const LEAGUE_PRIVACIES: readonly LeaguePrivacy[] = ['open', 'private'];

export interface League {
	id: string;
	name: string;
	description?: string;
	inviteCode: string;
	ownerUserId: string;
	createdAtMs: number;
	accentColor?: string;
	emblem?: string;
	privacy: LeaguePrivacy;
	imageUrl?: string;
}

export interface LeagueMember {
	leagueId: string;
	memberUserId: string;
	joinedAtMs: number;
	role: LeagueMemberRole;
}

interface LeagueRow {
	id: string;
	name: string;
	description: string | null;
	invite_code: string;
	owner_user_id: string;
	created_at_ms: string;
	accent_color: string | null;
	emblem: string | null;
	privacy: LeaguePrivacy;
	image_url: string | null;
}

/** A `league_members` row as the member queries select it. */
export interface LeagueMemberRow {
	league_id: string;
	member_user_id: string;
	joined_at_ms: string;
	role: LeagueMemberRole;
}

export const LEAGUE_COLUMNS = `id, name, description, invite_code, owner_user_id,
	created_at_ms::text, accent_color, emblem, privacy, image_url`;

/** The same column list qualified for a `leagues l` join. */
const LEAGUE_COLUMNS_L = `l.id, l.name, l.description, l.invite_code, l.owner_user_id,
	l.created_at_ms::text, l.accent_color, l.emblem, l.privacy, l.image_url`;

export const shapeLeague = (row: LeagueRow): League => ({
	id: row.id,
	name: row.name,
	description: row.description ?? undefined,
	inviteCode: row.invite_code,
	ownerUserId: row.owner_user_id,
	createdAtMs: Number(row.created_at_ms),
	accentColor: row.accent_color ?? undefined,
	emblem: row.emblem ?? undefined,
	privacy: row.privacy,
	imageUrl: row.image_url ?? undefined
});

export const shapeMember = (row: LeagueMemberRow): LeagueMember => ({
	leagueId: row.league_id,
	memberUserId: row.member_user_id,
	joinedAtMs: Number(row.joined_at_ms),
	role: row.role
});

const INVITE_CODE_ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';

const randomInviteCode = (): string =>
	Array.from({ length: 6 }, () =>
		INVITE_CODE_ALPHABET.charAt(randomInt(INVITE_CODE_ALPHABET.length))
	).join('');

const assertLeagueShape = ({
	name,
	description,
	privacy
}: {
	name: string;
	description?: string;
	privacy?: string;
}): void => {
	if (name.length < LEAGUE_NAME_MIN_LENGTH || name.length > LEAGUE_NAME_MAX_LENGTH) {
		throw new LeagueError(
			`leagues name must be ${LEAGUE_NAME_MIN_LENGTH}-${LEAGUE_NAME_MAX_LENGTH} chars (got ${name.length}).`
		);
	}

	if (nonNullish(description) && description.length > LEAGUE_DESCRIPTION_MAX_LENGTH) {
		throw new LeagueError(
			`leagues description must be at most ${LEAGUE_DESCRIPTION_MAX_LENGTH} chars.`
		);
	}

	if (nonNullish(privacy) && !LEAGUE_PRIVACIES.includes(privacy as LeaguePrivacy)) {
		throw new LeagueError(
			`leagues privacy must be one of ${LEAGUE_PRIVACIES.join(', ')} (got "${privacy}").`
		);
	}
};

export const getLeague = async (
	leagueId: string,
	q: TxQuery = query
): Promise<League | undefined> => {
	const rows = await q<LeagueRow>(`select ${LEAGUE_COLUMNS} from leagues where id = $1`, [
		leagueId
	]);

	return nonNullish(rows[0]) ? shapeLeague(rows[0]) : undefined;
};

/**
 * Create a league: the creator becomes owner and gets the role='owner'
 * membership row in the same transaction. The invite code is minted
 * server-side; a rare collision with an existing league re-rolls.
 */
export const createLeague = async ({
	id,
	name,
	description,
	ownerUserId,
	accentColor,
	emblem,
	privacy,
	nowMs = Date.now()
}: {
	id: string;
	name: string;
	description?: string;
	ownerUserId: string;
	accentColor?: string;
	emblem?: string;
	privacy?: LeaguePrivacy;
	nowMs?: number;
}): Promise<League> => {
	assertLeagueShape({ name, description, privacy });

	if (id.length === 0) {
		throw new LeagueError('leagues id must be a non-empty slug.');
	}

	if (nonNullish(emblem) && !(LEAGUE_EMBLEMS as readonly string[]).includes(emblem)) {
		throw new LeagueError(
			`leagues emblem must be one of ${LEAGUE_EMBLEMS.join(' ')} (got "${emblem}").`
		);
	}

	return await tx(async (q) => {
		const existing = await q<{ id: string }>(`select id from leagues where id = $1`, [id]);

		if (nonNullish(existing[0])) {
			throw new LeagueError(`league "${id}" already exists.`);
		}

		// Invite codes are unique for the league's lifetime; retry a handful of
		// times on the vanishing chance of a collision.
		let league: League | undefined;

		for (let attempt = 0; attempt < 5 && isNullish(league); attempt += 1) {
			const rows = await q<LeagueRow>(
				`insert into leagues (id, name, description, invite_code, owner_user_id, created_at_ms,
				   accent_color, emblem, privacy)
				 values ($1, $2, $3, $4, $5, $6, $7, $8, $9)
				 on conflict (invite_code) do nothing
				 returning ${LEAGUE_COLUMNS}`,
				[
					id,
					name,
					description ?? null,
					randomInviteCode(),
					ownerUserId,
					nowMs,
					accentColor ?? null,
					emblem ?? null,
					privacy ?? 'open'
				]
			);

			league = nonNullish(rows[0]) ? shapeLeague(rows[0]) : undefined;
		}

		if (isNullish(league)) {
			throw new LeagueError('could not mint a unique invite code.');
		}

		await q(
			`insert into league_members (league_id, member_user_id, joined_at_ms, role)
			 values ($1, $2, $3, 'owner')`,
			[id, ownerUserId, nowMs]
		);

		return league;
	});
};

/**
 * Owner-only edit. Identity fields (id, createdAtMs, inviteCode, emblem)
 * are immutable; name, description and privacy are the editable set. The
 * cover image is managed by the image upload/delete endpoints.
 */
export const updateLeague = async ({
	leagueId,
	callerId,
	name,
	description,
	privacy
}: {
	leagueId: string;
	callerId: string;
	name?: string;
	description?: string | null;
	privacy?: LeaguePrivacy;
}): Promise<League> =>
	await tx(async (q) => {
		const league = await getLeague(leagueId, q);

		if (isNullish(league)) {
			throw new LeagueError('league_not_found');
		}

		if (league.ownerUserId !== callerId) {
			throw new LeagueError('leagues edits must be made by the current owner.');
		}

		const nextName = name ?? league.name;
		// `undefined` keeps the stored blurb, an explicit `null` clears it; the
		// typeof check distinguishes the two without a bare undefined compare.
		const nextDescription =
			typeof description === 'undefined' ? (league.description ?? null) : description;

		assertLeagueShape({
			name: nextName,
			description: nextDescription ?? undefined,
			privacy
		});

		const rows = await q<LeagueRow>(
			`update leagues set name = $2, description = $3, privacy = $4, updated_at = now()
			 where id = $1
			 returning ${LEAGUE_COLUMNS}`,
			[leagueId, nextName, nextDescription, privacy ?? league.privacy]
		);
		const [row] = rows;

		if (isNullish(row)) {
			throw new LeagueError('league_not_found');
		}

		return shapeLeague(row);
	});

export type TransferLeagueOwnershipRefusalReason =
	'not_owner' | 'league_not_found' | 'new_owner_not_member' | 'new_owner_is_caller';

export interface TransferLeagueOwnershipResult {
	ok: boolean;
	reason?: TransferLeagueOwnershipRefusalReason;
}

/**
 * League ownership transfer: flip the owner column, promote the new owner's
 * member row and demote the outgoing owner to admin, atomically. Only a
 * current member can become owner.
 */
export const transferLeagueOwnership = async ({
	leagueId,
	callerId,
	newOwnerUserId
}: {
	leagueId: string;
	callerId: string;
	newOwnerUserId: string;
}): Promise<TransferLeagueOwnershipResult> => {
	if (callerId === newOwnerUserId) {
		return { ok: false, reason: 'new_owner_is_caller' };
	}

	return await tx(async (q) => {
		const league = await getLeague(leagueId, q);

		if (isNullish(league)) {
			return { ok: false, reason: 'league_not_found' };
		}

		if (league.ownerUserId !== callerId) {
			return { ok: false, reason: 'not_owner' };
		}

		const memberRows = await q<LeagueMemberRow>(
			`select league_id, member_user_id, joined_at_ms::text, role from league_members
			 where league_id = $1 and member_user_id = $2`,
			[leagueId, newOwnerUserId]
		);

		if (isNullish(memberRows[0])) {
			return { ok: false, reason: 'new_owner_not_member' };
		}

		await q(`update leagues set owner_user_id = $2, updated_at = now() where id = $1`, [
			leagueId,
			newOwnerUserId
		]);
		await q(
			`update league_members set role = 'owner' where league_id = $1 and member_user_id = $2`,
			[leagueId, newOwnerUserId]
		);
		await q(
			`update league_members set role = 'admin' where league_id = $1 and member_user_id = $2`,
			[leagueId, callerId]
		);

		return { ok: true };
	});
};

/**
 * Owner-authorised disband: drops every membership row (the owner row
 * included) and the league itself. Idempotent: a missing league is a clean
 * no-op success, matching the retry-friendly semantics of the original.
 */
export const deleteLeague = async ({
	leagueId,
	callerId
}: {
	leagueId: string;
	callerId: string;
}): Promise<{ ok: boolean; reason?: 'not_owner' }> =>
	await tx(async (q) => {
		const league = await getLeague(leagueId, q);

		if (isNullish(league)) {
			return { ok: true };
		}

		if (league.ownerUserId !== callerId) {
			return { ok: false, reason: 'not_owner' };
		}

		await q(`delete from league_members where league_id = $1`, [leagueId]);
		await q(`delete from leagues where id = $1`, [leagueId]);

		return { ok: true };
	});

/** The join-by-code resolver. Undefined = invalid code (UX, not an error). */
export const lookupLeagueByInvite = async (inviteCode: string): Promise<League | undefined> => {
	const rows = await query<LeagueRow>(
		`select ${LEAGUE_COLUMNS} from leagues where invite_code = $1`,
		[inviteCode]
	);

	return nonNullish(rows[0]) ? shapeLeague(rows[0]) : undefined;
};

export interface LeagueWithRole {
	league: League;
	role: LeagueMemberRole;
	joinedAtMs: number;
	memberCount: number;
}

/** Every league the caller belongs to, most recently joined first, with the
 * total member tally that drives the league-founder achievement. */
export const listMyLeagues = async (userId: string): Promise<LeagueWithRole[]> => {
	const rows = await query<
		LeagueRow & { role: LeagueMemberRole; member_joined_at_ms: string; member_count: string }
	>(
		`select ${LEAGUE_COLUMNS_L},
		        m.role, m.joined_at_ms::text as member_joined_at_ms,
		        (select count(*)::text from league_members c where c.league_id = l.id) as member_count
		 from league_members m
		 join leagues l on l.id = m.league_id
		 where m.member_user_id = $1
		 order by m.joined_at_ms desc`,
		[userId]
	);

	return rows.map((row) => ({
		league: shapeLeague(row),
		role: row.role,
		joinedAtMs: Number(row.member_joined_at_ms),
		memberCount: Number(row.member_count)
	}));
};

/** Full roster of a league, earliest joiner first. */
export const listLeagueMembers = async (leagueId: string): Promise<LeagueMember[]> => {
	const rows = await query<LeagueMemberRow>(
		`select league_id, member_user_id, joined_at_ms::text, role from league_members
		 where league_id = $1 order by joined_at_ms asc`,
		[leagueId]
	);

	return rows.map(shapeMember);
};

/**
 * Opponent pool for the create-battle picker: every Open league plus every
 * league the caller is a member of, minus leagues the caller owns. Sorted by
 * name for the picker.
 */
export const listChallengeableLeagues = async (userId: string): Promise<League[]> => {
	const rows = await query<LeagueRow>(
		`select ${LEAGUE_COLUMNS} from leagues l
		 where l.owner_user_id <> $1
		   and (l.privacy = 'open'
		        or exists (select 1 from league_members m
		                   where m.league_id = l.id and m.member_user_id = $1))
		 order by l.name asc`,
		[userId]
	);

	return rows.map(shapeLeague);
};

export interface FriendRecommendedLeague {
	league: League;
	memberCount: number;
	friendMemberUserIds: string[];
}

/**
 * Open leagues the caller's confirmed friends are in but the caller is not,
 * with the per-league friend overlap. Friendship = a bilateral ACTIVE FRIEND
 * relation; one-way follows never leak membership. Private leagues are never
 * surfaced. Sorted by friend overlap desc, then name asc.
 */
export const listFriendRecommendedLeagues = async (
	userId: string
): Promise<FriendRecommendedLeague[]> => {
	const rows = await query<LeagueRow & { member_count: string; friend_member_user_ids: string[] }>(
		`with friends as (
		   select case when participant_one = $1 then participant_two else participant_one end as friend_id
		   from relations
		   where category = 'FRIEND' and state = 'ACTIVE'
		     and (participant_one = $1 or participant_two = $1)
		 )
		 select ${LEAGUE_COLUMNS_L},
		        (select count(*)::text from league_members c where c.league_id = l.id) as member_count,
		        array_agg(distinct m.member_user_id::text order by m.member_user_id::text) as friend_member_user_ids
		 from league_members m
		 join friends f on f.friend_id = m.member_user_id
		 join leagues l on l.id = m.league_id
		 where l.privacy = 'open'
		   and not exists (select 1 from league_members mine
		                   where mine.league_id = l.id and mine.member_user_id = $1)
		 group by l.id
		 order by count(distinct m.member_user_id) desc, l.name asc`,
		[userId]
	);

	return rows.map((row) => ({
		league: shapeLeague(row),
		memberCount: Number(row.member_count),
		friendMemberUserIds: row.friend_member_user_ids
	}));
};

/** League ids the caller owns; the founder self-heal pass walks these. */
export const listOwnedLeagueIds = async (userId: string): Promise<string[]> => {
	const rows = await query<{ id: string }>(`select id from leagues where owner_user_id = $1`, [
		userId
	]);

	return rows.map(({ id }) => id);
};
