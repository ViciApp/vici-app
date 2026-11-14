import { MINUTE_IN_MS } from '#lib/constants/app.constants.ts';
import { Collection } from '#lib/constants/collections.constants.ts';
import { DAILY_HARD_CAP } from '#lib/constants/flow-rewards.constants.ts';
import {
	handleCooldownDaysLeft,
	MIN_NICKNAME_LENGTH,
	NICKNAME_PATTERN,
	nicknameUniqueKey
} from '#lib/constants/profile.constants.ts';
import type { UserRole } from '#lib/enums/user.ts';
import type { UserProfile } from '#lib/types/profile.ts';
import { visibilityFromProfile } from '#lib/utils/visibility.utils.ts';
import { assertNewProfileAllowed } from '#satellite/services/new-profile-gate.services.ts';
import { mintFlowOvertime } from '#satellite/services/vxp-flow-awards.services.ts';
import { timeMs } from '#satellite/utils/time.utils.ts';
import { isNullish, nonNullish } from '@dfinity/utils';
import type { AssertSetDocContext } from '@junobuild/functions';
import { msgCaller } from '@junobuild/functions/ic-cdk';
import {
	decodeDocData,
	encodeDocData,
	getDocStore,
	listDocsStore,
	setDocStore
} from '@junobuild/functions/sdk';
import type { PrincipalText } from '@junobuild/schema';

/**
 * Hydrates AND sanitizes a profile read from the datastore so every field
 * matches `UserProfileSchema` exactly before the value crosses the JS→Rust
 * boundary inside the satellite.
 *
 * Two failure modes to defend against:
 *
 * 1. **Missing required nested fields**: profile docs predate several
 *    fields (most recently `preferences.defaultAmount`), so the Sputnik
 *    JsonData→Candid encoder would trap with `Error converting from js
 *    'JsonData' into type 'Candid': missing field <name>` on the first
 *    legacy row. Fix: backfill nested defaults explicitly.
 *
 * 2. **Extra unknown fields**: older code stored fields like `bio` or
 *    `createdAt`/`updatedAt` that have since been removed from the
 *    schema. `defineQuery`'s result parse validates each row against
 *    `UserProfileSchema`, which uses `strictObject` and *rejects* unknown
 *    keys. A single polluted row makes the whole array parse throw,
 *    `jsResult` is never set, and the Rust caller reads a stale/empty
 *    payload and traps with the misleading `missing field default_amount`
 *    message. Fix: only forward the keys the schema actually knows about.
 *
 * `app_get_profile` happens to work on clean rows because there's only
 * one to encode and it passes parse; `app_list_leaderboard` iterates
 * everyone and hits the first dirty row. So keep this helper authoritative,
 * and keep it in sync with `UserProfileSchema`
 * (`src/lib/schema/profile.schema.ts`).
 */
export const withProfileDefaults = (profile: UserProfile): UserProfile => {
	const incoming = profile.preferences;
	const sanitizedPreferences: UserProfile['preferences'] = {
		defaultAmount: {
			flow: incoming?.defaultAmount?.flow ?? '0',
			manual: incoming?.defaultAmount?.manual ?? '0'
		},
		notify: {
			streakReminder: incoming?.notify?.streakReminder ?? true,
			marketAlerts: incoming?.notify?.marketAlerts ?? true,
			friendActivity: incoming?.notify?.friendActivity ?? false,
			weeklyDigest: incoming?.notify?.weeklyDigest ?? true
		},
		flowSessionLength: incoming?.flowSessionLength ?? 10,
		hapticsEnabled: incoming?.hapticsEnabled ?? true,
		soundEnabled: incoming?.soundEnabled ?? true,
		sharing: {
			profileVisibility:
				incoming?.sharing?.profileVisibility === 'public' ||
				incoming?.sharing?.profileVisibility === 'friends' ||
				incoming?.sharing?.profileVisibility === 'private'
					? incoming.sharing.profileVisibility
					: // No stored sharing slice: derive from the canonical top-level
						// `visibility` so legacy rows reflect their actual visibility
						// (FRIENDS_ONLY → 'private') instead of defaulting to public.
						visibilityFromProfile(profile.visibility),
			callsPublic: incoming?.sharing?.callsPublic ?? true,
			leaderboardOptIn: incoming?.sharing?.leaderboardOptIn ?? true,
			worldsOptIn: incoming?.sharing?.worldsOptIn ?? true
		},
		flowTags: Array.isArray(incoming?.flowTags) ? incoming.flowTags : [],
		worldCupMode: incoming?.worldCupMode ?? false,
		savedMarketIds: Array.isArray(incoming?.savedMarketIds) ? incoming.savedMarketIds : [],
		favoriteParticipantId: incoming?.favoriteParticipantId ?? '',
		favoriteSide:
			incoming?.favoriteSide === 'YES' || incoming?.favoriteSide === 'NO'
				? incoming.favoriteSide
				: '',
		onboardingCompleted: incoming?.onboardingCompleted ?? false
	};

	return {
		owner: profile.owner,
		nickname: profile.nickname ?? '',
		avatar: profile.avatar ?? '',
		// Serialized faceted-avatar picks. A legacy row that predates the
		// field decodes as absent; backfill to '' (no saved picks → the
		// surface falls back to a principal-seeded face).
		avatarParts: profile.avatarParts ?? '',
		pnl: profile.pnl ?? 0,
		visibility: profile.visibility,
		role: profile.role,
		totalTrades: profile.totalTrades ?? 0,
		winRate: profile.winRate ?? 0,
		dailyStreak: profile.dailyStreak ?? 0,
		// Best daily-streak ever reached. Defaults to 0 for legacy rows; the
		// next streak bump self-heals it up to the current `dailyStreak`.
		longestStreak: profile.longestStreak ?? 0,
		dailyGoalDone: profile.dailyGoalDone ?? 0,
		dailyGoalDate: profile.dailyGoalDate,
		streak: profile.streak ?? 0,
		accuracy: profile.accuracy ?? 0,
		points: profile.points ?? 0,
		level: profile.level ?? 1,
		archetype: profile.archetype ?? '',
		interests: profile.interests ?? [],
		lastActiveDay: profile.lastActiveDay,
		// Forward the soft-delete marker verbatim (Delete account v2). It's
		// `optional()` in the schema, so an absent value stays absent (active
		// account) and a present value round-trips unchanged.
		deletedAtMs: profile.deletedAtMs,
		// Forward the hibernation marker verbatim (Delete account v2: the
		// reversible sibling of soft-delete). Same `optional()` round-trip
		// semantics as `deletedAtMs`: absent stays absent (active), present
		// round-trips unchanged.
		hibernatedAtMs: profile.hibernatedAtMs,
		unlockedAchievements: profile.unlockedAchievements ?? [],
		contrarianWins: profile.contrarianWins ?? 0,
		// Rarest single upset (smallest winning execution consensus, drives
		// Octopus). `optional()` so an absent value (no settled win yet)
		// round-trips unchanged.
		bestUpsetConsensus: profile.bestUpsetConsensus,
		// Longest consecutive-win run ever (drives Snake). Defaults to 0 for
		// legacy rows; the next stats sync recomputes it from history.
		onFireStreak: profile.onFireStreak ?? 0,
		// Cold-streak recoveries (drives Honey Badger). Defaults to 0 for
		// legacy rows; the next stats sync recomputes it from history.
		comebacks: profile.comebacks ?? 0,
		// Winning-category breadth (drives Magpie). Defaults to 0 for legacy
		// rows; the next stats sync recomputes it from history + market tags.
		winningCategories: profile.winningCategories ?? 0,
		// League-life milestones (drive Bee). Default to 0 for legacy rows;
		// the next stats sync recomputes them from memberships / battles.
		leaguesJoined: profile.leaguesJoined ?? 0,
		boutsWon: profile.boutsWon ?? 0,
		leaguesFounded: profile.leaguesFounded ?? 0,
		// Top-decile streak state (drives the `top-decile` achievement).
		// `topDecileStreak` defaults to 0 for legacy rows; `lastTopDecileDay`
		// is `optional()` so an absent value (never evaluated) round-trips
		// unchanged.
		topDecileStreak: profile.topDecileStreak ?? 0,
		lastTopDecileDay: profile.lastTopDecileDay,
		// Best monthly sharpest-eye tier (drives the `sharpest-eye` album
		// award). `optional()` so an absent value (never placed) round-trips
		// unchanged.
		sharpestEyeBestTier: profile.sharpestEyeBestTier,
		// Alma Mater verification state (drives the verification pill on the
		// profile's school slot). `optional()` so an absent value (no school /
		// never set) round-trips unchanged.
		schoolStatus: profile.schoolStatus,
		// Celebrated Menagerie tier keys (achievement trophy layer). `optional()`
		// so an absent value (never seeded → first load seeds silently)
		// round-trips unchanged; a present array round-trips verbatim.
		earnedMenagerie: profile.earnedMenagerie,
		// Handle-change cooldown timestamp (drives the 30-day handle limit).
		// `optional()` so an absent value (never changed) round-trips unchanged.
		handleLastChangeMs: profile.handleLastChangeMs,
		preferences: sanitizedPreferences
	};
};

/**
 * A `YYYY-MM-DD` local-day key is well-formed iff its parsed components
 * round-trip exactly through a UTC date (so `2026-02-31`, which `Date`
 * would silently normalize to March 3, is rejected). The satellite has
 * no notion of the caller's timezone, so it does NOT compute the day
 * itself; it accepts the client's local-day key and uses it only as the
 * rollover boundary. The structural check here is the only validation:
 * forging a different (valid) key to dodge the cap is an adversarial
 * bypass that's explicitly out of scope for the honest-reset fix.
 */
const isWellFormedDayKey = (key: string): boolean => {
	const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(key);

	if (isNullish(match)) {
		return false;
	}

	const year = Number(match[1]);
	const month = Number(match[2]);
	const day = Number(match[3]);
	const date = new Date(Date.UTC(year, month - 1, day));

	return (
		date.getUTCFullYear() === year && date.getUTCMonth() === month - 1 && date.getUTCDate() === day
	);
};

/** Outcome of {@link recordFlowSwipeFn}. */
export interface RecordFlowSwipeResult {
	/** The authoritative count of Flow swipes recorded for `dailyGoalDate`. */
	dailyGoalDone: number;
	/** The local-day key (`YYYY-MM-DD`) the count belongs to. */
	dailyGoalDate: string;
	/** `true` once `dailyGoalDone` has reached {@link DAILY_HARD_CAP}. */
	capReached: boolean;
}

/**
 * Authoritative per-swipe daily-counter increment: the satellite owns the
 * Flow daily hard cap, not the client.
 *
 * The client never sends a count: it sends only its local-day key
 * (`YYYY-MM-DD`, computed FE-side via `todayKey`), which the server uses
 * solely as the rollover boundary. The server reads the caller's own
 * profile and:
 *
 *  - if the stored `dailyGoalDate` equals `dayKey`, increments the stored
 *    `dailyGoalDone` (capped at {@link DAILY_HARD_CAP});
 *  - otherwise starts the day fresh at 1 under `dayKey`.
 *
 * The result is written back via a version-locked `setDocStore` (PROFILES
 * is user-owned, so the write is authorised by the REAL caller, never an
 * admin key). With the monotonic-per-day assert as the backstop, a cleared
 * or stale client can no longer roll the count backward within a day, so
 * the cap survives reloads, cleared storage, sign-outs, and device
 * switches. A caller with no profile yet (not onboarded) is a no-op that
 * reports a 1-of-cap day so the FE can still gate the session.
 */
export const recordFlowSwipeFn = async ({
	dayKey
}: {
	dayKey: string;
}): Promise<RecordFlowSwipeResult> => {
	if (!isWellFormedDayKey(dayKey)) {
		throw new Error('dayKey must be a well-formed YYYY-MM-DD local-day key.');
	}

	const caller = msgCaller();
	const callerText = caller.toText();
	const callerBytes = caller.toUint8Array();

	const profileDoc = getDocStore({
		collection: Collection.PROFILES,
		key: callerText,
		caller: callerBytes
	});

	// A swipe only ever comes from a signed-in caller, who always has a
	// profile (created at onboarding); a missing doc here means a broken or
	// half-created account. Fail fast rather than fabricate an
	// authoritative-shaped count: the Flow commit's catch clamps the
	// optimistic tally to the last server-confirmed value, so a rejection
	// degrades gracefully instead of silently re-opening the cap.
	if (isNullish(profileDoc)) {
		throw new Error('Cannot record a Flow swipe: the caller has no profile.');
	}

	const profile = decodeDocData<UserProfile>(profileDoc.data);

	// Roll over by the client's local-day key: a stored count for any other
	// day has elapsed, so the new day starts at 0 before this swipe.
	const prevForDay = profile.dailyGoalDate === dayKey ? (profile.dailyGoalDone ?? 0) : 0;
	const dailyGoalDone = Math.min(DAILY_HARD_CAP, Math.max(0, prevForDay) + 1);

	const next = withProfileDefaults({ ...profile, dailyGoalDone, dailyGoalDate: dayKey });

	setDocStore({
		collection: Collection.PROFILES,
		key: callerText,
		caller: callerBytes,
		doc: {
			data: encodeDocData<UserProfile>(next),
			version: profileDoc.version
		}
	});

	const capReached = dailyGoalDone >= DAILY_HARD_CAP;

	// Overtime VXP is minted here, inline: the counter write above uses
	// `setDocStore`, which fires no `onSetDoc` hook, so an award hook would
	// never see it. `mintFlowOvertime` is idempotent per day and never
	// throws, so a payout hiccup can't corrupt the swipe-count result.
	if (capReached) {
		await mintFlowOvertime({ caller: callerBytes, recipient: callerText, dayKey });
	}

	return { dailyGoalDone, dailyGoalDate: dayKey, capReached };
};

/**
 * A profile is soft-deleted (Delete account v2) iff `deletedAtMs` is
 * present. Absence is the meaningful "active account" state: see the
 * field comment in `src/lib/schema/profile.schema.ts`. Used by the
 * PUBLIC profile reads to make a deleted user disappear from
 * leaderboard / search / direct lookup. `getProfile` additionally lets
 * the owner read their own soft-deleted doc (it knows the caller and the
 * looked-up principal), and the owner's raw read via Juno `getDoc` is
 * also never gated: both so the FE can still offer recovery within the
 * window.
 */
export const isSoftDeleted = (profile: Pick<UserProfile, 'deletedAtMs'>): boolean =>
	nonNullish(profile.deletedAtMs);

/**
 * A profile is hibernated (Delete account v2: the reversible sibling of
 * soft-delete) iff `hibernatedAtMs` is present. Absence is the meaningful
 * "active account" state: see the field comment in
 * `src/lib/schema/profile.schema.ts`. Hibernation is fully reversible: no
 * data is removed, the owner can `resumeMyAccount` at any time. While
 * hibernated the account freezes its shared stats (it's inactive) and
 * hides from public reads, but the owner's own `getDoc` read still sees
 * the marker so the FE can offer resume.
 */
export const isHibernated = (profile: Pick<UserProfile, 'hibernatedAtMs'>): boolean =>
	nonNullish(profile.hibernatedAtMs);

/**
 * A profile is hidden from PUBLIC reads iff it's either soft-deleted OR
 * hibernated (Delete account v2). Both states make the account disappear
 * from the leaderboard / search / direct lookup; they differ in
 * reversibility (soft-delete is a delete-with-grace-window, hibernation is
 * a reversible pause) but share the "vanish from public surfaces"
 * behaviour. The owner's own profile read goes through Juno `getDoc` (not
 * these endpoints) and is intentionally NOT gated, so the FE can still
 * offer recovery (soft-delete) or resume (hibernation).
 */
export const isPubliclyHidden = (
	profile: Pick<UserProfile, 'deletedAtMs' | 'hibernatedAtMs'>
): boolean => isSoftDeleted(profile) || isHibernated(profile);

export const getProfile = (principal: PrincipalText): UserProfile | undefined => {
	const caller = msgCaller();

	const profileDoc = getDocStore({
		collection: Collection.PROFILES,
		key: principal,
		caller
	});

	if (isNullish(profileDoc)) {
		return;
	}

	const profile = decodeDocData<UserProfile>(profileDoc.data);

	// Public lookup: a soft-deleted OR hibernated account is invisible to
	// OTHER callers, but the owner can always read their own (possibly
	// hidden) doc: the FE relies on this to drive recovery / resume within
	// the window, so the query agrees with the raw Juno `getDoc` path
	// instead of hiding the state only there.
	if (isPubliclyHidden(profile) && caller.toText() !== principal) {
		return;
	}

	const roleDoc = getDocStore({
		collection: Collection.ROLES,
		key: profile.owner,
		caller
	});

	return withProfileDefaults({
		...profile,
		role: roleDoc ? decodeDocData<{ role: UserRole }>(roleDoc.data).role : undefined
	});
};

export const searchProfiles = (query: string): UserProfile[] => {
	const caller = msgCaller();

	const lowerQuery = query.toLowerCase();

	const { items } = listDocsStore({
		collection: Collection.PROFILES,
		caller,
		params: {}
	});

	return (
		items
			.map(([_, item]) => decodeDocData<UserProfile>(item.data))
			// Public search: soft-deleted OR hibernated accounts are
			// invisible (Delete account v2). Drop them before the role
			// lookup + hydrate.
			.filter((profile) => !isPubliclyHidden(profile))
			.map((profile) => {
				const roleDoc = getDocStore({
					collection: Collection.ROLES,
					key: profile.owner,
					caller
				});

				return withProfileDefaults({
					...profile,
					role: roleDoc ? decodeDocData<{ role: UserRole }>(roleDoc.data).role : undefined
				});
			})
			.filter((p) => {
				const matches = [p.nickname, p.owner].some((val) => val.toLowerCase().includes(lowerQuery));

				return matches;
			})
	);
};

/**
 * Outcome of a nickname validity + uniqueness check. Returned by
 * `checkNicknameAvailability` so the FE can render typed inline errors
 * without parsing error strings.
 *
 * `reason` is set only when `available` is `false`:
 * - `required`: empty / whitespace.
 * - `too_short`: under `MIN_NICKNAME_LENGTH`.
 * - `invalid`: contains characters outside `NICKNAME_PATTERN`
 *                 (`[a-z0-9._-]`), e.g. a space in the middle.
 * - `taken`: another principal already owns this nickname.
 */
export type NicknameAvailability =
	| { available: true }
	| { available: false; reason: 'required' | 'too_short' | 'invalid' | 'taken' };

/**
 * Shared nickname validator. Used by both the `setDoc` assertion (write-time
 * guard) and the `checkNicknameAvailability` query (read-time hint), so the
 * UI and the satellite always agree on what "taken" means.
 *
 * `excludeKey` is the doc key (principal) to skip when scanning for
 * collisions: pass the editing user's principal so a user's own current
 * nickname doesn't count as a conflict.
 */
export const checkNicknameAvailabilityFn = ({
	nickname,
	excludeKey
}: {
	nickname: string | undefined | null;
	excludeKey?: string;
}): NicknameAvailability => {
	if (isNullish(nickname) || nickname.trim() === '') {
		return { available: false, reason: 'required' };
	}

	const trimmedNickname = nickname.trim();

	if (trimmedNickname.length < MIN_NICKNAME_LENGTH) {
		return { available: false, reason: 'too_short' };
	}

	// Charset guard (server-authoritative): reject whitespace, `@` and other
	// out-of-charset chars a direct `setDoc` could smuggle past the FE. Tested
	// on the RAW value (the stored one), not `trimmedNickname`, so surrounding
	// whitespace is rejected too. The pattern allows upper/lowercase + accents.
	if (!NICKNAME_PATTERN.test(nickname)) {
		return { available: false, reason: 'invalid' };
	}

	// Uniqueness folds case + accents (`José` = `JOSE` = `jose`); the stored
	// value keeps the owner's form.
	const proposedKey = nicknameUniqueKey(nickname);

	const caller = msgCaller();

	const { items } = listDocsStore({
		collection: Collection.PROFILES,
		caller,
		params: {}
	});

	const hasConflict = items
		.filter(([key]) => key !== excludeKey)
		.some(([, item]) => {
			try {
				const existingProfile = decodeDocData<UserProfile>(item.data);

				return nicknameUniqueKey(existingProfile.nickname ?? '') === proposedKey;
			} catch (_: unknown) {
				return false;
			}
		});

	if (hasConflict) {
		return { available: false, reason: 'taken' };
	}

	return { available: true };
};

/**
 * Tolerance (ms) for the "is `handleLastChangeMs` set to ~now?" check on an
 * allowed handle change. The FE stamps `Date.now()` before the update is
 * submitted, so by the time the assert runs the value is a few hundred ms in
 * the past relative to the satellite's `time()`. Allow a small slack on both
 * sides (clock skew + request latency) but reject values that are clearly
 * stale or in the future: the client must not be trusted to backdate the
 * stamp and dodge the cooldown.
 */
const HANDLE_LAST_CHANGE_TOLERANCE_MS = 5 * MINUTE_IN_MS;

// Handle-change detection uses the uniqueness fold, so re-casing/re-accenting
// your own handle isn't a "change" (no cooldown, no new stamp): the stored
// value still updates.
const normalizeNickname = (nickname: string | undefined | null): string =>
	nicknameUniqueKey(nickname ?? '');

/**
 * Set-profile assertion for the `profiles` collection. Two concerns:
 *
 * 1. **Nickname validity + uniqueness**: the shared
 *    {@link checkNicknameAvailabilityFn} (write-time guard mirroring the
 *    read-time availability probe).
 * 2. **Handle-change cooldown**: the handle is the `nickname` field. It can
 *    only change once every {@link HANDLE_COOLDOWN_DAYS} days. This is the
 *    server-authoritative half of the rule (the {@link HandleEditor} mirrors
 *    it client-side). When the normalized nickname CHANGES versus the stored
 *    doc, reject the write if the stored `handleLastChangeMs` is still inside
 *    the window, and otherwise require the proposed doc to stamp
 *    `handleLastChangeMs` to ~now (validated against the message `time()` so
 *    a client can't backdate it). When the nickname is UNCHANGED,
 *    `handleLastChangeMs` must not move.
 */
export const assertValidNickname = ({
	data: {
		collection,
		key: documentKey,
		data: { proposed, current }
	}
}: AssertSetDocContext) => {
	if (collection !== Collection.PROFILES) {
		return;
	}

	const proposedProfile = decodeDocData<UserProfile>(proposed.data);
	const { nickname } = proposedProfile;

	const currentProfile = nonNullish(current) ? decodeDocData<UserProfile>(current.data) : undefined;

	// A first write (no stored doc) seeds the handle; an update where the
	// normalized nickname differs sets a NEW handle. Both must clear the
	// validity + uniqueness guard. An update that leaves the nickname
	// untouched must NOT: the stored handle is grandfathered (it already
	// passed, or predates, these rules), and the uniqueness probe is a FULL
	// collection scan, so running it on every routine profile write (streak
	// bumps, stats syncs, the email migration's rewrites) made each write
	// O(collection) for no protective value.
	const settingNewHandle =
		isNullish(currentProfile) ||
		normalizeNickname(proposedProfile.nickname) !== normalizeNickname(currentProfile.nickname);

	if (settingNewHandle) {
		const result = checkNicknameAvailabilityFn({ nickname, excludeKey: documentKey });

		if (!result.available) {
			if (result.reason === 'required') {
				throw new Error('Nickname is required.');
			}

			if (result.reason === 'too_short') {
				throw new Error(`Nickname must be at least ${MIN_NICKNAME_LENGTH} characters.`);
			}

			if (result.reason === 'invalid') {
				throw new Error(
					`The handle "${nickname}" contains invalid characters — use lowercase letters, numbers and . _ - only (no spaces).`
				);
			}

			throw new Error(`The nickname "${nickname}" is already taken.`);
		}
	}

	const proposedLastChangeMs = proposedProfile.handleLastChangeMs;
	const nowMs = timeMs();

	// First write (account creation): there is no stored handle yet, so this
	// is not a cooldown-gated change. Only guard against a forged future /
	// stale stamp if the client set one at all.
	if (isNullish(currentProfile)) {
		if (
			nonNullish(proposedLastChangeMs) &&
			Math.abs(proposedLastChangeMs - nowMs) > HANDLE_LAST_CHANGE_TOLERANCE_MS
		) {
			throw new Error('handleLastChangeMs must be set to the current time on a handle change.');
		}

		return;
	}

	const currentLastChangeMs = currentProfile.handleLastChangeMs;

	if (!settingNewHandle) {
		// Nickname unchanged → the cooldown stamp is immutable. Treat absent
		// on both sides as equal.
		if ((proposedLastChangeMs ?? null) !== (currentLastChangeMs ?? null)) {
			throw new Error('handleLastChangeMs cannot change unless the handle changes.');
		}

		return;
	}

	// Nickname changed → enforce the cooldown against the STORED timestamp.
	const daysLeft = handleCooldownDaysLeft({ lastChangeMs: currentLastChangeMs, nowMs });

	if (daysLeft > 0) {
		throw new Error(
			`The handle was changed recently — it can be changed again in ${daysLeft} day(s).`
		);
	}

	// Allowed change: the proposed doc must stamp the change time to ~now.
	// Reject an absent / stale / future value so the client can't dodge the
	// next cooldown window by under-reporting the change time.
	if (
		isNullish(proposedLastChangeMs) ||
		Math.abs(proposedLastChangeMs - nowMs) > HANDLE_LAST_CHANGE_TOLERANCE_MS
	) {
		throw new Error('handleLastChangeMs must be set to the current time on a handle change.');
	}
};

/**
 * Backstop for the server-authoritative Flow daily cap: any direct client
 * `set_doc` to PROFILES must not roll the daily counter backward within a
 * day, nor push it past {@link DAILY_HARD_CAP}.
 *
 * `recordFlowSwipe` is the normal write path (it computes the count
 * server-side); this assert ensures a stale or cleared client, which
 * re-fetches the profile, sees a lower count, and `set_doc`s the whole
 * doc back, can't overwrite the authoritative total downward and re-open
 * a fresh allotment (the reported honest-reset leak).
 *
 * Rules, comparing the proposed doc against the CURRENT stored doc:
 *
 *  - First write (no stored doc) → allowed, but still capped at the hard
 *    cap so a forged first profile can't seed an over-cap count.
 *  - `dailyGoalDate` advances (a genuine new day) → reset to any value
 *    within `0..cap` is allowed.
 *  - `dailyGoalDate` unchanged → the proposed `dailyGoalDone` may not be
 *    LOWER than the stored one, and may not exceed the hard cap.
 *
 * Manipulating `dailyGoalDate` to a different (valid) day to force a reset
 * is an adversarial bypass, out of scope for the honest-reset fix.
 */
export const assertDailyGoalMonotonic = ({
	data: {
		collection,
		data: { proposed, current }
	}
}: AssertSetDocContext) => {
	if (collection !== Collection.PROFILES) {
		return;
	}

	const proposedProfile = decodeDocData<UserProfile>(proposed.data);
	const proposedDone = proposedProfile.dailyGoalDone ?? 0;

	// Reject non-integer / negative / non-finite counts outright: the cap
	// invariant assumes a whole-number tally in [0, cap], and a NaN or
	// fractional value would slip past the bounds checks below.
	if (!Number.isInteger(proposedDone) || proposedDone < 0) {
		throw new Error('dailyGoalDone must be a non-negative integer.');
	}

	if (proposedDone > DAILY_HARD_CAP) {
		throw new Error(`dailyGoalDone cannot exceed the daily hard cap of ${DAILY_HARD_CAP}.`);
	}

	const currentProfile = nonNullish(current) ? decodeDocData<UserProfile>(current.data) : undefined;

	// First write, or a genuine new-day reset: nothing to roll back against.
	if (isNullish(currentProfile) || currentProfile.dailyGoalDate !== proposedProfile.dailyGoalDate) {
		return;
	}

	// Same day → the count is monotonic non-decreasing. A stale client that
	// re-saves a lower total is rejected so the server's progress stands.
	if (proposedDone < (currentProfile.dailyGoalDone ?? 0)) {
		throw new Error('dailyGoalDone cannot decrease within the same day.');
	}
};

/**
 * The `profiles` pre-write veto: one dispatch-table entry composing the
 * sub-asserts, each exported on its own so it stays unit-testable. A throw
 * from any one rejects the write. The new-profile gate runs first so a refused
 * create skips the nickname check's full collection scan.
 */
export const assertProfile = (context: AssertSetDocContext): void => {
	assertNewProfileAllowed(context);
	assertValidNickname(context);
	assertDailyGoalMonotonic(context);
};
