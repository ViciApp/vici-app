// Worlds podium claim: a member at month-end collects its finish whatever
// their join date, but a join, or a switch, after the month closed earns
// nothing, and an eligible member is paid once.

import { afterEach, beforeAll, describe, expect, test } from 'bun:test';
import { randomBytes } from 'node:crypto';
import { query } from '../src/db/client';
import { DAY_IN_MS } from '../src/lib/time';
import { parseVxp, VXP_WORLDS_PODIUM } from '../src/vxp/constants';
import { AFFILIATION_LOCK_MS, setAffiliation } from '../src/worlds/affiliations';
import { claimWorldsPodiumPrize } from '../src/worlds/podium';
import { createTestUser, ensureMigrated } from './helpers/auth';
import { dbAvailable } from './helpers/setup';
import { readAwardRow, stubVxpLedger, type LedgerStub } from './helpers/vxp';

const uniqueSlug = (): string => `wp-${randomBytes(6).toString('hex')}`;

// Below the ranges other suites draw from (monthly-stats 2100 to 2899,
// tournaments 2900 to 2999, affiliation-stats 3000 and up).
const FIRST_TEST_YEAR = 2000;
const FIRST_TEST_MONTH_ANCHOR = `${FIRST_TEST_YEAR}-01`;
const PAST_LAST_TEST_MONTH_ANCHOR = `${FIRST_TEST_YEAR + 100}-01`;

let closedMonthsDrawn = 0;

/** A closed month of its own, with claimMs pinned mid next month. Drawn
 * sequentially: the freeze is all-or-nothing per (kind, month), so two tests
 * sharing a month would rank each other's affiliations. */
const uniqueClosedMonth = (): { monthAnchor: string; monthStartMs: number; claimMs: number } => {
	const year = FIRST_TEST_YEAR + Math.floor(closedMonthsDrawn / 12);
	const month = (closedMonthsDrawn % 12) + 1;

	closedMonthsDrawn += 1;

	return {
		monthAnchor: `${year}-${String(month).padStart(2, '0')}`,
		monthStartMs: Date.UTC(year, month - 1, 1),
		claimMs: Date.UTC(year, month, 15)
	};
};

/** Frozen months and member month rows of earlier runs on the same database
 * would otherwise already own the anchors this run draws. */
const clearTestMonths = async (): Promise<void> => {
	await query(`delete from affiliation_stats where month_anchor >= $1 and month_anchor < $2`, [
		FIRST_TEST_MONTH_ANCHOR,
		PAST_LAST_TEST_MONTH_ANCHOR
	]);
	await query(`delete from user_monthly_stats where month_anchor >= $1 and month_anchor < $2`, [
		FIRST_TEST_MONTH_ANCHOR,
		PAST_LAST_TEST_MONTH_ANCHOR
	]);
};

/** A member of slug since joinedAtMs whose month row carries the school to
 * the top of the month. */
const seedTopMember = async ({
	slug,
	monthAnchor,
	joinedAtMs
}: {
	slug: string;
	monthAnchor: string;
	joinedAtMs: number;
}): Promise<string> => {
	const userId = await createTestUser();

	await query(
		`insert into user_monthly_stats (user_id, month_anchor, month_calls, month_wins, updated_at_ms)
		 values ($1, $2, 100, 90, $3)`,
		[userId, monthAnchor, Date.now()]
	);
	await setAffiliation({
		userId,
		kind: 'university',
		affiliationIdentifier: slug,
		nowMs: joinedAtMs
	});

	return userId;
};

let stub: LedgerStub | undefined;

afterEach(() => {
	stub?.restore();
	stub = undefined;
});

describe.if(dbAvailable)('worlds podium tenure', () => {
	beforeAll(async () => {
		await ensureMigrated();
		await clearTestMonths();
	});

	test('a member since before the month claims gold once', async () => {
		stub = stubVxpLedger();
		const { monthAnchor, monthStartMs, claimMs } = uniqueClosedMonth();
		const slug = uniqueSlug();
		const member = await seedTopMember({ slug, monthAnchor, joinedAtMs: monthStartMs - DAY_IN_MS });

		const first = await claimWorldsPodiumPrize({ userId: member, monthAnchor, nowMs: claimMs });

		expect(first).toEqual({
			monthAnchor,
			awardsCreated: 1,
			awardsAlreadyClaimed: 0,
			notEligible: false
		});
		expect(stub.transfers).toHaveLength(1);
		expect(stub.transfers[0]?.amount).toBe(parseVxp(VXP_WORLDS_PODIUM.gold));

		const again = await claimWorldsPodiumPrize({ userId: member, monthAnchor, nowMs: claimMs });

		expect(again.awardsCreated).toBe(0);
		expect(again.awardsAlreadyClaimed).toBe(1);
		expect(stub.transfers).toHaveLength(1);
	});

	test('a member who joined mid-month still claims gold', async () => {
		stub = stubVxpLedger();
		const { monthAnchor, monthStartMs, claimMs } = uniqueClosedMonth();
		const slug = uniqueSlug();
		const member = await seedTopMember({
			slug,
			monthAnchor,
			joinedAtMs: monthStartMs + 14 * DAY_IN_MS
		});

		const result = await claimWorldsPodiumPrize({ userId: member, monthAnchor, nowMs: claimMs });

		expect(result.awardsCreated).toBe(1);
		expect(result.notEligible).toBe(false);
		expect(stub.transfers).toHaveLength(1);
	});

	test('joining the gold affiliation after the month closed earns nothing', async () => {
		stub = stubVxpLedger();
		const { monthAnchor, monthStartMs, claimMs } = uniqueClosedMonth();
		const slug = uniqueSlug();

		await seedTopMember({ slug, monthAnchor, joinedAtMs: monthStartMs - DAY_IN_MS });

		const latecomer = await createTestUser();

		await setAffiliation({
			userId: latecomer,
			kind: 'university',
			affiliationIdentifier: slug,
			nowMs: claimMs
		});

		const result = await claimWorldsPodiumPrize({ userId: latecomer, monthAnchor, nowMs: claimMs });

		expect(result).toEqual({
			monthAnchor,
			awardsCreated: 0,
			awardsAlreadyClaimed: 0,
			notEligible: true
		});
		expect(stub.transfers).toHaveLength(0);
		expect(
			await readAwardRow({
				userId: latecomer,
				awardType: 'worlds_podium',
				awardKey: `${monthAnchor}_gold`
			})
		).toBeUndefined();
	});

	test('switching to the gold affiliation after close carries no tenure', async () => {
		stub = stubVxpLedger();
		const { monthAnchor, monthStartMs, claimMs } = uniqueClosedMonth();
		const gold = uniqueSlug();

		await seedTopMember({ slug: gold, monthAnchor, joinedAtMs: monthStartMs - DAY_IN_MS });

		// A long-standing member elsewhere, whose switch lock has run out by
		// the time the month closes.
		const switcher = await createTestUser();

		await setAffiliation({
			userId: switcher,
			kind: 'university',
			affiliationIdentifier: uniqueSlug(),
			nowMs: monthStartMs - AFFILIATION_LOCK_MS - DAY_IN_MS
		});
		await setAffiliation({
			userId: switcher,
			kind: 'university',
			affiliationIdentifier: gold,
			nowMs: claimMs
		});

		const result = await claimWorldsPodiumPrize({ userId: switcher, monthAnchor, nowMs: claimMs });

		expect(result.notEligible).toBe(true);
		expect(result.awardsCreated).toBe(0);
		expect(stub.transfers).toHaveLength(0);
	});
});
