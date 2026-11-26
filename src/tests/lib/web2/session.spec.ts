import { getMyProfile, verifyOtp, Web2ApiError, type Web2Me } from '#lib/web2/client.ts';
import {
	adoptWeb2Session,
	assertWeb2SessionOwner,
	captureWeb2Session,
	clearWeb2Session,
	getWeb2User,
	loadWeb2Session,
	watchWeb2Session,
	Web2SessionChangedError
} from '#lib/web2/session.ts';
import { isNullish } from '@dfinity/utils';
import assert from 'node:assert/strict';
import { afterEach, beforeEach, describe, it } from 'node:test';

const meOf = (id: string): Web2Me => ({
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
	me?: Web2Me;
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

/** Holds every `/me` read until the spec answers it, in the order it picks. */
const stubDeferredMe = (): { answer: (args: { index: number; me: Web2Me }) => void } => {
	const pending: ((response: Response) => void)[] = [];

	globalThis.fetch = (): Promise<Response> =>
		new Promise((resolve) => {
			pending.push(resolve);
		});

	return {
		answer: ({ index, me }) => pending[index]?.(json({ status: 200, body: { user: me } }))
	};
};

const settle = async (): Promise<void> => {
	for (let i = 0; i < 20; i++) {
		await new Promise((resolve) => setImmediate(resolve));
	}
};

describe('web2 session', () => {
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
		adoptWeb2Session(ACCOUNT_A);
	});

	afterEach(() => {
		stopWatching?.();
		stopWatching = undefined;
		globalThis.fetch = originalFetch;
		Reflect.deleteProperty(globalThis, 'document');
	});

	describe('assertWeb2SessionOwner', () => {
		it('lets a write through while the cookie belongs to the same account', async () => {
			stubApi({ me: ACCOUNT_A });

			await assertWeb2SessionOwner(ACCOUNT_A.id);

			assert.equal(getWeb2User()?.id, ACCOUNT_A.id);
		});

		it('refuses the write and moves to the cookie account after a sign-in in another tab', async () => {
			stubApi({ me: ACCOUNT_B });

			await assert.rejects(assertWeb2SessionOwner(ACCOUNT_A.id), Web2SessionChangedError);

			assert.equal(getWeb2User()?.id, ACCOUNT_B.id);
		});
	});

	describe('captureWeb2Session', () => {
		it('holds while the session stays on the account', async () => {
			const isSameSession = captureWeb2Session();
			stubApi({ me: ACCOUNT_A });

			await loadWeb2Session();

			assert.equal(isSameSession(), true);
		});

		it('breaks once the session moves to another account', () => {
			const isSameSession = captureWeb2Session();

			adoptWeb2Session(ACCOUNT_B);

			assert.equal(isSameSession(), false);
		});

		it('stays broken when the session comes back to the same account', () => {
			const isSameSession = captureWeb2Session();

			adoptWeb2Session(ACCOUNT_B);
			adoptWeb2Session(ACCOUNT_A);

			assert.equal(isSameSession(), false);
		});

		it('breaks once the session signs out', async () => {
			const isSameSession = captureWeb2Session();
			stubApi({ refuse: { status: 200, body: { ok: true } } });

			await clearWeb2Session();

			assert.equal(isSameSession(), false);
		});
	});

	describe('session reads answering out of order', () => {
		it('keeps the newer probe when an older one answers last', async () => {
			const api = stubDeferredMe();

			const older = loadWeb2Session();
			const newer = loadWeb2Session();

			api.answer({ index: 1, me: ACCOUNT_B });
			api.answer({ index: 0, me: ACCOUNT_A });

			assert.equal((await older)?.id, ACCOUNT_B.id);
			assert.equal((await newer)?.id, ACCOUNT_B.id);
			assert.equal(getWeb2User()?.id, ACCOUNT_B.id);
		});

		it('drops a probe that answers after a sign-in landed', async () => {
			const api = stubDeferredMe();

			const probe = loadWeb2Session();

			adoptWeb2Session(ACCOUNT_B);
			api.answer({ index: 0, me: ACCOUNT_A });

			assert.equal((await probe)?.id, ACCOUNT_B.id);
			assert.equal(getWeb2User()?.id, ACCOUNT_B.id);
		});

		it('refuses a write without moving back to an account a newer probe left', async () => {
			const api = stubDeferredMe();

			const check = assertWeb2SessionOwner(ACCOUNT_B.id);
			const probe = loadWeb2Session();

			api.answer({ index: 1, me: ACCOUNT_B });
			await probe;
			api.answer({ index: 0, me: ACCOUNT_A });

			await assert.rejects(check, Web2SessionChangedError);
			assert.equal(getWeb2User()?.id, ACCOUNT_B.id);
		});
	});

	describe('watchWeb2Session', () => {
		it('signs the tab out when a request is refused as unauthenticated', async () => {
			stopWatching = watchWeb2Session();
			stubApi({});

			await assert.rejects(getMyProfile(), Web2ApiError);

			assert.equal(getWeb2User(), undefined);
		});

		it('keeps the session on any other refusal', async () => {
			stopWatching = watchWeb2Session();
			stubApi({ me: ACCOUNT_A, refuse: { status: 401, body: { error: 'invalid_code' } } });

			await assert.rejects(verifyOtp({ email: 'a@example.com', code: '000000' }), Web2ApiError);

			assert.equal(getWeb2User()?.id, ACCOUNT_A.id);
		});

		it('leaves the session alone once stopped', async () => {
			watchWeb2Session()();
			stubApi({});

			await assert.rejects(getMyProfile(), Web2ApiError);

			assert.equal(getWeb2User()?.id, ACCOUNT_A.id);
		});

		it('moves to the cookie account when another tab changes it', async () => {
			stopWatching = watchWeb2Session();
			stubApi({ me: ACCOUNT_B });

			const otherTab = new BroadcastChannel('vici.web2-session');
			otherTab.postMessage('changed');
			otherTab.close();

			await settle();

			assert.equal(getWeb2User()?.id, ACCOUNT_B.id);
		});

		it('signs the tab out when another tab signs out', async () => {
			stopWatching = watchWeb2Session();
			const isSameSession = captureWeb2Session();
			stubApi({});

			const otherTab = new BroadcastChannel('vici.web2-session');
			otherTab.postMessage('changed');
			otherTab.close();

			await settle();

			assert.equal(getWeb2User(), undefined);
			assert.equal(isSameSession(), false);
		});
	});
});
