import { PRIVACY_POLICY_VERSION } from '#lib/constants/legal-docs.constants.ts';
import { WAITLIST_STATUS_STORAGE_KEY } from '#lib/constants/waitlist.constants.ts';
import {
	cachedHandle,
	confirm,
	requestCode,
	restore,
	waitlistErrorCode,
	waitlistUnavailable
} from '#lib/services/waitlist.services.ts';
import { landingClaimRefusalOf } from '#lib/utils/landing-claim.utils.ts';
import { Web2ApiError } from '#lib/web2/client.ts';
import { isNullish } from '@dfinity/utils';
import assert from 'node:assert/strict';
import { afterEach, beforeEach, describe, it, mock } from 'node:test';

interface Call {
	url: string;
	body: Record<string, unknown>;
}

const json = ({ status, body }: { status: number; body: unknown }): Response =>
	new Response(JSON.stringify(body), { status });

describe('waitlist.services', () => {
	const originalFetch = globalThis.fetch;
	const originalStorage = Object.getOwnPropertyDescriptor(globalThis, 'localStorage');
	const originalWarn = console.warn;

	let calls: Call[];
	let storage: Map<string, string>;

	const answerWith = (respond: (call: Call) => Response): void => {
		globalThis.fetch = (...[url, init]: Parameters<typeof fetch>): Promise<Response> => {
			const call = { url: String(url), body: JSON.parse(String(init?.body)) as Call['body'] };

			calls.push(call);

			return Promise.resolve(respond(call));
		};
	};

	beforeEach(() => {
		calls = [];
		storage = new Map();
		console.warn = mock.fn();
		Object.defineProperty(globalThis, 'localStorage', {
			configurable: true,
			value: {
				getItem: (key: string) => storage.get(key) ?? null,
				setItem: (...[key, value]: [string, string]) => storage.set(key, value),
				removeItem: (key: string) => storage.delete(key)
			}
		});
	});

	afterEach(() => {
		globalThis.fetch = originalFetch;
		console.warn = originalWarn;

		if (isNullish(originalStorage)) {
			Reflect.deleteProperty(globalThis, 'localStorage');
		} else {
			Object.defineProperty(globalThis, 'localStorage', originalStorage);
		}
	});

	describe('waitlistErrorCode', () => {
		it('passes the waitlist refusals through', () => {
			for (const [status, code] of [
				[409, 'handle_taken'],
				[400, 'handle_invalid'],
				[400, 'email_invalid'],
				[400, 'email_not_accepted'],
				[401, 'invalid_code'],
				[410, 'expired_code'],
				[429, 'rate_limited']
			] as const) {
				assert.equal(waitlistErrorCode(new Web2ApiError({ status, code })), code);
			}
		});

		it('reads every Turnstile refusal as a failed bot check', () => {
			for (const [status, code] of [
				[403, 'turnstile_failed'],
				[503, 'turnstile_unavailable'],
				[503, 'turnstile_unconfigured']
			] as const) {
				assert.equal(waitlistErrorCode(new Web2ApiError({ status, code })), 'bot_check_failed');
			}
		});

		it('reads a server error or a network failure as unavailable', () => {
			assert.equal(
				waitlistErrorCode(new Web2ApiError({ status: 500, code: 'internal' })),
				'unavailable'
			);
			assert.equal(waitlistErrorCode(new TypeError('fetch failed')), 'unavailable');
		});
	});

	describe('requestCode', () => {
		it('sends the handle, the address, the entry point, the policy shown and the language', async () => {
			answerWith(() => json({ status: 200, body: { ok: true, codeTtlMs: 600_000 } }));

			assert.deepEqual(
				await requestCode({
					handle: 'zeno',
					email: 'zeno@example.com',
					source: 'footer',
					locale: 'it',
					referralCode: 'ABCD1234'
				}),
				{ ok: true, codeTtlMs: 600_000 }
			);

			const [call] = calls;

			assert.match(call.url, /\/api\/v1\/waitlist\/code$/);
			assert.equal(call.body.handle, 'zeno');
			assert.equal(call.body.email, 'zeno@example.com');
			assert.equal(call.body.source, 'footer');
			assert.equal(call.body.privacyVersion, PRIVACY_POLICY_VERSION);
			assert.equal(call.body.locale, 'it');
			assert.equal(call.body.referralCode, 'ABCD1234');
			assert.equal(typeof call.body.turnstileToken, 'string');
		});

		it('answers the refusal code instead of throwing', async () => {
			answerWith(() => json({ status: 403, body: { error: 'turnstile_failed' } }));

			assert.deepEqual(
				await requestCode({
					handle: 'zeno',
					email: 'zeno@example.com',
					source: 'nav',
					locale: 'en',
					referralCode: undefined
				}),
				{ error: 'bot_check_failed' }
			);
		});
	});

	describe('confirm and restore', () => {
		it('keeps the status token, and restore reads the reservation back with it', async () => {
			answerWith(({ url }) =>
				url.endsWith('/confirm')
					? json({ status: 200, body: { handle: 'zeno', statusToken: 'tok' } })
					: json({ status: 200, body: { handle: 'zeno', state: 'waiting' } })
			);

			assert.deepEqual(await confirm({ email: 'zeno@example.com', code: '123456' }), {
				handle: 'zeno'
			});
			assert.equal(cachedHandle(), 'zeno');
			assert.deepEqual(await restore(), { handle: 'zeno', state: 'waiting' });
			assert.deepEqual(calls[1].body, { statusToken: 'tok' });
		});

		it('keeps nothing on a wrong code', async () => {
			answerWith(() => json({ status: 401, body: { error: 'invalid_code' } }));

			assert.deepEqual(await confirm({ email: 'zeno@example.com', code: '000000' }), {
				error: 'invalid_code'
			});
			assert.equal(storage.has(WAITLIST_STATUS_STORAGE_KEY), false);
		});

		it('clears the cache once the reservation is gone', async () => {
			storage.set(
				WAITLIST_STATUS_STORAGE_KEY,
				JSON.stringify({ handle: 'zeno', statusToken: 't' })
			);
			answerWith(() => json({ status: 404, body: { error: 'not_found' } }));

			assert.equal(await restore(), undefined);
			assert.equal(cachedHandle(), undefined);
		});

		it('keeps the cache when the server cannot be asked', async () => {
			storage.set(
				WAITLIST_STATUS_STORAGE_KEY,
				JSON.stringify({ handle: 'zeno', statusToken: 't' })
			);
			answerWith(() => json({ status: 503, body: { error: 'unavailable' } }));

			await assert.rejects(restore());
			assert.equal(cachedHandle(), 'zeno');
		});

		it('asks nothing when this browser holds no reservation', async () => {
			answerWith(() => json({ status: 200, body: {} }));

			assert.equal(await restore(), undefined);
			assert.equal(calls.length, 0);
		});
	});

	describe('waitlistUnavailable', () => {
		it('refuses both calls with a code the capsule reads as a plain failure', async () => {
			const sent = await waitlistUnavailable.requestCode({
				handle: 'zeno',
				email: 'zeno@example.com',
				source: 'nav'
			});
			const confirmed = await waitlistUnavailable.confirm({
				email: 'zeno@example.com',
				code: '123456'
			});

			assert.ok('error' in sent && 'error' in confirmed);
			assert.equal(landingClaimRefusalOf(sent.error), 'failed');
			assert.equal(landingClaimRefusalOf(confirmed.error), 'failed');
		});

		it('holds no handle for a returning visitor', async () => {
			assert.equal(waitlistUnavailable.cachedHandle(), undefined);
			assert.equal(await waitlistUnavailable.restore(), undefined);
		});
	});
});
