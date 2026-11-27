import { describe, expect, test } from 'bun:test';
import { SCHOOL_DIRECTORY } from '../../src/school/directory';
import { extractRegexLiteral, importRepoModule, readRepoSource } from '../helpers/repo-source';

// The API verifies a school email against its own copy of the app's Worlds
// university roster and picker matcher: a school or domain added on one side
// only would let the picker offer an address the API then refuses. The roster
// module has type imports only, so it is imported; the matcher value-imports
// an SDK helper, so its pieces are pinned by static extraction.

const APP_MATCHER = 'src/lib/utils/school-picker.utils.ts';
const API_MATCHER = 'backend/src/school/matching.ts';

interface AppUniversity {
	id: string;
	name: string;
	country?: string;
	domains?: readonly string[];
}

/** The `export const spNormalize` arrow up to its closing `;`, whitespace
 * collapsed: its body is one chain of literal replaces, so equal text is
 * equal behaviour. */
const normalizerText = (relPath: string): string => {
	const source = readRepoSource(relPath);
	const marker = 'export const spNormalize';
	const start = source.indexOf(marker);

	if (start < 0) {
		throw new Error(`marker not found in ${relPath}: ${marker}`);
	}

	return source
		.slice(start, source.indexOf(';', start) + 1)
		.replace(/\s+/g, ' ')
		.trim();
};

describe('shared drift: school directory and email matcher', () => {
	test('SCHOOL_DIRECTORY matches the app university roster', async () => {
		const { WORLDS_UNIVERSITIES } = await importRepoModule<{
			WORLDS_UNIVERSITIES: readonly AppUniversity[];
		}>('src/lib/constants/worlds-affiliations.constants.ts');

		const app = WORLDS_UNIVERSITIES.map(({ id, name, country, domains }) => ({
			id,
			name,
			country: country ?? null,
			domains: [...(domains ?? [])]
		}));

		expect(app.length).toBeGreaterThan(0);
		expect(SCHOOL_DIRECTORY).toEqual(app);
	});

	test('name normalizer matches the app', () => {
		expect(normalizerText(API_MATCHER)).toBe(normalizerText(APP_MATCHER));
	});

	for (const constName of ['SP_EMAIL_HOST_RE', 'SP_CONSUMER_DOMAINS']) {
		test(`${constName} matches the app`, () => {
			const api = extractRegexLiteral({ source: readRepoSource(API_MATCHER), constName });
			const app = extractRegexLiteral({ source: readRepoSource(APP_MATCHER), constName });

			expect({ source: api.source, flags: api.flags }).toEqual({
				source: app.source,
				flags: app.flags
			});
		});
	}
});
