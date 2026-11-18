import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { describe, it } from 'node:test';

// The component and the stores it resets import SvelteKit modules, which this
// runner cannot load, so the spec reads the component source: every auth
// transition, in both backend modes, must run the one identity reset, and the
// component must hold no reset of its own beside it.
const source = readFileSync(
	new URL('../../../../lib/components/authn/Authn.svelte', import.meta.url),
	'utf8'
);

const RESET_CALL = 'resetIdentityScopedState(';

/** The body of a top-level `const <name> = ...` arrow function: from its
 * declaration to the first closing brace at the script's base indentation. */
const functionBody = (name: string): string => {
	const start = source.indexOf(`\tconst ${name} = `);

	assert.notEqual(start, -1, `${name} is declared in Authn.svelte`);

	const end = source.indexOf('\n\t};', start);

	assert.notEqual(end, -1, `${name} has a closing brace`);

	return source.slice(start, end);
};

describe('Authn identity reset', () => {
	for (const transition of ['updateUserStore', 'hydrateWeb2AppShell', 'clearWeb2AppShell']) {
		it(`${transition} runs the identity reset`, () => {
			assert.ok(functionBody(transition).includes(RESET_CALL));
		});
	}

	it('keeps no per-store reset of its own beside the shared one', () => {
		for (const reset of [
			'clearFriendRelations',
			'clearAffiliations',
			'clearLeagues',
			'clearMyMenagerieSignals',
			'clearMyReferrals',
			'reconcileIdentityScopedStorage',
			'positionsStore',
			'tradeHistoryStore'
		]) {
			assert.ok(!source.includes(reset), `${reset} is reset only through ${RESET_CALL}`);
		}
	});
});
