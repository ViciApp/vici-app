import { visibleLeaderboard } from '#lib/derived/leaderboard.derived.ts';
import { UserProfileSchema } from '#lib/schema/profile.schema.ts';
import { leaderboardStore } from '#lib/stores/leaderboard.store.ts';
import { profilesStore } from '#lib/stores/profiles.store.ts';
import { userStore } from '#lib/stores/user.store.ts';
import type { UserProfile } from '#lib/types/profile.ts';
import type { User } from '#lib/types/user.ts';
import assert from 'node:assert/strict';
import { afterEach, describe, it } from 'node:test';
import { get } from 'svelte/store';

const OPTED_IN = 'aaaaa-aa';
const OPTED_OUT = 'ryjl3-tyaaa-aaaaa-aaaba-cai';
const VIEWER = '2vxsx-fae';

const profileOf = ({
	owner,
	leaderboardOptIn = true
}: {
	owner: string;
	leaderboardOptIn?: boolean;
}): UserProfile => {
	const profile = UserProfileSchema.parse({ owner, nickname: owner });

	return {
		...profile,
		preferences: {
			...profile.preferences,
			sharing: { ...profile.preferences.sharing, leaderboardOptIn }
		}
	};
};

// What the API's leaderboard wire decodes to: every row opted in,
// whatever its owner stored.
const leaderboardRows = (owners: string[]): UserProfile[] =>
	owners.map((owner) => profileOf({ owner }));

const visibleOwners = (): string[] => get(visibleLeaderboard).map(({ owner }) => owner);

const signIn = (owner: string): void =>
	userStore.update((data) => ({
		...data,
		user: { owner } as User,
		profile: profileOf({ owner, leaderboardOptIn: false })
	}));

describe('visibleLeaderboard', () => {
	afterEach(() => {
		leaderboardStore.set(undefined);
		profilesStore.set(new Map());
		userStore.update((data) => ({ ...data, user: undefined, profile: undefined }));
	});

	it('reads the opt-out from the profile cache, not the leaderboard row', () => {
		leaderboardStore.set(leaderboardRows([OPTED_IN, OPTED_OUT]));
		profilesStore.set(
			new Map([
				[OPTED_IN, profileOf({ owner: OPTED_IN })],
				[OPTED_OUT, profileOf({ owner: OPTED_OUT, leaderboardOptIn: false })]
			])
		);

		assert.deepEqual(visibleOwners(), [OPTED_IN]);
	});

	it('hides a row until its profile is cached', () => {
		leaderboardStore.set(leaderboardRows([OPTED_IN]));

		assert.deepEqual(visibleOwners(), []);

		profilesStore.set(new Map([[OPTED_IN, profileOf({ owner: OPTED_IN })]]));

		assert.deepEqual(visibleOwners(), [OPTED_IN]);
	});

	it("keeps the viewer's own row only while they are signed in", () => {
		leaderboardStore.set(leaderboardRows([VIEWER]));
		profilesStore.set(new Map([[VIEWER, profileOf({ owner: VIEWER, leaderboardOptIn: false })]]));
		signIn(VIEWER);

		assert.deepEqual(visibleOwners(), [VIEWER]);

		userStore.update((data) => ({ ...data, user: undefined, profile: undefined }));

		assert.deepEqual(visibleOwners(), []);
	});
});
