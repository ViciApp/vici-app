import { Collection } from '#lib/constants/collections.constants.ts';
import type { AffiliationFreezeDoc, AffiliationStatsDoc } from '#lib/types/affiliation-stats.ts';
import {
	controller,
	installSatelliteHost,
	setContext,
	type SatelliteHost
} from '#root/src/tests/mocks/satellite-host.mock.ts';
import { assertSetAffiliationStats } from '#satellite/services/affiliation-stats.services.ts';
import assert from 'node:assert/strict';
import { afterEach, beforeEach, describe, it } from 'node:test';

const row: AffiliationStatsDoc = {
	kind: 'university',
	affiliationIdentifier: 'uni-1',
	totalCalls: 60,
	wins: 50,
	monthAnchor: '2026-10',
	monthTotalCalls: 60,
	monthWins: 50,
	updatedAtMs: 1
};

const freeze: AffiliationFreezeDoc = {
	kind: 'university',
	monthAnchor: '2026-10',
	rows: [row],
	complete: false
};

describe('assertSetAffiliationStats', () => {
	let host: SatelliteHost;

	const write = ({
		key = 'university/2026-10',
		proposed,
		current
	}: {
		key?: string;
		proposed: object;
		current?: object;
	}) =>
		assertSetAffiliationStats(
			setContext({
				caller: controller,
				collection: Collection.AFFILIATION_STATS,
				key,
				proposed,
				current
			})
		);

	beforeEach(() => {
		host = installSatelliteHost();
	});

	afterEach(() => host.restore());

	it('accepts a month freeze keyed on its own kind and month, and its completion', () => {
		assert.doesNotThrow(() => write({ proposed: freeze }));
		assert.doesNotThrow(() => write({ current: freeze, proposed: { ...freeze, complete: true } }));
	});

	it('refuses a freeze under another key', () => {
		assert.throws(() => write({ key: 'country/2026-10', proposed: freeze }), /keyed on its own/);
	});

	it('refuses a freeze whose rows change, or that is reopened', () => {
		assert.throws(
			() =>
				write({
					current: freeze,
					proposed: { ...freeze, rows: [{ ...row, monthWins: 60 }], complete: true }
				}),
			/only moves to complete/
		);
		assert.throws(
			() => write({ current: { ...freeze, complete: true }, proposed: freeze }),
			/only moves to complete/
		);
	});

	it('still holds a snapshot to its own key and write-once', () => {
		assert.doesNotThrow(() => write({ key: 'university/uni-1/2026-10', proposed: row }));
		assert.throws(
			() => write({ key: 'university/uni-1/2026-10', current: row, proposed: row }),
			/write-once/
		);
	});
});
