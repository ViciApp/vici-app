import config from '#root/juno.config.ts';
import { isNullish } from '@dfinity/utils';
import assert from 'node:assert/strict';
import { afterEach, describe, it } from 'node:test';

const MODES = ['production', 'development'] as const;

const withShutdown = (value: string | undefined) => {
	if (isNullish(value)) {
		delete process.env.VITE_LEGACY_SHUTDOWN;

		return;
	}

	process.env.VITE_LEGACY_SHUTDOWN = value;
};

describe('juno.config.ts legacy shutdown', () => {
	const initial = process.env.VITE_LEGACY_SHUTDOWN;

	afterEach(() => withShutdown(initial));

	it('keeps Google sign-in and no allowlist without the flag', () => {
		withShutdown(undefined);

		for (const mode of MODES) {
			const { authentication } = config({ mode }).satellite;

			assert.ok(authentication?.google?.clientId, mode);
			assert.equal(authentication?.rules, undefined, mode);
		}
	});

	it('drops Google and allows only the satellite ids with the flag', () => {
		withShutdown('true');

		for (const mode of MODES) {
			const { authentication, ids } = config({ mode }).satellite;

			assert.equal(authentication?.google, undefined, mode);
			assert.deepEqual(authentication?.rules?.allowedCallers, Object.values(ids ?? {}), mode);
			assert.ok((authentication?.rules?.allowedCallers ?? []).length > 0, mode);
		}
	});

	it('write-freezes every collection with the flag', () => {
		withShutdown('true');

		const { datastore = [], storage = [] } =
			config({ mode: 'production' }).satellite.collections ?? {};

		for (const { collection, write } of [...datastore, ...storage]) {
			assert.equal(write, 'controllers', collection);
		}
	});
});
