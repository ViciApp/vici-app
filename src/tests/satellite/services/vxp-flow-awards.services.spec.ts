import { Collection } from '#lib/constants/collections.constants.ts';
import {
	VXP_FLOW_MILESTONES,
	VXP_FLOW_OVERTIME_BONUS,
	VXP_FLOW_OVERTIME_ROLLING_CAP
} from '#lib/constants/vxp-economy.constants.ts';
import { vxpAwardKey, type VxpAwardDoc, type VxpAwardType } from '#lib/types/vxp-award.ts';
import { vxpBaseUnits } from '#lib/utils/vxp-amount.utils.ts';
import {
	docBytes,
	installSatelliteHost,
	type SatelliteHost
} from '#root/src/tests/mocks/satellite-host.mock.ts';
import { assertDeleteDoc, assertSetDoc } from '#satellite/index.ts';
import {
	mintFlowOvertime,
	onProfileSetForFlowMilestone
} from '#satellite/services/vxp-flow-awards.services.ts';
import { Principal } from '@icp-sdk/core/principal';
import type { OnSetDocContext } from '@junobuild/functions';
import { IcrcLedgerIdl } from '@junobuild/functions/canisters/ledger/icrc';
import assert from 'node:assert/strict';
import { afterEach, beforeEach, describe, it } from 'node:test';

const user = Principal.fromUint8Array(new Uint8Array([2, 2, 2]));
const other = Principal.fromUint8Array(new Uint8Array([3, 3, 3]));

const [firstMilestone, secondMilestone] = Object.keys(VXP_FLOW_MILESTONES)
	.map(Number)
	.sort((a, b) => a - b);

const profileWrite = ({
	prev,
	next,
	caller = user
}: {
	prev: number;
	next: number;
	caller?: Principal;
}): OnSetDocContext => {
	const doc = (totalTrades: number) => ({
		owner: user.toUint8Array(),
		data: docBytes({ totalTrades }),
		created_at: 1n,
		updated_at: 1n,
		version: 1n
	});

	return {
		caller: caller.toUint8Array(),
		data: {
			collection: Collection.PROFILES,
			key: user.toText(),
			data: { before: doc(prev), after: doc(next) }
		}
	};
};

describe('vxp-flow-awards.services', () => {
	let host: SatelliteHost;
	let transferResult: object;

	const transfers = (): number =>
		host.calls().filter((method) => method === 'icrc1_transfer').length;

	const readAward = ({
		awardType,
		awardKey
	}: {
		awardType: VxpAwardType;
		awardKey: string;
	}): VxpAwardDoc | undefined =>
		host.readDoc<VxpAwardDoc>({
			collection: Collection.VXP_AWARDS,
			key: vxpAwardKey({ recipient: user.toText(), awardType, awardKey })
		});

	const milestoneAward = (milestone: number): VxpAwardDoc | undefined =>
		readAward({ awardType: 'flow_milestone', awardKey: milestone.toString() });

	beforeEach(() => {
		// The real asserts run on every serverless write, as on the satellite.
		host = installSatelliteHost({
			asserts: { set: assertSetDoc.assert, remove: assertDeleteDoc.assert }
		});
		transferResult = { Ok: BigInt(7) };
		host.onCall({
			method: 'icrc1_transfer',
			argTypes: [IcrcLedgerIdl.TransferArg],
			result: IcrcLedgerIdl.TransferResult,
			handler: () => transferResult
		});
	});

	afterEach(() => host.restore());

	describe('onProfileSetForFlowMilestone', () => {
		it('pays a crossed lifetime milestone its bonus', async () => {
			await onProfileSetForFlowMilestone(
				profileWrite({ prev: firstMilestone - 1, next: firstMilestone })
			);

			const award = milestoneAward(firstMilestone);

			assert.equal(transfers(), 1);
			assert.equal(award?.status, 'paid');
			assert.equal(award?.blockIndex, '7');
			assert.equal(
				award?.amountBaseUnits,
				vxpBaseUnits(VXP_FLOW_MILESTONES[firstMilestone]).toString()
			);
		});

		it('pays every milestone a single write crosses', async () => {
			await onProfileSetForFlowMilestone(profileWrite({ prev: 0, next: secondMilestone }));

			assert.equal(transfers(), 2);
			assert.equal(milestoneAward(firstMilestone)?.status, 'paid');
			assert.equal(milestoneAward(secondMilestone)?.status, 'paid');
		});

		it('pays a milestone once when the crossing is seen twice', async () => {
			const write = profileWrite({ prev: 0, next: firstMilestone });

			await onProfileSetForFlowMilestone(write);
			await onProfileSetForFlowMilestone(write);

			assert.equal(transfers(), 1);
		});

		it('pays nothing for a write that crosses no milestone', async () => {
			await onProfileSetForFlowMilestone(
				profileWrite({ prev: firstMilestone, next: secondMilestone - 1 })
			);

			assert.equal(transfers(), 0);
			assert.deepEqual(host.keys(Collection.VXP_AWARDS), []);
		});

		it("pays nothing when someone else writes the user's profile", async () => {
			await onProfileSetForFlowMilestone(
				profileWrite({ prev: 0, next: firstMilestone, caller: other })
			);

			assert.equal(transfers(), 0);
			assert.deepEqual(host.keys(Collection.VXP_AWARDS), []);
		});

		it('records a refused transfer as failed, with the ledger error', async () => {
			transferResult = { Err: { TemporarilyUnavailable: null } };

			await onProfileSetForFlowMilestone(profileWrite({ prev: 0, next: firstMilestone }));

			const award = milestoneAward(firstMilestone);

			assert.equal(award?.status, 'failed');
			assert.match(award?.errorMessage ?? '', /TemporarilyUnavailable/);
			assert.equal(award?.blockIndex, undefined);
		});
	});

	describe('mintFlowOvertime', () => {
		const mint = (dayKey: string): Promise<void> =>
			mintFlowOvertime({ caller: user.toUint8Array(), recipient: user.toText(), dayKey });

		const overtimeAward = (dayKey: string): VxpAwardDoc | undefined =>
			readAward({ awardType: 'flow_overtime', awardKey: dayKey });

		it('pays the overtime bonus once per day', async () => {
			await mint('2026-11-01');
			await mint('2026-11-01');

			const award = overtimeAward('2026-11-01');

			assert.equal(transfers(), 1);
			assert.equal(award?.status, 'paid');
			assert.equal(award?.amountBaseUnits, vxpBaseUnits(VXP_FLOW_OVERTIME_BONUS).toString());
		});

		it('pays nothing once the rolling cap of recent overtime awards is reached', async () => {
			for (let day = 1; day <= VXP_FLOW_OVERTIME_ROLLING_CAP; day++) {
				await mint(`2026-10-${day.toString().padStart(2, '0')}`);
			}

			await mint('2026-11-01');

			assert.equal(transfers(), VXP_FLOW_OVERTIME_ROLLING_CAP);
			assert.equal(overtimeAward('2026-11-01'), undefined);
		});

		it('records a refused transfer as failed without throwing', async () => {
			transferResult = { Err: { TemporarilyUnavailable: null } };

			await mint('2026-11-01');

			const award = overtimeAward('2026-11-01');

			assert.equal(award?.status, 'failed');
			assert.match(award?.errorMessage ?? '', /TemporarilyUnavailable/);
		});
	});
});
