import { Collection } from '#lib/constants/collections.constants.ts';
import {
	REFERRAL_EXISTING_USER_REASON,
	REFERRAL_SIGNUP_WINDOW_MS,
	REFERRAL_VXP_BONUS_BASE_UNITS
} from '#lib/constants/referral.constants.ts';
import { MILLISECOND_IN_NANOSECONDS } from '#lib/constants/time.constants.ts';
import type { ReferralDoc } from '#lib/types/referral.ts';
import {
	controller,
	deleteContext,
	hostNowMs,
	installSatelliteHost,
	setContext,
	type SatelliteHost
} from '#root/src/tests/mocks/satellite-host.mock.ts';
import {
	assertDeleteReferral,
	assertDeleteReferralCode,
	assertSetReferral,
	isReferralPayoutRecord
} from '#satellite/services/referral.services.ts';
import { Principal } from '@icp-sdk/core/principal';
import assert from 'node:assert/strict';
import { afterEach, beforeEach, describe, it } from 'node:test';

const referrer = Principal.fromUint8Array(new Uint8Array([2, 2, 2]));
const referee = Principal.fromUint8Array(new Uint8Array([3, 3, 3]));
const stranger = Principal.fromUint8Array(new Uint8Array([4, 4, 4]));

const code = 'ABCD2345';

const owed = { status: 'owed' as const, amountBaseUnits: REFERRAL_VXP_BONUS_BASE_UNITS.toString() };
const paid = { ...owed, status: 'paid' as const, blockIndex: '7' };

const redeemed: ReferralDoc = {
	version: 1,
	referrer: referrer.toText(),
	code,
	redeemedAtMs: hostNowMs,
	withinReferrerCap: false,
	refereePayout: owed,
	referrerPayout: { status: 'none', amountBaseUnits: '0' }
};

const settled: ReferralDoc = {
	...redeemed,
	withinReferrerCap: true,
	refereePayout: paid,
	referrerPayout: paid
};

const nsAgo = (ms: number): bigint => BigInt(hostNowMs - ms) * MILLISECOND_IN_NANOSECONDS;

describe('referral.services', () => {
	let host: SatelliteHost;

	const installWithProfileAge = (ageMs: number) => {
		host = installSatelliteHost({
			docs: {
				[Collection.PROFILES]: { [referee.toText()]: { owner: referee.toText() } },
				[Collection.REFERRAL_CODES]: { [code]: { owner: referrer.toText() } }
			},
			createdAtNs: { [Collection.PROFILES]: { [referee.toText()]: nsAgo(ageMs) } }
		});
	};

	beforeEach(() => installWithProfileAge(60_000));

	afterEach(() => host.restore());

	describe('assertSetReferral', () => {
		const create = ({ caller, doc = redeemed }: { caller: Principal; doc?: ReferralDoc }) =>
			setContext({
				caller,
				collection: Collection.REFERRALS,
				key: referee.toText(),
				proposed: doc
			});

		const update = ({
			caller,
			current,
			proposed
		}: {
			caller: Principal;
			current: ReferralDoc;
			proposed: ReferralDoc;
		}) =>
			setContext({
				caller,
				collection: Collection.REFERRALS,
				key: referee.toText(),
				current,
				currentOwner: referee,
				proposed
			});

		it('rejects the referee setting a paid side back to owed', () => {
			assert.throws(
				() =>
					assertSetReferral(
						update({
							caller: referee,
							current: settled,
							proposed: { ...settled, refereePayout: owed, referrerPayout: owed }
						})
					),
				/only the satellite writes/
			);
		});

		it('rejects the referee writing their own referral record', () => {
			assert.throws(
				() => assertSetReferral(create({ caller: referee })),
				/only the satellite writes/
			);
		});

		it('rejects a satellite write that reopens a paid side', () => {
			assert.throws(
				() =>
					assertSetReferral(
						update({
							caller: controller,
							current: settled,
							proposed: { ...settled, refereePayout: owed }
						})
					),
				/paid/
			);
		});

		it('lets the satellite move an owed side forward', () => {
			assert.doesNotThrow(() =>
				assertSetReferral(
					update({
						caller: controller,
						current: redeemed,
						proposed: { ...redeemed, refereePayout: { ...owed, status: 'processing' } }
					})
				)
			);
		});

		it('rejects a satellite write that moves an armed referrer side back to none', () => {
			const armed: ReferralDoc = { ...redeemed, withinReferrerCap: true, referrerPayout: owed };

			assert.throws(
				() =>
					assertSetReferral(
						update({
							caller: controller,
							current: armed,
							proposed: {
								...armed,
								withinReferrerCap: false,
								referrerPayout: { status: 'none', amountBaseUnits: '0' }
							}
						})
					),
				/only moves forward/
			);
		});

		it('lets a failed transfer hand processing back to owed', () => {
			const processing: ReferralDoc = {
				...settled,
				referrerPayout: { ...owed, status: 'processing' }
			};

			assert.doesNotThrow(() =>
				assertSetReferral(
					update({
						caller: controller,
						current: processing,
						proposed: { ...processing, referrerPayout: owed }
					})
				)
			);
		});

		it('lets the satellite record a redemption inside the signup window', () => {
			assert.doesNotThrow(() => assertSetReferral(create({ caller: controller })));
		});

		it('refuses a redemption for an account older than the signup window', () => {
			host.restore();
			installWithProfileAge(REFERRAL_SIGNUP_WINDOW_MS + 60_000);

			assert.throws(
				() => assertSetReferral(create({ caller: controller })),
				new RegExp(REFERRAL_EXISTING_USER_REASON)
			);
		});

		it('refuses a redemption that starts with a payout already armed', () => {
			assert.throws(
				() =>
					assertSetReferral(
						create({ caller: controller, doc: { ...redeemed, referrerPayout: owed } })
					),
				/must start/
			);
		});
	});

	describe('assertDeleteReferralCode', () => {
		const remove = (caller: Principal) =>
			deleteContext({
				caller,
				collection: Collection.REFERRAL_CODES,
				key: code,
				current: { owner: referrer.toText() },
				currentOwner: referrer
			});

		it("rejects deleting another user's referral code", () => {
			assert.throws(
				() => assertDeleteReferralCode(remove(stranger)),
				/only the owner or the satellite/
			);
		});

		it('lets the owner and a satellite controller delete it', () => {
			assert.doesNotThrow(() => assertDeleteReferralCode(remove(referrer)));
			assert.doesNotThrow(() => assertDeleteReferralCode(remove(controller)));
		});
	});

	describe('assertDeleteReferral', () => {
		const remove = (caller: Principal) =>
			deleteContext({
				caller,
				collection: Collection.REFERRALS,
				key: referee.toText(),
				current: settled,
				currentOwner: referee
			});

		it('rejects the referee deleting their referral record to redeem again', () => {
			assert.throws(() => assertDeleteReferral(remove(referee)), /only the satellite writes/);
			assert.throws(() => assertDeleteReferral(remove(stranger)), /only the satellite writes/);
		});

		it('lets a satellite controller delete it', () => {
			assert.doesNotThrow(() => assertDeleteReferral(remove(controller)));
		});
	});

	describe('isReferralPayoutRecord', () => {
		it('keeps a row whose bonus or referrer side has started paying', () => {
			assert.equal(isReferralPayoutRecord(settled), true);
			assert.equal(isReferralPayoutRecord({ ...redeemed, refereePayout: paid }), true);
			assert.equal(isReferralPayoutRecord({ ...redeemed, referrerPayout: owed }), true);
		});

		it('lets the purge drop a row that has not started paying', () => {
			assert.equal(isReferralPayoutRecord(redeemed), false);
		});
	});
});
