// What a challenge link does for the friends it reaches: the redemption that
// credits its challenger through the one referrals row (paid once, by the
// existing settlement), and the engine-verified answer that befriends them.

import { afterEach, beforeAll, beforeEach, describe, expect, test } from 'bun:test';
import {
	getOrAssignReferralCode,
	redeemReferralCode,
	writeReferralRedemption
} from '../src/account/referrals';
import { createSession } from '../src/auth/sessions';
import { query } from '../src/db/client';
import { clearCache } from '../src/engine/cache';
import { app } from '../src/index';
import { resetRateLimits } from '../src/lib/rate-limit';
import { redeemChallenge } from '../src/social/challenge-answers';
import { settleReferralPayout } from '../src/vxp/referral';
import { runTradeActivityTriggers } from '../src/vxp/triggers';
import { createTestUser, ensureMigrated } from './helpers/auth';
import {
	call,
	create,
	fill,
	installChallengeEngine,
	newSeries,
	player,
	readBody,
	relationOf,
	type OwnChallengeBody
} from './helpers/challenges';
import { dbAvailable } from './helpers/setup';
import { readAwardRow, type LedgerStub } from './helpers/vxp';

let restore: (() => void) | undefined;
let ledger: LedgerStub | undefined;

describe.if(dbAvailable)('challenge credit and answers', () => {
	beforeAll(async () => {
		await ensureMigrated();
	});

	beforeEach(() => {
		clearCache();
		resetRateLimits();
		({ restore, ledger } = installChallengeEngine());
	});

	afterEach(() => {
		restore?.();
		restore = undefined;
	});

	describe('inviter credit', () => {
		test('a fresh sign-up redeems into one referrals row naming the link', async () => {
			const maya = await player();
			const leo = await player();
			const seriesId = newSeries();

			fill({ userId: maya.userId, seriesId, qty: 10, priceCents: 38 });

			const { id } = await create({ who: maya, seriesId });
			const res = await call({ method: 'POST', path: `/${id}/redeem`, token: leo.token });

			expect(res.status).toBe(200);
			expect(await res.json()).toEqual({ outcome: 'redeemed' });

			const rows = await query<{ referrer_user_id: string; challenge_id: string; code: string }>(
				`select referrer_user_id, challenge_id, code from referrals where referee_user_id = $1`,
				[leo.userId]
			);

			expect(rows).toEqual([
				{
					referrer_user_id: maya.userId,
					challenge_id: id,
					code: await getOrAssignReferralCode(maya.userId)
				}
			]);
			expect(await relationOf(maya.userId, leo.userId)).toBe('ACTIVE');

			// Any second channel changes nothing: another link, or a code.
			const ana = await player();

			fill({ userId: ana.userId, seriesId, qty: 10, priceCents: 40 });

			const other = await create({ who: ana, seriesId });
			const again = await call({ method: 'POST', path: `/${other.id}/redeem`, token: leo.token });

			expect(await again.json()).toEqual({ outcome: 'not_eligible' });

			const code = await app.handle(
				new Request('http://localhost/api/v1/referrals/redeem', {
					method: 'POST',
					headers: { cookie: `vici_session=${leo.token}`, 'content-type': 'application/json' },
					body: JSON.stringify({ code: await getOrAssignReferralCode(ana.userId) })
				})
			);

			expect(code.status).toBe(400);
			expect(
				await query(`select referrer_user_id from referrals where referee_user_id = $1`, [
					leo.userId
				])
			).toEqual([{ referrer_user_id: maya.userId }]);
			expect(await relationOf(ana.userId, leo.userId)).toBeUndefined();
		});

		test('self, past the window, not found and no position', async () => {
			const maya = await player();
			const veteran = await player();
			const seriesId = newSeries();

			fill({ userId: maya.userId, seriesId, qty: 10, priceCents: 38 });

			const { id } = await create({ who: maya, seriesId });

			const self = await call({ method: 'POST', path: `/${id}/redeem`, token: maya.token });

			expect(self.status).toBe(400);
			expect(await self.json()).toEqual({ error: 'self_challenge' });

			await query(`update profiles set created_at = now() - interval '3 days' where user_id = $1`, [
				veteran.userId
			]);

			const late = await call({ method: 'POST', path: `/${id}/redeem`, token: veteran.token });

			expect(await late.json()).toEqual({ outcome: 'not_eligible' });
			expect(
				await query(`select 1 from referrals where referee_user_id = $1`, [veteran.userId])
			).toEqual([]);
			expect(await relationOf(maya.userId, veteran.userId)).toBeUndefined();

			const unknown = await call({
				method: 'POST',
				path: '/ZZZZZZZZZZZZZZZZ/redeem',
				token: veteran.token
			});

			expect(unknown.status).toBe(404);

			// A flat challenger still credits.
			fill({ userId: maya.userId, seriesId, qty: -10, priceCents: 50 });
			await runTradeActivityTriggers({ userId: maya.userId });

			const fresh = await player();
			const flat = await call({ method: 'POST', path: `/${id}/redeem`, token: fresh.token });

			expect(await flat.json()).toEqual({ outcome: 'redeemed' });
		});

		test('only the redemption that wrote the row is credited or befriends', async () => {
			const maya = await player();
			const ana = await player();
			const leo = await player();
			const seriesId = newSeries();

			fill({ userId: maya.userId, seriesId, qty: 10, priceCents: 38 });
			fill({ userId: ana.userId, seriesId, qty: 10, priceCents: 40 });

			const mayaLink = await create({ who: maya, seriesId });
			const anaLink = await create({ who: ana, seriesId });

			const outcomes = await Promise.all([
				redeemChallenge({ userId: leo.userId, id: mayaLink.id }),
				redeemChallenge({ userId: leo.userId, id: anaLink.id })
			]);

			expect([...outcomes].sort()).toEqual(['not_eligible', 'redeemed']);

			const [winner, loser] = outcomes[0] === 'redeemed' ? [maya, ana] : [ana, maya];

			expect(
				await query(`select referrer_user_id from referrals where referee_user_id = $1`, [
					leo.userId
				])
			).toEqual([{ referrer_user_id: winner.userId }]);
			expect(await relationOf(winner.userId, leo.userId)).toBe('ACTIVE');
			expect(await relationOf(loser.userId, leo.userId)).toBeUndefined();

			// The write that loses the referee key reports it and befriends nobody.
			expect(
				await writeReferralRedemption({
					userId: leo.userId,
					referrerUserId: loser.userId,
					code: await getOrAssignReferralCode(loser.userId),
					challengeId: loser === maya ? mayaLink.id : anaLink.id
				})
			).toBe(false);
			expect(await relationOf(loser.userId, leo.userId)).toBeUndefined();
		});

		test('a caller without a profile is told to retry after creating it', async () => {
			const maya = await player();
			const seriesId = newSeries();

			fill({ userId: maya.userId, seriesId, qty: 10, priceCents: 38 });

			const { id } = await create({ who: maya, seriesId });
			const bare = await createSession(await createTestUser());
			const res = await call({ method: 'POST', path: `/${id}/redeem`, token: bare });

			expect(res.status).toBe(400);
			expect(await res.json()).toEqual({ error: 'profile_required' });
		});
	});

	describe('payout', () => {
		test('a link redemption pays one referee bonus and one referrer reward, and no other channel adds one', async () => {
			const maya = await player();
			const ana = await player();
			const leo = await player();
			const seriesId = newSeries();

			fill({ userId: maya.userId, seriesId, qty: 10, priceCents: 38 });
			fill({ userId: ana.userId, seriesId, qty: 10, priceCents: 40 });

			const mayaLink = await create({ who: maya, seriesId });
			const anaLink = await create({ who: ana, seriesId });

			expect(await redeemChallenge({ userId: leo.userId, id: mayaLink.id })).toBe('redeemed');
			expect(await redeemChallenge({ userId: leo.userId, id: anaLink.id })).toBe('not_eligible');
			await expect(
				redeemReferralCode({ userId: leo.userId, code: await getOrAssignReferralCode(ana.userId) })
			).rejects.toThrow('already redeemed');

			// The referee's first prediction settles both sides, once.
			fill({ userId: leo.userId, seriesId, qty: -10, priceCents: 40 });

			const transfersBefore = ledger?.transfers.length ?? 0;

			expect(await settleReferralPayout({ refereeUserId: leo.userId })).toEqual({ settled: true });
			expect(await settleReferralPayout({ refereeUserId: leo.userId })).toEqual({ settled: true });

			const award = async (userId: string) =>
				await readAwardRow({ userId, awardType: 'referral', awardKey: leo.userId });

			expect((await award(leo.userId))?.status).toBe('paid');
			expect((await award(maya.userId))?.status).toBe('paid');
			expect(await award(ana.userId)).toBeUndefined();
			expect((ledger?.transfers.length ?? 0) - transfersBefore).toBe(2);
		});
	});

	describe('answers', () => {
		test('an answer is engine-verified, idempotent and befriends', async () => {
			const maya = await player();
			const leo = await player();
			const seriesId = newSeries();

			fill({ userId: maya.userId, seriesId, qty: 10, priceCents: 38 });

			const { id } = await create({ who: maya, seriesId });

			// Opening the link befriends nobody.
			await readBody(id);

			expect(await relationOf(maya.userId, leo.userId)).toBeUndefined();

			const early = await call({ method: 'POST', path: `/${id}/answer`, token: leo.token });

			expect(early.status).toBe(400);
			expect(await early.json()).toEqual({ error: 'no_position' });

			fill({ userId: leo.userId, seriesId, qty: -10, priceCents: 56 });

			const first = await call({ method: 'POST', path: `/${id}/answer`, token: leo.token });
			const firstBody = (await first.json()) as {
				answer: { side: string; entryPriceBps: number };
			};

			expect(first.status).toBe(200);
			expect(firstBody.answer).toMatchObject({ side: 'NO', entryPriceBps: 4400 });
			expect(await relationOf(maya.userId, leo.userId)).toBe('ACTIVE');

			fill({ userId: leo.userId, seriesId, qty: -10, priceCents: 20 });

			const repeat = await call({ method: 'POST', path: `/${id}/answer`, token: leo.token });

			expect(await repeat.json()).toEqual(firstBody);

			// Closing the position later does not undo the stored answer.
			fill({ userId: leo.userId, seriesId, qty: 20, priceCents: 50 });

			const afterClose = await call({ method: 'POST', path: `/${id}/answer`, token: leo.token });

			expect(afterClose.status).toBe(200);
			expect(await afterClose.json()).toEqual(firstBody);

			const self = await call({ method: 'POST', path: `/${id}/answer`, token: maya.token });

			expect(await self.json()).toEqual({ error: 'self_challenge' });

			const answered = await query<{ label: string; source: string }>(
				`select props->>'label' as label, props->>'source' as source from analytics_events
				 where user_id = $1 and name = 'challenge_answered'`,
				[leo.userId]
			);

			expect(answered).toEqual([{ label: 'opposite_side', source: 'existing' }]);

			const inbox = await call({ method: 'GET', path: '/answers', token: maya.token });

			expect(await inbox.json()).toEqual({
				items: [
					{
						challengeId: id,
						seriesId,
						side: 'NO',
						entryPriceBps: 4400,
						answeredAtMs: expect.any(Number),
						answerer: { handle: leo.handle, avatar: '', avatarParts: '' },
						myPosition: expect.objectContaining({ side: 'YES', entryPriceBps: 3800 })
					}
				]
			});

			const mine = await call({ method: 'GET', path: '/mine', token: maya.token });
			const mineBody = (await mine.json()) as { items: OwnChallengeBody[] };

			expect(
				mineBody.items.map(({ id: linkId, answerCount }) => ({ linkId, answerCount }))
			).toEqual([{ linkId: id, answerCount: 1 }]);
		});

		test('an answer from a referee through that link is counted as referred', async () => {
			const maya = await player();
			const leo = await player();
			const seriesId = newSeries();

			fill({ userId: maya.userId, seriesId, qty: 10, priceCents: 38 });

			const { id } = await create({ who: maya, seriesId });

			await call({ method: 'POST', path: `/${id}/redeem`, token: leo.token });
			fill({ userId: leo.userId, seriesId, qty: 10, priceCents: 40 });
			await call({ method: 'POST', path: `/${id}/answer`, token: leo.token });

			expect(
				await query(
					`select props->>'label' as label, props->>'source' as source from analytics_events
					 where user_id = $1 and name = 'challenge_answered'`,
					[leo.userId]
				)
			).toEqual([{ label: 'same_side', source: 'referred' }]);
		});
	});
});
