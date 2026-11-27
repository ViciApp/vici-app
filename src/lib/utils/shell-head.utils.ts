/**
 * Head tags of the built app shell, rewritten for a deployment whose
 * address and link preview differ from the ones `src/app.html` carries. The
 * app is a static shell, so a crawler or a chat app's link preview reads
 * these tags and nothing the app renders later.
 */

export interface ShellHead {
	/** The deployment's origin, without a trailing slash. */
	origin: string;
	title: string;
	description: string;
	/** Headline of the link preview. */
	shareTitle: string;
	shareImage: { path: string; width: number; height: number; type: string };
}

const escapeHtml = (text: string): string =>
	text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

const metaProperty = (property: string): RegExp =>
	new RegExp(`<meta\\s+property="${property}"[^>]*>`);

const metaName = (name: string): RegExp => new RegExp(`<meta\\s+name="${name}"[^>]*>`);

const JSON_LD_PATTERN = /<script type="application\/ld\+json">[^<]*<\/script>/;

// A tag that is missing or doubled means the shell changed shape: the caller
// must fail its build rather than ship a half-rewritten head.
const replaceOnce = ({
	html,
	pattern,
	replacement,
	label
}: {
	html: string;
	pattern: RegExp;
	replacement: (match: string) => string;
	label: string;
}): string => {
	const matches = html.match(new RegExp(pattern, 'g'))?.length ?? 0;

	if (matches !== 1) {
		throw new Error(`Shell head contract broken: ${label} matched ${matches} times (expected 1)`);
	}

	return html.replace(pattern, replacement);
};

/**
 * `shell` with its title, description, canonical address, link-preview tags
 * and structured data pointing at `head`. `sourceOrigin` is the origin the
 * shell was written for. Throws when a tag it rewrites is not found exactly
 * once.
 */
export const rewriteShellHead = ({
	shell,
	sourceOrigin,
	head: { origin, title, description, shareTitle, shareImage }
}: {
	shell: string;
	sourceOrigin: string;
	head: ShellHead;
}): string => {
	const home = `${origin}/`;
	const image = `${origin}${shareImage.path}`;
	const safeTitle = escapeHtml(title);
	const safeDescription = escapeHtml(description);
	const safeShareTitle = escapeHtml(shareTitle);

	const tags: { pattern: RegExp; label: string; tag: string }[] = [
		{ pattern: /<title>[^<]*<\/title>/, label: 'title tag', tag: `<title>${safeTitle}</title>` },
		{
			pattern: metaName('description'),
			label: 'description meta',
			tag: `<meta name="description" content="${safeDescription}" />`
		},
		{
			pattern: /<link\s+rel="canonical"[^>]*>/,
			label: 'canonical link',
			tag: `<link rel="canonical" href="${home}" />`
		},
		{
			pattern: metaProperty('og:url'),
			label: 'og:url',
			tag: `<meta property="og:url" content="${home}" />`
		},
		{
			pattern: metaProperty('og:title'),
			label: 'og:title',
			tag: `<meta property="og:title" content="${safeShareTitle}" />`
		},
		{
			pattern: metaProperty('og:description'),
			label: 'og:description',
			tag: `<meta property="og:description" content="${safeDescription}" />`
		},
		{
			pattern: metaProperty('og:image'),
			label: 'og:image',
			tag: `<meta property="og:image" content="${image}" />`
		},
		{
			pattern: metaProperty('og:image:secure_url'),
			label: 'og:image:secure_url',
			tag: `<meta property="og:image:secure_url" content="${image}" />`
		},
		{
			pattern: metaProperty('og:image:width'),
			label: 'og:image:width',
			tag: `<meta property="og:image:width" content="${shareImage.width}" />`
		},
		{
			pattern: metaProperty('og:image:height'),
			label: 'og:image:height',
			tag: `<meta property="og:image:height" content="${shareImage.height}" />`
		},
		{
			pattern: metaProperty('og:image:type'),
			label: 'og:image:type',
			tag: `<meta property="og:image:type" content="${shareImage.type}" />`
		},
		{
			pattern: metaProperty('og:image:alt'),
			label: 'og:image:alt',
			tag: `<meta property="og:image:alt" content="${safeShareTitle}" />`
		},
		{
			pattern: metaName('twitter:title'),
			label: 'twitter:title',
			tag: `<meta name="twitter:title" content="${safeShareTitle}" />`
		},
		{
			pattern: metaName('twitter:description'),
			label: 'twitter:description',
			tag: `<meta name="twitter:description" content="${safeDescription}" />`
		},
		{
			pattern: metaName('twitter:image'),
			label: 'twitter:image',
			tag: `<meta name="twitter:image" content="${image}" />`
		},
		{
			pattern: metaName('twitter:image:alt'),
			label: 'twitter:image:alt',
			tag: `<meta name="twitter:image:alt" content="${safeShareTitle}" />`
		}
	];

	const retagged = tags.reduce(
		(html, { pattern, label, tag }) =>
			replaceOnce({ html, pattern, label, replacement: () => tag }),
		shell
	);

	return replaceOnce({
		html: retagged,
		pattern: JSON_LD_PATTERN,
		label: 'structured data',
		replacement: (block) => block.split(sourceOrigin).join(origin)
	});
};
