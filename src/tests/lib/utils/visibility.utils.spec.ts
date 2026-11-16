import { UserProfileSchema } from '#lib/schema/profile.schema.ts';
import type { UserProfile } from '#lib/types/profile.ts';
import { isShownOnGlobalLeaderboard } from '#lib/utils/visibility.utils.ts';
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

const OWNER = 'aaaaa-aa';
const VIEWER = '2vxsx-fae';

const profileWith = (leaderboardOptIn: boolean): UserProfile => {
	const profile = UserProfileSchema.parse({ owner: OWNER, nickname: 'Ada' });

	return {
		...profile,
		preferences: {
			...profile.preferences,
			sharing: { ...profile.preferences.sharing, leaderboardOptIn }
		}
	};
};

describe('isShownOnGlobalLeaderboard', () => {
	it('shows an opted-in profile to another viewer', () => {
		assert.equal(
			isShownOnGlobalLeaderboard({ owner: OWNER, profile: profileWith(true), selfOwner: VIEWER }),
			true
		);
	});

	it('hides an opted-out profile from another viewer, signed in or not', () => {
		const profile = profileWith(false);

		assert.equal(isShownOnGlobalLeaderboard({ owner: OWNER, profile, selfOwner: VIEWER }), false);
		assert.equal(
			isShownOnGlobalLeaderboard({ owner: OWNER, profile, selfOwner: undefined }),
			false
		);
	});

	it('keeps the viewer their own entry when they opted out', () => {
		assert.equal(
			isShownOnGlobalLeaderboard({ owner: OWNER, profile: profileWith(false), selfOwner: OWNER }),
			true
		);
	});

	it('fails closed while the profile is not loaded', () => {
		assert.equal(
			isShownOnGlobalLeaderboard({ owner: OWNER, profile: undefined, selfOwner: VIEWER }),
			false
		);
	});

	it('reads a profile stored before the sharing preferences as opted in', () => {
		const legacy = UserProfileSchema.parse({ owner: OWNER, nickname: 'Ada' });

		assert.equal(
			isShownOnGlobalLeaderboard({ owner: OWNER, profile: legacy, selfOwner: VIEWER }),
			true
		);
	});
});
