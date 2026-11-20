import { Collection } from '#lib/constants/collections.constants.ts';
import { DAILY_HARD_CAP } from '#lib/constants/flow-rewards.constants.ts';
import { MAX_PROFILE_POINTS } from '#lib/constants/profile.constants.ts';
import { UserRole } from '#lib/enums/user.ts';
import type { UserProfile } from '#lib/types/profile.ts';
import { vxpAwardKey, type VxpAwardDoc } from '#lib/types/vxp-award.ts';
import {
	answerSettlementAccuracy,
	controller,
	deleteContext,
	hostNowMs,
	installSatelliteHost,
	setContext,
	type SatelliteHost
} from '#root/src/tests/mocks/satellite-host.mock.ts';
import { assertSetDoc } from '#satellite/index.ts';
import {
	getUserRankAndCountFn,
	listLeaderboard,
	refreshLeaderboardRankingFn
} from '#satellite/services/leaderboard.services.ts';
import { APP_CONFIG_NEW_PROFILE_GATE_KEY } from '#satellite/services/new-profile-gate.services.ts';
import {
	assertProfile,
	assertProfileOwner,
	getProfile,
	recordFlowSwipeFn
} from '#satellite/services/profile.services.ts';
import { Principal } from '@icp-sdk/core/principal';
import { IcrcLedgerIdl } from '@junobuild/functions/canisters/ledger/icrc';
import assert from 'node:assert/strict';
import { afterEach, beforeEach, describe, it } from 'node:test';

const owner = Principal.fromUint8Array(new Uint8Array([2, 2, 2]));
const stranger = Principal.fromUint8Array(new Uint8Array([3, 3, 3]));
const admin = Principal.fromUint8Array(new Uint8Array([4, 4, 4]));

const profile = { owner: owner.toText(), nickname: 'owner', points: 10 };

describe('profile.services', () => {
	let host: SatelliteHost;

	beforeEach(() => {
		host = installSatelliteHost();
	});

	afterEach(() => host.restore());

	describe('assertProfile', () => {
		const update = (caller: Principal) =>
			setContext({
				caller,
				collection: Collection.PROFILES,
				key: owner.toText(),
				current: profile,
				currentOwner: owner,
				proposed: { ...profile, deletedAtMs: 1 }
			});

		it("rejects a write to another user's profile", () => {
			assert.throws(() => assertProfile(update(stranger)), /only the owner or the satellite/);
		});

		it('lets the owner update their profile', () => {
			assert.doesNotThrow(() => assertProfile(update(owner)));
		});

		it('lets a satellite controller update a profile', () => {
			assert.doesNotThrow(() => assertProfile(update(controller)));
		});

		it("rejects a profile whose owner field is not the doc key's principal", () => {
			const forged = (current?: object) =>
				setContext({
					caller: owner,
					collection: Collection.PROFILES,
					key: owner.toText(),
					current,
					currentOwner: owner,
					proposed: { ...profile, owner: admin.toText() }
				});

			assert.throws(() => assertProfile(forged()), /owner must be the doc key/);
			assert.throws(() => assertProfile(forged(profile)), /owner must be the doc key/);
		});
	});

	describe('assertProfile on schoolStatus', () => {
		const write = ({
			caller,
			current,
			schoolStatus
		}: {
			caller: Principal;
			current?: object;
			schoolStatus?: string;
		}) =>
			setContext({
				caller,
				collection: Collection.PROFILES,
				key: owner.toText(),
				current,
				currentOwner: owner,
				proposed: { ...profile, schoolStatus }
			});

		it('rejects the owner setting it on a new profile', () => {
			assert.throws(
				() => assertProfile(write({ caller: owner, schoolStatus: 'verified' })),
				/schoolStatus is set by the satellite/
			);
		});

		it('rejects the owner changing or clearing the stored value', () => {
			assert.throws(
				() => assertProfile(write({ caller: owner, current: profile, schoolStatus: 'verified' })),
				/schoolStatus is set by the satellite/
			);
			assert.throws(
				() =>
					assertProfile(
						write({ caller: owner, current: { ...profile, schoolStatus: 'verified' } })
					),
				/schoolStatus is set by the satellite/
			);
		});

		it('lets the owner keep the stored value', () => {
			assert.doesNotThrow(() =>
				assertProfile(
					write({
						caller: owner,
						current: { ...profile, schoolStatus: 'verified' },
						schoolStatus: 'verified'
					})
				)
			);
		});

		it('lets a satellite controller set it', () => {
			assert.doesNotThrow(() =>
				assertProfile(write({ caller: controller, current: profile, schoolStatus: 'verified' }))
			);
		});
	});

	describe('assertProfile on points', () => {
		const write = ({ current, points }: { current: object; points: unknown }) =>
			setContext({
				caller: owner,
				collection: Collection.PROFILES,
				key: owner.toText(),
				current,
				currentOwner: owner,
				proposed: { ...profile, points }
			});

		it('rejects points that are not a whole number up to the ceiling', () => {
			for (const points of [-5, 12.5, '900', 1e300, MAX_PROFILE_POINTS + 1]) {
				assert.throws(
					() => assertProfile(write({ current: profile, points })),
					/points must be a whole number from 0 to/
				);
			}
		});

		it('lets the owner write whole points up to the ceiling', () => {
			for (const points of [0, 1_250, MAX_PROFILE_POINTS]) {
				assert.doesNotThrow(() => assertProfile(write({ current: profile, points })));
			}
		});

		it('lets a write keep a stored value it does not change', () => {
			const stored = { ...profile, points: 12.5 };

			assert.doesNotThrow(() => assertProfile(write({ current: stored, points: 12.5 })));
		});
	});

	describe('assertProfile on the Flow daily goal', () => {
		const today = '2026-11-18';
		const stored = { ...profile, dailyGoalDone: 3, dailyGoalDate: today };

		const write = ({
			caller,
			current,
			dailyGoalDone,
			dailyGoalDate
		}: {
			caller: Principal;
			current?: object;
			dailyGoalDone?: number;
			dailyGoalDate?: string;
		}) =>
			setContext({
				caller,
				collection: Collection.PROFILES,
				key: owner.toText(),
				current,
				currentOwner: owner,
				proposed: { ...profile, dailyGoalDone, dailyGoalDate }
			});

		const openSignUps = () =>
			host.putDoc({
				collection: Collection.APP_CONFIG,
				key: APP_CONFIG_NEW_PROFILE_GATE_KEY,
				data: { enabled: false },
				owner: controller
			});

		it('rejects the owner raising the stored count', () => {
			assert.throws(
				() =>
					assertProfile(
						write({
							caller: owner,
							current: stored,
							dailyGoalDone: DAILY_HARD_CAP - 1,
							dailyGoalDate: today
						})
					),
				/daily goal is set by the satellite/
			);
		});

		it('rejects the owner moving the day to restart the count', () => {
			assert.throws(
				() =>
					assertProfile(
						write({
							caller: owner,
							current: stored,
							dailyGoalDone: DAILY_HARD_CAP - 1,
							dailyGoalDate: '2026-11-19'
						})
					),
				/daily goal is set by the satellite/
			);
		});

		it('rejects the owner lowering the stored count', () => {
			assert.throws(
				() =>
					assertProfile(
						write({ caller: owner, current: stored, dailyGoalDone: 0, dailyGoalDate: today })
					),
				/daily goal is set by the satellite/
			);
		});

		it('rejects a new profile that carries a count or a day', () => {
			openSignUps();

			assert.throws(
				() => assertProfile(write({ caller: owner, dailyGoalDone: DAILY_HARD_CAP - 1 })),
				/daily goal is set by the satellite/
			);
			assert.throws(
				() => assertProfile(write({ caller: owner, dailyGoalDone: 0, dailyGoalDate: today })),
				/daily goal is set by the satellite/
			);
		});

		it('lets the owner keep the stored count and day', () => {
			assert.doesNotThrow(() =>
				assertProfile(
					write({ caller: owner, current: stored, dailyGoalDone: 3, dailyGoalDate: today })
				)
			);
			assert.doesNotThrow(() => assertProfile(write({ caller: owner, current: profile })));

			openSignUps();

			assert.doesNotThrow(() => assertProfile(write({ caller: owner, dailyGoalDone: 0 })));
		});

		it('lets a satellite controller set it within the hard cap', () => {
			assert.doesNotThrow(() =>
				assertProfile(
					write({
						caller: controller,
						current: stored,
						dailyGoalDone: DAILY_HARD_CAP,
						dailyGoalDate: today
					})
				)
			);
			assert.throws(
				() =>
					assertProfile(
						write({
							caller: controller,
							current: stored,
							dailyGoalDone: DAILY_HARD_CAP + 1,
							dailyGoalDate: today
						})
					),
				/cannot exceed the daily hard cap/
			);
		});
	});

	describe('assertProfileOwner', () => {
		const remove = (caller: Principal) =>
			deleteContext({
				caller,
				collection: Collection.PROFILES,
				key: owner.toText(),
				current: profile,
				currentOwner: owner
			});

		it("rejects deleting another user's profile", () => {
			assert.throws(() => assertProfileOwner(remove(stranger)), /only the owner or the satellite/);
		});

		it('lets the owner and a controller delete the profile', () => {
			assert.doesNotThrow(() => assertProfileOwner(remove(owner)));
			assert.doesNotThrow(() => assertProfileOwner(remove(controller)));
		});
	});

	describe('a stored profile whose owner field names another principal', () => {
		beforeEach(() => {
			host.putDoc({
				collection: Collection.ROLES,
				key: admin.toText(),
				data: { role: UserRole.ADMIN },
				owner: controller
			});
			host.putDoc({
				collection: Collection.PROFILES,
				key: owner.toText(),
				data: { ...profile, owner: admin.toText(), points: 99 },
				owner
			});
			host.setCaller(stranger);
		});

		it("reads as the doc key's principal, without the other principal's role", () => {
			const read = getProfile(owner.toText());

			assert.equal(read?.owner, owner.toText());
			assert.equal(read?.role, undefined);
		});

		it("ranks and lists under the doc key, without the other principal's role", async () => {
			answerSettlementAccuracy({
				host,
				settlements: [{ principal: owner, atMs: hostNowMs - 1, calls: 20, wins: 15 }]
			});
			await refreshLeaderboardRankingFn();

			const [top] = listLeaderboard();

			assert.equal(top?.owner, owner.toText());
			assert.equal(top?.role, undefined);
			assert.deepEqual(getUserRankAndCountFn({ principal: admin.toText() }), {
				rank: undefined,
				count: 1
			});
		});
	});
});

describe('recordFlowSwipeFn', () => {
	const user = Principal.fromUint8Array(new Uint8Array([5, 5, 5]));
	const today = '2026-11-18';
	let host: SatelliteHost;

	const seed = (data: Partial<UserProfile>) =>
		host.putDoc({
			collection: Collection.PROFILES,
			key: user.toText(),
			data: { owner: user.toText(), nickname: 'swiper', ...data },
			owner: user
		});

	const stored = () =>
		host.readDoc<UserProfile>({ collection: Collection.PROFILES, key: user.toText() });

	beforeEach(() => {
		// The real asserts run on every serverless write, as on the satellite.
		host = installSatelliteHost({ asserts: { set: assertSetDoc.assert } });
		host.onCall({
			method: 'icrc1_transfer',
			argTypes: [IcrcLedgerIdl.TransferArg],
			result: IcrcLedgerIdl.TransferResult,
			handler: () => ({ Ok: BigInt(7) })
		});
		host.setCaller(user);
	});

	afterEach(() => host.restore());

	it('increments the stored count through the profiles assert', async () => {
		seed({ dailyGoalDone: 3, dailyGoalDate: today });

		const result = await recordFlowSwipeFn({ dayKey: today });

		assert.deepEqual(result, { dailyGoalDone: 4, dailyGoalDate: today, capReached: false });
		assert.equal(stored()?.dailyGoalDone, 4);
		assert.equal(stored()?.dailyGoalDate, today);
		assert.deepEqual(host.calls(), []);
	});

	it('starts a new day at one', async () => {
		seed({ dailyGoalDone: DAILY_HARD_CAP, dailyGoalDate: '2026-11-17' });

		const result = await recordFlowSwipeFn({ dayKey: today });

		assert.deepEqual(result, { dailyGoalDone: 1, dailyGoalDate: today, capReached: false });
	});

	it('mints the overtime award when the count reaches the hard cap', async () => {
		seed({ dailyGoalDone: DAILY_HARD_CAP - 1, dailyGoalDate: today });

		const result = await recordFlowSwipeFn({ dayKey: today });
		const award = host.readDoc<VxpAwardDoc>({
			collection: Collection.VXP_AWARDS,
			key: vxpAwardKey({ recipient: user.toText(), awardType: 'flow_overtime', awardKey: today })
		});

		assert.deepEqual(result, {
			dailyGoalDone: DAILY_HARD_CAP,
			dailyGoalDate: today,
			capReached: true
		});
		assert.deepEqual(host.calls(), ['icrc1_transfer']);
		assert.equal(award?.status, 'paid');
	});
});
