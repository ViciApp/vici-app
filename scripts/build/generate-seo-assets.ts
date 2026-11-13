/**
 * generate-seo-assets: the crawler-facing surface of the SPA.
 *
 * The app ships as a single static shell (`adapter-static` with an
 * `index.html` fallback and `ssr = false`), so every URL serves identical
 * HTML: crawlers and link unfurlers never see a market's question. This
 * script runs as the second `predeploy` step (after `npm run build`, see
 * `juno.config.ts`) and emits into `build/`:
 *
 *   - `sitemap.xml`: the public static routes plus one URL per visible
 *     market, so search engines discover the catalog at all.
 *   - ONE per-market copy of the built shell at `m/{slug~id8}` (the
 *     keyword-carrying canonical, same param the share sheet hands out;
 *     see `#lib/utils/market-slug.utils`) with the market's
 *     title/description swapped into `<title>`, the description meta, the
 *     canonical link and the OG/Twitter tags, a per-market JSON-LD block,
 *     plus `window.__viciSeriesId` so the `/m/[id]` route resolves the
 *     market without a catalog lookup.
 *
 * Exactly one page per market, deliberately: every emitted file is staged,
 * committed AND deleted again per deploy, and the satellite recomputes the
 * asset certification tree across all assets on those bulk operations:
 * deleting ~6k staged assets exceeded the IC's 40B-instruction message
 * limit (see junobuild/juno#2263; deploy applied, cleanup failed). The
 * plain-id routes (`/markets/{id}`, `/m/{id}`) intentionally get no copies.
 *
 * Contract with `src/app.html`: the head tags rewritten here must keep
 * matching the patterns below: the script hard-fails when a pattern stops
 * matching, so an app.html refactor can't silently strip the SEO layer.
 *
 * Visibility mirrors the live feed: only markets attributed to the Vici
 * engine, and only once their on-chain `start_ns` has passed (mirrors
 * `#lib/utils/wc-schedule.utils`'s reveal gate, generalized beyond World Cup
 * markets: a staggered drop with a future start stays hidden here too). A
 * market with no `start_ns` is live from registration and always visible.
 * An unrevealed market must never leak here: its question would be public
 * before its release.
 *
 * Resolved markets get an ANSWER page, not a stale trading page: clearing is
 * the source of truth for resolution (`list_settled_series` +
 * `get_settlement_status`), and a settled market's outcome goes into the
 * title, the head of the description and the JSON-LD. Without it the page
 * advertises "Live community odds" over an empty book: thin content that
 * reads identically to a market nobody has traded yet, on exactly the pages
 * whose search demand peaks *after* the event.
 *
 * Failure is fatal by design: `hosting deploy --prune` deletes any asset
 * missing from `build/`, so a silently-degraded run would wipe every
 * previously deployed market page and the sitemap. The soft dependencies are
 * the clearing reads (live odds and resolution): a slow/unreachable clearing
 * canister must never fail a deploy, so they degrade to "no odds clause" and
 * "treat as unresolved" respectively, never a throw.
 */
import type { _SERVICE as ClearingService, LimitOrder } from '#declarations/clearing/clearing.d.ts';
import { idlFactory as clearingIdlFactory } from '#declarations/clearing/clearing.idl.js';
import type { _SERVICE as RegistryService, Series } from '#declarations/registry/registry.d.ts';
import { idlFactory as registryIdlFactory } from '#declarations/registry/registry.idl.js';
import { MILLISECOND_IN_NANOSECONDS } from '#lib/constants/app.constants.ts';
import { CLEARING_CANISTER_ID, REGISTRY_CANISTER_ID } from '#lib/constants/canisters.constants.ts';
import type { Outcome } from '#lib/types/market.ts';
import { marketShareParam } from '#lib/utils/market-slug.utils.ts';
import { settlementInputOutcome } from '#lib/utils/payoff.utils.ts';
import { isMarketRevealed } from '#lib/utils/wc-schedule.utils.ts';
import { fromNullable, isNullish, nonNullish, toNullable } from '@dfinity/utils';
import { Actor, HttpAgent, type ActorSubclass } from '@icp-sdk/core/agent';
import { Ed25519KeyIdentity } from '@icp-sdk/core/identity';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const SCRIPT_DIR = dirname(fileURLToPath(import.meta.url));
const BUILD_DIR = join(SCRIPT_DIR, '..', '..', 'build');

const PROD_ORIGIN = 'https://vici.market';
const IC_HOST = 'https://icp-api.io';
const ENGINE_ID = process.env.VICI_ENGINE_ID ?? 'eng_0';
const PAGE_SIZE = 200n;

// Bounded fan-out for the per-market odds reads: enough to keep the deploy
// step quick over a few hundred markets, low enough not to hammer the
// clearing canister with one burst.
const ODDS_CONCURRENCY = 8;

// Mirrors the market-detail `<svelte:head>` title (`market.detail.head_suffix`).
const TITLE_SUFFIX = ' | Vici Social Markets';

// Meta descriptions get truncated by search engines around this length;
// cutting at a word boundary keeps the snippet clean.
const DESCRIPTION_MAX_LENGTH = 160;

// Registry descriptions are often a terse one-liner ("Both-to-score
// market"); the brand tail turns the snippet into a call to action AND
// seeds the "prediction market" keyword into the crawler-facing meta (the
// phrase never appears in the rendered UI, only here in the head layer).
const DESCRIPTION_TAIL = 'Live community odds on the Vici prediction market.';

// A settled market has no live book, so the open-market tail would promise
// odds the page cannot show. Point at the catalog instead: the resolved page
// is an answer page whose job is to hand the reader an open market next.
const DESCRIPTION_TAIL_RESOLVED = 'See the result and open markets on Vici.';

const escapeHtml = (value: string): string =>
	value
		.replaceAll('&', '&amp;')
		.replaceAll('<', '&lt;')
		.replaceAll('>', '&gt;')
		.replaceAll('"', '&quot;');

const collapseWhitespace = (value: string): string => value.replace(/\s+/g, ' ').trim();

const truncateAtWord = (value: string): string => {
	const collapsed = collapseWhitespace(value);

	if (collapsed.length <= DESCRIPTION_MAX_LENGTH) {
		return collapsed;
	}

	const cut = collapsed.slice(0, DESCRIPTION_MAX_LENGTH);
	const lastSpace = cut.lastIndexOf(' ');

	return `${lastSpace > 0 ? cut.slice(0, lastSpace) : cut}…`;
};

/**
 * What the crawler is told about a market's state. `resolved` without an
 * `outcome` is a real case: a categorical or non-canonical settlement price
 * that {@link settlementInputOutcome} refuses to label (see
 * `binaryPayoffLabel`): the page then says "resolved" without naming a
 * winner rather than guessing one.
 */
type Resolution =
	{ resolved: false; yesProbability?: number } | { resolved: true; outcome?: Outcome };

/**
 * The plain-text meta description: for an open market the (truncated)
 * registry blurb, an optional live-odds sentence, then the brand/keyword
 * tail. Returns raw text; callers HTML-escape it for meta attributes and
 * pass it verbatim into JSON-LD.
 *
 * A resolved market leads with the outcome instead. Search engines cut the
 * snippet around {@link DESCRIPTION_MAX_LENGTH}, and the registry blurb alone
 * can fill that budget, so the answer goes in the one slot guaranteed to
 * survive truncation. This is the whole point of the resolved page: the
 * query it wins ("who won X") wants the result, not the question.
 */
const composeDescription = ({
	plain,
	resolution
}: {
	plain: string;
	resolution: Resolution;
}): string => {
	const base = truncateAtWord(plain);
	const sentences: string[] = [];

	if (resolution.resolved) {
		sentences.push(
			nonNullish(resolution.outcome)
				? `Resolved: ${resolution.outcome}.`
				: 'This market has resolved.'
		);
	}

	if (base.length > 0) {
		sentences.push(/[.!?…]$/.test(base) ? base : `${base}.`);
	}

	if (!resolution.resolved && nonNullish(resolution.yesProbability)) {
		sentences.push(`Community odds: Yes ${Math.round(resolution.yesProbability * 100)}%.`);
	}

	sentences.push(resolution.resolved ? DESCRIPTION_TAIL_RESOLVED : DESCRIPTION_TAIL);

	return sentences.join(' ');
};

/**
 * The `<title>` / OG headline. The market question stays in front so it still
 * keyword-matches the query; the outcome is appended as the differentiator.
 */
const composeHeadline = ({
	title,
	resolution
}: {
	title: string;
	resolution: Resolution;
}): string => {
	if (!resolution.resolved) {
		return title;
	}

	// A resolved market is marked resolved even when the winner can't be
	// named: without this the degraded page would carry a title identical to
	// an open market's, which is the one thing the resolved page exists to
	// avoid. "Resolved" alone is still an accurate, differentiating headline.
	return nonNullish(resolution.outcome)
		? `${title} - Resolved: ${resolution.outcome}`
		: `${title} - Resolved`;
};

/**
 * Serialises a schema.org object into a `<script type="application/ld+json">`
 * tag. `</` is escaped so a stray value can never close the script early.
 */
const jsonLdScript = (data: unknown): string =>
	`<script type="application/ld+json">${JSON.stringify(data).replaceAll('</', '<\\/')}</script>`;

const listAllSeries = async (registry: ActorSubclass<RegistryService>): Promise<Series[]> => {
	const all: Series[] = [];
	let cursor: string | undefined = undefined;

	for (;;) {
		const page = await registry.list_series({
			cursor: toNullable(cursor),
			limit: toNullable(PAGE_SIZE)
		});

		all.push(...page.items);

		const next = fromNullable(page.next_cursor);

		if (isNullish(next) || page.items.length === 0) {
			return all;
		}

		cursor = next;
	}
};

/**
 * Current YES probability (0..1) from the resting order book, mirroring the
 * FE's `calculateMarketStats` / `calculateProbability` in
 * `#lib/utils/market.utils.ts`: best-bid/best-ask mid when both sides exist,
 * the single side when one-sided, `undefined` when the book is empty (never
 * a 0.5 placeholder). NO orders are flipped to the YES perspective the same
 * way the live UI does.
 */
const midYesProbability = (orders: LimitOrder[]): number | undefined => {
	const bidPrices: number[] = [];
	const askPrices: number[] = [];

	for (const order of orders) {
		const side = 'Buy' in order.side ? 'BUY' : 'SELL';
		const outcomeId = fromNullable(order.outcome_id) ?? 'YES';
		const rawPrice = Number(order.price.decimal.value) / 10 ** Number(order.price.decimal.decimals);

		if (outcomeId === 'YES') {
			(side === 'BUY' ? bidPrices : askPrices).push(rawPrice);
		} else if (outcomeId === 'NO') {
			// Flip the binary opposite to the YES perspective (mirrors the live
			// UI); any other outcome is categorical and irrelevant to a Yes %.
			(side === 'BUY' ? askPrices : bidPrices).push(1 - rawPrice);
		}
	}

	const bestBid = bidPrices.length > 0 ? Math.max(...bidPrices) : undefined;
	const bestAsk = askPrices.length > 0 ? Math.min(...askPrices) : undefined;

	if (nonNullish(bestBid) && nonNullish(bestAsk)) {
		return (bestBid + bestAsk) / 2;
	}

	return bestBid ?? bestAsk;
};

/**
 * Reads one market's current YES probability. Soft by contract: any clearing
 * error degrades to `undefined` (no odds clause) rather than failing the
 * deploy: odds are a nice-to-have on top of the always-present title/desc.
 */
const fetchYesProbability = async ({
	clearing,
	seriesId
}: {
	clearing: ActorSubclass<ClearingService>;
	seriesId: string;
}): Promise<number | undefined> => {
	try {
		const orders = await clearing.list_orders({ series_id: toNullable(seriesId) });

		return midYesProbability(orders);
	} catch (err) {
		// Soft dependency: swallow and fall through to "no odds" (returns
		// undefined) rather than fail the deploy: odds are optional garnish.
		console.warn(`[seo-assets] odds read failed for ${seriesId}; emitting page without odds.`, err);
	}
};

/**
 * The authoritative set of settled series ids, draining clearing's exclusive
 * cursor. Soft by the same contract as the odds read: an unreachable clearing
 * canister yields an empty set, so every market is emitted as unresolved
 * (today's behaviour) rather than failing the deploy.
 */
const listSettledSeriesIds = async (
	clearing: ActorSubclass<ClearingService>
): Promise<Set<string>> => {
	const ids = new Set<string>();
	let startAfter: string | undefined = undefined;

	try {
		for (;;) {
			const page = await clearing.list_settled_series({
				start_after: toNullable(startAfter),
				limit: toNullable(PAGE_SIZE),
				balance_domain: toNullable()
			});

			for (const id of page.items) {
				ids.add(id);
			}

			const next = fromNullable(page.next_cursor);

			if (isNullish(next) || page.items.length === 0) {
				return ids;
			}

			startAfter = next;
		}
	} catch (err) {
		console.warn(
			'[seo-assets] settled-series read failed; emitting all markets as unresolved.',
			err
		);

		return new Set();
	}
};

/**
 * One settled market's winning outcome. Soft: a failed read degrades to
 * "resolved, winner unnamed": the page still tells the crawler the market is
 * over, which is the part that stops it reading as a live-odds page.
 */
const fetchSettlementOutcome = async ({
	clearing,
	seriesId
}: {
	clearing: ActorSubclass<ClearingService>;
	seriesId: string;
}): Promise<Outcome | undefined> => {
	try {
		const status = fromNullable(await clearing.get_settlement_status(seriesId));

		return nonNullish(status) ? settlementInputOutcome(status.settlement) : undefined;
	} catch (err) {
		console.warn(`[seo-assets] settlement read failed for ${seriesId}; omitting outcome.`, err);
	}
};

const mapWithConcurrency = async <T, R>({
	items,
	limit,
	fn
}: {
	items: T[];
	limit: number;
	fn: (item: T) => Promise<R>;
}): Promise<R[]> => {
	const results: R[] = new Array(items.length);
	let next = 0;

	const worker = async (): Promise<void> => {
		for (;;) {
			const index = next++;

			if (index >= items.length) {
				return;
			}

			results[index] = await fn(items[index]);
		}
	};

	await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker));

	return results;
};

/**
 * Replaces exactly one occurrence, or throws: a pattern that stops matching
 * means `src/app.html` drifted from the contract documented up top, and a
 * silent no-op here would ship brand-generic meta on every market page.
 */
const replaceOnce = ({
	html,
	pattern,
	replacement,
	label
}: {
	html: string;
	pattern: RegExp;
	replacement: string;
	label: string;
}): string => {
	const matches = html.match(new RegExp(pattern, 'g'))?.length ?? 0;

	if (matches !== 1) {
		throw new Error(
			`SEO shell contract broken: ${label} matched ${matches} times in build/index.html (expected exactly 1)`
		);
	}

	// Replacement via callback so `$…` sequences in market text stay literal.
	return html.replace(pattern, () => replacement);
};

/**
 * Rewrites the head tags of the built shell for one crawler-facing page.
 * `ogType` is `article` for a single market, `website` for a topic page.
 */
const renderShell = ({
	shell,
	titleText,
	descriptionText,
	canonicalUrl,
	ogType
}: {
	shell: string;
	titleText: string;
	descriptionText: string;
	canonicalUrl: string;
	ogType: 'article' | 'website';
}): string => {
	const safeTitle = escapeHtml(collapseWhitespace(titleText));
	const safeDescription = escapeHtml(descriptionText);
	const fullTitle = `${safeTitle}${TITLE_SUFFIX}`;

	// Bounded patterns only: `[^<]` / `[^>]` cannot cross a tag boundary, so
	// a stray mention of a tag elsewhere in the shell (e.g. inside a comment)
	// can never make a pattern swallow neighbouring head tags.
	const replacements: { pattern: RegExp; replacement: string; label: string }[] = [
		{
			pattern: /<title>[^<]*<\/title>/,
			replacement: `<title>${fullTitle}</title>`,
			label: 'title tag'
		},
		{
			pattern: /<meta\s+name="description"[^>]*>/,
			replacement: `<meta name="description" content="${safeDescription}" />`,
			label: 'description meta'
		},
		{
			pattern: /<link\s+rel="canonical"[^>]*>/,
			replacement: `<link rel="canonical" href="${canonicalUrl}" />`,
			label: 'canonical link'
		},
		{
			pattern: /<meta\s+property="og:type"[^>]*>/,
			replacement: `<meta property="og:type" content="${ogType}" />`,
			label: 'og:type'
		},
		{
			pattern: /<meta\s+property="og:url"[^>]*>/,
			replacement: `<meta property="og:url" content="${canonicalUrl}" />`,
			label: 'og:url'
		},
		{
			pattern: /<meta\s+property="og:title"[^>]*>/,
			replacement: `<meta property="og:title" content="${fullTitle}" />`,
			label: 'og:title'
		},
		{
			pattern: /<meta\s+property="og:description"[^>]*>/,
			replacement: `<meta property="og:description" content="${safeDescription}" />`,
			label: 'og:description'
		},
		{
			pattern: /<meta\s+name="twitter:title"[^>]*>/,
			replacement: `<meta name="twitter:title" content="${fullTitle}" />`,
			label: 'twitter:title'
		},
		{
			pattern: /<meta\s+name="twitter:description"[^>]*>/,
			replacement: `<meta name="twitter:description" content="${safeDescription}" />`,
			label: 'twitter:description'
		}
	];

	return replacements.reduce(
		(html, { pattern, replacement, label }) => replaceOnce({ html, pattern, replacement, label }),
		shell
	);
};

// Series ids and share params are used as path segments under `build/`: a
// separator, a `..` or any other unexpected character in one could make
// `join` escape the build directory or collide with another generated page.
// `~` is the slug/id separator of `marketShareParam`.
const SAFE_ID_PATTERN = /^[A-Za-z0-9_-]+$/;
const SAFE_SHARE_PARAM_PATTERN = /^[A-Za-z0-9_~-]+$/;

/**
 * Appends the per-page extras (JSON-LD, and for markets the `__viciSeriesId`
 * hint) just before `</head>`. Each fragment keeps `</head>` intact so the
 * single-match contract holds if this is chained.
 */
const injectHeadExtras = ({ html, fragments }: { html: string; fragments: string[] }): string =>
	replaceOnce({
		html,
		pattern: /<\/head>/,
		replacement: `${fragments.join('\n\t\t')}</head>`,
		label: 'head close tag'
	});

const writePage = ({ relativeDir, html }: { relativeDir: string; html: string }) => {
	const dir = join(BUILD_DIR, relativeDir);

	mkdirSync(dir, { recursive: true });
	writeFileSync(join(dir, 'index.html'), html, 'utf8');
};

const renderSitemap = ({ paths, lastmod }: { paths: string[]; lastmod: string }): string => {
	const staticPaths = ['/', '/about', '/welcome'];

	const urls = [...staticPaths, ...paths]
		.map(
			(path) =>
				`\t<url><loc>${escapeHtml(`${PROD_ORIGIN}${path}`)}</loc><lastmod>${lastmod}</lastmod></url>`
		)
		.join('\n');

	return `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${urls}\n</urlset>\n`;
};

const buildMarketJsonLd = ({
	title,
	headline,
	descriptionText,
	canonicalUrl,
	resolution
}: {
	title: string;
	headline: string;
	descriptionText: string;
	canonicalUrl: string;
	resolution: Resolution;
}): string =>
	jsonLdScript({
		'@context': 'https://schema.org',
		'@graph': [
			{
				'@type': 'WebPage',
				'@id': `${canonicalUrl}#webpage`,
				url: canonicalUrl,
				name: `${collapseWhitespace(headline)}${TITLE_SUFFIX}`,
				description: descriptionText,
				isPartOf: { '@id': `${PROD_ORIGIN}/#website` },
				// Resolved pages compete for result queries ("who won…"), open ones
				// for forecast queries; the keyword set follows the intent.
				keywords: resolution.resolved
					? `prediction market, ${collapseWhitespace(title)}, result, resolved, outcome`
					: `prediction market, ${collapseWhitespace(title)}, community odds, forecast`
			},
			{
				'@type': 'BreadcrumbList',
				itemListElement: [
					{ '@type': 'ListItem', position: 1, name: 'VICI', item: `${PROD_ORIGIN}/` },
					{ '@type': 'ListItem', position: 2, name: collapseWhitespace(title), item: canonicalUrl }
				]
			}
		]
	});

const main = async () => {
	// E2E runs deploy against the emulator satellite: no mainnet registry
	// there, and no crawler either.
	if (process.env.JUNO_EMULATOR === 'true') {
		console.log('[seo-assets] JUNO_EMULATOR=true: skipping SEO asset generation.');

		return;
	}

	const shell = readFileSync(join(BUILD_DIR, 'index.html'), 'utf8');

	// Clearing's settlement queries reject the anonymous principal (IC0406,
	// "Anonymous caller not authorised") while accepting ANY authenticated
	// one: the guard is a spam gate, not an authorisation check, and every
	// endpoint read here is public information. So the deploy signs with a
	// throwaway keypair rather than a managed key: nothing to store, nothing
	// to rotate, no privileged principal in CI.
	//
	// One signed agent serves every actor below. The registry reads and the
	// odds read do not *require* an identity, but signing them costs nothing
	// (they stay query calls) and a second anonymous agent would buy only the
	// chance of the two drifting apart.
	const agent = await HttpAgent.create({ host: IC_HOST, identity: Ed25519KeyIdentity.generate() });
	const registry = Actor.createActor<RegistryService>(registryIdlFactory, {
		agent,
		canisterId: REGISTRY_CANISTER_ID
	});
	const clearing = Actor.createActor<ClearingService>(clearingIdlFactory, {
		agent,
		canisterId: CLEARING_CANISTER_ID
	});

	const series = await listAllSeries(registry);
	const viciSeries = series.filter((s) => fromNullable(s.engine_id) === ENGINE_ID);

	const nowMs = Date.now();
	const visible = viciSeries.filter((s) => {
		const startNs = fromNullable(s.start_ns);
		const startDate = nonNullish(startNs) ? startNs / MILLISECOND_IN_NANOSECONDS : undefined;

		return isMarketRevealed({ startDate, now: nowMs });
	});

	if (visible.length === 0) {
		throw new Error(
			`No visible markets found (fetched ${series.length} series, ${viciSeries.length} for engine ${ENGINE_ID}): refusing to emit an empty SEO surface.`
		);
	}

	// Resolution first: it decides which per-market read is worth making. A
	// settled market's book is empty, so the odds call would spend a round trip
	// to return `undefined`; ask for its outcome instead.
	const settledIds = await listSettledSeriesIds(clearing);

	const resolutionByIndex = await mapWithConcurrency<Series, Resolution>({
		items: visible,
		limit: ODDS_CONCURRENCY,
		fn: async (market) =>
			settledIds.has(market.series_id)
				? {
						resolved: true,
						outcome: await fetchSettlementOutcome({ clearing, seriesId: market.series_id })
					}
				: {
						resolved: false,
						yesProbability: await fetchYesProbability({ clearing, seriesId: market.series_id })
					}
	});

	const sitemapPaths: string[] = [];

	visible.forEach((market, index) => {
		const id = market.series_id;

		if (!SAFE_ID_PATTERN.test(id)) {
			throw new Error(`Refusing to use series id as a path segment: ${JSON.stringify(id)}`);
		}

		const shareParam = marketShareParam({ title: market.title, seriesId: id });

		if (!SAFE_SHARE_PARAM_PATTERN.test(shareParam)) {
			throw new Error(
				`Refusing to use share param as a path segment: ${JSON.stringify(shareParam)}`
			);
		}

		// The slugged share URL is the sole emitted page and the canonical: it
		// is what the share sheet hands out, the only variant whose URL
		// carries the question's keywords, and the only URL the sitemap lists.
		const canonicalUrl = `${PROD_ORIGIN}/m/${shareParam}`;
		const resolution = resolutionByIndex[index];
		const descriptionText = composeDescription({
			plain: market.description.plain,
			resolution
		});
		const headline = composeHeadline({ title: market.title, resolution });

		const withHead = renderShell({
			shell,
			titleText: headline,
			descriptionText,
			canonicalUrl,
			ogType: 'article'
		});
		const html = injectHeadExtras({
			html: withHead,
			fragments: [
				`<script>window.__viciSeriesId = ${JSON.stringify(id)};</script>`,
				buildMarketJsonLd({
					title: market.title,
					headline,
					descriptionText,
					canonicalUrl,
					resolution
				})
			]
		});

		writePage({ relativeDir: join('m', shareParam), html });
		sitemapPaths.push(`/m/${shareParam}`);
	});

	const lastmod = new Date(nowMs).toISOString().slice(0, 10);
	writeFileSync(
		join(BUILD_DIR, 'sitemap.xml'),
		renderSitemap({ paths: [...sitemapPaths].sort(), lastmod }),
		'utf8'
	);

	const hidden = viciSeries.length - visible.length;
	const resolved = resolutionByIndex.filter((r) => r.resolved).length;
	const unlabelled = resolutionByIndex.filter((r) => r.resolved && isNullish(r.outcome)).length;

	console.log(
		`[seo-assets] ${visible.length} market pages (${resolved} resolved, ${unlabelled} without a named outcome) + sitemap.xml written; ${hidden} unrevealed markets withheld; ${series.length - viciSeries.length} non-${ENGINE_ID} series ignored.`
	);
};

await main();
