#!/usr/bin/env node
/**
 * Verify the locale catalogs under `src/lib/constants/messages/` against
 * `en.ts` (the source of truth), with strictness driven by each locale's
 * registered `tier` in `locale.constants.ts`:
 *
 * - `live`: must exist and expose exactly the `en` key set (no missing,
 *   no extra). This is the original behaviour.
 * - `soon`: may be absent (no catalog file at all) or partial (a subset of
 *   `en` keys). Missing keys resolve through the locale's fallback chain to
 *   English at runtime, so a partial catalog is valid. Only `extra` keys
 *   (keys not present in `en`) are flagged.
 *
 * Exits non-zero on any drift, with a per-locale report. Wired into
 * `npm run check:i18n` and `npm run lint`.
 *
 * See `docs/ai/frontend/i18n.md`.
 */
import { isNullish, nonNullish } from '@dfinity/utils';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const messagesDir = path.resolve(scriptDir, '../src/lib/constants/messages');
const localeConstantsPath = path.resolve(scriptDir, '../src/lib/constants/locale.constants.ts');

/**
 * Extract all `'key': ...` entries from a catalog TS file. The catalogs
 * are mechanical exports (`export const xxMessages = { 'a': '...', ... }
 * as const;`) so a regex on the source is robust enough, and avoids
 * pulling in a TS loader just for this check.
 *
 * @param {string} filePath
 * @returns {Set<string>}
 */
const extractKeys = (filePath) => {
	const source = fs.readFileSync(filePath, 'utf8');
	const keys = new Set();
	const re = /^[\s]*'((?:\\'|[^'])+)'\s*:/gm;
	let match;

	while (nonNullish((match = re.exec(source)))) {
		keys.add(match[1]);
	}

	return keys;
};

/**
 * Read `LOCALE_REGISTRY` from `locale.constants.ts` so the script stays in
 * lock-step with the registry without hand-maintaining a list. Returns each
 * locale's `id` paired with its `tier`, which drives how strictly its catalog
 * is checked.
 *
 * @returns {{ id: string, tier: string }[]}
 */
const readRegistry = () => {
	const source = fs.readFileSync(localeConstantsPath, 'utf8');
	const block = source.match(/LOCALE_REGISTRY[\s\S]*?\[([\s\S]*?)\]\s*as const/);

	if (isNullish(block)) {
		throw new Error(
			`Could not parse LOCALE_REGISTRY in ${path.relative(process.cwd(), localeConstantsPath)}`
		);
	}

	const locales = [];
	// Each entry spans multiple lines; capture the `id` and the `tier` that
	// belongs to the same object literal. `tier` always follows `id` within
	// an entry, so a non-greedy span between them is unambiguous.
	const re = /id:\s*'([^']+)'[\s\S]*?tier:\s*'([^']+)'/g;
	let match;

	while (nonNullish((match = re.exec(block[1])))) {
		locales.push({ id: match[1], tier: match[2] });
	}

	if (locales.length === 0) {
		throw new Error('LOCALE_REGISTRY is empty: nothing to check.');
	}

	return locales;
};

const main = () => {
	const registry = readRegistry();
	const baseLocale = 'en';

	if (!registry.some(({ id }) => id === baseLocale)) {
		console.error(`Source-of-truth locale '${baseLocale}' is not in LOCALE_REGISTRY.`);
		process.exit(1);
	}

	const baseFile = path.join(messagesDir, `${baseLocale}.ts`);

	if (!fs.existsSync(baseFile)) {
		console.error(`Missing base catalog: ${path.relative(process.cwd(), baseFile)}`);
		process.exit(1);
	}

	const baseKeys = extractKeys(baseFile);
	const failures = [];
	const otherLocales = registry.filter(({ id }) => id !== baseLocale);
	let liveChecked = 0;

	for (const { id: locale, tier } of otherLocales) {
		const catalogPath = path.join(messagesDir, `${locale}.ts`);
		const hasCatalog = fs.existsSync(catalogPath);
		const localeKeys = hasCatalog ? extractKeys(catalogPath) : new Set();
		const missing = [...baseKeys].filter((key) => !localeKeys.has(key));
		const extra = [...localeKeys].filter((key) => !baseKeys.has(key));

		if (tier !== 'live' && tier !== 'soon') {
			console.error(
				`✗ ${locale}: unknown tier '${tier}' in LOCALE_REGISTRY (expected 'live' or 'soon').`
			);
			process.exit(1);
		}

		if (tier === 'soon') {
			// `soon` locales fall back to English: an absent catalog is fine, and
			// a partial one (missing some `en` keys) is fine too. We still reject
			// `extra` keys: a key not in `en` can never resolve through fallback.
			if (hasCatalog && extra.length > 0) {
				failures.push({ locale, tier, missing: [], extra, status: 'extra-keys' });
			}
		} else {
			// `live` locales must exist and align exactly with `en`.
			liveChecked += 1;

			if (!hasCatalog) {
				failures.push({ locale, tier, missing: [...baseKeys], extra: [], status: 'absent' });
			} else if (missing.length > 0 || extra.length > 0) {
				failures.push({ locale, tier, missing, extra, status: 'drift' });
			}
		}
	}

	if (failures.length === 0) {
		console.log(
			`✓ i18n catalogs aligned across ${liveChecked + 1} live locales (${baseKeys.size} keys); soon locales fall back to English.`
		);
		process.exit(0);
	}

	console.error('✗ i18n catalog drift detected.\n');

	for (const { locale, tier, missing, extra, status } of failures) {
		if (status === 'absent') {
			console.error(`  [${locale}] (${tier}) catalog file is missing.`);
		} else {
			console.error(`  [${locale}] (${tier})`);

			if (missing.length > 0) {
				console.error(`    missing (${missing.length}):`);

				for (const key of missing) {
					console.error(`      - ${key}`);
				}
			}

			if (extra.length > 0) {
				console.error(`    extra (${extra.length}):`);

				for (const key of extra) {
					console.error(`      + ${key}`);
				}
			}
		}
	}

	console.error(
		'\nFix: live locales must mirror en.ts exactly; soon locales may be absent or partial but must not add keys missing from en.'
	);
	console.error('See docs/ai/frontend/i18n.md.');
	process.exit(1);
};

main();
