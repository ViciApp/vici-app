import { Collection } from '#lib/constants/collections.constants.ts';
import { VXP_LEAGUE_FOUNDER_MAX_AWARDS } from '#lib/constants/vxp-economy.constants.ts';
import type { LeagueDoc } from '#lib/types/league.ts';
import type { ReferralDoc } from '#lib/types/referral.ts';
import { vxpAwardKey, type VxpAwardDoc, type VxpAwardType } from '#lib/types/vxp-award.ts';
import type { VxpOnboardingDoc } from '#lib/types/vxp-onboarding.ts';
import {
	docBytes,
	installSatelliteHost,
	setContext,
	type SatelliteHost
} from '#root/src/tests/mocks/satellite-host.mock.ts';
import { hardDeleteAccountFn } from '#satellite/services/account.services.ts';
import { redeemReferralCodeFn } from '#satellite/services/referral.services.ts';
import { assertSetVxpAward } from '#satellite/services/vxp-awards.services.ts';
import { onLeagueSetForFounderVxpPayout } from '#satellite/services/vxp-league-founder-awards.services.ts';
import { onProfileSetForVxpOnboarding } from '#satellite/services/vxp-onboarding.services.ts';
import { Principal } from '@icp-sdk/core/principal';
import type { OnSetDocContext } from '@junobuild/functions';
import { IcrcLedgerIdl } from '@junobuild/functions/canisters/ledger/icrc';
import assert from 'node:assert/strict';
import { afterEach, beforeEach, describe, it } from 'node:test';

const leaver = Principal.fromUint8Array(new Uint8Array([2, 2, 2]));
const other = Principal.fromUint8Array(new Uint8Array([3, 3, 3]));

const award = ({
	recipient,
	awardType,
	awardKey,
	status
}: {
	recipient: Principal;
	awardType: VxpAwardType;
	awardKey: string;
	status: VxpAwardDoc['status'];
}): VxpAwardDoc => ({
	recipient: recipient.toText(),
	awardType,
	awardKey,
	amountBaseUnits: '1000',
	status,
	earnedAtMs: 1,
	...(status === 'paid' ? { paidAtMs: 1, blockIndex: '1' } : {}),
	...(status === 'failed' ? { errorMessage: 'rejected' } : {})
});

const paidLadder: VxpOnboardingDoc = {
	version: 1,
	tradeCount: 0,
	legacyOnboardingSynced: true,
	milestones: {
		m1: { status: 'paid', amountBaseUnits: '15000000', blockIndex: '1' },
		m2: { status: 'none', amountBaseUnits: '0' },
		m3: { status: 'none', amountBaseUnits: '0' }
	}
};

/** A doc as a hook context carries it. */
const hookDoc = ({ data, owner }: { data: object; owner: Principal }) => ({
	owner: owner.toUint8Array(),
	data: docBytes(data),
	created_at: 1n,
	updated_at: 1n,
	version: 1n
});

const onSet = ({
	caller,
	collection,
	key,
	after
}: {
	caller: Principal;
	collection: string;
	key: string;
	after: object;
}): OnSetDocContext => ({
	caller: caller.toUint8Array(),
	data: { collection, key, data: { after: hookDoc({ data: after, owner: caller }) } }
});

describe('a deleted account cannot collect its one-time awards again', () => {
	let host: SatelliteHost;

	const seed = (doc: VxpAwardDoc) =>
		host.putDoc({
			collection: Collection.VXP_AWARDS,
			key: vxpAwardKey(doc),
			data: doc,
			owner: Principal.fromText(doc.recipient)
		});

	const purge = (principal: Principal) =>
		hardDeleteAccountFn({
			callerText: principal.toText(),
			callerBytes: principal.toUint8Array()
		});

	const createAward = (doc: VxpAwardDoc) =>
		assertSetVxpAward(
			setContext({
				caller: Principal.fromText(doc.recipient),
				collection: Collection.VXP_AWARDS,
				key: vxpAwardKey(doc),
				proposed: doc
			})
		);

	const signUp = (principal: Principal) =>
		host.putDoc({
			collection: Collection.PROFILES,
			key: principal.toText(),
			data: { owner: principal.toText() },
			owner: principal
		});

	beforeEach(() => {
		host = installSatelliteHost();
		host.onCall({
			method: 'icrc1_transfer',
			argTypes: [IcrcLedgerIdl.TransferArg],
			result: IcrcLedgerIdl.TransferResult,
			handler: () => ({ Ok: BigInt(7) })
		});
	});

	afterEach(() => host.restore());

	it('refuses a one-time award the principal was paid before its purge', () => {
		const streak = award({
			recipient: leaver,
			awardType: 'streak',
			awardKey: 'streak_3',
			status: 'paid'
		});

		seed(streak);
		purge(leaver);

		assert.deepEqual(host.keys(Collection.VXP_AWARDS), []);
		assert.throws(() => createAward({ ...streak, status: 'pending' }), /already paid/);
		assert.doesNotThrow(() => createAward({ ...streak, awardKey: 'streak_7', status: 'pending' }));
		assert.doesNotThrow(() =>
			createAward({ ...streak, recipient: other.toText(), status: 'pending' })
		);
	});

	it('leaves no marker for a repeatable or a failed award', () => {
		const overtime = award({
			recipient: leaver,
			awardType: 'flow_overtime',
			awardKey: '2026-11-02',
			status: 'paid'
		});
		const comeback = award({
			recipient: leaver,
			awardType: 'comeback',
			awardKey: 'restore',
			status: 'failed'
		});

		seed(overtime);
		seed(comeback);
		purge(leaver);

		assert.doesNotThrow(() => createAward({ ...overtime, status: 'pending' }));
		assert.doesNotThrow(() => createAward({ ...comeback, status: 'pending' }));
	});

	it('does not pay the registration grant again on a re-sign-up', async () => {
		host.putDoc({
			collection: Collection.VXP_ONBOARDING,
			key: leaver.toText(),
			data: paidLadder,
			owner: leaver
		});
		purge(leaver);

		for (const principal of [leaver, other]) {
			signUp(principal);
			host.setCaller(principal);
			await onProfileSetForVxpOnboarding(
				onSet({
					caller: principal,
					collection: Collection.PROFILES,
					key: principal.toText(),
					after: { owner: principal.toText() }
				})
			);
		}

		assert.equal(host.calls().filter((method) => method === 'icrc1_transfer').length, 1);
	});

	it('counts the founder awards of the purged account toward the lifetime cap', async () => {
		for (let i = 0; i < VXP_LEAGUE_FOUNDER_MAX_AWARDS; i++) {
			seed(
				award({
					recipient: leaver,
					awardType: 'league_founder',
					awardKey: `league-${i}`,
					status: 'paid'
				})
			);
		}

		purge(leaver);

		const league: LeagueDoc = {
			id: 'league-new',
			name: 'New',
			inviteCode: 'ABC123',
			owner: leaver.toText(),
			createdAtMs: 1
		};

		host.setCaller(leaver);
		await onLeagueSetForFounderVxpPayout(
			onSet({ caller: leaver, collection: Collection.LEAGUES, key: league.id, after: league })
		);

		assert.ok(!host.calls().includes('icrc1_transfer'));
		assert.deepEqual(host.keys(Collection.VXP_AWARDS), []);
	});

	it('keeps a paid referral record, so the referee bonus cannot be redeemed again', () => {
		const code = 'ABCD2345';
		const redemption: ReferralDoc = {
			version: 1,
			referrer: other.toText(),
			code,
			redeemedAtMs: 1,
			withinReferrerCap: true,
			refereePayout: { status: 'paid', amountBaseUnits: '1000', blockIndex: '1' },
			referrerPayout: { status: 'paid', amountBaseUnits: '1000', blockIndex: '2' }
		};

		host.putDoc({
			collection: Collection.REFERRALS,
			key: leaver.toText(),
			data: redemption,
			owner: leaver
		});
		host.putDoc({
			collection: Collection.REFERRAL_CODES,
			key: code,
			data: { owner: other.toText() },
			owner: other
		});
		purge(leaver);
		signUp(leaver);
		host.setCaller(leaver);

		assert.throws(() => redeemReferralCodeFn({ code }), /already redeemed/);
	});

	it('writes markers that name no principal, once however often the purge runs', () => {
		seed(
			award({ recipient: leaver, awardType: 'achievement', awardKey: 'oracle', status: 'paid' })
		);
		purge(leaver);

		const written = host.keys(Collection.VXP_AWARD_MARKERS);

		purge(leaver);

		assert.equal(written.length, 1);
		assert.deepEqual(host.keys(Collection.VXP_AWARD_MARKERS), written);
		assert.ok(written.every((key) => !key.includes(leaver.toText())));
		assert.deepEqual(
			host.readDoc({ collection: Collection.VXP_AWARD_MARKERS, key: written[0] ?? '' }),
			{}
		);
	});
});
