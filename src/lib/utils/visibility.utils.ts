import { ProfileVisibility } from '#lib/enums/profile.ts';
import type { SettingsVisibility } from '#lib/types/preferences.ts';
import type { UserProfile } from '#lib/types/profile.ts';
import { nonNullish } from '@dfinity/utils';
import type { PrincipalText } from '@dfinity/zod-schemas';

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

/**
 * Whether `owner` may appear on a global ranking surface, honouring the
 * "Show on global leaderboard" opt-out. Fails closed: a profile that is not
 * loaded yet is hidden, so an opted-out predictor never flashes onto a list
 * before their preference is known (showing-then-hiding is itself a leak).
 * The viewer always keeps their own entry. A nullish flag on a loaded legacy
 * profile reads as opted in, matching the always-shown default.
 */
export const isShownOnGlobalLeaderboard = ({
	owner,
	profile,
	selfOwner
}: {
	owner: PrincipalText;
	profile: UserProfile | undefined;
	selfOwner: PrincipalText | undefined;
}): boolean =>
	owner === selfOwner ||
	(nonNullish(profile) && profile.preferences.sharing.leaderboardOptIn !== false);
