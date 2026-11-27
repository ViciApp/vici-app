import { describe, expect, test } from 'bun:test';
import { WITHDRAWAL_TRANSITIONS } from '../../src/custody/withdrawals';
import { extractBlock, quotedStrings, readRepoSource } from '../helpers/repo-source';

// The app refuses a withdrawal row whose state it does not know, so a state
// added to the machine here without the app would fail every send that reaches
// it. The app schema module value-imports zod, so its list is pinned by static
// extraction.
describe('shared drift: withdrawal states', () => {
	test('the app withdrawal states match the backend state machine', () => {
		const app = quotedStrings(
			extractBlock({
				source: readRepoSource('src/lib/schema/web2-api.schema.ts'),
				marker: 'const WEB2_WITHDRAWAL_STATES'
			})
		);

		expect(Object.keys(WITHDRAWAL_TRANSITIONS)).toEqual(app);
	});
});
