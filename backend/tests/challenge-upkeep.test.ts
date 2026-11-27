// A challenge link's lifecycle: the hard delete removes an account's links
// and the answers it gave, and the retention prune removes links whose market
// closed, or which were revoked, longer ago than the retention window.

import { nonNullish } from '@dfinity/utils';
import { afterEach, beforeAll, beforeEach, describe, expect, test } from 'bun:test';
import { hardDeleteAccount } from '../src/account/lifecycle';
import { query } from '../src/db/client';
import { clearCache } from '../src/engine/cache';
import { resetRateLimits } from '../src/lib/rate-limit';
import { DAY_IN_MS } from '../src/lib/time';
import { CHALLENGE_LINK_RETENTION_MS, pruneChallengeLinks } from '../src/social/challenge-upkeep';
import { ensureMigrated } from './helpers/auth';
import {
	call,
	create,
	fill,
	installChallengeEngine,
	linkExists,
	newSeries,
	player,
	settledSeries,
	settlementReads
} from './helpers/challenges';
import { dbAvailable } from './helpers/setup';

let restore: (() => void) | undefined;

const closedAtOf = async (id: string): Promise<string | null | undefined> => {
	const [row] = await query<{ market_closed_at_ms: string | null }>(
		`select market_closed_at_ms::text from challenge_links where id = $1`,
		[id]
	);

	return row?.market_closed_at_ms;
};

/** Runs prune ticks until every given link is stamped closed, at most as many
 * as one full walk of the pending series needs (the database is shared, so
 * the walk may start anywhere). */
const pruneUntilStamped = async ({
	ids,
	stampSeriesLimit
}: {
	ids: string[];
	stampSeriesLimit: number;
}): Promise<void> => {
	const rows = await query<{ pending: number }>(
		`select count(distinct series_id)::int as pending from challenge_links
		 where market_closed_at_ms is null`
	);
	const maxTicks = Math.ceil((rows[0]?.pending ?? 0) / stampSeriesLimit) + 2;

	for (let tick = 0; tick < maxTicks; tick++) {
		clearCache();
		await pruneChallengeLinks({ stampSeriesLimit });

		const stamps = await Promise.all(ids.map(closedAtOf));

		if (stamps.every(nonNullish)) {
			return;
		}
	}
};

describe.if(dbAvailable)('challenge link lifecycle', () => {
	beforeAll(async () => {
		await ensureMigrated();
	});

	beforeEach(() => {
		clearCache();
		resetRateLimits();
		({ restore } = installChallengeEngine());
	});

	afterEach(() => {
		restore?.();
		restore = undefined;
	});

	describe('lifecycle', () => {
		test('the hard delete removes the links and the answers given', async () => {
			const maya = await player();
			const leo = await player();
			const seriesId = newSeries();

			fill({ userId: maya.userId, seriesId, qty: 10, priceCents: 38 });
			fill({ userId: leo.userId, seriesId, qty: 10, priceCents: 40 });

			const mayaLink = await create({ who: maya, seriesId });
			const leoLink = await create({ who: leo, seriesId });

			await call({ method: 'POST', path: `/${mayaLink.id}/answer`, token: leo.token });
			await call({ method: 'POST', path: `/${leoLink.id}/answer`, token: maya.token });

			await hardDeleteAccount(maya.userId);

			expect(await linkExists(mayaLink.id)).toBe(false);
			expect(
				await query(`select 1 from challenge_answers where answerer_user_id = $1`, [maya.userId])
			).toEqual([]);
			expect(
				await query(`select 1 from challenge_answers where challenge_id = $1`, [mayaLink.id])
			).toEqual([]);
			expect(await linkExists(leoLink.id)).toBe(true);
		});

		test('the prune removes what is past retention and nothing younger', async () => {
			const maya = await player();
			const leo = await player();
			const now = Date.now();

			const make = async (expiryMs?: number): Promise<string> => {
				const seriesId = newSeries();

				fill({ userId: maya.userId, seriesId, qty: 10, priceCents: 38 });

				const { id } = await create({ who: maya, seriesId });

				if (nonNullish(expiryMs)) {
					await query(`update challenge_links set series_expiry_ms = $2 where id = $1`, [
						id,
						expiryMs
					]);
				}

				return id;
			};

			const longClosed = await make(now - CHALLENGE_LINK_RETENTION_MS - DAY_IN_MS);
			const recentlyClosed = await make(now - DAY_IN_MS);
			const open = await make();
			const longRevoked = await make();
			const recentlyRevoked = await make();

			await query(
				`insert into challenge_answers (challenge_id, answerer_user_id, side, entry_price_bps,
				   answered_at_ms) values ($1, $2, 'NO', 5000, $3)`,
				[longClosed, leo.userId, now]
			);
			await query(
				`update challenge_links set status = 'revoked', status_changed_at_ms = $2 where id = $1`,
				[longRevoked, now - CHALLENGE_LINK_RETENTION_MS - DAY_IN_MS]
			);
			await query(
				`update challenge_links set status = 'revoked', status_changed_at_ms = $2 where id = $1`,
				[recentlyRevoked, now - DAY_IN_MS]
			);

			await pruneChallengeLinks();

			expect(await linkExists(longClosed)).toBe(false);
			expect(
				await query(`select 1 from challenge_answers where challenge_id = $1`, [longClosed])
			).toEqual([]);
			expect(await linkExists(longRevoked)).toBe(false);
			expect(await linkExists(recentlyClosed)).toBe(true);
			expect(await linkExists(open)).toBe(true);
			expect(await linkExists(recentlyRevoked)).toBe(true);

			const stamped = await query<{ id: string; market_closed_at_ms: string | null }>(
				`select id, market_closed_at_ms::text from challenge_links where id = any($1::text[])`,
				[[recentlyClosed, open]]
			);

			expect(Object.fromEntries(stamped.map((row) => [row.id, row.market_closed_at_ms]))).toEqual({
				[recentlyClosed]: String(now - DAY_IN_MS),
				[open]: null
			});

			// A second run deletes nothing more of these.
			await pruneChallengeLinks();

			expect(await linkExists(recentlyClosed)).toBe(true);
		});

		test('a market settled before its expiry is stamped closed when seen', async () => {
			const maya = await player();
			const seriesId = newSeries();

			fill({ userId: maya.userId, seriesId, qty: 10, priceCents: 38 });

			const { id } = await create({ who: maya, seriesId });

			settledSeries.add(seriesId);

			const before = Date.now();

			await pruneUntilStamped({ ids: [id], stampSeriesLimit: 1000 });

			expect(Number(await closedAtOf(id))).toBeGreaterThanOrEqual(before);
			expect(await linkExists(id)).toBe(true);
		});

		test('one tick checks a bounded page of open markets and the next resumes', async () => {
			const maya = await player();
			const ids: string[] = [];

			for (let i = 0; i < 3; i++) {
				const seriesId = newSeries();

				fill({ userId: maya.userId, seriesId, qty: 10, priceCents: 38 });
				ids.push((await create({ who: maya, seriesId })).id);
				settledSeries.add(seriesId);
			}

			clearCache();
			settlementReads.length = 0;

			await pruneChallengeLinks({ stampSeriesLimit: 2 });

			expect(settlementReads.flat().length).toBeLessThanOrEqual(2);

			await pruneUntilStamped({ ids, stampSeriesLimit: 100 });

			expect((await Promise.all(ids.map(closedAtOf))).every(nonNullish)).toBe(true);
		});
	});
});
