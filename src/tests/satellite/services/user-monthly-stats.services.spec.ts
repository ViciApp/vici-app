import { Collection } from '#lib/constants/collections.constants.ts';
import {
	controller,
	installSatelliteHost,
	type SatelliteHost
} from '#root/src/tests/mocks/satellite-host.mock.ts';
import { getMonthlyLeaderboardFn } from '#satellite/services/user-monthly-stats.services.ts';
import { Principal } from '@icp-sdk/core/principal';
import assert from 'node:assert/strict';
import { afterEach, beforeEach, describe, it } from 'node:test';

const monthAnchor = '2026-10';

const principal = (byte: number): string =>
	Principal.fromUint8Array(new Uint8Array([byte, byte, byte])).toText();

const active = principal(2);
const softDeleted = principal(3);
const hibernated = principal(4);
const purged = principal(5);

describe('user-monthly-stats.services', () => {
	let host: SatelliteHost;

	beforeEach(() => {
		host = installSatelliteHost();

		const seed = ({ owner, monthWins }: { owner: string; monthWins: number }) =>
			host.putDoc({
				collection: Collection.USER_MONTHLY_STATS,
				key: `${owner}/${monthAnchor}`,
				data: { owner, monthAnchor, monthCalls: 40, monthWins, monthConsensus: [0.2] },
				owner: controller
			});

		const profile = ({ owner, marker = {} }: { owner: string; marker?: object }) =>
			host.putDoc({
				collection: Collection.PROFILES,
				key: owner,
				data: { owner, nickname: 'n', ...marker },
				owner: controller
			});

		seed({ owner: active, monthWins: 20 });
		seed({ owner: softDeleted, monthWins: 40 });
		seed({ owner: hibernated, monthWins: 39 });
		seed({ owner: purged, monthWins: 38 });

		profile({ owner: active });
		profile({ owner: softDeleted, marker: { deletedAtMs: 1 } });
		profile({ owner: hibernated, marker: { hibernatedAtMs: 1 } });
	});

	afterEach(() => host.restore());

	describe('getMonthlyLeaderboardFn', () => {
		it('leaves out soft-deleted, hibernated and purged accounts', () => {
			const { sharpestEye, boldCaller } = getMonthlyLeaderboardFn({ monthAnchor });

			assert.deepEqual(
				sharpestEye.map((entry) => entry.owner),
				[active]
			);
			assert.deepEqual(
				boldCaller.map((entry) => entry.owner),
				[active]
			);
		});
	});
});
