import { handleUniqueKey } from '#lib/constants/handle.constants.ts';
import { defaultPreferences } from '#lib/constants/settings.constants.ts';
import { MINUTE_IN_MS } from '#lib/constants/time.constants.ts';
import { ProfileVisibility } from '#lib/enums/profile.ts';
import { notifyAchievementsUnlocked } from '#lib/services/achievements.services.ts';
import { profilesStore } from '#lib/stores/profiles.store.ts';
import { userStore } from '#lib/stores/user.store.ts';
import type { KeyedDoc } from '#lib/types/keyed-doc.ts';
import type { UserProfile } from '#lib/types/profile.ts';
import { evaluateAchievements, mergeUnlockedAchievements } from '#lib/utils/achievements.utils.ts';
import { shortenWithMiddleEllipsis } from '#lib/utils/format.utils.ts';
import type { HandleRefusal } from '#lib/utils/handle.utils.ts';
import { applyDailyStreakBump } from '#lib/utils/streak.utils.ts';
import {
	checkNicknameAvailability as checkNicknameAvailabilityApi,
	getMyProfile as getMyProfileApi,
	getProfileById as getProfileApi,
	recordFlowSwipe as recordFlowSwipeApi,
	searchProfiles as searchProfilesApi,
	upsertMyProfile as upsertMyProfileApi
} from '#lib/api-client/client.ts';
import { assertSessionOwner, getSessionUser } from '#lib/api-client/session.ts';
import { isNullish, nonNullish } from '@dfinity/utils';
import type { PrincipalText } from '@dfinity/zod-schemas';
import { get } from 'svelte/store';

/**
 * The default profile shell for an owner with no stored doc yet. Shared by the
 * read path and the app-shell hydration so a never-written account renders
 * identically everywhere.
 */
const emptyProfile = (owner: PrincipalText): UserProfile => ({
	owner,
	nickname: shortenWithMiddleEllipsis({ text: owner, splitLength: 5 }),
	avatar: '',
	avatarParts: '',
	pnl: 0,
	visibility: ProfileVisibility.FRIENDS_ONLY,
	totalTrades: 0,
	winRate: 0,
	dailyStreak: 0,
	longestStreak: 0,
	dailyGoalDone: 0,
	streak: 0,
	onFireStreak: 0,
	comebacks: 0,
	winningCategories: 0,
	leaguesJoined: 0,
	boutsWon: 0,
	leaguesFounded: 0,
	accuracy: 0,
	points: 0,
	level: 1,
	archetype: '',
	interests: [],
	unlockedAchievements: [],
	contrarianWins: 0,
	topDecileStreak: 0,
	preferences: defaultPreferences()
});

/**
 * The stored profile, or `undefined` when the API has none to show for this
 * owner: no profile yet, a hidden (deleted or hibernated) account, or any
 * owner that is not an account id (the API answers those as absent).
 */
const fetchProfile = async (principal: PrincipalText): Promise<UserProfile | undefined> =>
	(await getProfileApi(principal)) ?? undefined;

/**
 * Loads a user profile from the API or returns a default shell, keyed by the
 * owner.
 */
export const getProfile = async (principal: PrincipalText): Promise<KeyedDoc<UserProfile>> => ({
	key: principal,
	data: (await fetchProfile(principal)) ?? emptyProfile(principal)
});

/**
 * The signed-in user's own profile for the app-shell hydration. Returns the
 * default shell (with `existed: false`) for a freshly created account that has
 * no stored profile yet, so the onboarding drain runs its new-user branch.
 */
export const loadProfileShell = async (
	owner: PrincipalText
): Promise<{ profile: UserProfile; existed: boolean }> => {
	const profile = await getMyProfileApi();

	return isNullish(profile)
		? { profile: emptyProfile(owner), existed: false }
		: { profile, existed: true };
};

/**
 * Populates `profilesStore` with the principals that aren't already cached.
 * Use this from any surface that renders a counterpart's name/avatar
 * (activity feed, market recent trades, market discussion, friends list, …)
 * instead of keeping a per-component `Map` and a per-component fetch loop.
 *
 * Failures for individual principals are swallowed: the cache simply won't
 * have an entry, and the UI is expected to fall back to a shortened
 * principal. This mirrors what every existing caller was already doing.
 *
 * Only stored profiles are cached, never the default shell. A shell reads as
 * opted in to every sharing preference, so caching one for an owner with no
 * readable profile (a hidden account, or a ranking row keyed by an engine
 * principal) would let them past the leaderboard opt-out, which
 * fails closed on an uncached owner. Those owners are remembered for
 * {@link PROFILE_UNRESOLVED_RECHECK_MS} instead, so a large standings page
 * does not refetch them on every hydration, yet a profile created or
 * recovered meanwhile shows up without a reload.
 *
 * Fetches run in bounded batches ({@link PROFILE_HYDRATION_CONCURRENCY}) rather
 * than one big `Promise.all`: a large caller (e.g. the full Leaderboard) would
 * otherwise open a request per principal at once, saturating the browser's
 * per-host connection pool and starving every other in-flight call. Batching
 * paces the burst without dropping any principal.
 */
const PROFILE_HYDRATION_CONCURRENCY = 25;

const PROFILE_UNRESOLVED_RECHECK_MS = 5 * MINUTE_IN_MS;

/** Owner → when the backend last answered that it has no profile to show. */
const unresolvedProfileOwners = new Map<PrincipalText, number>();

const isRecentlyUnresolved = ({
	principal,
	nowMs
}: {
	principal: PrincipalText;
	nowMs: number;
}): boolean => {
	const markedAtMs = unresolvedProfileOwners.get(principal);

	return nonNullish(markedAtMs) && nowMs - markedAtMs < PROFILE_UNRESOLVED_RECHECK_MS;
};

export const loadProfilesByPrincipals = async ({
	principals
}: {
	principals: PrincipalText[];
}): Promise<void> => {
	const cached = get(profilesStore);
	const nowMs = Date.now();
	const unique = Array.from(new Set(principals)).filter(
		(principal) =>
			principal.length > 0 && !cached.has(principal) && !isRecentlyUnresolved({ principal, nowMs })
	);

	if (unique.length === 0) {
		return;
	}

	// `absent`: the backend answered with no profile; `failed`: the read
	// failed, so a later call may retry it.
	const results: ({ profile: UserProfile } | 'absent' | 'failed')[] = [];

	for (let start = 0; start < unique.length; start += PROFILE_HYDRATION_CONCURRENCY) {
		const batch = unique.slice(start, start + PROFILE_HYDRATION_CONCURRENCY);

		// Batches run sequentially to cap concurrency; within a batch the
		// per-principal fetches are parallel.
		const settled = await Promise.all(
			batch.map((principal) =>
				fetchProfile(principal).then(
					(profile) => (nonNullish(profile) ? { profile } : ('absent' as const)),
					() => 'failed' as const
				)
			)
		);

		results.push(...settled);
	}

	profilesStore.update((current) => {
		const next = new Map(current);

		for (let i = 0; i < unique.length; i++) {
			const result = results[i];

			if (result === 'absent') {
				unresolvedProfileOwners.set(unique[i], nowMs);
			} else if (result !== 'failed') {
				unresolvedProfileOwners.delete(unique[i]);
				next.set(unique[i], result.profile);
			}
		}

		return next;
	});
};

/**
 * Persist a partial `preferences` change through the serialized patch
 * queue, leaf-merging onto the freshest stored slice. Settings surfaces
 * and the preferences store own different leaves and fire independently;
 * routing them here (instead of a full-snapshot `upsertProfile` built
 * from a local mirror) is what keeps a sound/haptics/visibility toggle
 * from reverting the onboarding-picked `favoriteParticipantId` it never
 * had in its snapshot.
 *
 * `visibility` mirrors the top-level enum the wire format reads for
 * leaderboard / search filtering; pass it only when the change includes
 * `sharing.profileVisibility`.
 */
export const persistPreferences = ({
	principal,
	preferences,
	visibility
}: {
	principal: PrincipalText;
	preferences: Partial<UserProfile['preferences']>;
	visibility?: ProfileVisibility;
}): Promise<UserProfile> =>
	patchProfile({
		principal,
		patch: nonNullish(visibility) ? { preferences, visibility } : { preferences }
	});

// Serializes the fire-and-forget profile writers (daily streak + daily
// goal). Both fire on the same first swipe and the goal fires on every
// subsequent prediction, so without serialization their read-modify-
// write cycles interleave and an older snapshot clobbers a newer field
// (lost streak / goal progress). The queue runs each patch to
// completion before the next reads, so every patch sees the prior
// write and only overrides its own fields.
let profilePatchQueue: Promise<unknown> = Promise.resolve();

/**
 * A `patchProfile` patch may carry only the preference leaves it owns:
 * the queue merges them onto the freshest stored `preferences` rather
 * than replacing the whole slice. So a `favoriteSide`-only write can't
 * drop a concurrently-written `favoriteParticipantId`, and vice versa.
 */
type ProfilePatch = Omit<Partial<UserProfile>, 'preferences'> & {
	preferences?: Partial<UserProfile['preferences']>;
};

/**
 * Merge a partial field set onto the freshest profile doc, serialized
 * against other profile patches from this module. Reads the latest doc
 * inside the queued turn so concurrent patches never overlay a stale
 * snapshot. Best-effort: callers fire-and-forget; failures don't break
 * the chain.
 *
 * `preferences` is merged at the leaf level: a patch carrying a partial
 * `preferences` overrides only the keys it names and keeps every other
 * stored preference. A shallow `{ ...current, ...resolved }` would
 * replace the whole `preferences` object, so a partial patch built from
 * a stale snapshot (or one that simply omits a sibling) would silently
 * drop fields like the onboarding-picked `favoriteParticipantId`.
 */
const patchProfile = ({
	principal,
	patch
}: {
	principal: PrincipalText;
	// A static field set, or a function that derives the patch from the
	// freshest profile (e.g. `longestStreak = max(existing, dailyStreak)`),
	// evaluated inside the queued turn so it sees prior writes.
	patch: ProfilePatch | ((current: UserProfile) => ProfilePatch);
}): Promise<UserProfile> => {
	const run = profilePatchQueue.then(async () => {
		// The patch builds on the caller's own row (the session's, every stored
		// field), never on the public read of `principal`: the PUT below writes
		// the whole doc onto the session's account.
		const profileDoc = {
			key: principal,
			data: (await getMyProfileApi()) ?? emptyProfile(principal)
		};
		const resolved = typeof patch === 'function' ? patch(profileDoc.data) : patch;
		const data: UserProfile = {
			...profileDoc.data,
			...resolved,
			preferences: nonNullish(resolved.preferences)
				? { ...profileDoc.data.preferences, ...resolved.preferences }
				: profileDoc.data.preferences
		};

		await upsertProfile({ ...profileDoc, data });

		return data;
	});

	profilePatchQueue = run.catch(() => undefined);

	return run;
};

/**
 * Persist the user's daily-streak engine state. Called from Flow Mode
 * after `applyDailyStreakBump` flips the locally held value, so a
 * refresh mid-session doesn't reset the Flame stage.
 *
 * Best-effort: callers should fire-and-forget; the local UI already
 * reflects the bumped values for the rest of the session even if the
 * round-trip fails. Serialized via `patchProfile` so it can't clobber a
 * concurrent daily-goal write (and vice versa).
 */
export const persistDailyStreak = ({
	principal,
	dailyStreak,
	lastActiveDay
}: {
	principal: PrincipalText;
	dailyStreak: number;
	lastActiveDay: string;
}): Promise<UserProfile> =>
	patchProfile({
		principal,
		// `longestStreak` is the high-water mark of `dailyStreak`. Derive it
		// from the freshest doc inside the queued turn so this is the single
		// place the personal-best is maintained alongside the bump it tracks.
		patch: (current) => ({
			dailyStreak,
			lastActiveDay,
			longestStreak: Math.max(current.longestStreak ?? 0, dailyStreak)
		})
	});

/**
 * Record one committed Flow swipe against the server-authoritative daily
 * cap. The API owns the count: we send only our local-day key (the
 * `YYYY-MM-DD` from `todayKey`) as the rollover boundary, never a count,
 * and the server reads the caller's profile, rolls over by the key, and
 * writes the capped increment itself.
 *
 * The returned `{ dailyGoalDone, dailyGoalDate, capReached }` is the source
 * of truth for the cross-session daily hard cap, so a cleared or signed-out
 * client can no longer reset it. The Flow commit fires this without blocking
 * the swipe animation and reconciles the returned count into local state +
 * the mirror in `.then(...)`; on a transport failure it keeps the optimistic
 * local count but clamps it so the session never rises above the last value
 * the server confirmed for the day.
 */
export const recordFlowSwipe = ({
	dayKey
}: {
	dayKey: string;
}): Promise<{ dailyGoalDone: number; dailyGoalDate: string; capReached: boolean }> =>
	recordFlowSwipeApi({ dayKey });

/**
 * Persist the Menagerie celebration ledger: the set of `${slug}:${tier}` keys
 * the owner has already seen a reveal for. Drives the once-per-crossing guard:
 * the celebration host writes the full current earned set after seeding (first
 * load, silently) and after each genuine crossing.
 *
 * Best-effort and fire-and-forget: the reveal already played from the local
 * queue; a failed round-trip just means it may re-evaluate next load (the diff
 * engine is idempotent against the persisted ledger). The local `userStore` is
 * synced so the host's own detection settles immediately and doesn't re-fire.
 */
export const persistEarnedMenagerie = async ({
	owner,
	keys
}: {
	owner: PrincipalText;
	keys: string[];
}): Promise<void> => {
	// Reflect the ledger locally first so the always-mounted host's detection
	// pass sees the seeded / updated set on the next tick.
	userStore.update((current) =>
		current.profile && current.profile.owner === owner
			? { ...current, profile: { ...current.profile, earnedMenagerie: keys } }
			: current
	);

	try {
		await patchProfile({ principal: owner, patch: { earnedMenagerie: keys } });
	} catch (err: unknown) {
		console.warn('persistEarnedMenagerie failed', err instanceof Error ? err.message : err);
	}
};

/**
 * Full-doc PUT of the caller's profile: the server locks the caller's row,
 * applies the nickname and handle-cooldown guards, keeps the stored Flow daily
 * goal, and returns the stored result. The session identifies the row, so
 * `owner` and role in the body are ignored; the account email lives on the
 * auth identity, not the profile doc, so it is intentionally not sent here.
 */
export const upsertProfile = async (profileDoc: KeyedDoc<UserProfile>): Promise<void> => {
	// The session cookie, not `owner`, picks the row: refuse a snapshot of one
	// account while the cookie belongs to another (a sign-in in another tab),
	// rather than write it over that account's profile.
	await assertSessionOwner(profileDoc.key);
	await upsertMyProfileApi(profileDoc.data);
};

/**
 * Persist the onboarding picks (handle + backed team/side + completion flag) onto the freshest
 * profile doc, serialized through {@link patchProfile}'s queue.
 *
 * This goes through the patch queue rather than a full-snapshot {@link upsertProfile}: the other
 * profile writers (daily streak, preferences, Menagerie ledger) can fire during the post-signin
 * drain, and a full snapshot built from a stale profile would revert whatever they wrote. A
 * field-level patch on the freshest doc leaves those concurrent writes intact.
 *
 * `setHandle` is gated by the caller's availability probe; pass `true` only when the picked handle
 * is free. The handle-change cooldown stamp is decided here against the FRESH stored nickname so a
 * concurrent rename can't desync it.
 *
 * Resolves to `{ profile, handleApplied }`. `handleApplied` is `false` when the handle was never
 * requested (`setHandle: false`) OR when it was claimed in the TOCTOU window between the caller's
 * probe and this write (the API rejects the whole doc with "already taken"): in that case
 * the handle is dropped and the rest of the picks are retried so team/side/completion, which are
 * independent of the handle, still persist. The caller maps `setHandle && !handleApplied` to a
 * collision toast.
 */
export const applyOnboardingPicks = async ({
	principal,
	handle,
	setHandle,
	interests,
	favoriteParticipantId,
	favoriteSide
}: {
	principal: PrincipalText;
	handle: string | null;
	setHandle: boolean;
	interests?: string[];
	favoriteParticipantId: string;
	favoriteSide: string;
}): Promise<{ profile: UserProfile; handleApplied: boolean }> => {
	const buildPatch =
		(includeHandle: boolean) =>
		(current: UserProfile): ProfilePatch => {
			// Only the onboarding-owned preference leaves: `patchProfile`
			// merges them onto the freshest stored `preferences`, so a
			// concurrent write to a sibling preference can't be reverted here.
			const patch: ProfilePatch = {
				preferences: {
					favoriteParticipantId,
					favoriteSide,
					onboardingCompleted: true
				}
			};

			if (nonNullish(interests)) {
				patch.interests = interests;
			}

			if (includeHandle && nonNullish(handle)) {
				patch.nickname = handle;

				// Stamp the handle-change time only on a real change so the
				// profile write accepts it; the default
				// nickname almost always differs from the picked handle.
				if (isHandleChange({ next: handle, current: current.nickname ?? '' })) {
					patch.handleLastChangeMs = Date.now();
				}
			}

			return patch;
		};

	if (!setHandle || isNullish(handle)) {
		return {
			profile: await patchProfile({ principal, patch: buildPatch(false) }),
			handleApplied: false
		};
	}

	try {
		return {
			profile: await patchProfile({ principal, patch: buildPatch(true) }),
			handleApplied: true
		};
	} catch (err: unknown) {
		const message = err instanceof Error ? err.message : '';

		// TOCTOU: the handle was free at the caller's probe but got claimed before this write
		// landed, so the API rejected the whole doc. Retry WITHOUT the handle so the rest of
		// the picks still persist; the caller surfaces the collision and the user renames later.
		if (message.includes('already taken')) {
			return {
				profile: await patchProfile({ principal, patch: buildPatch(false) }),
				handleApplied: false
			};
		}

		throw err;
	}
};

/**
 * Case-insensitive profile search over nickname and owner.
 */
export const searchProfiles = (query: string): Promise<UserProfile[]> => searchProfilesApi(query);

/**
 * Whether writing `next` over `current` changes the handle, so the write must
 * stamp `handleLastChangeMs` and the cooldown applies. Compared on the handle
 * key the API's cooldown compares, so tidying `José` to `jose` or `a.b` to
 * `ab` is free.
 */
export const isHandleChange = ({ next, current }: { next: string; current: string }): boolean =>
	handleUniqueKey(next) !== handleUniqueKey(current);

/**
 * Outcome of a nickname availability probe. The FE uses this to render typed
 * inline errors (instead of regex-parsing thrown messages).
 */
export type NicknameAvailability =
	{ available: true } | { available: false; reason: HandleRefusal };

/**
 * Pre-flight check for the create-account and profile-edit flows. Runs
 * through the same validator the profile write uses, so a `true` here means
 * the next write will not be vetoed for nickname reasons. The API excludes the
 * caller's own current nickname via the session, so the user is not told
 * their own nickname is taken.
 */
export const checkNicknameAvailability = async ({
	nickname
}: {
	nickname: string;
}): Promise<NicknameAvailability> => {
	const result = await checkNicknameAvailabilityApi(nickname);

	if (result.available) {
		return { available: true };
	}

	return { available: false, reason: result.reason ?? 'taken' };
};

/**
 * When the signed-in user joined, in milliseconds, for the Settings "Joined"
 * line: the session account's creation time. `undefined` when unknown.
 */
export const getMyJoinedAtMs = (): number | undefined => {
	const joinedAtMs = Date.parse(getSessionUser()?.createdAt ?? '');

	return Number.isNaN(joinedAtMs) ? undefined : joinedAtMs;
};

/**
 * Persists the signed-in user's email onto their own profile row. The PUT is a
 * full-doc write, so this read-modify-writes the stored profile. With no
 * profile row yet the address already rides the auth identity (sign-in is
 * email-verified), and writing a default shell here would falsely flip a fresh
 * account to "existed" for the onboarding drain, so it skips instead.
 */
export const saveMyEmail = async ({
	principal,
	email
}: {
	principal: PrincipalText;
	email: string;
}): Promise<void> => {
	await assertSessionOwner(principal);

	const profile = await getMyProfileApi();

	if (isNullish(profile)) {
		return;
	}

	await upsertMyProfileApi({ ...profile, email });
};

/**
 * Record that the user did something predictable today: bumps the
 * daily-streak engine and persists the result. Currently called from
 * the trade-execution path (`placeOrder`) so a successful trade keeps
 * the Flame alive for the day.
 *
 * Uses the same `applyDailyStreakBump` engine as Flow Mode, so the
 * two writers produce identical values for the same local day: no
 * race, no UTC-vs-local drift. Same-day calls early-return without
 * a write.
 */
export const recordActivity = async (principal: PrincipalText): Promise<void> => {
	const profileDoc = await getProfile(principal);
	const bump = applyDailyStreakBump({
		streak: profileDoc.data.dailyStreak ?? 0,
		lastActiveDay: profileDoc.data.lastActiveDay
	});

	if (!bump.bumped) {
		return;
	}

	// Re-evaluate so streak-driven achievements (`marathon`) can fire
	// on the very write that crosses the threshold. The other achievement
	// axes (trades, accuracy, contrarian, league-founder, top-decile)
	// re-use the persisted values; they're not the trigger here, and any
	// already-earned sticky award stays unlocked through the merge.
	// `ownsQualifyingLeague` is left `false`: this path never flips
	// `league-founder` on, but it can't rescind one either, since unlocks
	// are sticky.
	const evaluations = evaluateAchievements({
		totalTrades: profileDoc.data.totalTrades ?? 0,
		winStreak: profileDoc.data.streak ?? 0,
		dailyStreak: bump.streak,
		accuracy: profileDoc.data.accuracy ?? 0,
		contrarianWins: profileDoc.data.contrarianWins ?? 0,
		ownsQualifyingLeague: false,
		topDecileStreak: profileDoc.data.topDecileStreak ?? 0,
		// Reuse the persisted monthly-award state so this path can't rescind
		// a sticky unlock (the `marathon` daily-streak bump is the only
		// trigger here).
		sharpestEyeBestTier: profileDoc.data.sharpestEyeBestTier,
		wonBoldCallerMonth: (profileDoc.data.unlockedAchievements ?? []).includes('bold-caller')
	});

	const { unlocked, newlyUnlocked } = mergeUnlockedAchievements({
		previouslyUnlocked: profileDoc.data.unlockedAchievements ?? [],
		evaluations
	});

	const bonusXp = newlyUnlocked.reduce((acc, evaluation) => acc + evaluation.def.xp, 0);
	const points = (profileDoc.data.points ?? 0) + bonusXp;
	const level = bonusXp > 0 ? Math.floor(points / 500) + 1 : (profileDoc.data.level ?? 1);

	// Patch via the shared queue so this orders against the overlapping
	// `persistDailyStreak` writer on the same trade.
	await patchProfile({
		principal,
		patch: {
			dailyStreak: bump.streak,
			// Keep the personal-best in lock-step with the bump (same
			// high-water-mark rule as `persistDailyStreak`).
			longestStreak: Math.max(profileDoc.data.longestStreak ?? 0, bump.streak),
			lastActiveDay: bump.lastActiveDay,
			points,
			level,
			unlockedAchievements: unlocked
		}
	});

	notifyAchievementsUnlocked(newlyUnlocked);
};
