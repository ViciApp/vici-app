/**
 * Disallow hardcoded user-visible text inside `.svelte` files that have
 * already opted in to i18n (i.e. that import `#lib/utils/i18n.utils.ts`).
 *
 * Rationale
 * ---------
 * The repo has a typed i18n layer (`t({ locale, key, params })` from
 * `#lib/utils/i18n.utils.ts`). Once a component imports it, every other
 * user-visible string in that component should go through `t(...)` too
 * — otherwise it ships in English to every locale.
 *
 * We deliberately scope this rule to files that already import
 * `i18n.utils` so it doesn't drown the long tail of untranslated
 * components in noise. New components that opt in get full enforcement;
 * legacy ones can be paid down incrementally.
 *
 * See `docs/ai/frontend/i18n.md` for the full workflow.
 *
 * Heuristics
 * ----------
 * Inside `.svelte` files that import `i18n.utils`, walk the AST and flag
 * any `SvelteText` node whose trimmed value contains 4 or more
 * consecutive letters AFTER stripping known brand tokens. That catches
 * words and sentences while ignoring:
 *   - Whitespace / template indentation.
 *   - Numbers, punctuation, currency symbols, emoji.
 *   - Brand / token names declared exempt in `docs/ai/frontend/i18n.md`
 *     (`Vici`, `Bitcoin`, `Internet Computer`, `BTC`, `ICP`, `ckUSDC`,
 *     `ETH`, `USDC`, `ICRC`, version strings like `v0.0.7`).
 *   - Anything inside `<script>` / `<style>` blocks.
 *
 * "VICI · v0.0.7" → stripped to " · " → no match. ✓
 * "| Vici Social Markets" → stripped to "| Social Markets" → "Social"
 *     still matches → flagged. ✓ (Brand + non-brand mix should be
 *     extracted into a `{brand}` interpolation.)
 *
 * Attribute literals (`aria-label="Close"`) are intentionally NOT
 * flagged by this rule — they live in a different node type
 * (`SvelteLiteral`) and a per-attribute allowlist would be needed to
 * keep noise down. They're covered by code review and the i18n.md
 * checklist for now.
 */
'use strict';

// eslint-disable-next-line @typescript-eslint/no-require-imports
const { isNullish, nonNullish } = require('@dfinity/utils');

const I18N_UTILS_PATH = '#lib/utils/i18n.utils.ts';
const LETTER_RUN = /[A-Za-zÀ-ÖØ-öø-ÿ]{4,}/;
const SKIP_PARENT_TYPES = new Set(['SvelteScriptElement', 'SvelteStyleElement']);

// Brand / token names that `docs/ai/frontend/i18n.md` declares exempt
// from translation. Matched case-insensitively as whole words, then
// stripped before the letter-run check so a literal like "Vici." or
// "VICI · v0.0.7" no longer fires the rule.
//
// Multi-word entries (e.g. `Internet Computer`) must come before any
// of their prefixes (`Internet`) when both are listed — the longest
// match wins because `BRAND_TOKENS_RE` is built as a single alternation
// and ordered explicitly here.
const BRAND_TOKENS = [
	'Internet Computer',
	'Bitcoin',
	'ckUSDC',
	'USDC',
	'BTC',
	'ETH',
	'ICP',
	'ICRC',
	'VICI',
	'Vici',
	'VXP'
];

const BRAND_TOKENS_RE = new RegExp(
	`\\b(?:${BRAND_TOKENS.map((token) => token.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('|')})\\b`,
	'gi'
);

// Version-like fragments (`v0.0.7`, `v1.2.3-beta`). Code-shaped, not
// user copy — strip alongside brand tokens.
const VERSION_RE = /\bv\d+(?:\.\d+){1,3}(?:[-+][A-Za-z0-9.]+)?\b/g;

const stripExemptTokens = (text) => text.replace(BRAND_TOKENS_RE, '').replace(VERSION_RE, '');

const walkSvelteText = ({ ast, onMatch }) => {
	const visit = ({ node, ancestors }) => {
		if (isNullish(node) || typeof node !== 'object' || typeof node.type !== 'string') {
			return;
		}

		if (ancestors.some((ancestor) => SKIP_PARENT_TYPES.has(ancestor.type))) {
			return;
		}

		if (node.type === 'SvelteText') {
			const raw = typeof node.value === 'string' ? node.value : '';
			const stripped = stripExemptTokens(raw);

			if (stripped.trim().length > 0 && LETTER_RUN.test(stripped)) {
				onMatch({ node, raw });
			}

			return;
		}

		const nextAncestors = ancestors.concat(node);
		const childKeys = Object.keys(node).filter(
			(key) => key !== 'parent' && key !== 'loc' && key !== 'range'
		);

		for (const key of childKeys) {
			const child = node[key];

			if (Array.isArray(child)) {
				for (const item of child) {
					visit({ node: item, ancestors: nextAncestors });
				}
			} else if (nonNullish(child) && typeof child === 'object' && typeof child.type === 'string') {
				visit({ node: child, ancestors: nextAncestors });
			}
		}
	};

	visit({ node: ast, ancestors: [] });
};

module.exports = {
	meta: {
		type: 'suggestion',
		docs: {
			description:
				'Disallow hardcoded user-visible text in .svelte files that already import #lib/utils/i18n.utils.ts.',
			category: 'i18n',
			recommended: false
		},
		messages: {
			bareText:
				'Hardcoded text "{{snippet}}" — route it through t({ locale: $localeStore, key }) from #lib/utils/i18n.utils.ts, and add the key to every catalog under src/lib/constants/messages/. See docs/ai/frontend/i18n.md.'
		},
		schema: []
	},

	create: (context) => {
		const filename =
			typeof context.filename === 'string'
				? context.filename
				: typeof context.getFilename === 'function'
					? context.getFilename()
					: '';

		if (!filename.endsWith('.svelte')) {
			return {};
		}

		let importsI18n = false;

		return {
			ImportDeclaration: (node) => {
				if (node.source && node.source.value === I18N_UTILS_PATH) {
					importsI18n = true;
				}
			},

			'Program:exit': () => {
				if (!importsI18n) {
					return;
				}

				const sourceCode =
					context.sourceCode ??
					(typeof context.getSourceCode === 'function' ? context.getSourceCode() : null);

				if (isNullish(sourceCode)) {
					return;
				}

				walkSvelteText({
					ast: sourceCode.ast,
					onMatch: ({ node, raw }) => {
						const trimmed = raw.trim();
						const snippet = trimmed.length > 60 ? `${trimmed.slice(0, 60)}…` : trimmed;

						context.report({
							node,
							messageId: 'bareText',
							data: { snippet }
						});
					}
				});
			}
		};
	}
};
