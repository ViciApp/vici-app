import { MACRO_IDS } from '#lib/constants/market-taxonomy.constants.ts';
import { PREFERENCES_STORAGE_KEY } from '#lib/constants/settings.constants.ts';
import { authPrincipal } from '#lib/derived/user.derived.ts';
import { track } from '#lib/services/analytics.services.ts';
import { persistPreferences } from '#lib/services/profile.services.ts';
import { userStore } from '#lib/stores/user.store.ts';
import type { SettingsVisibility, SharingPrefs, UserPreferences } from '#lib/types/preferences.ts';
import { visibilityFromProfile } from '#lib/utils/visibility.utils.ts';
import { browser } from '$app/env';
import { isNullish, nonNullish } from '@dfinity/utils';
import { get, writable } from 'svelte/store';

/**
 * Cross-device user preferences store.
 *
 * Source of truth is `profile.preferences` on the user's profile doc.
 * The store mirrors that field locally so components can read with
 * `$preferencesStore.foo` and write with `preferencesStore.update(fn)`
 * without each consumer learning the profile-write dance.
 *
 * Write path: every `update`/`set` optimistically updates the local
 * value, then persists only the changed leaves through the serialized
 * patch queue (`persistPreferences`) in the background. Failures are
 * logged; the local optimistic state stays in place (the next profile
 * load will reconcile if the server-side write actually dropped).
 *
 * Migration: on the *first* hydrate per session, any legacy payload
 * still sitting under `localStorage[PREFERENCES_STORAGE_KEY]` is
 * merged into the profile (one-time push of the changed leaves) and then
 * the localStorage entry is cleared. Subsequent sessions read straight
 * from the profile.
 */

export const DEFAULT_PREFERENCES: UserPreferences = {
	defaultAmount: { flow: '0', manual: '0' },
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
		profileVisibility: 'private',
		callsPublic: true,
		leaderboardOptIn: true,
		worldsOptIn: true
	},
	flowTags: [...MACRO_IDS],
	worldCupMode: false,
	savedMarketIds: [],
	favoriteParticipantId: '',
	favoriteSide: '',
	onboardingCompleted: false
};

/**
 * Loose shape the hydrator accepts. The wire schema infers
 * `flowSessionLength: number` (not the literal union), so we coerce
 * defensively on read instead of forcing every caller to narrow.
 */
interface PartialPrefsInput {
	defaultAmount?: { flow?: string; manual?: string };
	notify?: Partial<UserPreferences['notify']>;
	flowSessionLength?: number;
	hapticsEnabled?: boolean;
	soundEnabled?: boolean;
	sharing?: {
		profileVisibility?: string;
		callsPublic?: boolean;
		leaderboardOptIn?: boolean;
		worldsOptIn?: boolean;
	};
	flowTags?: string[];
	worldCupMode?: boolean;
	savedMarketIds?: string[];
	favoriteParticipantId?: string;
	favoriteSide?: string;
	onboardingCompleted?: boolean;
}

const coerceFlowSessionLength = (
	value: number | undefined
): UserPreferences['flowSessionLength'] => {
	if (value === 5 || value === 10 || value === 20) {
		return value;
	}

	return DEFAULT_PREFERENCES.flowSessionLength;
};

const coerceVisibility = (value: string | undefined): SettingsVisibility => {
	if (value === 'public' || value === 'friends' || value === 'private') {
		return value;
	}

	return DEFAULT_PREFERENCES.sharing.profileVisibility;
};

/**
 * Build the `sharing` slice from the persisted `preferences.sharing`,
 * falling back to the legacy top-level `profile.visibility` for the
 * profile-visibility choice when no slice is stored yet. The opt-in
 * flags default `true` (always-shown behaviour) for legacy rows.
 */
const hydrateSharing = ({
	partial,
	legacyVisibility
}: {
	partial: PartialPrefsInput['sharing'];
	legacyVisibility: SettingsVisibility | undefined;
}): SharingPrefs => ({
	profileVisibility: coerceVisibility(partial?.profileVisibility ?? legacyVisibility),
	callsPublic: partial?.callsPublic ?? DEFAULT_PREFERENCES.sharing.callsPublic,
	leaderboardOptIn: partial?.leaderboardOptIn ?? DEFAULT_PREFERENCES.sharing.leaderboardOptIn,
	worldsOptIn: partial?.worldsOptIn ?? DEFAULT_PREFERENCES.sharing.worldsOptIn
});

/**
 * Normalise a partial / legacy / undefined preferences blob into the
 * full shape. Empty `flowTags` is mapped to all market tags (legacy
 * "all enabled" semantic). `legacyVisibility` seeds the sharing slice's
 * profile-visibility from the top-level `profile.visibility` when no
 * slice is stored yet.
 */
const hydrateShape = ({
	partial,
	legacyVisibility
}: {
	partial: PartialPrefsInput | undefined;
	legacyVisibility?: SettingsVisibility;
}): UserPreferences => ({
	defaultAmount: {
		flow: partial?.defaultAmount?.flow ?? DEFAULT_PREFERENCES.defaultAmount.flow,
		manual: partial?.defaultAmount?.manual ?? DEFAULT_PREFERENCES.defaultAmount.manual
	},
	notify: { ...DEFAULT_PREFERENCES.notify, ...(partial?.notify ?? {}) },
	flowSessionLength: coerceFlowSessionLength(partial?.flowSessionLength),
	hapticsEnabled: partial?.hapticsEnabled ?? DEFAULT_PREFERENCES.hapticsEnabled,
	soundEnabled: partial?.soundEnabled ?? DEFAULT_PREFERENCES.soundEnabled,
	sharing: hydrateSharing({ partial: partial?.sharing, legacyVisibility }),
	flowTags:
		Array.isArray(partial?.flowTags) && partial.flowTags.length > 0
			? partial.flowTags
			: [...MACRO_IDS],
	worldCupMode: partial?.worldCupMode ?? DEFAULT_PREFERENCES.worldCupMode,
	savedMarketIds: Array.isArray(partial?.savedMarketIds) ? partial.savedMarketIds : [],
	favoriteParticipantId:
		partial?.favoriteParticipantId ?? DEFAULT_PREFERENCES.favoriteParticipantId,
	favoriteSide:
		partial?.favoriteSide === 'YES' || partial?.favoriteSide === 'NO' ? partial.favoriteSide : '',
	onboardingCompleted: partial?.onboardingCompleted ?? DEFAULT_PREFERENCES.onboardingCompleted
});

/**
 * Read the legacy localStorage payload (if any). Returns `undefined`
 * when nothing is stored or the blob is malformed. After a successful
 * migration the caller is expected to clear the entry — this read is
 * idempotent and the second call returns `undefined`.
 */
const readLegacyLocalStorage = (): Partial<UserPreferences> | undefined => {
	if (!browser) {
		return;
	}

	try {
		const raw = localStorage.getItem(PREFERENCES_STORAGE_KEY);

		if (isNullish(raw) || raw.length === 0) {
			return;
		}

		const parsed: unknown = JSON.parse(raw);

		if (typeof parsed === 'object' && nonNullish(parsed)) {
			return parsed;
		}
	} catch {
		// Corrupt payload — ignore and let defaults take over.
	}
};

const clearLegacyLocalStorage = () => {
	if (!browser) {
		return;
	}

	try {
		localStorage.removeItem(PREFERENCES_STORAGE_KEY);
	} catch {
		// Storage may be unavailable; nothing to do.
	}
};

// Local writable store — components subscribe to this. The actual
// source of truth is `userStore.profile.preferences`; this store
// mirrors it for synchronous reads + write-through semantics.
const internal = writable<UserPreferences>({ ...DEFAULT_PREFERENCES });

let legacyMigrationAttempted = false;

/**
 * The preference leaves this store owns — everything except the
 * onboarding-owned picks (`favoriteParticipantId`, `favoriteSide`,
 * `onboardingCompleted`), which only the onboarding handoff writes. The
 * local mirror seeds those to the schema defaults before the profile
 * loads, so persisting them from here would revert the onboarding pick
 * the user just made; the diff below is scoped to these keys to keep
 * them out of every settings write.
 */
const STORE_OWNED_PREFERENCE_KEYS = [
	'defaultAmount',
	'notify',
	'flowSessionLength',
	'hapticsEnabled',
	'soundEnabled',
	'sharing',
	'flowTags',
	'worldCupMode',
	'savedMarketIds'
] as const satisfies readonly (keyof UserPreferences)[];

/**
 * Structural equality for a preference leaf. `hydrateShape` rebuilds the
 * object/array leaves (`notify`, `defaultAmount`, `sharing`, `flowTags`,
 * `savedMarketIds`) on every write, so reference equality would flag them
 * as changed even when their values didn't move. Falling back to a
 * stable JSON compare keeps the diff semantic — the leaf shapes are small
 * and JSON-safe with deterministic key order from `hydrateShape`.
 */
// eslint-disable-next-line local-rules/prefer-object-params -- equality predicate; a/b read best positionally
const leafEquals = (a: unknown, b: unknown): boolean =>
	a === b || JSON.stringify(a) === JSON.stringify(b);

/**
 * Diff of the store-owned preference leaves: the keys whose value
 * actually changed between `prev` and `next`. Object/array leaves are
 * compared structurally so a write that only flips one toggle doesn't
 * re-send (and potentially overwrite from a stale local snapshot) the
 * untouched sub-objects.
 */
const changedPreferenceLeaves = ({
	prev,
	next
}: {
	prev: UserPreferences;
	next: UserPreferences;
}): Partial<UserPreferences> => {
	const patch: Partial<UserPreferences> = {};

	for (const key of STORE_OWNED_PREFERENCE_KEYS) {
		if (!leafEquals(prev[key], next[key])) {
			(patch as Record<string, unknown>)[key] = next[key];
		}
	}

	return patch;
};

/**
 * Persist only the preference leaves that changed, through the
 * serialized patch queue (`persistPreferences` leaf-merges onto the
 * freshest stored slice). Optimistic local updates have already
 * happened; this is purely the persistence side. Fire-and-forget with a
 * console.error fallback.
 *
 * A full-snapshot write from this local mirror would carry a stale
 * `favoriteParticipantId` (the mirror seeds it to '' before the profile
 * loads) and revert a freshly onboarded country pick — so we send only
 * the changed store-owned leaves and let the queue merge.
 */
const persistToProfile = ({
	prev,
	next
}: {
	prev: UserPreferences;
	next: UserPreferences;
}): void => {
	if (!browser) {
		return;
	}

	const { profile } = get(userStore);
	const principal = get(authPrincipal);

	if (isNullish(profile) || isNullish(principal)) {
		// Profile not loaded yet — the write will get picked up on
		// hydrate when the migration path runs.
		return;
	}

	const patch = changedPreferenceLeaves({ prev, next });

	if (Object.keys(patch).length === 0) {
		return;
	}

	// Sync the in-memory userStore optimistically so a re-subscribe
	// doesn't immediately re-hydrate the local store with the old
	// preferences value. Re-read the profile from the update callback's
	// own `data` rather than the snapshot captured above: if the store
	// changed in between (sign-out, a concurrent optimistic write), this
	// must not clobber the newer state or reintroduce a profile after
	// sign-out. Leaf-merge so the onboarding-owned picks the patch never
	// carries (favourite team/side) stay put.
	userStore.update((data) =>
		isNullish(data.profile)
			? data
			: {
					...data,
					profile: { ...data.profile, preferences: { ...data.profile.preferences, ...patch } }
				}
	);

	void persistPreferences({ principal, preferences: patch }).catch((err) => {
		console.error('preferencesStore: failed to persist to profile', err);
	});
};

/**
 * Subscribe to the userStore so the local mirror tracks the canonical
 * `profile.preferences`. Runs only in the browser (SSR has no
 * userStore lifecycle).
 */
if (browser) {
	userStore.subscribe((data) => {
		const { profile } = data;

		if (isNullish(profile)) {
			// User signed out — reset to defaults so the next sign-in
			// doesn't leak the previous user's settings.
			internal.set({ ...DEFAULT_PREFERENCES });
			legacyMigrationAttempted = false;

			return;
		}

		// Reconcile the sharing slice's profile-visibility with the legacy
		// top-level `profile.visibility` when no slice is stored yet.
		const fromProfile = hydrateShape({
			partial: profile.preferences,
			legacyVisibility: visibilityFromProfile(profile.visibility)
		});

		// One-time legacy migration: if the profile has the default
		// payload and localStorage has something stored, merge the
		// stored values into the profile and clear the legacy key.
		if (!legacyMigrationAttempted) {
			legacyMigrationAttempted = true;
			const legacy = readLegacyLocalStorage();

			if (nonNullish(legacy)) {
				// Pre-`sharing` payloads stored `callsPublic` at the top
				// level (`preferences.callsPublic`). Fold any such legacy
				// root value into `sharing.callsPublic` so a user who had
				// opted out of public call history isn't silently reset to
				// the default — a stored `sharing.callsPublic` still wins.
				const legacyCallsPublic = (legacy as { callsPublic?: boolean }).callsPublic;
				const mergedPartial: PartialPrefsInput = {
					...fromProfile,
					...legacy,
					sharing: {
						...fromProfile.sharing,
						...legacy.sharing,
						...(typeof legacyCallsPublic === 'boolean'
							? {
									callsPublic: legacy.sharing?.callsPublic ?? legacyCallsPublic
								}
							: {})
					}
				};
				const migrated = hydrateShape({ partial: mergedPartial });
				internal.set(migrated);
				persistToProfile({ prev: fromProfile, next: migrated });
				clearLegacyLocalStorage();

				return;
			}
		}

		internal.set(fromProfile);
	});
}

/**
 * The public preferences store. Reading returns the hydrated
 * `UserPreferences`. Writing updates the local mirror optimistically
 * and queues a leaf-level preference patch.
 *
 * `persistToProfile` is called *after* `internal.set` returns so we
 * don't re-enter the subscriber chain while the local store is
 * mid-write. The userStore subscriber will fire once the
 * persistToProfile-driven userStore.update lands, but by then the
 * local internal store is already at the target value — the
 * subscriber's `internal.set(fromProfile)` is a no-op write of the
 * same payload.
 */
export const preferencesStore = {
	subscribe: internal.subscribe,
	set: (next: UserPreferences) => {
		const current = get(internal);
		const hydrated = hydrateShape({ partial: next });
		internal.set(hydrated);
		persistToProfile({ prev: current, next: hydrated });
	},
	update: (updater: (current: UserPreferences) => UserPreferences) => {
		const current = get(internal);
		const next = hydrateShape({ partial: updater(current) });
		internal.set(next);
		persistToProfile({ prev: current, next });
	}
};

/**
 * Derived view of the current `flowSessionLength` ceiling, so callers
 * don't have to keep destructuring the store. Pure helper retained
 * for back-compat with the previous module shape.
 */
export const flowSessionMaxBets = (prefs: UserPreferences): number => prefs.flowSessionLength;

/**
 * Add or remove a market id from the saved-markets list. The store
 * write path round-trips through the profile, so the heart toggle
 * persists across devices.
 */
export const toggleSavedMarket = ({ marketId }: { marketId: string }): void => {
	preferencesStore.update((current) => {
		const ids = current.savedMarketIds;
		const removing = ids.includes(marketId);

		const next = removing ? ids.filter((id) => id !== marketId) : [...ids, marketId];

		track({
			name: removing ? 'watchlist_removed' : 'watchlist_added',
			marketId
		});

		return { ...current, savedMarketIds: next };
	});
};

/** Pure helper: is this market id in the saved list? */
export const isMarketSaved = ({
	marketId,
	prefs
}: {
	marketId: string;
	prefs: UserPreferences;
}): boolean => prefs.savedMarketIds.includes(marketId);
