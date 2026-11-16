import { Collection } from '#lib/constants/collections.constants.ts';
import {
	controller,
	deleteContext,
	installSatelliteHost,
	type SatelliteHost
} from '#root/src/tests/mocks/satellite-host.mock.ts';
import {
	assertDeleteReferral,
	assertDeleteReferralCode
} from '#satellite/services/referral.services.ts';
import { Principal } from '@icp-sdk/core/principal';
import assert from 'node:assert/strict';
import { afterEach, beforeEach, describe, it } from 'node:test';

const referrer = Principal.fromUint8Array(new Uint8Array([2, 2, 2]));
const referee = Principal.fromUint8Array(new Uint8Array([3, 3, 3]));
const stranger = Principal.fromUint8Array(new Uint8Array([4, 4, 4]));

const code = 'ABCD2345';

const referral = {
	version: 1,
	referrer: referrer.toText(),
	code,
	redeemedAtMs: 1_700_000_000_000,
	withinReferrerCap: true,
	refereePayout: { status: 'paid', amountBaseUnits: '1000' },
	referrerPayout: { status: 'paid', amountBaseUnits: '1000' }
};

describe('referral.services', () => {
	let host: SatelliteHost;

	beforeEach(() => {
		host = installSatelliteHost();
	});

	afterEach(() => host.restore());

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
				current: referral,
				currentOwner: referee
			});

		it("rejects deleting another user's referral record", () => {
			assert.throws(() => assertDeleteReferral(remove(stranger)), /referrals/);
		});

		it('lets a satellite controller delete it', () => {
			assert.doesNotThrow(() => assertDeleteReferral(remove(controller)));
		});
	});
});
