import { ApiError, getMyProfile, verifyOtp, type ApiMe } from '#lib/api-client/client.ts';
import {
	adoptSession,
	assertSessionOwner,
	getSessionUser,
	SessionChangedError,
	watchSession
} from '#lib/api-client/session.ts';
import { isNullish } from '@dfinity/utils';
import assert from 'node:assert/strict';
import { afterEach, beforeEach, describe, it } from 'node:test';

const meOf = (id: string): ApiMe => ({
	id,
	role: 'user',
	displayName: null,
	avatarUrl: null,
	createdAt: '2026-01-01T00:00:00.000Z',
	identities: [],
	legacyPrincipals: []
});

const ACCOUNT_A = meOf('account-a');
const ACCOUNT_B = meOf('account-b');

const json = ({ status, body }: { status: number; body: unknown }): Response =>
	new Response(JSON.stringify(body), { status });

/** Answers `/me` with `me`, or the API's signed-out refusal when it is absent;
 * any other path is refused with `refuse`. */
const stubApi = ({
	me,
	refuse = { status: 401, body: { error: 'unauthenticated' } }
}: {
	me?: ApiMe;
	refuse?: { status: number; body: unknown };
}): void => {
	globalThis.fetch = (...[url]: Parameters<typeof fetch>): Promise<Response> =>
		Promise.resolve(
			String(url).endsWith('/api/v1/me')
				? isNullish(me)
					? json({ status: 401, body: { error: 'unauthenticated' } })
					: json({ status: 200, body: { user: me } })
				: json(refuse)
		);
};

const settle = async (): Promise<void> => {
	for (let i = 0; i < 20; i++) {
		await new Promise((resolve) => setImmediate(resolve));
	}
};

describe('session', () => {
	const originalFetch = globalThis.fetch;
	let stopWatching: (() => void) | undefined;

	beforeEach(() => {
		Object.assign(globalThis, {
			document: {
				visibilityState: 'visible',
				addEventListener: () => undefined,
				removeEventListener: () => undefined
			}
		});
		adoptSession(ACCOUNT_A);
	});

	afterEach(() => {
		stopWatching?.();
		stopWatching = undefined;
		globalThis.fetch = originalFetch;
		Reflect.deleteProperty(globalThis, 'document');
	});

	describe('assertSessionOwner', () => {
		it('lets a write through while the cookie belongs to the same account', async () => {
			stubApi({ me: ACCOUNT_A });

			await assertSessionOwner(ACCOUNT_A.id);

			assert.equal(getSessionUser()?.id, ACCOUNT_A.id);
		});

		it('refuses the write and moves to the cookie account after a sign-in in another tab', async () => {
			stubApi({ me: ACCOUNT_B });

			await assert.rejects(assertSessionOwner(ACCOUNT_A.id), SessionChangedError);

			assert.equal(getSessionUser()?.id, ACCOUNT_B.id);
		});
	});

	describe('watchSession', () => {
		it('signs the tab out when a request is refused as unauthenticated', async () => {
			stopWatching = watchSession();
			stubApi({});

			await assert.rejects(getMyProfile(), ApiError);

			assert.equal(getSessionUser(), undefined);
		});

		it('keeps the session on any other refusal', async () => {
			stopWatching = watchSession();
			stubApi({ me: ACCOUNT_A, refuse: { status: 401, body: { error: 'invalid_code' } } });

			await assert.rejects(verifyOtp({ email: 'a@example.com', code: '000000' }), ApiError);

			assert.equal(getSessionUser()?.id, ACCOUNT_A.id);
		});

		it('leaves the session alone once stopped', async () => {
			watchSession()();
			stubApi({});

			await assert.rejects(getMyProfile(), ApiError);

			assert.equal(getSessionUser()?.id, ACCOUNT_A.id);
		});

		it('moves to the cookie account when another tab changes it', async () => {
			stopWatching = watchSession();
			stubApi({ me: ACCOUNT_B });

			const otherTab = new BroadcastChannel('vici.web2-session');
			otherTab.postMessage('changed');
			otherTab.close();

			await settle();

			assert.equal(getSessionUser()?.id, ACCOUNT_B.id);
		});
	});
});
