import type { UserPreferences } from '#lib/types/preferences.ts';

export const PREFERENCES_STORAGE_KEY = 'vici.preferences.v1';

/**
 * The stored preferences of a profile that never wrote any: the profile schema
 * fills every missing leaf from here, and the never-written profile shell
 * carries it whole. A factory, so no caller shares (and can mutate) another's
 * arrays and objects. The satellite bundles this module through the schema, so
 * it stays free of value imports.
 *
 * - `defaultAmount` `'0'` means "no stored call size": Flow then keeps its own
 *   starting amount.
 * - An empty `flowTags` means every macro; the preferences store expands it on
 *   hydrate.
 * - `sharing.profileVisibility` `'private'` is how the settings UI reads the
 *   top-level `FRIENDS_ONLY` visibility default.
 */
export const defaultPreferences = (): UserPreferences => ({
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
	flowTags: [],
	worldCupMode: false,
	savedMarketIds: [],
	favoriteParticipantId: '',
	favoriteSide: '',
	onboardingCompleted: false
});
