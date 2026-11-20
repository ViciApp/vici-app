import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { describe, it } from 'node:test';

// The service imports SvelteKit modules, which this runner cannot load, so the
// spec reads its source: a web2 profile PUT writes the whole doc onto whichever
// account the session cookie belongs to, so every PUT confirms that account
// first and a patch is built from the session's own row.
const source = readFileSync(
	new URL('../../../lib/services/profile.services.ts', import.meta.url),
	'utf8'
);

/** The body of `const <name> = ...` (exported or not), up to its closing brace. */
const bodyOf = (name: string): string => {
	const start = source.search(new RegExp(`(export )?const ${name} = `));

	assert.notEqual(start, -1, `${name} is declared`);

	return source.slice(start, source.indexOf('\n};', start));
};

describe('profile.services web2 writes', () => {
	it('builds a patch on the session own row, not the public read', () => {
		const body = bodyOf('patchProfile');

		assert.ok(body.includes('await getMyProfileWeb2()'));
		assert.ok(!/=\s*await getProfile\(principal\);/.test(body));
	});

	for (const writer of ['upsertProfile', 'saveMyEmail']) {
		it(`${writer} confirms the session account before the PUT`, () => {
			const body = bodyOf(writer);
			const guard = body.indexOf('await assertWeb2SessionOwner(');

			assert.notEqual(guard, -1);
			assert.ok(guard < body.indexOf('await upsertMyProfileWeb2('));
		});
	}
});
