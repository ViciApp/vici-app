import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { describe, it } from 'node:test';

// These stores import services that load SvelteKit modules, which this runner
// cannot load, so the spec reads their source: a refresh started for one
// account must not commit after the auth transition cleared the cache, so
// each refresh runs under the shared load epoch its clear invalidates.
const sourceOf = (file: string): string =>
	readFileSync(new URL(`../../../lib/stores/${file}`, import.meta.url), 'utf8');

const STORES = [
	{ file: 'friends.store.ts', clear: 'clearFriendRelations' },
	{ file: 'leagues.store.ts', clear: 'clearLeagues' },
	{ file: 'affiliations.store.ts', clear: 'clearAffiliations' },
	{ file: 'referrals.store.ts', clear: 'clearMyReferrals' }
];

/** The body of `export const <name> = ...`, up to its closing brace. */
const bodyOf = ({ source, name }: { source: string; name: string }): string => {
	const start = source.indexOf(`export const ${name} = `);

	assert.notEqual(start, -1, `${name} is exported`);

	return source.slice(start, source.indexOf('\n};', start));
};

describe('user-scoped store refresh', () => {
	for (const { file, clear } of STORES) {
		describe(file, () => {
			const source = sourceOf(file);

			it('runs its refresh under a load epoch', () => {
				assert.ok(source.includes('createLoadEpoch()'));
				assert.ok(source.includes('epoch.start()'));
			});

			it(`invalidates in-flight refreshes in ${clear}`, () => {
				assert.ok(bodyOf({ source, name: clear }).includes('epoch.invalidate()'));
			});
		});
	}

	it('keeps the cached friend lists when a fetch fails', () => {
		assert.ok(!sourceOf('friends.store.ts').includes('.catch(() => [])'));
	});
});
