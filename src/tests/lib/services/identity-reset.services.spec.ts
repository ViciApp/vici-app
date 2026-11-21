import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { describe, it } from 'node:test';

// The reset imports stores that load SvelteKit modules, which this runner
// cannot load, so the spec reads the source: the wallet figures one account
// loaded must be dropped on every auth transition, or the next account sees
// them (and persists them as its own holdings snapshot) until its load lands.
const source = readFileSync(
	new URL('../../../lib/services/identity-reset.services.ts', import.meta.url),
	'utf8'
);

describe('resetIdentityScopedState', () => {
	for (const store of ['balancesStore', 'collateralsStore', 'ordersStore']) {
		it(`drops ${store}`, () => {
			assert.ok(source.includes(`\t${store}.set(undefined);`));
		});
	}
});
