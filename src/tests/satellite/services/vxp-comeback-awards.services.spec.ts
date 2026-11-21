import { Collection } from '#lib/constants/collections.constants.ts';
import { DAY_IN_MS } from '#lib/constants/time.constants.ts';
import {
	COMEBACK_AWAY_DAYS,
	COMEBACK_BALANCE_FLOOR_BASE_UNITS,
	COMEBACK_RESTORE_TARGET_BASE_UNITS
} from '#lib/constants/vxp-economy.constants.ts';
import { vxpAwardKey, type VxpAwardDoc } from '#lib/types/vxp-award.ts';
import {
	docBytes,
	installSatelliteHost,
	type SatelliteHost
} from '#root/src/tests/mocks/satellite-host.mock.ts';
import { assertDeleteDoc, assertSetDoc } from '#satellite/index.ts';
import { onProfileSetForComebackRestore } from '#satellite/services/vxp-comeback-awards.services.ts';
import { nonNullish } from '@dfinity/utils';
import { Principal } from '@icp-sdk/core/principal';
import type { OnSetDocContext } from '@junobuild/functions';
import { IcrcLedgerIdl } from '@junobuild/functions/canisters/ledger/icrc';
import assert from 'node:assert/strict';
import { afterEach, beforeEach, describe, it } from 'node:test';

const user = Principal.fromUint8Array(new Uint8Array([2, 2, 2]));
const other = Principal.fromUint8Array(new Uint8Array([3, 3, 3]));

const lastSeenMs = Date.UTC(2026, 9, 1);

/** The `YYYY-MM-DD` day `days` after the last active day. */
const dayAfter = (days: number): string =>
	new Date(lastSeenMs + days * DAY_IN_MS).toISOString().slice(0, 10);

const lastSeenDay = dayAfter(0);

const profileWrite = ({
	prev,
	next,
	caller = user
}: {
	prev?: string;
	next: string;
	caller?: Principal;
}): OnSetDocContext => {
	const doc = (lastActiveDay: string) => ({
		owner: user.toUint8Array(),
		data: docBytes({ lastActiveDay }),
		created_at: 1n,
		updated_at: 1n,
		version: 1n
	});

	return {
		caller: caller.toUint8Array(),
		data: {
			collection: Collection.PROFILES,
			key: user.toText(),
			data: { before: nonNullish(prev) ? doc(prev) : undefined, after: doc(next) }
		}
	};
};

const restoreKey = vxpAwardKey({
	recipient: user.toText(),
	awardType: 'comeback',
	awardKey: 'restore'
});

describe('onProfileSetForComebackRestore', () => {
	let host: SatelliteHost;
	let balance: bigint;
	let transferResult: object;

	const transfers = (): number =>
		host.calls().filter((method) => method === 'icrc1_transfer').length;

	const readAward = (): VxpAwardDoc | undefined =>
		host.readDoc<VxpAwardDoc>({ collection: Collection.VXP_AWARDS, key: restoreKey });

	const returnAfter = (days: number): Promise<void> =>
		onProfileSetForComebackRestore(profileWrite({ prev: lastSeenDay, next: dayAfter(days) }));

	beforeEach(() => {
		// The real asserts run on every serverless write, as on the satellite.
		host = installSatelliteHost({
			asserts: { set: assertSetDoc.assert, remove: assertDeleteDoc.assert }
		});
		balance = COMEBACK_BALANCE_FLOOR_BASE_UNITS / BigInt(4);
		transferResult = { Ok: BigInt(7) };
		host.onCall({
			method: 'icrc1_balance_of',
			argTypes: [IcrcLedgerIdl.Account],
			result: IcrcLedgerIdl.Tokens,
			handler: () => balance
		});
		host.onCall({
			method: 'icrc1_transfer',
			argTypes: [IcrcLedgerIdl.TransferArg],
			result: IcrcLedgerIdl.TransferResult,
			handler: () => transferResult
		});
	});

	afterEach(() => host.restore());

	it('tops a returning, depleted balance up to the restore target', async () => {
		await returnAfter(COMEBACK_AWAY_DAYS);

		const award = readAward();

		assert.equal(transfers(), 1);
		assert.equal(award?.status, 'paid');
		assert.equal(award?.blockIndex, '7');
		assert.equal(award?.amountBaseUnits, (COMEBACK_RESTORE_TARGET_BASE_UNITS - balance).toString());
	});

	it('pays nothing for an absence shorter than the threshold', async () => {
		await returnAfter(COMEBACK_AWAY_DAYS - 1);

		assert.deepEqual(host.calls(), []);
		assert.equal(readAward(), undefined);
	});

	it('pays nothing when the balance is at or above the floor', async () => {
		balance = COMEBACK_BALANCE_FLOOR_BASE_UNITS;

		await returnAfter(COMEBACK_AWAY_DAYS);

		assert.deepEqual(host.calls(), ['icrc1_balance_of']);
		assert.equal(readAward(), undefined);
	});

	it('restores an account once, even on a later return', async () => {
		await returnAfter(COMEBACK_AWAY_DAYS);
		await returnAfter(COMEBACK_AWAY_DAYS);
		await onProfileSetForComebackRestore(
			profileWrite({ prev: dayAfter(COMEBACK_AWAY_DAYS), next: dayAfter(3 * COMEBACK_AWAY_DAYS) })
		);

		assert.equal(transfers(), 1);
		assert.equal(readAward()?.status, 'paid');
	});

	it('pays nothing for a first profile write, which is not a return', async () => {
		await onProfileSetForComebackRestore(profileWrite({ next: dayAfter(COMEBACK_AWAY_DAYS) }));

		assert.deepEqual(host.calls(), []);
	});

	it("pays nothing when someone else writes the user's profile", async () => {
		await onProfileSetForComebackRestore(
			profileWrite({ prev: lastSeenDay, next: dayAfter(COMEBACK_AWAY_DAYS), caller: other })
		);

		assert.deepEqual(host.calls(), []);
	});

	it('records a refused transfer as failed, with the ledger error', async () => {
		transferResult = { Err: { TemporarilyUnavailable: null } };

		await returnAfter(COMEBACK_AWAY_DAYS);

		const award = readAward();

		assert.equal(award?.status, 'failed');
		assert.match(award?.errorMessage ?? '', /TemporarilyUnavailable/);
		assert.equal(award?.blockIndex, undefined);
	});
});
