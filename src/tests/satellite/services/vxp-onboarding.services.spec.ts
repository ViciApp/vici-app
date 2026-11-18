import { Collection } from '#lib/constants/collections.constants.ts';
import { ActivityType } from '#lib/enums/social.ts';
import type { VxpOnboardingDoc } from '#lib/types/vxp-onboarding.ts';
import {
	docBytes,
	installSatelliteHost,
	type SatelliteHost
} from '#root/src/tests/mocks/satellite-host.mock.ts';
import { onProfileSetForVxpOnboarding } from '#satellite/services/vxp-onboarding.services.ts';
import { Principal } from '@icp-sdk/core/principal';
import type { OnSetDocContext } from '@junobuild/functions';
import { IcrcLedgerIdl } from '@junobuild/functions/canisters/ledger/icrc';
import assert from 'node:assert/strict';
import { afterEach, beforeEach, describe, it } from 'node:test';

const user = Principal.fromUint8Array(new Uint8Array([2, 2, 2]));

const profileWrite = (): OnSetDocContext => ({
	caller: user.toUint8Array(),
	data: {
		collection: Collection.PROFILES,
		key: user.toText(),
		data: {
			after: {
				owner: user.toUint8Array(),
				data: docBytes({ owner: user.toText() }),
				created_at: 1n,
				updated_at: 1n,
				version: 1n
			}
		}
	}
});

describe('onProfileSetForVxpOnboarding', () => {
	let host: SatelliteHost;

	const logActivity = ({ type, timestamp }: { type: ActivityType; timestamp: number }) =>
		host.putDoc({
			collection: Collection.ACTIVITIES,
			key: `${user.toText()}#${timestamp}#${type}`,
			data: { user: user.toText(), type, timestamp },
			owner: user
		});

	const ladder = (): VxpOnboardingDoc | undefined =>
		host.readDoc<VxpOnboardingDoc>({ collection: Collection.VXP_ONBOARDING, key: user.toText() });

	beforeEach(() => {
		host = installSatelliteHost();
		host.setCaller(user);
		host.putDoc({
			collection: Collection.PROFILES,
			key: user.toText(),
			data: { owner: user.toText() },
			owner: user
		});
		host.onCall({
			method: 'icrc1_transfer',
			argTypes: [IcrcLedgerIdl.TransferArg],
			result: IcrcLedgerIdl.TransferResult,
			handler: () => ({ Ok: BigInt(7) })
		});
	});

	afterEach(() => host.restore());

	it('counts only prediction activities toward the trade milestones', async () => {
		for (let i = 0; i < 6; i++) {
			logActivity({ type: ActivityType.FOLLOW, timestamp: 1_000 + i });
		}

		await onProfileSetForVxpOnboarding(profileWrite());

		assert.equal(ladder()?.tradeCount, 0);
		assert.equal(ladder()?.milestones.m2.status, 'none');
		assert.equal(ladder()?.milestones.m3.status, 'none');
	});

	it('still counts a prediction made before the ladder existed', async () => {
		logActivity({ type: ActivityType.FOLLOW, timestamp: 1_000 });
		logActivity({ type: ActivityType.TRADE, timestamp: 1_001 });

		await onProfileSetForVxpOnboarding(profileWrite());

		assert.equal(ladder()?.tradeCount, 1);
		assert.notEqual(ladder()?.milestones.m2.status, 'none');
	});
});
