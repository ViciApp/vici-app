import { tournamentDrawMonthRefusal } from '#satellite/utils/tournament-draw.utils.ts';
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

describe('tournamentDrawMonthRefusal', () => {
	const nowMs = Date.UTC(2026, 10, 15, 12);

	it('accepts the current UTC month', () => {
		assert.equal(tournamentDrawMonthRefusal({ monthAnchor: '2026-11', nowMs }), undefined);
	});

	it('accepts the current month from its first to its last millisecond', () => {
		assert.equal(
			tournamentDrawMonthRefusal({ monthAnchor: '2026-11', nowMs: Date.UTC(2026, 10, 1) }),
			undefined
		);
		assert.equal(
			tournamentDrawMonthRefusal({ monthAnchor: '2026-11', nowMs: Date.UTC(2026, 11, 1) - 1 }),
			undefined
		);
	});

	it('refuses a closed month', () => {
		assert.equal(tournamentDrawMonthRefusal({ monthAnchor: '2026-10', nowMs }), 'invalid_input');
		assert.equal(tournamentDrawMonthRefusal({ monthAnchor: '2025-11', nowMs }), 'invalid_input');
	});

	it('refuses the month that just closed, right after the rollover', () => {
		assert.equal(
			tournamentDrawMonthRefusal({ monthAnchor: '2026-10', nowMs: Date.UTC(2026, 10, 1) }),
			'invalid_input'
		);
	});

	it('refuses a month that has not started', () => {
		assert.equal(
			tournamentDrawMonthRefusal({ monthAnchor: '2026-12', nowMs }),
			'month_not_started'
		);
		assert.equal(
			tournamentDrawMonthRefusal({ monthAnchor: '2027-01', nowMs: Date.UTC(2026, 11, 31, 23) }),
			'month_not_started'
		);
	});

	it('refuses a malformed anchor', () => {
		for (const monthAnchor of ['2026-13', '2026-1', 'nope', '']) {
			assert.equal(
				tournamentDrawMonthRefusal({ monthAnchor, nowMs }),
				'invalid_input',
				monthAnchor
			);
		}
	});
});
