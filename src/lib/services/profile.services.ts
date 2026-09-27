import type { RegistryDid } from '$declarations';
import { functions } from '$declarations/satellite/satellite.api';
import { USD_DECIMALS, ZERO } from '$lib/constants/app.constants';
import { Collection } from '$lib/constants/collections.constants';
import { COMEBACK_COLD_STREAK_LOSSES } from '$lib/constants/menagerie.constants';
import {
	MIN_NICKNAME_LENGTH,
	nicknameUniqueKey,
	sanitizeNickname
} from '$lib/constants/profile.constants';
import { ProfileVisibility } from '$lib/enums/profile';
import type { UserRole } from '$lib/enums/user';
import { notifyAchievementsUnlocked } from '$lib/services/achievements.services';
import { safeGetIdentityOnce } from '$lib/services/identity.services';
import { getMyBattleStats, listMyLeagues } from '$lib/services/leagues.services';
import { areNewSignupsMoved } from '$lib/services/new-app-redirect.services';
import { getUserTradeHistory } from '$lib/services/trade.services';
import {
	bestSharpestEyeTier,
	evaluateMonthlyAwards,
	syncMyMonthlyStats
} from '$lib/services/user-monthly-stats.services';
import { computeUserStatsSnapshot, persistMyUserStats } from '$lib/services/user-stats.services';
import { marketMetadataStore } from '$lib/stores/market-metadata.store';
import { profilesStore } from '$lib/stores/profiles.store';
import { userStore } from '$lib/stores/user.store';
import type { Nickname, ProfilePrivate, UserProfile } from '$lib/types/profile';
import type { UserStatsDoc } from '$lib/types/user-stats';
import {
	CONTRARIAN_PRICE_THRESHOLD,
	evaluateAchievements,
	LEAGUE_FOUNDER_MIN_MEMBERS,
	mergeUnlockedAchievements
} from '$lib/utils/achievements.utils';
import { decimalFixedValueToNumber, shortenWithMiddleEllipsis } from '$lib/utils/format.utils';
import { countWinningCategories } from '$lib/utils/menagerie.utils';
import {
	eventExecutionPrice,
	isExecutedEvent,
	isSettledEvent,
	isWinningSettledEvent
} from '$lib/utils/resolved-position.utils';
import { applyDailyStreakBump, todayKey } from '$lib/utils/streak.utils';
import { visibilityFromProfile } from '$lib/utils/visibility.utils';
import { isWeb2Backend } from '$lib/web2/backend-mode';
import {
	checkFriendship as checkFriendshipWeb2,
	checkNicknameAvailability as checkNicknameAvailabilityWeb2,
	getMyProfileEmail as getMyProfileEmailWeb2,
	getMyProfile as getMyProfileWeb2,
	getProfileById as getProfileWeb2,
	recordFlowSwipe as recordFlowSwipeWeb2,
	searchProfiles as searchProfilesWeb2,
	upsertMyProfile as upsertMyProfileWeb2
} from '$lib/web2/client';
import { fromWireProfile } from '$satellite/utils/wire-format.utils';
import { isNullish, nonNullish } from '@dfinity/utils';
import type { Identity } from '@icp-sdk/core/agent';
import { getDoc, setDoc, type Doc, type User } from '@junobuild/core';
import type { PrincipalText } from '@junobuild/schema';
import { get } from 'svelte/store';

/**
 * The default profile shell for an owner with no stored doc yet. Shared by the
 * on-chain and web2 read paths and the web2 app-shell hydration so a
 * never-written account renders identically on both backends.
 */
export const emptyProfile = (owner: PrincipalText): UserProfile => ({
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
	preferences: {
		defaultAmount: {
			flow: '1.0',
			manual: '1.0'
		},
		notify: {
			streakReminder: true,
			marketAlerts: true,
			friendActivity: false,
			weeklyDigest: true
		},
		flowSessionLength: 10,
		hapticsEnabled: true,
		soundEnabled: true,
		sharing: {
			// Mirror the top-level `visibility` default
			// (FRIENDS_ONLY → 'private'); opt-ins default on.
			profileVisibility: visibilityFromProfile(ProfileVisibility.FRIENDS_ONLY),
			callsPublic: true,
			leaderboardOptIn: true,
			worldsOptIn: true
		},
		flowTags: [],
		worldCupMode: false,
		savedMarketIds: [],
		favoriteParticipantId: '',
		favoriteSide: '',
		onboardingCompleted: false
	}
});

/**
 * Loads a user profile from the backend or returns a default shell. web2 reads
 * the HTTP API (`owner` is the account id there); the default on-chain path
 * merges role from the satellite query. Both branches return the same
 * `Doc<UserProfile>` shape so every caller stays backend-agnostic.
 */
export const getProfile = async (principal: PrincipalText): Promise<Doc<UserProfile>> => {
	if (isWeb2Backend()) {
		const profile = await getProfileWeb2(principal);

		return { key: principal, data: profile ?? emptyProfile(principal) };
	}

	const { profile } = await functions.getProfile({ principalStr: principal });

	if (isNullish(profile)) {
		return { key: principal, data: emptyProfile(principal) };
	}

	return {
		key: principal,
		data: profile as UserProfile
	};
};

/**
 * The signed-in user's own profile for the web2 app-shell hydration. Returns
 * the default shell (with `existed: false`) for a freshly created account that
 * has no stored profile yet, so the onboarding drain runs exactly as it does
 * for a new on-chain user. web2 only; the on-chain path hydrates via
 * {@link ensureProfile}.
 */
export const loadWeb2ProfileShell = async (
	owner: PrincipalText
): Promise<{ profile: UserProfile; existed: boolean }> => {
	const profile = await getMyProfileWeb2();

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
 * Fetches run in bounded batches ({@link PROFILE_HYDRATION_CONCURRENCY}) rather
 * than one big `Promise.all`: a large caller (e.g. the full Leaderboard) would
 * otherwise open a request per principal at once, saturating the browser's
 * per-host connection pool and starving every other in-flight call. Batching
 * paces the burst without dropping any principal.
 */
const PROFILE_HYDRATION_CONCURRENCY = 25;

export const loadProfilesByPrincipals = async ({
	principals
}: {
	principals: PrincipalText[];
}): Promise<void> => {
	const cached = get(profilesStore);
	const unique = Array.from(new Set(principals)).filter(
		(principal) => principal.length > 0 && !cached.has(principal)
	);

	if (unique.length === 0) {
		return;
	}

	const docs: (Awaited<ReturnType<typeof getProfile>> | undefined)[] = [];

	for (let start = 0; start < unique.length; start += PROFILE_HYDRATION_CONCURRENCY) {
		const batch = unique.slice(start, start + PROFILE_HYDRATION_CONCURRENCY);

		// Batches run sequentially to cap concurrency; within a batch the
		// per-principal fetches are parallel.
		const settled = await Promise.all(
			batch.map((principal) => getProfile(principal).catch(() => undefined))
		);

		docs.push(...settled);
	}

	profilesStore.update((current) => {
		const next = new Map(current);

		for (let i = 0; i < unique.length; i++) {
			const doc = docs[i];

			if (doc) {
				next.set(unique[i], doc.data);
			}
		}

		return next;
	});
};

export const updateInterests = async ({
	principal,
	interests
}: {
	principal: PrincipalText;
	interests: string[];
}): Promise<void> => {
	await patchProfile({ principal, patch: { interests } });
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
 * A `patchProfile` patch may carry only the preference leaves it owns —
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
		const profileDoc = await getProfile(principal);
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
 * Best-effort — callers should fire-and-forget; the local UI already
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
 * cap. The satellite owns the count: we send only our local-day key (the
 * `YYYY-MM-DD` from `todayKey`) as the rollover boundary — never a count —
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
	isWeb2Backend() ? recordFlowSwipeWeb2({ dayKey }) : functions.recordFlowSwipe({ dayKey });

/**
 * Persist the Menagerie celebration ledger — the set of `${slug}:${tier}` keys
 * the owner has already seen a reveal for. Drives the once-per-crossing guard:
 * the celebration host writes the full current earned set after seeding (first
 * load, silently) and after each genuine crossing.
 *
 * Best-effort and fire-and-forget — the reveal already played from the local
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

export const upsertProfile = async (
	profileDoc: Doc<UserProfile> | { key: string; data: UserProfile }
): Promise<void> => {
	// web2 is a full-doc PUT: the server locks the caller's row, applies the
	// same nickname / handle-cooldown / daily-goal guards, and returns the
	// stored result. The caller's session identifies the row, so `owner` / role
	// in the body are ignored; the account email lives on the auth identity in
	// this mode, not the profile doc, so it is intentionally not sent here.
	if (isWeb2Backend()) {
		await upsertMyProfileWeb2(profileDoc.data);

		return;
	}

	const { key } = profileDoc;
	const existing = await getDoc<UserProfile>({
		collection: Collection.PROFILES,
		key
	});

	const base = existing?.data ?? profileDoc.data;
	// Strip the legacy `email` field AFTER the merge: both the stored doc and
	// the caller's payload can still carry it at runtime (pre-migration rows,
	// snapshots built from raw `getDoc` reads) even though the schema no
	// longer declares it, and re-spreading it would re-persist the address
	// onto the public doc. Every write from here on leaves the profile clean —
	// the address lives in `profile_private`.
	const { email: _legacyEmail, ...data } = {
		...base,
		...profileDoc.data,
		// Leaf-merge `preferences` onto the freshest stored slice rather than
		// replacing it. Full-snapshot callers (avatar parts, handle rename)
		// carry a `preferences` they built from an in-store snapshot that can
		// predate a concurrent write — without this merge, an avatar save right
		// after onboarding would replace `preferences` and drop the just-picked
		// `favoriteParticipantId`.
		preferences: { ...base.preferences, ...profileDoc.data.preferences }
	} as UserProfile & { email?: string };

	if (isNullish(existing)) {
		await setDoc({
			collection: Collection.PROFILES,
			doc: { key, data }
		});

		return;
	}

	if (isNullish(existing.version)) {
		throw new Error('Cannot update profile: document is missing version.');
	}

	await setDoc({
		collection: Collection.PROFILES,
		doc: {
			key,
			version: existing.version,
			data
		}
	});
};

/**
 * Persist the onboarding picks (handle + backed team/side + completion flag) onto the freshest
 * profile doc, serialized through {@link patchProfile}'s queue.
 *
 * This MUST go through the patch queue rather than a full-snapshot {@link upsertProfile}: on the
 * login that finishes onboarding, {@link calculateAndSyncStats} writes the same doc concurrently
 * (it's awaited right after `userStore.set` in `Authn.svelte`, so it overlaps the post-signin
 * drain). A full-snapshot write built from the pre-sync profile would lose the optimistic-version
 * race and throw — silently dropping the user's picks (the "could not save your onboarding
 * choices" report: handle present from the bootstrap, country/team blank). A field-level patch on
 * the freshest doc both avoids the conflict and leaves the concurrently-written stats intact.
 *
 * `setHandle` is gated by the caller's availability probe — pass `true` only when the picked handle
 * is free. The handle-change cooldown stamp is decided here against the FRESH stored nickname so a
 * concurrent rename can't desync it.
 *
 * Resolves to `{ profile, handleApplied }`. `handleApplied` is `false` when the handle was never
 * requested (`setHandle: false`) OR when it was claimed in the TOCTOU window between the caller's
 * probe and this write (the satellite rejects the whole doc with "already taken"): in that case
 * the handle is dropped and the rest of the picks are retried so team/side/completion — which are
 * independent of the handle — still persist. The caller maps `setHandle && !handleApplied` to a
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
				// set-profile assertion accepts the write — the bootstrapped
				// nickname almost always differs from the picked handle.
				if (nicknameUniqueKey(handle) !== nicknameUniqueKey(current.nickname ?? '')) {
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
		// landed, so the satellite rejected the whole doc. Retry WITHOUT the handle so the rest of
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
 * Case-insensitive search over nickname, owner, and document key via secure satellite query.
 */
export const searchProfiles = async (query: string): Promise<UserProfile[]> => {
	if (isWeb2Backend()) {
		return searchProfilesWeb2(query);
	}

	const { items } = await functions.searchProfiles({ queryStr: query });

	return items.map(fromWireProfile);
};

/**
 * Outcome of a nickname availability probe — mirrors
 * `NicknameAvailability` on the satellite side. The FE uses this to
 * render typed inline errors (instead of regex-parsing thrown messages).
 */
export type NicknameAvailability =
	| { available: true }
	| { available: false; reason: 'required' | 'too_short' | 'invalid' | 'taken' };

/**
 * Pre-flight check for the create-account and profile-edit flows.
 * Runs through the same validator the satellite assertion uses
 * (`checkNicknameAvailabilityFn`), so a `true` here means the next
 * `setDoc` will not be vetoed for nickname reasons.
 *
 * Pass the editor's `principal` when editing an existing profile so
 * the user is not told their own current nickname is taken.
 */
export const checkNicknameAvailability = async ({
	nickname,
	principal
}: {
	nickname: string;
	principal?: PrincipalText;
}): Promise<NicknameAvailability> => {
	// web2 excludes the caller's own current nickname via the session, so the
	// `principal` hint is not needed on that transport.
	const result = isWeb2Backend()
		? await checkNicknameAvailabilityWeb2(nickname)
		: await functions.checkNicknameAvailability({
				nickname,
				excludePrincipalStr: principal ?? ''
			});

	if (result.available) {
		return { available: true };
	}

	// The web2 validator can report `too_long`, which the shared FE outcome
	// folds into `invalid` (the charset/format bucket) so both transports
	// surface the same set of inline reasons.
	const reason = result.reason === 'too_long' ? 'invalid' : (result.reason ?? 'taken');

	return { available: false, reason };
};

/**
 * Reads the signed-in user's own on-file email from the owner-private
 * `profile_private` doc. The collection is `managed` (owner +
 * controllers), so this only resolves for the caller's own principal —
 * never call it for a counterpart. Returns the empty string when no doc
 * (or no address) is stored.
 */
export const getMyEmail = async (principal: PrincipalText): Promise<string> => {
	// web2 keys the read on the session, not the passed principal, and the
	// address lives on the caller's own profile row rather than a private doc
	// (the row's email never rides a public profile object client-side).
	if (isWeb2Backend()) {
		return await getMyProfileEmailWeb2();
	}

	const doc = await getDoc<ProfilePrivate>({
		collection: Collection.PROFILE_PRIVATE,
		key: principal
	});

	return doc?.data.email.trim() ?? '';
};

/**
 * Persists the signed-in user's email onto their owner-private
 * `profile_private` doc (version-safe upsert). The satellite assert
 * binds both the doc key and the embedded `owner` to the caller, so
 * this can only ever write the caller's own doc.
 */
export const saveMyEmail = async ({
	principal,
	email
}: {
	principal: PrincipalText;
	email: string;
}): Promise<void> => {
	// web2 stores the address on the owner profile row and the PUT is a
	// full-doc write, so read-modify-write the stored profile. With no profile
	// row yet the address already rides the auth identity (sign-in is
	// email-verified on this transport), and writing a default shell here
	// would falsely flip a fresh account to "existed" for the onboarding
	// drain, so skip instead.
	if (isWeb2Backend()) {
		const profile = await getMyProfileWeb2();

		if (isNullish(profile)) {
			return;
		}

		await upsertMyProfileWeb2({ ...profile, email });

		return;
	}

	const existing = await getDoc<ProfilePrivate>({
		collection: Collection.PROFILE_PRIVATE,
		key: principal
	});

	await setDoc({
		collection: Collection.PROFILE_PRIVATE,
		doc: {
			key: principal,
			...(nonNullish(existing?.version) && { version: existing.version }),
			data: { owner: principal, email }
		}
	});
};

/**
 * Post-sign-in email hydration + provider backfill. Reads the stored
 * private address; when there is none and the IdP shared one this
 * sign-in, captures it onto the private doc. Never overwrites an
 * address already on file (a manually-entered one, or one from an
 * earlier provider), so switching IdPs can't silently replace it.
 * Best-effort — a failed read/write never blocks sign-in; the resolved
 * on-file address (possibly '') is returned for the user store.
 */
const hydrateMyEmail = async ({
	principal,
	providerEmail
}: {
	principal: PrincipalText;
	providerEmail: string;
}): Promise<string> => {
	try {
		const stored = await getMyEmail(principal);

		if (stored.length > 0 || providerEmail.length === 0) {
			return stored;
		}

		await saveMyEmail({ principal, email: providerEmail });

		return providerEmail;
	} catch (err: unknown) {
		console.warn('profile email hydration failed', err);

		return '';
	}
};

/**
 * Result of `ensureProfile` — `existed` flags whether the satellite
 * already held a profile doc for this principal at sign-in time. The
 * post-sign-in handoff in `(app)/+layout.svelte` uses this to decide
 * whether to apply a pending pre-auth onboarding payload (new user)
 * or preserve the existing profile (returning user). `email` is the
 * user's own on-file address from the owner-private `profile_private`
 * doc (possibly just backfilled from the IdP), hydrated here so the
 * user store never has to read it from the public profile.
 */
export interface EnsureProfileResult {
	profile: UserProfile;
	existed: boolean;
	email: string;
}

/**
 * `ensureProfile` outcome when the principal has no profile and this build
 * sends new accounts to the new app (`areNewSignupsMoved`): nothing was
 * written, and the caller is expected to sign the session back out.
 */
export interface EnsureProfileMovedResult {
	newAccountMoved: true;
}

/**
 * OpenID profile metadata Juno attaches to the auth `User` for OpenID-backed
 * providers (Google, GitHub). Every field is optional: the IdP only returns
 * what the user consented to share, so any of these — `email` included — can
 * be missing on any given sign-in.
 */
interface OpenIdProviderProfile {
	email?: string;
	name?: string;
	givenName?: string;
	familyName?: string;
}

/**
 * Reads the OpenID claims off the auth `User`. They live under
 * `user.data.providerData.openid` since the `@junobuild/core` v5 auth-client
 * migration (the pre-v5 `details.profile` shape this used to read no longer
 * exists). Returns `undefined` for providers that carry no OpenID metadata —
 * Internet Identity (including Apple-via-II), passkey/WebAuthn, and the dev
 * shortcut.
 */
const extractOpenIdProfile = (user: User): OpenIdProviderProfile | undefined => {
	const { providerData } = user.data as {
		providerData?: { openid?: OpenIdProviderProfile };
	};

	return providerData?.openid;
};

// Principals whose profile doc was created by THIS browser session's
// `ensureProfile` (first-touch bootstrap). `onAuthStateChange` can fire a
// second pass whose `getDoc` now finds the just-created doc and reports
// `existed: true`; if that lands before the onboarding drain effect reads
// `profileExisted`, the drain wrongly takes the returning-user branch and
// drops the picks. This set is the deterministic "is this principal new in
// this session?" signal the drain consults so a benign second pass can't
// flip it. Session-scoped (page lifetime); a genuinely returning user whose
// doc predates this session is never added.
const bootstrappedThisSession = new Set<PrincipalText>();

/**
 * True when `ensureProfile` created this principal's profile during the
 * current browser session — authoritative regardless of a later racy
 * `getDoc` read. Used by the onboarding drain to decide new-vs-returning.
 */
export const wasBootstrappedThisSession = (principal: PrincipalText): boolean =>
	bootstrappedThisSession.has(principal);

/**
 * Reset the bootstrapped-this-session capture. Called on sign-out (which always
 * fires `onAuthStateChange(null)`), so a user who created a profile earlier in
 * this tab, signed out, and signs back in is correctly seen as RETURNING — not
 * re-classified as new (which would let a referral-only pending payload run the
 * new-user branch and clobber their saved picks). The double-`onAuthStateChange`
 * race this set guards happens within a single sign-in (both passes carry a
 * non-null user), so clearing on sign-out never reopens it.
 */
export const forgetBootstrappedThisSession = (): void => {
	bootstrappedThisSession.clear();
};

export const ensureProfile = async (
	user: User
): Promise<EnsureProfileResult | EnsureProfileMovedResult> => {
	const principal = user.key;
	const profileDoc = await getProfile(principal);

	const openid = extractOpenIdProfile(user);
	// Best-effort: the IdP only returns an email when the user consented to
	// share it (and only OpenID providers expose one at all), so this is
	// frequently empty — capture it when present, never depend on it.
	const providerEmail = openid?.email?.trim() ?? '';

	// The synthetic shell from `getProfile` never carries a version. To
	// detect "has the satellite ever stored a profile for this
	// principal?" we have to read the doc directly via Juno's SDK —
	// `version` is only populated on real stored docs. This is what
	// previously caused every returning user to fall through to the
	// upsert path and have any pending onboarding silently overwrite
	// their saved nickname.
	const existing = await getDoc<UserProfile>({
		collection: Collection.PROFILES,
		key: principal
	});

	if (nonNullish(existing) && nonNullish(existing.version)) {
		// The address lives on the owner-private `profile_private` doc, never
		// on the public profile — hydrate it (and backfill the provider email
		// when nothing is on file yet) without touching the profile doc.
		const email = await hydrateMyEmail({ principal, providerEmail });

		return { profile: existing.data, existed: true, email };
	}

	// Checked before the first write on purpose: the email hydration below
	// creates the owner-private doc, and the seed patch creates the profile, so
	// bailing any later would leave a half-created account behind.
	if (areNewSignupsMoved()) {
		return { newAccountMoved: true };
	}

	const fullName = nonNullish(openid)
		? (openid.name ?? [openid.givenName, openid.familyName].filter(Boolean).join(' '))
		: '';

	// Seed a VALID handle on first touch. Both candidates carry characters
	// the handle charset forbids — the OAuth display name (`"John Doe"`) has
	// spaces, the shortened-principal default carries an `…` ellipsis — and
	// the satellite now rejects those. Sanitise to `[a-z0-9._-]`; if nothing
	// usable survives (e.g. a non-latin display name sanitises to empty),
	// fall back to the raw principal, which is all lowercase/digits/hyphens
	// and clears the charset guard. The user can refine it later from the
	// profile dashboard.
	const seedSource = fullName.trim().length > 0 ? fullName : profileDoc.data.nickname;
	const sanitizedSeed = sanitizeNickname(seedSource);
	const nickname = sanitizedSeed.length >= MIN_NICKNAME_LENGTH ? sanitizedSeed : principal;

	// First-touch bootstrap. Seed the nickname through the SAME serialized
	// `patchProfile` queue that `calculateAndSyncStats`
	// — awaited right after sign-in on this finishing login — and the onboarding
	// drain use. A direct full-snapshot `upsertProfile` here is NOT serialized
	// against that concurrent stats write, so its read-then-write loses the
	// optimistic-version race and throws ("set doc version"), stranding the user
	// on signup even though auth already succeeded (a refresh then shows them
	// signed in). Going through the queue orders the create against the stats
	// write instead, so whichever runs first, the other reads its version.
	//
	// The default nickname is the user's shortened principal, which can collide
	// with another provider's shortened principal — fall back to the unshortened
	// principal so the assertion cannot veto this implicit write. The user can
	// change it later from the profile dashboard.
	const seedPatch: ProfilePatch = { nickname };

	// Record the bootstrap BEFORE the write awaits. A fresh sign-in can fire a
	// second `onAuthStateChange` pass whose profile read resolves after the
	// create lands but before control returns here; if the mark lagged behind the
	// await, that pass would see the doc as pre-existing while
	// `wasBootstrappedThisSession` was still false, misclassify a brand-new user
	// as returning, and drop their onboarding handle. Marking up front is safe: a
	// throwing write errors the caller out, and a principal with no doc reads as
	// `existed: false` (the new-user path) on any retry.
	bootstrappedThisSession.add(principal);

	// Capture the provider email (when shared) onto the owner-private doc —
	// same best-effort semantics as the returning-user hydration above.
	const email = await hydrateMyEmail({ principal, providerEmail });

	try {
		return { profile: await patchProfile({ principal, patch: seedPatch }), existed: false, email };
	} catch (err: unknown) {
		const message = err instanceof Error ? err.message : '';

		if (message.includes('already taken')) {
			return {
				profile: await patchProfile({ principal, patch: { ...seedPatch, nickname: principal } }),
				existed: false,
				email
			};
		}

		throw err;
	}
};

/**
 * Falls back to a shortened principal so the UI never renders an empty
 * name when a profile has no nickname set.
 */
export const getDisplayName = ({
	profile
}: {
	profile: {
		owner: PrincipalText;
		nickname: Nickname;
		visibility?: ProfileVisibility;
	};
	viewerPrincipal?: PrincipalText;
	viewerRole?: UserRole;
	isFriend?: boolean;
}): string => {
	if (!profile.nickname || profile.nickname.trim() === '') {
		return shortenWithMiddleEllipsis({ text: profile.owner });
	}

	return profile.nickname;
};

/**
 * Checks if two users have an active friend relation via secure satellite query.
 */
export const checkFriendship = async ({
	userA,
	userB
}: {
	userA: PrincipalText;
	userB: PrincipalText;
}): Promise<boolean> => {
	if (isWeb2Backend()) {
		return checkFriendshipWeb2({ userA, userB });
	}

	const { isFriend } = await functions.checkFriendship({ userA, userB });

	return isFriend;
};

/**
 * Derives trading stats, points, and level from clearing history and writes them to the profile.
 */
export const calculateAndSyncStats = async ({
	identity,
	domain
}: {
	identity: Identity;
	domain: RegistryDid.BalanceDomain;
}): Promise<void> => {
	const principal = identity.getPrincipal().toText();
	const history = await getUserTradeHistory(domain);

	const settledTradesCount = history.filter(isSettledEvent).length;
	const wins = history.filter(isWinningSettledEvent).length;

	// Lifetime realized P&L: sum the signed realized cashflow each
	// clearing `Settled` event already carries. A settlement's signed
	// `qty` IS the realized `cashflow_usd` in `USD_DECIMALS` base units
	// (see `resolved-position.utils.ts` / the `ResolvedPosition` docs) —
	// not a contract quantity to re-multiply by price. Summed as `bigint`
	// base units and decoded once at the end, so the conversion is exact
	// (no per-event float accumulation). NOT clamped: lifetime P&L is net
	// and must include losing settlements.
	const realizedPnl = decimalFixedValueToNumber({
		value: history.filter(isSettledEvent).reduce((acc, event) => acc + event.qty, ZERO),
		decimals: USD_DECIMALS
	});

	const totalTrades = history.filter(isExecutedEvent).length;
	const winRate = settledTradesCount > 0 ? (wins / settledTradesCount) * 100 : 0;

	const sortedHistory = [...history].sort((a, b) => Number(b.timestamp) - Number(a.timestamp));
	const currentStreak = sortedHistory
		.filter(isSettledEvent)
		.findIndex((event) => event.qty <= ZERO);
	const resolvedStreak =
		currentStreak === -1 ? sortedHistory.filter(isSettledEvent).length : currentStreak;

	const accuracy = winRate;

	// Long-shot wins for the `contrarian` achievement. A settled win
	// at execution price ≤ CONTRARIAN_PRICE_THRESHOLD means the market
	// priced their side as a long shot when they took it.
	const contrarianWins = history.filter((event) => {
		if (!isWinningSettledEvent(event)) {
			return false;
		}

		return eventExecutionPrice(event) <= CONTRARIAN_PRICE_THRESHOLD;
	}).length;

	// Rarest single upset (Octopus) — the smallest execution consensus among
	// settled wins; lower = rarer. A consensus price is a probability, so only
	// finite values in (0, 1] count: NaN / ±Infinity (malformed event) and
	// out-of-range values are no data, not a best-ever upset — same defence as
	// the monthly consensus aggregation, but excluding rather than clamping,
	// since clamping would fabricate a value for a MIN metric. `undefined`
	// when there's no winning settlement yet, so the trophy stays at its
	// locked baseline instead of reading a fabricated value.
	const bestUpsetConsensus = history
		.filter(isWinningSettledEvent)
		.map(eventExecutionPrice)
		.filter((price) => Number.isFinite(price) && price > 0 && price <= 1)
		.reduce<number | undefined>(
			(min, price) => (isNullish(min) || price < min ? price : min),
			undefined
		);

	const chronoHistory = [...history].sort((a, b) => Number(a.timestamp) - Number(b.timestamp));

	// Longest consecutive-win run ever (Snake) — the high-water sibling of
	// the current `streak`. Recomputed over the full chronological history;
	// kept monotonic against the persisted value below so the trophy never
	// regresses even if the readable history window ever shrinks.
	const { longestRun } = chronoHistory.filter(isSettledEvent).reduce<{
		longestRun: number;
		run: number;
	}>(
		({ longestRun, run }, event) => {
			const nextRun = event.qty > ZERO ? run + 1 : 0;

			return { longestRun: Math.max(longestRun, nextRun), run: nextRun };
		},
		{ longestRun: 0, run: 0 }
	);

	// Cold-streak recoveries (Honey Badger) — each settled win that snaps a
	// run of at least `COMEBACK_COLD_STREAK_LOSSES` consecutive settled
	// losses. Only a genuinely negative settlement counts as a loss: a
	// neutral one (`qty === 0` — see `settledEventToResolvedPosition`) is
	// neither a loss nor a recovery, so it breaks the run without scoring.
	// Like `onFireStreak`, recomputed over the full chronological history
	// and kept monotonic against the persisted value below.
	const { comebacks: coldStreakComebacks } = chronoHistory.filter(isSettledEvent).reduce<{
		comebacks: number;
		losses: number;
	}>(
		({ comebacks, losses }, event) => {
			if (event.qty > ZERO) {
				return {
					comebacks: losses >= COMEBACK_COLD_STREAK_LOSSES ? comebacks + 1 : comebacks,
					losses: 0
				};
			}

			return { comebacks, losses: event.qty < ZERO ? losses + 1 : 0 };
		},
		{ comebacks: 0, losses: 0 }
	);

	const { totalPoints } = chronoHistory.reduce<{ totalPoints: number; runningStreak: number }>(
		(acc, event) => {
			if (isSettledEvent(event)) {
				if (event.qty > ZERO) {
					const nextStreak = acc.runningStreak + 1;
					const priceVal = eventExecutionPrice(event);
					const weight = priceVal > 0 ? 1.0 / priceVal : 1.0;
					const multiplier = Math.pow(1.1, nextStreak - 1);

					return {
						totalPoints: acc.totalPoints + Math.floor(100 * weight * multiplier),
						runningStreak: nextStreak
					};
				}

				return { totalPoints: acc.totalPoints, runningStreak: 0 };
			}

			if (isExecutedEvent(event)) {
				return { totalPoints: acc.totalPoints + 10, runningStreak: acc.runningStreak };
			}

			return acc;
		},
		{ totalPoints: 0, runningStreak: 0 }
	);

	// The per-user dashboard snapshot doubles as the source of the Magpie
	// breadth metric: its per-category buckets feed `countWinningCategories`
	// for the profile patch below, and the snapshot itself is persisted to
	// `USER_STATS` after the patch. Best-effort like the other auxiliary
	// reads: malformed market metadata must not abort the whole stats sync,
	// so a failed computation degrades to no `USER_STATS` refresh and a 0
	// breadth count — which the monotonic patch below keeps from regressing
	// the persisted value.
	let snapshot: UserStatsDoc | undefined;
	let winningCategories = 0;

	try {
		snapshot = computeUserStatsSnapshot({
			owner: principal,
			history,
			metadata: get(marketMetadataStore),
			nowMs: Date.now()
		});
		winningCategories = countWinningCategories(snapshot.categoryStats);
	} catch (err: unknown) {
		console.error('calculateAndSyncStats: failed to compute user_stats snapshot', err);
	}

	const profileDoc = await getProfile(principal);

	// `league-founder` — does the caller own a league with at least
	// `LEAGUE_FOUNDER_MIN_MEMBERS` members? Read from `listMyLeagues`
	// (carries `memberCount`). Best-effort: a failed read leaves the award
	// un-flipped this pass, but it's sticky once earned, so a later sync
	// recovers it. Default `false` rather than letting an error reset it.
	// The same read backs the Bee trophy's membership counters.
	let ownsQualifyingLeague = false;
	let leaguesJoined = 0;
	let leaguesFounded = 0;

	try {
		const myLeagues = await listMyLeagues();
		const owned = myLeagues.filter(
			(entry) => entry.role === 'owner' && entry.league.owner === principal
		);

		ownsQualifyingLeague = owned.some((entry) => entry.memberCount >= LEAGUE_FOUNDER_MIN_MEMBERS);
		leaguesJoined = myLeagues.length;
		leaguesFounded = owned.length;
	} catch (err: unknown) {
		console.error('calculateAndSyncStats: failed to read leagues for league-founder', err);
	}

	// Resolved battles the caller's side won (Bee's "win a bout" rung),
	// tallied server-side by `getMyBattleStats` — duels by principal match
	// on the winning side, league bouts by ownership of the winning league.
	// Best-effort like the league read: a failed read computes 0 and the
	// monotonic patch below keeps the persisted tally.
	let boutsWon = 0;

	try {
		({ boutsWon } = await getMyBattleStats());
	} catch (err: unknown) {
		console.error('calculateAndSyncStats: failed to read battles for bouts-won', err);
	}

	// `top-decile` — bump the consecutive-day streak at most once per
	// local calendar day when the caller sits in the top 10% of the
	// global leaderboard (rank ≤ count / 10), reset to 0 otherwise.
	// Mirrors the `dailyStreak` once-per-day pattern: same-day re-syncs
	// don't move the streak. Best-effort — a failed rank read keeps the
	// persisted streak + day untouched so a transient error neither bumps
	// nor resets.
	const today = todayKey();
	let topDecileStreak = profileDoc.data.topDecileStreak ?? 0;
	let { lastTopDecileDay } = profileDoc.data;

	if (lastTopDecileDay !== today) {
		try {
			const { rank, count } = await functions.getUserRankAndCount({ principalStr: principal });

			// Top decile = rank within the best 10% of ranked profiles.
			// `Math.floor` keeps the cutoff inclusive on exact tenths (a
			// 10-profile pool admits rank 1 only); a pool too small to have
			// a tenth (count < 10) admits no one, matching "top 10%".
			const cutoff = Math.floor(count / 10);
			const inTopDecile = nonNullish(rank) && cutoff >= 1 && rank <= cutoff;

			topDecileStreak = inTopDecile ? topDecileStreak + 1 : 0;
			lastTopDecileDay = today;
		} catch (err: unknown) {
			console.error('calculateAndSyncStats: failed to read rank for top-decile', err);
		}
	}

	// Monthly album awards (sharpest-eye, bold-caller). Re-derive the
	// caller's current + prior month stats docs from clearing history and
	// persist them (lazy month rollover — no scheduler), then evaluate the
	// just-closed (prior) month's leaderboard for the caller's standing. The
	// awards are for COMPLETED months, so the prior month is the one that can
	// flip a fresh unlock. `sharpestEyeBestTier` is kept monotonic (a worse
	// later placement never demotes the best ever), and `wonBoldCaller` is
	// sticky once merged. Best-effort: a failed read leaves the awards
	// un-flipped this pass but never rescinds an earned one.
	let { sharpestEyeBestTier } = profileDoc.data;
	let wonBoldCallerMonth = (profileDoc.data.unlockedAchievements ?? []).includes('bold-caller');

	try {
		const { priorAnchor } = await syncMyMonthlyStats({
			owner: principal,
			history,
			nowMs: Date.now()
		});

		const standing = await evaluateMonthlyAwards({ owner: principal, monthAnchor: priorAnchor });

		sharpestEyeBestTier = bestSharpestEyeTier({
			current: sharpestEyeBestTier,
			candidate: standing.sharpestEyeTier
		});
		wonBoldCallerMonth = wonBoldCallerMonth || standing.wonBoldCaller;
	} catch (err: unknown) {
		console.error('calculateAndSyncStats: failed to sync monthly stats / awards', err);
	}

	// Evaluate achievements against the freshly-computed snapshot and
	// fold any newly-unlocked ids into the persisted set. Newly
	// unlocked achievements also credit their XP into the points total
	// before we recompute the level — so an achievement that pushes a
	// user across a 500-point boundary correctly bumps the level in
	// the same write.
	const evaluations = evaluateAchievements({
		totalTrades,
		winStreak: resolvedStreak,
		dailyStreak: profileDoc.data.dailyStreak ?? 0,
		accuracy,
		contrarianWins,
		ownsQualifyingLeague,
		topDecileStreak,
		sharpestEyeBestTier,
		wonBoldCallerMonth
	});

	const { unlocked, newlyUnlocked } = mergeUnlockedAchievements({
		previouslyUnlocked: profileDoc.data.unlockedAchievements ?? [],
		evaluations
	});

	const bonusXp = newlyUnlocked.reduce((acc, evaluation) => acc + evaluation.def.xp, 0);
	const adjustedPoints = totalPoints + bonusXp;
	const level = Math.floor(adjustedPoints / 500) + 1;

	// Patch (not full-snapshot write): the profile read at the top is stale by
	// now — re-sending it would revert a handle picked during onboarding mid-sync
	// and trip the server handle-cooldown assert.
	await patchProfile({
		principal,
		patch: {
			totalTrades,
			winRate,
			pnl: realizedPnl,
			streak: resolvedStreak,
			accuracy,
			points: adjustedPoints,
			level,
			contrarianWins,
			bestUpsetConsensus,
			onFireStreak: Math.max(longestRun, profileDoc.data.onFireStreak ?? 0),
			comebacks: Math.max(coldStreakComebacks, profileDoc.data.comebacks ?? 0),
			// Monotonic like the other trophy stats: when market metadata isn't
			// hydrated the tag lookup degrades to "untagged" and the fresh count
			// reads 0 — a thin sync must not strip an earned rung.
			winningCategories: Math.max(winningCategories, profileDoc.data.winningCategories ?? 0),
			leaguesJoined: Math.max(leaguesJoined, profileDoc.data.leaguesJoined ?? 0),
			boutsWon: Math.max(boutsWon, profileDoc.data.boutsWon ?? 0),
			leaguesFounded: Math.max(leaguesFounded, profileDoc.data.leaguesFounded ?? 0),
			topDecileStreak,
			lastTopDecileDay,
			sharpestEyeBestTier,
			unlockedAchievements: unlocked
		}
	});

	// Persist the per-user dashboard cache alongside the profile
	// write. The Dash page reads `USER_STATS[principal]` on mount;
	// keeping the snapshot fresh here means the categories tile +
	// recent-history tile stay in sync with the user's last
	// resolution event. Failures are logged but don't block the
	// profile write — the cache will be rebuilt on the next sync.
	try {
		if (nonNullish(snapshot)) {
			await persistMyUserStats(snapshot);
		}
	} catch (err) {
		console.error('calculateAndSyncStats: failed to persist user_stats', err);
	}

	notifyAchievementsUnlocked(newlyUnlocked);
};

/**
 * {@link calculateAndSyncStats} for the signed-in user. The recompute reads
 * the clearing history with the user's on-chain identity, which a web2
 * session never has, so web2 mode skips it instead of failing on the missing
 * identity (a deliberate on-chain-only remainder, see
 * `docs/ai/frontend/web2-backend-mode.md`).
 */
export const syncMyStats = async ({
	domain
}: {
	domain: RegistryDid.BalanceDomain;
}): Promise<void> => {
	if (isWeb2Backend()) {
		return;
	}

	const identity = await safeGetIdentityOnce();

	await calculateAndSyncStats({ identity, domain });
};

/**
 * Record that the user did something predictable today — bumps the
 * daily-streak engine and persists the result. Currently called from
 * the trade-execution path (`placeOrder`) so a successful trade keeps
 * the Flame alive for the day.
 *
 * Uses the same `applyDailyStreakBump` engine as Flow Mode, so the
 * two writers produce identical values for the same local day — no
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
	// on the very write that crosses the threshold, rather than
	// waiting for the next sign-in `calculateAndSyncStats`. The other
	// achievement axes (trades, accuracy, contrarian, league-founder,
	// top-decile) re-use the persisted values — they're not the trigger
	// here, and any already-earned sticky award stays unlocked through
	// the merge. `ownsQualifyingLeague` is left `false`: this path never
	// flips `league-founder` on (that's `calculateAndSyncStats`' job),
	// but it can't rescind one either, since unlocks are sticky.
	const evaluations = evaluateAchievements({
		totalTrades: profileDoc.data.totalTrades ?? 0,
		winStreak: profileDoc.data.streak ?? 0,
		dailyStreak: bump.streak,
		accuracy: profileDoc.data.accuracy ?? 0,
		contrarianWins: profileDoc.data.contrarianWins ?? 0,
		ownsQualifyingLeague: false,
		topDecileStreak: profileDoc.data.topDecileStreak ?? 0,
		// Monthly awards are computed in `calculateAndSyncStats`, not here —
		// reuse the persisted state so this path can't rescind a sticky
		// unlock (the `marathon` daily-streak bump is the only trigger here).
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
