import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { describe, it } from 'node:test';

// The inbox store imports SvelteKit modules, which this runner cannot load,
// so the spec reads its source: a session account switch keeps the tab alive, so
// every store loaded from localStorage at import must be re-read when the
// owner changes, or the previous account's read / dismissed ids are written
// back under the next account.
const source = readFileSync(new URL('../../../lib/stores/inbox.store.ts', import.meta.url), 'utf8');

/** The body of `const <name> = ...`, up to its closing brace. */
const bodyOf = (name: string): string => {
	const start = source.search(new RegExp(`(export )?const ${name} = `));

	assert.notEqual(start, -1, `${name} is declared`);

	return source.slice(start, source.indexOf('\n};', start));
};

// Every module-scope store seeded from a persisted loader, e.g.
// `const inboxReadStore = writable<Set<string>>(loadStringSet(KEY));`.
const PERSISTED_STORES = Array.from(
	source.matchAll(/^const (\w+) = writable<.+?>\((load\w+\([^)]*\))\);$/gm),
	([, store, load]) => ({ store, load })
);

describe('inbox.store', () => {
	it('finds the persisted stores', () => {
		assert.deepEqual(
			PERSISTED_STORES.map(({ store }) => store),
			['settledReadStore', 'inboxReadStore', 'inboxDismissedStore', 'inboxProgressStore']
		);
	});

	describe('reloadPersistedInboxState', () => {
		const body = bodyOf('reloadPersistedInboxState');

		for (const { store, load } of PERSISTED_STORES) {
			it(`re-reads ${store}`, () => {
				assert.ok(body.includes(`${store}.set(${load});`));
			});
		}
	});

	describe('initInboxProgress', () => {
		it('reloads the persisted state when the owner changes', () => {
			const body = bodyOf('initInboxProgress');
			const branch = body.indexOf('if (owner !== lastOwner) {');

			assert.notEqual(branch, -1, 'initInboxProgress tracks the owner');

			const ownerChange = body.slice(branch);

			assert.ok(
				ownerChange
					.slice(0, ownerChange.indexOf('\n\t\t}'))
					.includes('reloadPersistedInboxState();')
			);
		});
	});
});
