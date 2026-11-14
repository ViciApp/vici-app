// Profile domain: the client-synced profile doc backed by typed columns,
// shaped for the API (preferences sanitized, role hydrated) and read by id
// or by search. The guarded write lives in `profile-write.ts`.

import { isNullish, nonNullish } from '@dfinity/utils';
import { query, type TxQuery } from '../db/client';
import { optionalMs } from '../lib/time';
import { MIN_NICKNAME_LENGTH } from './nickname';

/** Client-facing validation failure: routes answer it as a 400/409 with the
 * message, mirroring the write-guard errors clients already handle. */
export class ProfileValidationError extends Error {}

export type ProfileVisibility = 'public' | 'friends_and_followers' | 'friends_only';

export const PROFILE_VISIBILITIES: readonly ProfileVisibility[] = [
	'public',
	'friends_and_followers',
	'friends_only'
];

export interface ProfileRow {
	user_id: string;
	nickname: string;
	avatar: string;
	avatar_parts: string;
	email: string;
	pnl: number;
	visibility: ProfileVisibility;
	total_trades: number;
	win_rate: number;
	daily_streak: number;
	longest_streak: number;
	daily_goal_done: number;
	daily_goal_date: string | null;
	streak: number;
	accuracy: number;
	points: number;
	level: number;
	archetype: string;
	interests: string[];
	last_active_day: string | null;
	deleted_at_ms: string | null;
	hibernated_at_ms: string | null;
	unlocked_achievements: string[];
	contrarian_wins: number;
	best_upset_consensus: number | null;
	on_fire_streak: number;
	comebacks: number;
	winning_categories: number;
	leagues_joined: number;
	bouts_won: number;
	leagues_founded: number;
	top_decile_streak: number;
	last_top_decile_day: string | null;
	sharpest_eye_best_tier: string | null;
	school_status: string | null;
	earned_menagerie: string[] | null;
	handle_last_change_ms: string | null;
	preferences: Record<string, unknown>;
	role?: string | null;
}

/** Cross-device user settings bag, sanitized to a complete shape on read. */
export interface ProfilePreferences {
	defaultAmount: { flow: string; manual: string };
	notify: {
		streakReminder: boolean;
		marketAlerts: boolean;
		friendActivity: boolean;
		weeklyDigest: boolean;
	};
	flowSessionLength: number;
	hapticsEnabled: boolean;
	soundEnabled: boolean;
	sharing: {
		profileVisibility: 'public' | 'friends' | 'private';
		callsPublic: boolean;
		leaderboardOptIn: boolean;
		worldsOptIn: boolean;
	};
	flowTags: string[];
	worldCupMode: boolean;
	savedMarketIds: string[];
	favoriteParticipantId: string;
	favoriteSide: 'YES' | 'NO' | '';
	onboardingCompleted: boolean;
}

/** API shape of a profile: the stored doc plus the hydrated role. */
export interface Profile {
	userId: string;
	nickname: string;
	avatar: string;
	avatarParts: string;
	pnl: number;
	visibility: ProfileVisibility;
	role?: string;
	totalTrades: number;
	winRate: number;
	dailyStreak: number;
	longestStreak: number;
	dailyGoalDone: number;
	dailyGoalDate?: string;
	streak: number;
	accuracy: number;
	points: number;
	level: number;
	archetype: string;
	interests: string[];
	lastActiveDay?: string;
	deletedAtMs?: number;
	hibernatedAtMs?: number;
	unlockedAchievements: string[];
	contrarianWins: number;
	bestUpsetConsensus?: number;
	onFireStreak: number;
	comebacks: number;
	winningCategories: number;
	leaguesJoined: number;
	boutsWon: number;
	leaguesFounded: number;
	topDecileStreak: number;
	lastTopDecileDay?: string;
	sharpestEyeBestTier?: string;
	schoolStatus?: string;
	earnedMenagerie?: string[];
	handleLastChangeMs?: number;
	preferences: ProfilePreferences;
}

/** Map the persisted visibility to the three-way sharing choice, so legacy
 * rows without a stored sharing slice reflect their actual visibility. */
const visibilityToSharing = (
	visibility: ProfileVisibility | undefined
): 'public' | 'friends' | 'private' => {
	if (visibility === 'public') {
		return 'public';
	}

	if (visibility === 'friends_and_followers') {
		return 'friends';
	}

	return 'private';
};

export const asRecord = (value: unknown): Record<string, unknown> =>
	typeof value === 'object' && nonNullish(value) && !Array.isArray(value)
		? (value as Record<string, unknown>)
		: {};

const asBoolean = (value: unknown, fallback: boolean): boolean =>
	typeof value === 'boolean' ? value : fallback;

const asString = (value: unknown, fallback: string): string =>
	typeof value === 'string' ? value : fallback;

const asStringArray = (value: unknown): string[] =>
	Array.isArray(value) ? value.filter((item): item is string => typeof item === 'string') : [];

/**
 * Hydrates AND sanitizes the preferences bag so every field is present with
 * its default before the value reaches a client. Missing nested fields are
 * backfilled (legacy rows predate several of them) and unknown keys are
 * dropped, keeping the read shape canonical.
 */
export const sanitizePreferences = ({
	preferences,
	visibility
}: {
	preferences: unknown;
	visibility: ProfileVisibility | undefined;
}): ProfilePreferences => {
	const incoming = asRecord(preferences);
	const defaultAmount = asRecord(incoming.defaultAmount);
	const notify = asRecord(incoming.notify);
	const sharing = asRecord(incoming.sharing);
	const sharingVisibility = sharing.profileVisibility;

	return {
		defaultAmount: {
			flow: asString(defaultAmount.flow, '0'),
			manual: asString(defaultAmount.manual, '0')
		},
		notify: {
			streakReminder: asBoolean(notify.streakReminder, true),
			marketAlerts: asBoolean(notify.marketAlerts, true),
			friendActivity: asBoolean(notify.friendActivity, false),
			weeklyDigest: asBoolean(notify.weeklyDigest, true)
		},
		flowSessionLength:
			typeof incoming.flowSessionLength === 'number' && Number.isFinite(incoming.flowSessionLength)
				? incoming.flowSessionLength
				: 10,
		hapticsEnabled: asBoolean(incoming.hapticsEnabled, true),
		soundEnabled: asBoolean(incoming.soundEnabled, true),
		sharing: {
			profileVisibility:
				sharingVisibility === 'public' ||
				sharingVisibility === 'friends' ||
				sharingVisibility === 'private'
					? sharingVisibility
					: visibilityToSharing(visibility),
			callsPublic: asBoolean(sharing.callsPublic, true),
			leaderboardOptIn: asBoolean(sharing.leaderboardOptIn, true),
			worldsOptIn: asBoolean(sharing.worldsOptIn, true)
		},
		flowTags: asStringArray(incoming.flowTags),
		worldCupMode: asBoolean(incoming.worldCupMode, false),
		savedMarketIds: asStringArray(incoming.savedMarketIds),
		favoriteParticipantId: asString(incoming.favoriteParticipantId, ''),
		favoriteSide:
			incoming.favoriteSide === 'YES' || incoming.favoriteSide === 'NO'
				? incoming.favoriteSide
				: '',
		onboardingCompleted: asBoolean(incoming.onboardingCompleted, false)
	};
};

/** Shape a stored row into the API profile: defaults applied, role hydrated
 * from the users table ('user' is the canonical "no role" state). */
export const shapeProfile = (row: ProfileRow): Profile => ({
	userId: row.user_id,
	nickname: row.nickname ?? '',
	avatar: row.avatar ?? '',
	avatarParts: row.avatar_parts ?? '',
	pnl: row.pnl ?? 0,
	visibility: row.visibility,
	...(nonNullish(row.role) && row.role !== 'user' ? { role: row.role } : {}),
	totalTrades: row.total_trades ?? 0,
	winRate: row.win_rate ?? 0,
	dailyStreak: row.daily_streak ?? 0,
	longestStreak: row.longest_streak ?? 0,
	dailyGoalDone: row.daily_goal_done ?? 0,
	dailyGoalDate: row.daily_goal_date ?? undefined,
	streak: row.streak ?? 0,
	accuracy: row.accuracy ?? 0,
	points: row.points ?? 0,
	level: row.level ?? 1,
	archetype: row.archetype ?? '',
	interests: row.interests ?? [],
	lastActiveDay: row.last_active_day ?? undefined,
	deletedAtMs: optionalMs(row.deleted_at_ms),
	hibernatedAtMs: optionalMs(row.hibernated_at_ms),
	unlockedAchievements: row.unlocked_achievements ?? [],
	contrarianWins: row.contrarian_wins ?? 0,
	bestUpsetConsensus: row.best_upset_consensus ?? undefined,
	onFireStreak: row.on_fire_streak ?? 0,
	comebacks: row.comebacks ?? 0,
	winningCategories: row.winning_categories ?? 0,
	leaguesJoined: row.leagues_joined ?? 0,
	boutsWon: row.bouts_won ?? 0,
	leaguesFounded: row.leagues_founded ?? 0,
	topDecileStreak: row.top_decile_streak ?? 0,
	lastTopDecileDay: row.last_top_decile_day ?? undefined,
	sharpestEyeBestTier: row.sharpest_eye_best_tier ?? undefined,
	schoolStatus: row.school_status ?? undefined,
	earnedMenagerie: row.earned_menagerie ?? undefined,
	handleLastChangeMs: optionalMs(row.handle_last_change_ms),
	preferences: sanitizePreferences({ preferences: row.preferences, visibility: row.visibility })
});

/** A profile is hidden from PUBLIC reads iff it is soft-deleted OR
 * hibernated. The owner's own read is never gated, so the client can still
 * offer recovery / resume. */
export const isPubliclyHidden = (
	row: Pick<ProfileRow, 'deleted_at_ms' | 'hibernated_at_ms'>
): boolean => nonNullish(row.deleted_at_ms) || nonNullish(row.hibernated_at_ms);

/** The owner's own profile: the public shape plus the private email. Only
 * the /me surface and an owner-scoped read may ever serialize this; every
 * public read (leaderboard, search, by-id for others) uses shapeProfile,
 * which carries no email at all. */
export interface OwnProfile extends Profile {
	email: string;
}

export const shapeOwnProfile = (row: ProfileRow): OwnProfile => ({
	...shapeProfile(row),
	email: row.email ?? ''
});

export const PROFILE_COLUMNS = `p.user_id, p.nickname, p.avatar, p.avatar_parts, p.email, p.pnl,
	p.visibility, p.total_trades, p.win_rate, p.daily_streak, p.longest_streak,
	p.daily_goal_done, p.daily_goal_date, p.streak, p.accuracy, p.points, p.level,
	p.archetype, p.interests, p.last_active_day, p.deleted_at_ms::text, p.hibernated_at_ms::text,
	p.unlocked_achievements, p.contrarian_wins, p.best_upset_consensus, p.on_fire_streak,
	p.comebacks, p.winning_categories, p.leagues_joined, p.bouts_won, p.leagues_founded,
	p.top_decile_streak, p.last_top_decile_day, p.sharpest_eye_best_tier, p.school_status,
	p.earned_menagerie, p.handle_last_change_ms::text, p.preferences, u.role`;

export const getProfileRow = async ({
	userId,
	q = query
}: {
	userId: string;
	q?: TxQuery;
}): Promise<ProfileRow | undefined> => {
	const rows = await q<ProfileRow>(
		`select ${PROFILE_COLUMNS}
		 from profiles p
		 join users u on u.id = p.user_id
		 where p.user_id = $1`,
		[userId]
	);

	return rows[0];
};

/**
 * Public profile lookup: a soft-deleted or hibernated account is invisible
 * to OTHER callers, but the owner can always read their own (possibly
 * hidden) row, which the client relies on to drive recovery / resume.
 */
export const getProfileView = async ({
	userId,
	callerId
}: {
	userId: string;
	callerId?: string;
}): Promise<Profile | OwnProfile | undefined> => {
	const row = await getProfileRow({ userId });

	if (isNullish(row)) {
		return;
	}

	if (isPubliclyHidden(row) && callerId !== userId) {
		return;
	}

	return callerId === userId ? shapeOwnProfile(row) : shapeProfile(row);
};

const escapeLike = (value: string): string => value.replace(/[\\%_]/g, (ch) => `\\${ch}`);

/** The shortest search query that runs: the shortest handle, so any handle
 * stays findable while a blank or one-letter query cannot list everyone. */
export const PROFILE_SEARCH_MIN_QUERY_LENGTH = MIN_NICKNAME_LENGTH;

/** Rows one search answers at most. */
export const PROFILE_SEARCH_MAX_RESULTS = 20;

/** Public search over non-hidden profiles: nickname substring match plus the
 * user id and any linked legacy principal, so imported accounts stay
 * findable by their historic identifier. A query shorter than
 * {@link PROFILE_SEARCH_MIN_QUERY_LENGTH} matches nothing. Results are capped,
 * so the exact handle ranks first, then handles that start with the query:
 * the add-friend lookup picks the exact handle out of this page. */
export const searchProfiles = async (queryStr: string): Promise<Profile[]> => {
	const needle = queryStr.trim().toLowerCase();

	if (needle.length < PROFILE_SEARCH_MIN_QUERY_LENGTH) {
		return [];
	}

	const escaped = escapeLike(needle);

	const rows = await query<ProfileRow>(
		`select ${PROFILE_COLUMNS}
		 from profiles p
		 join users u on u.id = p.user_id
		 where p.deleted_at_ms is null and p.hibernated_at_ms is null
		   and (
		     lower(p.nickname) like $1 escape '\\'
		     or p.user_id::text like $1 escape '\\'
		     or exists (
		       select 1 from legacy_principals lp
		       where lp.user_id = p.user_id and lower(lp.principal) like $1 escape '\\'
		     )
		   )
		 order by lower(p.nickname) = $2 desc,
		          lower(p.nickname) like $3 escape '\\' desc,
		          lower(p.nickname),
		          p.user_id
		 limit $4`,
		[`%${escaped}%`, needle, `${escaped}%`, PROFILE_SEARCH_MAX_RESULTS]
	);

	return rows.map(shapeProfile);
};
