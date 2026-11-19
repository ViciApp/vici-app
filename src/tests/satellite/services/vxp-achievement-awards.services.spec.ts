import { ACHIEVEMENTS } from '#lib/constants/achievements.constants.ts';
import { Collection } from '#lib/constants/collections.constants.ts';
import { vxpAwardKey, type VxpAwardDoc } from '#lib/types/vxp-award.ts';
import { vxpBaseUnits } from '#lib/utils/vxp-amount.utils.ts';
import {
	docBytes,
	installSatelliteHost,
	type SatelliteHost
} from '#root/src/tests/mocks/satellite-host.mock.ts';
import { assertDeleteDoc, assertSetDoc } from '#satellite/index.ts';
import { onProfileSetForAchievementAward } from '#satellite/services/vxp-achievement-awards.services.ts';
import { Principal } from '@icp-sdk/core/principal';
import type { OnSetDocContext } from '@junobuild/functions';
import { IcrcLedgerIdl, type IcrcLedgerDid } from '@junobuild/functions/canisters/ledger/icrc';
import assert from 'node:assert/strict';
import { afterEach, beforeEach, describe, it } from 'node:test';

const user = Principal.fromUint8Array(new Uint8Array([2, 2, 2]));
const other = Principal.fromUint8Array(new Uint8Array([3, 3, 3]));

const [first, second] = ACHIEVEMENTS.filter(({ xp }) => xp > 0);

const profileWrite = ({
	prev,
	next,
	caller = user
}: {
	prev?: string[];
	next: string[];
	caller?: Principal;
}): OnSetDocContext => {
	const doc = (unlockedAchievements: string[]) => ({
		owner: user.toUint8Array(),
		data: docBytes({ unlockedAchievements }),
		created_at: 1n,
		updated_at: 1n,
		version: 1n
	});

	return {
		caller: caller.toUint8Array(),
		data: {
			collection: Collection.PROFILES,
			key: user.toText(),
			data: { before: prev && doc(prev), after: doc(next) }
		}
	};
};

const readAward = ({
	host,
	achievementId
}: {
	host: SatelliteHost;
	achievementId: string;
}): VxpAwardDoc | undefined =>
	host.readDoc<VxpAwardDoc>({
		collection: Collection.VXP_AWARDS,
		key: vxpAwardKey({
			recipient: user.toText(),
			awardType: 'achievement',
			awardKey: achievementId
		})
	});

describe('onProfileSetForAchievementAward', () => {
	let host: SatelliteHost;
	let transferResult: object;
	let sent: IcrcLedgerDid.TransferArg[];

	const transfers = (): number =>
		host.calls().filter((method) => method === 'icrc1_transfer').length;

	beforeEach(() => {
		// The real asserts run on every serverless write, as on the satellite.
		host = installSatelliteHost({
			asserts: { set: assertSetDoc.assert, remove: assertDeleteDoc.assert }
		});
		transferResult = { Ok: BigInt(7) };
		sent = [];
		host.onCall({
			method: 'icrc1_transfer',
			argTypes: [IcrcLedgerIdl.TransferArg],
			result: IcrcLedgerIdl.TransferResult,
			handler: ([arg]) => {
				sent.push(arg as IcrcLedgerDid.TransferArg);

				return transferResult;
			}
		});
	});

	afterEach(() => host.restore());

	it('pays a newly unlocked achievement its catalog value in VXP', async () => {
		await onProfileSetForAchievementAward(profileWrite({ prev: [], next: [first.id] }));

		const award = readAward({ host, achievementId: first.id });

		assert.equal(transfers(), 1);
		assert.equal(award?.status, 'paid');
		assert.equal(award?.blockIndex, '7');
		assert.equal(award?.amountBaseUnits, vxpBaseUnits(first.xp).toString());

		const [transfer] = sent;

		assert.equal(transfer?.amount, vxpBaseUnits(first.xp));
		assert.equal(transfer?.to.owner.toText(), user.toText());
		assert.deepEqual(transfer?.memo, [new TextEncoder().encode(`vxp:achievement:${first.id}`)]);
	});

	it('pays only the achievements added by this write', async () => {
		await onProfileSetForAchievementAward(
			profileWrite({ prev: [first.id], next: [first.id, second.id] })
		);

		assert.equal(transfers(), 1);
		assert.equal(readAward({ host, achievementId: first.id }), undefined);
		assert.equal(readAward({ host, achievementId: second.id })?.status, 'paid');
	});

	it('pays an achievement once when the unlock is seen twice', async () => {
		const write = profileWrite({ prev: [], next: [first.id] });

		await onProfileSetForAchievementAward(write);
		await onProfileSetForAchievementAward(write);

		assert.equal(transfers(), 1);
		assert.equal(readAward({ host, achievementId: first.id })?.status, 'paid');
	});

	it('pays nothing for an id outside the catalog', async () => {
		await onProfileSetForAchievementAward(profileWrite({ prev: [], next: ['not-an-achievement'] }));

		assert.equal(transfers(), 0);
		assert.deepEqual(host.keys(Collection.VXP_AWARDS), []);
	});

	it("pays nothing when someone else writes the user's profile", async () => {
		await onProfileSetForAchievementAward(
			profileWrite({ prev: [], next: [first.id], caller: other })
		);

		assert.equal(transfers(), 0);
		assert.deepEqual(host.keys(Collection.VXP_AWARDS), []);
	});

	it('records a refused transfer as failed, with the ledger error', async () => {
		transferResult = { Err: { TemporarilyUnavailable: null } };

		await onProfileSetForAchievementAward(profileWrite({ prev: [], next: [first.id] }));

		const award = readAward({ host, achievementId: first.id });

		assert.equal(award?.status, 'failed');
		assert.match(award?.errorMessage ?? '', /TemporarilyUnavailable/);
		assert.equal(award?.blockIndex, undefined);
	});
});
