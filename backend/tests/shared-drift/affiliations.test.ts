import { describe, expect, test } from 'bun:test';
import { AFFILIATION_KINDS } from '../../src/worlds/affiliations';
import { extractBlock, quotedStrings, readRepoSource } from '../helpers/repo-source';

// The app module value-imports a time constant, so its kind list is pinned by
// static extraction.
describe('shared drift: affiliation kinds', () => {
	test('backend AFFILIATION_KINDS matches the app list', () => {
		const app = quotedStrings(
			extractBlock({
				source: readRepoSource('src/lib/types/affiliation.ts'),
				marker: 'export const AFFILIATION_KINDS'
			})
		);

		const backend: string[] = [...AFFILIATION_KINDS];

		expect(backend).toEqual(app);
	});
});
