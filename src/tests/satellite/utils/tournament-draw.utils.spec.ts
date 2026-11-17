import { DAY_IN_MS } from '#lib/constants/time.constants.ts';
import { roundWindow } from '#lib/types/tournament.ts';
import { tournamentDrawRefusal } from '#satellite/utils/tournament-draw.utils.ts';
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

describe('tournamentDrawRefusal', () => {
	const novemberStartMs = Date.UTC(2026, 10, 1);
	const roundOne = roundWindow({ tournamentMonthStartMs: novemberStartMs, round: 'r1' });
	const nowMs = novemberStartMs + 3 * DAY_IN_MS;

	it('accepts the current UTC month while round 1 is open', () => {
		assert.equal(tournamentDrawRefusal({ monthAnchor: '2026-11', nowMs }), undefined);
	});

	it('accepts the current month from its first millisecond to the last one of round 1', () => {
		assert.equal(
			tournamentDrawRefusal({ monthAnchor: '2026-11', nowMs: novemberStartMs }),
			undefined
		);
		assert.equal(
			tournamentDrawRefusal({ monthAnchor: '2026-11', nowMs: roundOne.endMs - 1 }),
			undefined
		);
	});

	it('refuses the current month once round 1 has closed', () => {
		for (const lateMs of [roundOne.endMs, Date.UTC(2026, 10, 20), Date.UTC(2026, 11, 1) - 1]) {
			assert.equal(
				tournamentDrawRefusal({ monthAnchor: '2026-11', nowMs: lateMs }),
				'invalid_input',
				new Date(lateMs).toISOString()
			);
		}
	});

	it('refuses a closed month', () => {
		assert.equal(tournamentDrawRefusal({ monthAnchor: '2026-10', nowMs }), 'invalid_input');
		assert.equal(tournamentDrawRefusal({ monthAnchor: '2025-11', nowMs }), 'invalid_input');
	});

	it('refuses the month that just closed, right after the rollover', () => {
		assert.equal(
			tournamentDrawRefusal({ monthAnchor: '2026-10', nowMs: novemberStartMs }),
			'invalid_input'
		);
	});

	it('refuses a month that has not started', () => {
		assert.equal(tournamentDrawRefusal({ monthAnchor: '2026-12', nowMs }), 'month_not_started');
		assert.equal(
			tournamentDrawRefusal({ monthAnchor: '2027-01', nowMs: Date.UTC(2026, 11, 31, 23) }),
			'month_not_started'
		);
	});

	it('refuses a malformed anchor', () => {
		for (const monthAnchor of ['2026-13', '2026-1', 'nope', '']) {
			assert.equal(tournamentDrawRefusal({ monthAnchor, nowMs }), 'invalid_input', monthAnchor);
		}
	});
});
