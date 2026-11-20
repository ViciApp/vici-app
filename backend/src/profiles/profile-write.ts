// The owner's profile write: structural validation of the client-sent doc,
// the server-enforced guards (nickname validity + uniqueness, the
// handle-change cooldown) and the guarded upsert. The Flow daily goal
// (`daily_goal_done` / `daily_goal_date`) is not part of the doc: only the
// flow-swipe counter in `flow.ts` writes it.

import { isNullish, nonNullish } from '@dfinity/utils';
import { tx, type TxQuery } from '../db/client';
import { fanoutProfileDeltaToLeagueStats } from '../leagues/stats';
import {
	checkNicknameAvailability,
	HANDLE_LAST_CHANGE_TOLERANCE_MS,
	handleCooldownDaysLeft,
	MAX_NICKNAME_LENGTH,
	MIN_NICKNAME_LENGTH,
	nicknameUniqueKey
} from './nickname';
import {
	getProfileRow,
	PROFILE_VISIBILITIES,
	ProfileValidationError,
	sanitizePreferences,
	shapeOwnProfile,
	type OwnProfile,
	type ProfilePreferences,
	type ProfileRow,
	type ProfileVisibility
} from './profile';

/** Ceiling of every client-written integer counter on the profile (the trade
 * count, the streaks, the level, the achievement tallies): far above any real
 * activity, and far below the `int` columns that hold them and the league
 * sums they feed. */
export const MAX_PROFILE_COUNTER = 1_000_000;

/** Ceiling of the client-written lifetime points score, the sort key of the
 * points ranking (leaderboard, rank, rival): far above any real total, and
 * small enough that the ordering stays exact. Pinned to the app's
 * `MAX_PROFILE_POINTS` (`src/lib/constants/profile.constants.ts`), which the
 * satellite's profile assert enforces. */
export const MAX_PROFILE_POINTS = 1_000_000_000;

/** Client-writable profile doc: everything but the identity, the role, the
 * server-owned Flow daily goal and the server-set `schoolStatus` (only school
 * verification writes it); a client write keeps those as stored. */
export interface ProfileInput {
	nickname: string;
	avatar: string;
	avatarParts: string;
	email: string;
	pnl: number;
	visibility: ProfileVisibility;
	totalTrades: number;
	winRate: number;
	dailyStreak: number;
	longestStreak: number;
	streak: number;
	accuracy: number;
	points: number;
	level: number;
	archetype: string;
	interests: string[];
	lastActiveDay?: string;
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
	earnedMenagerie?: string[];
	handleLastChangeMs?: number;
	preferences: ProfilePreferences;
}

const finiteNumber = (value: unknown, field: string, fallback: number): number => {
	if (isNullish(value)) {
		return fallback;
	}

	if (typeof value !== 'number' || !Number.isFinite(value)) {
		throw new ProfileValidationError(`${field} must be a finite number.`);
	}

	return value;
};

const boundedInteger = ({
	value,
	field,
	fallback,
	max
}: {
	value: unknown;
	field: string;
	fallback: number;
	max: number;
}): number => {
	if (isNullish(value)) {
		return fallback;
	}

	if (typeof value !== 'number' || !Number.isInteger(value) || value < 0 || value > max) {
		throw new ProfileValidationError(`${field} must be an integer between 0 and ${max}.`);
	}

	return value;
};

/** A client-written count stored in an `int` column: an integer within
 * [0, MAX_PROFILE_COUNTER], so a fraction or an out-of-range value is a 400
 * and never a database fault. */
const counter = (value: unknown, field: string, fallback: number): number =>
	boundedInteger({ value, field, fallback, max: MAX_PROFILE_COUNTER });

/** A client-written share of settled calls, in percent like the client
 * computes it. */
const percentage = (value: unknown, field: string): number => {
	const share = finiteNumber(value, field, 0);

	if (share < 0 || share > 100) {
		throw new ProfileValidationError(`${field} must be between 0 and 100.`);
	}

	return share;
};

const optionalFiniteNumber = (value: unknown, field: string): number | undefined => {
	if (isNullish(value)) {
		return;
	}

	return finiteNumber(value, field, 0);
};

const stringField = (value: unknown, field: string, fallback: string): string => {
	if (isNullish(value)) {
		return fallback;
	}

	if (typeof value !== 'string') {
		throw new ProfileValidationError(`${field} must be a string.`);
	}

	return value;
};

const optionalString = (value: unknown, field: string): string | undefined => {
	if (isNullish(value)) {
		return;
	}

	return stringField(value, field, '');
};

const stringArray = (value: unknown, field: string): string[] => {
	if (isNullish(value)) {
		return [];
	}

	if (!Array.isArray(value) || value.some((item) => typeof item !== 'string')) {
		throw new ProfileValidationError(`${field} must be an array of strings.`);
	}

	return value as string[];
};

/** Structural validation of the client-sent doc, mirroring the strict
 * profile schema: typed fields, finite numbers, known visibility values. */
export const parseProfileInput = (body: Record<string, unknown>): ProfileInput => {
	const visibility = body.visibility ?? 'friends_only';

	if (!PROFILE_VISIBILITIES.includes(visibility as ProfileVisibility)) {
		throw new ProfileValidationError('visibility must be a known visibility value.');
	}

	return {
		nickname: stringField(body.nickname, 'nickname', ''),
		avatar: stringField(body.avatar, 'avatar', ''),
		avatarParts: stringField(body.avatarParts, 'avatarParts', ''),
		email: stringField(body.email, 'email', ''),
		pnl: finiteNumber(body.pnl, 'pnl', 0),
		visibility: visibility as ProfileVisibility,
		totalTrades: counter(body.totalTrades, 'totalTrades', 0),
		winRate: percentage(body.winRate, 'winRate'),
		dailyStreak: counter(body.dailyStreak, 'dailyStreak', 0),
		longestStreak: counter(body.longestStreak, 'longestStreak', 0),
		streak: counter(body.streak, 'streak', 0),
		accuracy: percentage(body.accuracy, 'accuracy'),
		points: boundedInteger({
			value: body.points,
			field: 'points',
			fallback: 0,
			max: MAX_PROFILE_POINTS
		}),
		level: counter(body.level, 'level', 1),
		archetype: stringField(body.archetype, 'archetype', ''),
		interests: stringArray(body.interests, 'interests'),
		lastActiveDay: optionalString(body.lastActiveDay, 'lastActiveDay'),
		unlockedAchievements: stringArray(body.unlockedAchievements, 'unlockedAchievements'),
		contrarianWins: counter(body.contrarianWins, 'contrarianWins', 0),
		bestUpsetConsensus: optionalFiniteNumber(body.bestUpsetConsensus, 'bestUpsetConsensus'),
		onFireStreak: counter(body.onFireStreak, 'onFireStreak', 0),
		comebacks: counter(body.comebacks, 'comebacks', 0),
		winningCategories: counter(body.winningCategories, 'winningCategories', 0),
		leaguesJoined: counter(body.leaguesJoined, 'leaguesJoined', 0),
		boutsWon: counter(body.boutsWon, 'boutsWon', 0),
		leaguesFounded: counter(body.leaguesFounded, 'leaguesFounded', 0),
		topDecileStreak: counter(body.topDecileStreak, 'topDecileStreak', 0),
		lastTopDecileDay: optionalString(body.lastTopDecileDay, 'lastTopDecileDay'),
		sharpestEyeBestTier: optionalString(body.sharpestEyeBestTier, 'sharpestEyeBestTier'),
		earnedMenagerie: isNullish(body.earnedMenagerie)
			? undefined
			: stringArray(body.earnedMenagerie, 'earnedMenagerie'),
		handleLastChangeMs: optionalFiniteNumber(body.handleLastChangeMs, 'handleLastChangeMs'),
		// Shaped by the read schema before it is stored, so SQL that reads a
		// preference leaf only ever meets the types that schema guarantees.
		preferences: sanitizePreferences({
			preferences: body.preferences,
			visibility: visibility as ProfileVisibility
		})
	};
};

/**
 * Nickname + handle-cooldown write guard, run against the CURRENT stored
 * row inside the upsert transaction. Two concerns:
 *
 * 1. Nickname validity + uniqueness via {@link checkNicknameAvailability},
 *    with a grandfather clause: an unchanged legacy nickname that fails the
 *    charset or max-length guard does not block edits to unrelated fields;
 *    it is rejected only when this write actually sets the bad handle.
 * 2. Handle-change cooldown: when the normalized nickname CHANGES versus the
 *    stored row, reject the write while the stored stamp is inside the
 *    window, and otherwise require the proposed stamp to be ~now. When the
 *    nickname is UNCHANGED, the stamp must not move.
 */
const assertValidNickname = async ({
	userId,
	proposed,
	current,
	nowMs,
	q
}: {
	userId: string;
	proposed: ProfileInput;
	current: ProfileRow | undefined;
	nowMs: number;
	q: TxQuery;
}): Promise<void> => {
	const { nickname } = proposed;

	const normalize = (value: string | null | undefined): string => nicknameUniqueKey(value ?? '');

	const settingNewHandle =
		isNullish(current) || normalize(proposed.nickname) !== normalize(current.nickname);

	const result = await checkNicknameAvailability({ nickname, excludeUserId: userId, q });

	if (!result.available) {
		if (result.reason === 'required') {
			throw new ProfileValidationError('Nickname is required.');
		}

		if (result.reason === 'too_short') {
			throw new ProfileValidationError(
				`Nickname must be at least ${MIN_NICKNAME_LENGTH} characters.`
			);
		}

		// Grandfather an unchanged legacy nickname on the length ceiling and
		// charset rules; reject only when this write actually sets the bad
		// handle, so a stored handle that predates these rules does not block
		// edits to unrelated fields.
		if (result.reason === 'too_long') {
			if (settingNewHandle) {
				throw new ProfileValidationError(
					`Nickname must be at most ${MAX_NICKNAME_LENGTH} characters.`
				);
			}
		} else if (result.reason === 'invalid') {
			if (settingNewHandle) {
				throw new ProfileValidationError(
					`The handle "${nickname}" contains invalid characters: use lowercase letters, numbers and . _ - only (no spaces).`
				);
			}
		} else {
			throw new ProfileValidationError(`The nickname "${nickname}" is already taken.`);
		}
	}

	const proposedLastChangeMs = proposed.handleLastChangeMs;

	// First write (account creation): not a cooldown-gated change. Only guard
	// against a forged future / stale stamp if the client set one at all.
	if (isNullish(current)) {
		if (
			nonNullish(proposedLastChangeMs) &&
			Math.abs(proposedLastChangeMs - nowMs) > HANDLE_LAST_CHANGE_TOLERANCE_MS
		) {
			throw new ProfileValidationError(
				'handleLastChangeMs must be set to the current time on a handle change.'
			);
		}

		return;
	}

	const currentLastChangeMs = nonNullish(current.handle_last_change_ms)
		? Number(current.handle_last_change_ms)
		: undefined;

	if (!settingNewHandle) {
		// Nickname unchanged: the cooldown stamp is immutable. Treat absent on
		// both sides as equal.
		if ((proposedLastChangeMs ?? null) !== (currentLastChangeMs ?? null)) {
			throw new ProfileValidationError(
				'handleLastChangeMs cannot change unless the handle changes.'
			);
		}

		return;
	}

	// Nickname changed: enforce the cooldown against the STORED timestamp.
	const daysLeft = handleCooldownDaysLeft({ lastChangeMs: currentLastChangeMs, nowMs });

	if (daysLeft > 0) {
		throw new ProfileValidationError(
			`The handle was changed recently: it can be changed again in ${daysLeft} day(s).`
		);
	}

	// Allowed change: the proposed doc must stamp the change time to ~now, so
	// the client cannot dodge the next window by under-reporting the change.
	if (
		isNullish(proposedLastChangeMs) ||
		Math.abs(proposedLastChangeMs - nowMs) > HANDLE_LAST_CHANGE_TOLERANCE_MS
	) {
		throw new ProfileValidationError(
			'handleLastChangeMs must be set to the current time on a handle change.'
		);
	}
};

/**
 * The trade count only ever grows: a lower figure (a client reading a shorter
 * history) keeps the stored one, so the league fan-out sees only new highs
 * and a drop followed by a rise back counts once.
 */
const storedTradeCount = ({
	proposed,
	current
}: {
	proposed: ProfileInput;
	current: ProfileRow | undefined;
}): number => Math.max(proposed.totalTrades, current?.total_trades ?? 0);

/**
 * Full-doc upsert of the caller's own profile, guarded by the nickname
 * invariants. Runs in one transaction with the stored row locked,
 * so concurrent writes serialize and the guards always compare against the
 * latest committed state; the unique nickname index remains the last-resort
 * backstop for a race on the same fold.
 */
export const upsertMyProfile = async ({
	userId,
	body
}: {
	userId: string;
	body: Record<string, unknown>;
}): Promise<OwnProfile> => {
	const proposed = parseProfileInput(body);
	const nowMs = Date.now();

	return await tx(async (q) => {
		await q(`select 1 from profiles where user_id = $1 for update`, [userId]);

		const current = await getProfileRow({ userId, q });

		await assertValidNickname({ userId, proposed, current, nowMs, q });

		const totalTrades = storedTradeCount({ proposed, current });

		try {
			await q(
				`insert into profiles (
				   user_id, nickname, nickname_key, avatar, avatar_parts, email, pnl, visibility,
				   total_trades, win_rate, daily_streak, longest_streak, streak, accuracy, points,
				   level, archetype, interests, last_active_day, unlocked_achievements,
				   contrarian_wins, best_upset_consensus, on_fire_streak, comebacks,
				   winning_categories, leagues_joined, bouts_won, leagues_founded, top_decile_streak,
				   last_top_decile_day, sharpest_eye_best_tier, earned_menagerie,
				   handle_last_change_ms, preferences, updated_at
				 ) values (
				   $1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18,
				   $19, $20, $21, $22, $23, $24, $25, $26, $27, $28, $29, $30, $31, $32, $33, $34,
				   now()
				 )
				 on conflict (user_id) do update set
				   nickname = excluded.nickname,
				   nickname_key = excluded.nickname_key,
				   avatar = excluded.avatar,
				   avatar_parts = excluded.avatar_parts,
				   email = excluded.email,
				   pnl = excluded.pnl,
				   visibility = excluded.visibility,
				   total_trades = excluded.total_trades,
				   win_rate = excluded.win_rate,
				   daily_streak = excluded.daily_streak,
				   longest_streak = excluded.longest_streak,
				   streak = excluded.streak,
				   accuracy = excluded.accuracy,
				   points = excluded.points,
				   level = excluded.level,
				   archetype = excluded.archetype,
				   interests = excluded.interests,
				   last_active_day = excluded.last_active_day,
				   unlocked_achievements = excluded.unlocked_achievements,
				   contrarian_wins = excluded.contrarian_wins,
				   best_upset_consensus = excluded.best_upset_consensus,
				   on_fire_streak = excluded.on_fire_streak,
				   comebacks = excluded.comebacks,
				   winning_categories = excluded.winning_categories,
				   leagues_joined = excluded.leagues_joined,
				   bouts_won = excluded.bouts_won,
				   leagues_founded = excluded.leagues_founded,
				   top_decile_streak = excluded.top_decile_streak,
				   last_top_decile_day = excluded.last_top_decile_day,
				   sharpest_eye_best_tier = excluded.sharpest_eye_best_tier,
				   earned_menagerie = excluded.earned_menagerie,
				   handle_last_change_ms = excluded.handle_last_change_ms,
				   preferences = excluded.preferences,
				   updated_at = now()`,
				[
					userId,
					proposed.nickname,
					nicknameUniqueKey(proposed.nickname),
					proposed.avatar,
					proposed.avatarParts,
					proposed.email,
					proposed.pnl,
					proposed.visibility,
					totalTrades,
					proposed.winRate,
					proposed.dailyStreak,
					proposed.longestStreak,
					proposed.streak,
					proposed.accuracy,
					proposed.points,
					proposed.level,
					proposed.archetype,
					JSON.stringify(proposed.interests),
					proposed.lastActiveDay ?? null,
					JSON.stringify(proposed.unlockedAchievements),
					proposed.contrarianWins,
					proposed.bestUpsetConsensus ?? null,
					proposed.onFireStreak,
					proposed.comebacks,
					proposed.winningCategories,
					proposed.leaguesJoined,
					proposed.boutsWon,
					proposed.leaguesFounded,
					proposed.topDecileStreak,
					proposed.lastTopDecileDay ?? null,
					proposed.sharpestEyeBestTier ?? null,
					nonNullish(proposed.earnedMenagerie) ? JSON.stringify(proposed.earnedMenagerie) : null,
					proposed.handleLastChangeMs ?? null,
					JSON.stringify(proposed.preferences)
				]
			);
		} catch (err) {
			// The unique nickname index is the backstop for two concurrent
			// first-claims of the same fold; surface it as the same typed error
			// the pre-check produces.
			if (
				typeof err === 'object' &&
				nonNullish(err) &&
				(err as { code?: string }).code === '23505'
			) {
				throw new ProfileValidationError(`The nickname "${proposed.nickname}" is already taken.`);
			}

			throw err;
		}

		const row = await getProfileRow({ userId, q });

		if (isNullish(row)) {
			throw new Error('profile upsert returned no row');
		}

		// League counters ride the same transaction as the profile write: an
		// advance in totalTrades fans the trade/win delta out to every league
		// the user belongs to. Hibernated accounts never move shared stats.
		await fanoutProfileDeltaToLeagueStats({
			q,
			userId,
			before: nonNullish(current)
				? { totalTrades: current.total_trades, winRate: current.win_rate }
				: undefined,
			after: { totalTrades, winRate: proposed.winRate },
			afterHibernated: nonNullish(row.hibernated_at_ms),
			nowMs
		});

		return shapeOwnProfile(row);
	});
};
