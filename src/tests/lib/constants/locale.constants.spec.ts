import {
	isRegisteredLocale,
	LOCALE_REGISTRY,
	SUPPORTED_LOCALES
} from '#lib/constants/locale.constants.ts';
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

describe('isRegisteredLocale', () => {
	it('accepts every registered locale, live and soon', () => {
		for (const { id } of LOCALE_REGISTRY) {
			assert.equal(isRegisteredLocale(id), true, id);
		}

		assert.ok(LOCALE_REGISTRY.length > SUPPORTED_LOCALES.length);
	});

	it('rejects unknown ids, case variants and non-strings', () => {
		for (const value of ['', 'xx', 'EN', 'pt-br', ' en', null, undefined, 1, {}, ['en']]) {
			assert.equal(isRegisteredLocale(value), false, String(value));
		}
	});
});
