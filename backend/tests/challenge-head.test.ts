// The link preview of a challenge link: the headline for each state of the
// link, the consent switch keeping the handle out, every interpolated value
// escaped, the generic share card on the app's origin, and a 404 with an
// empty body for a link that reads as not found.

import { afterEach, beforeAll, beforeEach, describe, expect, test } from 'bun:test';
import { clearCache } from '../src/engine/cache';
import { env } from '../src/env';
import { resetRateLimits } from '../src/lib/rate-limit';
import {
	challengeDescription,
	challengeHeadline,
	renderChallengeHead
} from '../src/social/challenge-head';
import type { ChallengeView } from '../src/social/challenges';
import { runTradeActivityTriggers } from '../src/vxp/triggers';
import { ensureMigrated } from './helpers/auth';
import {
	call,
	create,
	fill,
	installChallengeEngine,
	newSeries,
	player,
	settledSeries,
	uniqueIp
} from './helpers/challenges';
import { dbAvailable } from './helpers/setup';

const maya = { handle: 'maya', avatar: '', avatarParts: '' };

const view = (overrides: Partial<ChallengeView> = {}): ChallengeView => ({
	seriesId: 'series-head',
	position: { side: 'YES', entryPriceBps: 3800, calledAtMs: 1 },
	sideChanged: false,
	challenger: maya,
	marketOpen: true,
	...overrides
});

describe('challenge preview copy', () => {
	test('one headline per state of the link', () => {
		expect(challengeHeadline(view())).toBe('@maya called Yes at 38%');
		expect(
			challengeHeadline(
				view({
					position: { side: 'NO', entryPriceBps: 4100, calledAtMs: 1 },
					sideChanged: true
				})
			)
		).toBe('@maya now says No at 41%');
		expect(challengeHeadline(view({ position: null }))).toBe('@maya challenged you on this');
		expect(challengeHeadline(view({ marketOpen: false }))).toBe(
			'@maya called Yes at 38%. This one has closed'
		);
	});

	test('without consent the handle is never printed', () => {
		const hidden = (overrides: Partial<ChallengeView>) =>
			challengeHeadline(view({ challenger: null, ...overrides }));

		expect(hidden({})).toBe('A friend called Yes at 38%');
		expect(hidden({ position: null })).toBe('A friend challenged you on this');
		expect(hidden({ marketOpen: false })).toBe('A friend called Yes at 38%. This one has closed');
		expect(
			renderChallengeHead({
				id: 'ABCDEFGHJKMNPQRS',
				view: view({ challenger: null }),
				marketTitle: 'Will it happen?',
				appOrigin: 'https://vici.app'
			})
		).not.toContain('maya');
	});

	test('a percent is never shown as a certainty', () => {
		expect(
			challengeHeadline(view({ position: { side: 'YES', entryPriceBps: 1, calledAtMs: 1 } }))
		).toBe('@maya called Yes at 1%');
		expect(
			challengeHeadline(view({ position: { side: 'NO', entryPriceBps: 9999, calledAtMs: 1 } }))
		).toBe('@maya called No at 99%');
	});

	test('the description is the question and what is left to do', () => {
		const marketTitle = 'Will Brazil beat Norway?';

		expect(challengeDescription({ view: view(), marketTitle })).toBe(
			"Will Brazil beat Norway? Think they're wrong?"
		);
		expect(challengeDescription({ view: view({ sideChanged: true }), marketTitle })).toBe(
			"Will Brazil beat Norway? Think they're wrong?"
		);
		expect(challengeDescription({ view: view({ position: null }), marketTitle })).toBe(
			"Will Brazil beat Norway? What's your call?"
		);
		expect(challengeDescription({ view: view({ marketOpen: false }), marketTitle })).toBe(
			'Will Brazil beat Norway?'
		);
		expect(challengeDescription({ view: view(), marketTitle: undefined })).toBe(
			"Think they're wrong?"
		);
	});

	test('the fragment names the link and the share card on the app origin', () => {
		const html = renderChallengeHead({
			id: 'ABCDEFGHJKMNPQRS',
			view: view(),
			marketTitle: 'Will it happen?',
			appOrigin: 'https://vici.app'
		});

		expect(html).toContain('<title>@maya called Yes at 38% | VICI</title>');
		expect(html).toContain(
			'<meta property="og:url" content="https://vici.app/c/ABCDEFGHJKMNPQRS" />'
		);
		expect(html).toContain(
			'<meta property="og:image" content="https://vici.app/branding/landing-share.jpg" />'
		);
		expect(html).toContain(
			'<meta name="twitter:image" content="https://vici.app/branding/landing-share.jpg" />'
		);
		expect(html).toContain('<meta name="robots" content="noindex, nofollow" />');
		expect(html).toContain(
			`<meta property="og:description" content="Will it happen? Think they&#39;re wrong?" />`
		);
	});
});

describe.if(dbAvailable)('challenge head route', () => {
	let restore: (() => void) | undefined;

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

	const head = async (id: string): Promise<Response> =>
		await call({ method: 'GET', path: `/${id}/head`, ip: uniqueIp() });

	test('renders the current state of the link as HTML', async () => {
		const challenger = await player();
		const seriesId = newSeries({ title: 'Will it rain in Rome?' });

		fill({ userId: challenger.userId, seriesId, qty: 10, priceCents: 38 });

		const { id } = await create({ who: challenger, seriesId });
		const res = await head(id.toLowerCase());
		const html = await res.text();

		expect(res.status).toBe(200);
		expect(res.headers.get('content-type')).toBe('text/html; charset=utf-8');
		expect(html).toContain(`<title>@${challenger.handle} called Yes at 38% | VICI</title>`);
		expect(html).toContain(
			`<meta name="description" content="Will it rain in Rome? Think they&#39;re wrong?" />`
		);
		expect(html).toContain(
			`<meta property="og:url" content="${new URL(`/c/${id}`, env.publicAppUrl).href}" />`
		);
		expect(html).not.toContain(challenger.userId);

		fill({ userId: challenger.userId, seriesId, qty: -30, priceCents: 59 });
		await runTradeActivityTriggers({ userId: challenger.userId });

		expect(await (await head(id)).text()).toContain(
			`<title>@${challenger.handle} now says No at 41% | VICI</title>`
		);

		settledSeries.add(seriesId);
		clearCache();

		expect(await (await head(id)).text()).toContain(
			`<title>@${challenger.handle} called No at 41%. This one has closed | VICI</title>`
		);
	});

	test('the image is the generic share card, absolute on the app origin', async () => {
		const challenger = await player();
		const seriesId = newSeries();

		fill({ userId: challenger.userId, seriesId, qty: 10, priceCents: 38 });

		const { id } = await create({ who: challenger, seriesId });
		const html = await (await head(id)).text();
		const image = html.match(/<meta property="og:image" content="([^"]*)" \/>/)?.[1];

		expect(image).toBe(new URL('/branding/landing-share.jpg', env.publicAppUrl).href);
		expect(image?.startsWith(`${new URL(env.publicAppUrl).origin}/`)).toBe(true);
	});

	test('consent off never prints the handle', async () => {
		const challenger = await player();
		const seriesId = newSeries();

		fill({ userId: challenger.userId, seriesId, qty: 10, priceCents: 38 });

		const { id } = await create({ who: challenger, seriesId, showIdentity: false });
		const html = await (await head(id)).text();

		expect(html).toContain('<title>A friend called Yes at 38% | VICI</title>');
		expect(html).not.toContain(challenger.handle);
	});

	test('a hostile market title is escaped', async () => {
		const challenger = await player();
		const seriesId = newSeries({ title: `"><script>alert('x')</script><meta x="` });

		fill({ userId: challenger.userId, seriesId, qty: 10, priceCents: 38 });

		const { id } = await create({ who: challenger, seriesId });
		const html = await (await head(id)).text();

		expect(html).not.toContain('<script>');
		expect(html).not.toContain('"><');
		expect(html).toContain(
			'&quot;&gt;&lt;script&gt;alert(&#39;x&#39;)&lt;/script&gt;&lt;meta x=&quot;'
		);
	});

	test('a link that reads as not found answers 404 with an empty body', async () => {
		const challenger = await player();
		const seriesId = newSeries();

		fill({ userId: challenger.userId, seriesId, qty: 10, priceCents: 38 });

		const { id } = await create({ who: challenger, seriesId });

		await call({ method: 'DELETE', path: `/${id}`, token: challenger.token });

		for (const missing of [id, 'ZZZZZZZZZZZZZZZZ', 'not-an-id']) {
			const res = await head(missing);

			expect(res.status).toBe(404);
			expect(await res.text()).toBe('');
		}
	});
});
