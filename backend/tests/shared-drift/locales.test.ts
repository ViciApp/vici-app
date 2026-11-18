import { describe, expect, test } from 'bun:test';
import { REGISTERED_LOCALE_IDS } from '../../src/markets/locales';
import { importRepoModule } from '../helpers/repo-source';

// locale.constants.ts has no value imports, so the real module is loaded and
// the derived REGISTERED_LOCALE_IDS is compared as-is (registry order counts:
// detection walks it in order).
describe('shared drift: locales', () => {
	test('backend REGISTERED_LOCALE_IDS matches the app locale registry', async () => {
		const app = await importRepoModule<{ REGISTERED_LOCALE_IDS: readonly string[] }>(
			'src/lib/constants/locale.constants.ts'
		);

		const backend: string[] = [...REGISTERED_LOCALE_IDS];

		expect(backend).toEqual([...app.REGISTERED_LOCALE_IDS]);
	});
});
