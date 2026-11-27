import { rewriteShellHead, type ShellHead } from '#lib/utils/shell-head.utils.ts';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { describe, it } from 'node:test';

// The real shell source: the rewrite is a contract with its head tags, so a
// tag renamed there must fail here before it fails an image build.
const SHELL = readFileSync(new URL('../../../app.html', import.meta.url), 'utf8');

const SOURCE_ORIGIN = 'https://vici.market';

const HEAD: ShellHead = {
	origin: 'https://vici.app',
	title: 'VICI: The social prediction market',
	description: 'Call what happens next, at a "live" price.',
	shareTitle: 'VICI. Call it.',
	shareImage: { path: '/branding/landing-share.jpg', width: 1200, height: 630, type: 'image/jpeg' }
};

const rewrite = (shell: string = SHELL): string =>
	rewriteShellHead({ shell, sourceOrigin: SOURCE_ORIGIN, head: HEAD });

describe('shell-head.utils', () => {
	it('points the address tags at the new origin', () => {
		const html = rewrite();

		assert.match(html, /<link rel="canonical" href="https:\/\/vici\.app\/" \/>/);
		assert.match(html, /<meta property="og:url" content="https:\/\/vici\.app\/" \/>/);
	});

	it('writes the title, the description and the link-preview headline', () => {
		const html = rewrite();

		assert.match(html, /<title>VICI: The social prediction market<\/title>/);
		assert.match(
			html,
			/<meta name="description" content="Call what happens next, at a &quot;live&quot; price\." \/>/
		);
		assert.match(html, /<meta property="og:title" content="VICI\. Call it\." \/>/);
		assert.match(html, /<meta name="twitter:title" content="VICI\. Call it\." \/>/);
	});

	it('swaps every link-preview image tag, with its size and type', () => {
		const html = rewrite();
		const image = 'https://vici.app/branding/landing-share.jpg';

		assert.ok(html.includes(`<meta property="og:image" content="${image}" />`));
		assert.ok(html.includes(`<meta property="og:image:secure_url" content="${image}" />`));
		assert.ok(html.includes(`<meta name="twitter:image" content="${image}" />`));
		assert.ok(html.includes('<meta property="og:image:width" content="1200" />'));
		assert.ok(html.includes('<meta property="og:image:height" content="630" />'));
		assert.ok(html.includes('<meta property="og:image:type" content="image/jpeg" />'));
	});

	it('leaves no tag naming the source origin', () => {
		const html = rewrite();
		const head = html.slice(0, html.indexOf('</head>'));
		const tags = head.match(
			/<(?:meta|link)\s[^>]*>|<script type="application\/ld\+json">[^<]*<\/script>/g
		);

		const origins = (tags ?? [])
			.flatMap((tag) => tag.match(/https?:\/\/[^\s"'<>]+/g) ?? [])
			.map((url) => new URL(url).origin);

		assert.ok(origins.length > 0);
		assert.deepEqual(
			origins.filter((origin) => origin === new URL(SOURCE_ORIGIN).origin),
			[]
		);
	});

	it('changes nothing outside the tags it names', () => {
		const html = rewrite();

		assert.equal(html.slice(html.indexOf('</head>')), SHELL.slice(SHELL.indexOf('</head>')));
	});

	it('is the same when run twice', () => {
		const once = rewrite();

		assert.equal(rewrite(once), once);
	});

	it('throws when a tag it rewrites is missing', () => {
		assert.throws(
			() => rewrite(SHELL.replace(/<link\s+rel="canonical"[^>]*>/, '')),
			/canonical link matched 0 times/
		);
	});
});
