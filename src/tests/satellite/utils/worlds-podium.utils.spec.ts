import { MILLISECOND_IN_NANOSECONDS } from '#lib/constants/app.constants.ts';
import { joinedBeforeMonthClose } from '#satellite/utils/worlds-podium.utils.ts';
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

const ns = (ms: number): bigint => BigInt(ms) * MILLISECOND_IN_NANOSECONDS;

const OCTOBER_CLOSE_MS = Date.UTC(2026, 10, 1);

describe('worlds-podium.utils', () => {
	describe('joinedBeforeMonthClose', () => {
		it('pays a slot joined before the month started', () => {
			assert.equal(
				joinedBeforeMonthClose({ joinedAtNs: ns(Date.UTC(2026, 5, 3)), monthAnchor: '2026-10' }),
				true
			);
		});

		it('pays a slot joined late in the month itself', () => {
			assert.equal(
				joinedBeforeMonthClose({
					joinedAtNs: ns(Date.UTC(2026, 9, 31, 23, 59)),
					monthAnchor: '2026-10'
				}),
				true
			);
		});

		it('pays a slot joined one nanosecond before close', () => {
			assert.equal(
				joinedBeforeMonthClose({ joinedAtNs: ns(OCTOBER_CLOSE_MS) - 1n, monthAnchor: '2026-10' }),
				true
			);
		});

		it('refuses a slot joined at the instant the month closed', () => {
			assert.equal(
				joinedBeforeMonthClose({ joinedAtNs: ns(OCTOBER_CLOSE_MS), monthAnchor: '2026-10' }),
				false
			);
		});

		it('refuses a slot joined after the month closed', () => {
			assert.equal(
				joinedBeforeMonthClose({
					joinedAtNs: ns(Date.UTC(2026, 10, 1, 0, 5)),
					monthAnchor: '2026-10'
				}),
				false
			);
		});

		it('closes December at the start of the next year', () => {
			assert.equal(
				joinedBeforeMonthClose({
					joinedAtNs: ns(Date.UTC(2026, 11, 31, 12)),
					monthAnchor: '2026-12'
				}),
				true
			);
			assert.equal(
				joinedBeforeMonthClose({ joinedAtNs: ns(Date.UTC(2027, 0, 1)), monthAnchor: '2026-12' }),
				false
			);
		});
	});
});
