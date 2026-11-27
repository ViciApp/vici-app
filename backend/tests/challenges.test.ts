// Challenge links: issued only for a real engine position, one per (user,
// series), kept current by the trade trigger, and read publicly with nothing
// but the consented identity. The credit and the answers are in
// challenge-answers.test.ts, the hard delete and the prune in
// challenge-upkeep.test.ts.

import { afterEach, beforeAll, beforeEach, describe, expect, test } from 'bun:test';
import { query } from '../src/db/client';
import { clearCache } from '../src/engine/cache';
import { userIcPrincipalText } from '../src/lib/keys';
import { resetRateLimits } from '../src/lib/rate-limit';
import { DAY_IN_MS } from '../src/lib/time';
import { CHALLENGE_ID_REGEX, normalizeChallengeId } from '../src/social/challenges';
import { heldBinaryPosition } from '../src/vxp/predictions';
import { runTradeActivityTriggers } from '../src/vxp/triggers';
import { ensureMigrated } from './helpers/auth';
import {
	call,
	create,
	fill,
	fills,
	installChallengeEngine,
	newSeries,
	NS_PER_MS,
	player,
	read,
	readBody,
	settledSeries,
	uniqueIp,
	type OwnChallengeBody
} from './helpers/challenges';
import { hibernateProfile, softDeleteProfile } from './helpers/profiles';
import { dbAvailable } from './helpers/setup';

let restore: (() => void) | undefined;

describe('challenge id format', () => {
	test('a normalised id is 16 Crockford characters; anything else is not an id', () => {
		expect(normalizeChallengeId(' abcdefghjkmnpqrs ')).toBe('ABCDEFGHJKMNPQRS');
		expect(normalizeChallengeId('ABCDEFGHJKMNPQRI')).toBeUndefined();
		expect(normalizeChallengeId('ABCDEFGHJKMNPQR')).toBeUndefined();
		expect(normalizeChallengeId("'; drop table challenge_links; --")).toBeUndefined();
		expect(CHALLENGE_ID_REGEX.test('0123456789ABCDEF')).toBe(true);
	});
});

describe('held position opening time', () => {
	test('adding keeps the opening fill, a flip reopens, flat clears', () => {
		const userId = 'a6a3c57c-0d55-4bb1-9c2a-0d1c6b3c0f01';
		const seriesId = newSeries();
		const opened = fill({ userId, seriesId, qty: 10, priceCents: 40, atMs: 1_000 });

		fill({ userId, seriesId, qty: 10, priceCents: 60, atMs: 2_000 });

		const events = () => fills.get(userIcPrincipalText(userId)) ?? [];

		expect(heldBinaryPosition({ events: events(), seriesId })).toEqual({
			side: 'YES',
			entryPrice: 0.5,
			openedAtNs: opened.timestamp
		});

		const flip = fill({ userId, seriesId, qty: -30, priceCents: 70, atMs: 3_000 });

		expect(heldBinaryPosition({ events: events(), seriesId })?.openedAtNs).toBe(flip.timestamp);

		fill({ userId, seriesId, qty: 10, priceCents: 70, atMs: 4_000 });

		expect(heldBinaryPosition({ events: events(), seriesId })).toBeUndefined();
	});
});

describe.if(dbAvailable)('challenge links', () => {
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

	describe('creation', () => {
		test('needs a session', async () => {
			const res = await call({
				method: 'POST',
				path: '/',
				body: { seriesId: newSeries(), showIdentity: true }
			});

			expect(res.status).toBe(401);
		});

		test('needs a held binary position on an open Vici series', async () => {
			const maya = await player();

			const refusal = async (seriesId: string): Promise<{ status: number; error: string }> => {
				const res = await call({
					method: 'POST',
					path: '/',
					token: maya.token,
					body: { seriesId, showIdentity: true }
				});

				return { status: res.status, error: ((await res.json()) as { error: string }).error };
			};

			expect(await refusal(newSeries())).toEqual({ status: 400, error: 'no_position' });
			expect(await refusal('series-challenge-missing')).toEqual({
				status: 400,
				error: 'unknown_series'
			});
			expect(await refusal(newSeries({ engineId: 'eng_9' }))).toEqual({
				status: 400,
				error: 'unknown_series'
			});
			expect(await refusal(newSeries({ binary: false }))).toEqual({
				status: 400,
				error: 'unsupported_series'
			});

			const expired = newSeries({ expiryMs: Date.now() - DAY_IN_MS });

			fill({ userId: maya.userId, seriesId: expired, qty: 10, priceCents: 40 });

			expect(await refusal(expired)).toEqual({ status: 400, error: 'market_closed' });

			const settled = newSeries();

			fill({ userId: maya.userId, seriesId: settled, qty: 10, priceCents: 40 });
			settledSeries.add(settled);

			expect(await refusal(settled)).toEqual({ status: 400, error: 'market_closed' });

			// A position that nets to flat is no position.
			const flat = newSeries();

			fill({ userId: maya.userId, seriesId: flat, qty: 10, priceCents: 40 });
			fill({ userId: maya.userId, seriesId: flat, qty: -10, priceCents: 50 });

			expect(await refusal(flat)).toEqual({ status: 400, error: 'no_position' });
		});

		test('the position comes from the engine and is idempotent per series', async () => {
			const maya = await player();
			const seriesId = newSeries();
			const opened = fill({ userId: maya.userId, seriesId, qty: 10, priceCents: 38 });

			const first = await create({ who: maya, seriesId });

			expect(first.id).toMatch(CHALLENGE_ID_REGEX);
			expect(first.position).toEqual({
				side: 'YES',
				entryPriceBps: 3800,
				calledAtMs: Number(opened.timestamp / NS_PER_MS)
			});
			expect(first.showIdentity).toBe(true);
			expect(first.marketOpen).toBe(true);
			expect(first.challenger?.handle).toBe(maya.handle);

			// A request cannot set side or price: extra fields change nothing.
			fill({ userId: maya.userId, seriesId, qty: 10, priceCents: 42 });

			const res = await call({
				method: 'POST',
				path: '/',
				token: maya.token,
				body: { seriesId, showIdentity: false, side: 'NO', entryPriceBps: 9000 }
			});

			expect(res.status).toBe(200);

			const second = ((await res.json()) as { challenge: OwnChallengeBody }).challenge;

			expect(second.id).toBe(first.id);
			expect(second.position?.side).toBe('YES');
			expect(second.position?.entryPriceBps).toBe(4000);
			expect(second.showIdentity).toBe(false);
			expect(second.challenger).toBeNull();

			const events = await query<{ label: string; ok: boolean }>(
				`select props->>'label' as label, (props->>'ok')::boolean as ok
				 from analytics_events
				 where user_id = $1 and name = 'challenge_created' and props->>'marketId' = $2
				 order by key`,
				[maya.userId, seriesId]
			);

			expect(events).toEqual([
				{ label: 'new', ok: true },
				{ label: 'existing', ok: false }
			]);
		});
	});

	describe('current state', () => {
		test('a flip and a close reach the link through the trade trigger', async () => {
			const maya = await player();
			const seriesId = newSeries();

			fill({ userId: maya.userId, seriesId, qty: 10, priceCents: 38 });

			const { id } = await create({ who: maya, seriesId });

			const flip = fill({ userId: maya.userId, seriesId, qty: -30, priceCents: 59 });

			await runTradeActivityTriggers({ userId: maya.userId });

			expect(await readBody(id)).toMatchObject({
				position: {
					side: 'NO',
					entryPriceBps: 4100,
					calledAtMs: Number(flip.timestamp / NS_PER_MS)
				},
				sideChanged: true
			});

			fill({ userId: maya.userId, seriesId, qty: 20, priceCents: 50 });
			await runTradeActivityTriggers({ userId: maya.userId });

			expect(await readBody(id)).toMatchObject({ position: null, sideChanged: false });
		});

		test('market state is read live: settled or expired reads closed', async () => {
			const maya = await player();
			const seriesId = newSeries();

			fill({ userId: maya.userId, seriesId, qty: 10, priceCents: 38 });

			const { id } = await create({ who: maya, seriesId });

			expect((await readBody(id)).marketOpen).toBe(true);

			settledSeries.add(seriesId);
			clearCache();

			expect((await readBody(id)).marketOpen).toBe(false);
		});
	});

	describe('public read', () => {
		test('carries the call and the consented handle, never the account', async () => {
			const maya = await player();
			const seriesId = newSeries();

			fill({ userId: maya.userId, seriesId, qty: 10, priceCents: 38 });

			const { id } = await create({ who: maya, seriesId });
			const res = await read(id.toLowerCase());
			const text = await res.text();

			expect(res.status).toBe(200);
			expect(text).not.toContain(maya.userId);
			expect(text).not.toContain('email');
			expect(JSON.parse(text)).toEqual({
				challenge: {
					seriesId,
					position: expect.objectContaining({ side: 'YES', entryPriceBps: 3800 }),
					sideChanged: false,
					challenger: { handle: maya.handle, avatar: '', avatarParts: '' },
					marketOpen: true,
					isOwner: false
				}
			});
		});

		test('consent overrides the profile settings both ways', async () => {
			const priv = await player();
			const pub = await player();
			const seriesId = newSeries();

			await query(
				`update profiles set visibility = 'friends_only',
				   preferences = '{"sharing":{"callsPublic":false,"profileVisibility":"private"}}'
				 where user_id = $1`,
				[priv.userId]
			);
			fill({ userId: priv.userId, seriesId, qty: 10, priceCents: 38 });
			fill({ userId: pub.userId, seriesId, qty: -10, priceCents: 38 });

			const privLink = await create({ who: priv, seriesId, showIdentity: true });
			const pubLink = await create({ who: pub, seriesId, showIdentity: false });

			expect((await readBody(privLink.id)).challenger).toMatchObject({ handle: priv.handle });
			expect((await readBody(pubLink.id)).challenger).toBeNull();
		});

		test('only the owner changes consent', async () => {
			const maya = await player();
			const leo = await player();
			const seriesId = newSeries();

			fill({ userId: maya.userId, seriesId, qty: 10, priceCents: 38 });

			const { id } = await create({ who: maya, seriesId });

			const stranger = await call({
				method: 'PATCH',
				path: `/${id}`,
				token: leo.token,
				body: { showIdentity: false }
			});

			expect(stranger.status).toBe(404);
			expect((await readBody(id)).challenger).not.toBeNull();

			const owner = await call({
				method: 'PATCH',
				path: `/${id}`,
				token: maya.token,
				body: { showIdentity: false }
			});

			expect(owner.status).toBe(200);
			expect(((await owner.json()) as { challenge: OwnChallengeBody }).challenge.showIdentity).toBe(
				false
			);
			expect((await readBody(id)).challenger).toBeNull();
		});

		test('a hidden challenger reads as not found and comes back on recovery', async () => {
			const maya = await player();
			const seriesId = newSeries();

			fill({ userId: maya.userId, seriesId, qty: 10, priceCents: 38 });

			const { id } = await create({ who: maya, seriesId });

			await softDeleteProfile(maya.userId);

			expect((await read(id)).status).toBe(404);

			await query(`update profiles set deleted_at_ms = null where user_id = $1`, [maya.userId]);

			expect((await read(id)).status).toBe(200);

			await hibernateProfile(maya.userId);

			expect((await read(id)).status).toBe(404);
		});

		test('isOwner marks the challenger alone, with consent on or off, and is never shared', async () => {
			const maya = await player();
			const leo = await player();
			const seriesId = newSeries();

			fill({ userId: maya.userId, seriesId, qty: 10, priceCents: 38 });

			const { id } = await create({ who: maya, seriesId });
			const readAs = async (token?: string): Promise<Response> =>
				await call({ method: 'GET', path: `/${id}`, token, ip: uniqueIp() });
			const isOwnerOf = async (res: Response): Promise<unknown> =>
				((await res.json()) as { challenge: { isOwner: unknown } }).challenge.isOwner;

			const signedOut = await readAs();

			expect(signedOut.status).toBe(200);
			expect(await isOwnerOf(signedOut)).toBe(false);
			expect(signedOut.headers.get('cache-control')).toBeNull();
			expect(signedOut.headers.get('vary')).toContain('Cookie');

			const stranger = await readAs(leo.token);

			expect(await isOwnerOf(stranger)).toBe(false);
			expect(stranger.headers.get('cache-control')).toBe('private');

			const owner = await readAs(maya.token);

			expect(await isOwnerOf(owner)).toBe(true);
			expect(owner.headers.get('cache-control')).toBe('private');
			expect(owner.headers.get('vary')).toContain('Cookie');

			await call({
				method: 'PATCH',
				path: `/${id}`,
				token: maya.token,
				body: { showIdentity: false }
			});

			const hidden = await readAs(maya.token);
			const body = ((await hidden.json()) as { challenge: Record<string, unknown> }).challenge;

			expect(body.challenger).toBeNull();
			expect(body.isOwner).toBe(true);
			expect(await isOwnerOf(await readAs('not-a-session'))).toBe(false);
		});

		test('revoked, unknown and malformed ids answer the same', async () => {
			const maya = await player();
			const seriesId = newSeries();

			fill({ userId: maya.userId, seriesId, qty: 10, priceCents: 38 });

			const { id } = await create({ who: maya, seriesId });
			const revoke = await call({ method: 'DELETE', path: `/${id}`, token: maya.token });

			expect(revoke.status).toBe(200);

			const answers = await Promise.all(
				[id, 'ZZZZZZZZZZZZZZZZ', 'not-a-challenge-id', '%27%3B--'].map(async (raw) => {
					const res = await read(raw);

					return { status: res.status, body: await res.json() };
				})
			);

			for (const answer of answers) {
				expect(answer).toEqual({ status: 404, body: { error: 'challenge_not_found' } });
			}

			// A revoked link cannot be revoked or changed again, and a new create
			// issues a new id.
			expect((await call({ method: 'DELETE', path: `/${id}`, token: maya.token })).status).toBe(
				404
			);
			expect((await create({ who: maya, seriesId })).id).not.toBe(id);
		});
	});

	describe('limits', () => {
		test('the public read is limited per IP', async () => {
			const ip = uniqueIp();
			let last = 0;

			for (let i = 0; i <= 120; i++) {
				last = (await call({ method: 'GET', path: '/ZZZZZZZZZZZZZZZZ', ip })).status;
			}

			expect(last).toBe(429);
			expect(
				(await call({ method: 'GET', path: '/ZZZZZZZZZZZZZZZZ', ip: uniqueIp() })).status
			).toBe(404);
		});

		test('redeem is limited per account and asks for no Turnstile token', async () => {
			const leo = await player();
			let last = 0;

			for (let i = 0; i <= 20; i++) {
				last = (await call({ method: 'POST', path: '/ZZZZZZZZZZZZZZZZ/redeem', token: leo.token }))
					.status;
			}

			expect(last).toBe(429);
		});
	});
});
