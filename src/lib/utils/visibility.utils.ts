import { ProfileVisibility } from '#lib/enums/profile.ts';
import type { SettingsVisibility } from '#lib/types/preferences.ts';

/**
 * Map the persisted {@link ProfileVisibility} enum to the three-way
 * {@link SettingsVisibility} the settings UI renders. `undefined`
 * (no stored value) and `FRIENDS_ONLY` both read as `private`.
 */
export const visibilityFromProfile = (value: ProfileVisibility | undefined): SettingsVisibility => {
	if (value === ProfileVisibility.PUBLIC) {
		return 'public';
	}

	if (value === ProfileVisibility.FRIENDS_AND_FOLLOWERS) {
		return 'friends';
	}

	return 'private';
};

/**
 * Inverse of {@link visibilityFromProfile}: map the settings UI's
 * three-way choice back to the persisted {@link ProfileVisibility}
 * enum. `private` maps to `FRIENDS_ONLY`.
 */
export const visibilityToProfile = (value: SettingsVisibility): ProfileVisibility => {
	if (value === 'public') {
		return ProfileVisibility.PUBLIC;
	}

	if (value === 'friends') {
		return ProfileVisibility.FRIENDS_AND_FOLLOWERS;
	}

	return ProfileVisibility.FRIENDS_ONLY;
};
