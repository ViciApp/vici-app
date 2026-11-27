import {
	ApiError,
	logout as apiLogout,
	getMe,
	setSessionLostHandler,
	type ApiMe
} from '#lib/web2/client.ts';
import { nonNullish } from '@dfinity/utils';
import { get, readonly, writable, type Readable } from 'svelte/store';

/**
 * Session state. There is no local identity to read: the browser holds an
 * HttpOnly session cookie and "signed in" derives from `/me` succeeding. This
 * store is the single source of that truth for the auth surface.
 */
interface SessionState {
	user: ApiMe | undefined;
	/**
	 * True until the first `/me` probe resolves. Consumers treat it as "we
	 * don't know yet" so signed-out UI never flashes before the probe returns.
	 */
	authBusy: boolean;
}

const store = writable<SessionState>({ user: undefined, authBusy: true });

export const sessionStore: Readable<SessionState> = readonly(store);

// Open while `watchSession` runs: tells the app's other tabs that this
// tab's session account changed, so they re-read the cookie they share.
let channel: BroadcastChannel | undefined;

// Kept as it is: a tab still on the previous bundle listens on this name.
const SESSION_CHANNEL = 'vici.web2-session';

const setUser = (user: ApiMe | undefined): void => {
	const changed = get(store).user?.id !== user?.id;

	store.set({ user, authBusy: false });

	if (changed) {
		channel?.postMessage('changed');
	}
};

/**
 * Raised instead of a write asked for an account the session cookie no longer
 * belongs to (another tab signed in as someone else). The session store has
 * already moved to the cookie's account by then, so the app resets for it.
 */
export class SessionChangedError extends Error {
	constructor() {
		super('The session now belongs to another account.');
	}
}

/**
 * Probe the cookie session and mirror it into the store. A 401 is the
 * signed-out steady state, not an error; any other failure also resolves to
 * signed-out so the app never hangs on `authBusy`. Returns the user (or
 * `undefined` when signed out) for callers that branch on the outcome.
 */
export const loadSession = async (): Promise<ApiMe | undefined> => {
	store.update((state) => ({ ...state, authBusy: true }));

	try {
		const user = await getMe();

		setUser(user);

		return user;
	} catch (err: unknown) {
		if (!(err instanceof ApiError) || err.status !== 401) {
			console.error('session probe failed', err);
		}

		// Signed out (or an unreachable API): reflect it in the store and fall
		// through to an implicit `undefined`.
		setUser(undefined);
	}
};

/**
 * Imperative read of the current session user, for services that gate work on
 * "signed in". `undefined`
 * both while the first probe is in flight and in the signed-out steady state;
 * callers that need to distinguish the two subscribe to the store instead.
 */
export const getSessionUser = (): ApiMe | undefined => get(store).user;

/**
 * Adopt a session from a login response. The OTP verify route returns the
 * `/me` body alongside the freshly set cookie, so the store can be seeded
 * without a second probe.
 */
export const adoptSession = (user: ApiMe): void => setUser(user);

/**
 * Confirm the session cookie still belongs to `owner` before a write in that
 * account's name. Tabs share the cookie, so a sign-in in another tab moves
 * every tab to the new account while this one still shows the old one: then
 * the store adopts the cookie's account (the app resets and rehydrates for it)
 * and the write is refused with {@link SessionChangedError}.
 */
export const assertSessionOwner = async (owner: string): Promise<void> => {
	const me = await getMe();

	if (me.id === owner) {
		return;
	}

	setUser(me);

	throw new SessionChangedError();
};

/**
 * Re-read the cookie's account without the cold-probe busy state, and move
 * the store to it when it changed. A gone session is handled by the refusal
 * handler `watchSession` registers.
 */
const syncSession = async (): Promise<void> => {
	try {
		const me = await getMe();

		if (get(store).user?.id !== me.id) {
			setUser(me);
		}
	} catch (err: unknown) {
		if (!(err instanceof ApiError) || err.status !== 401) {
			console.error('session sync failed', err);
		}
	}
};

/**
 * Keep the store on the cookie's account for the life of the app shell: a
 * request refused as `unauthenticated` signs the tab out (the app resets), and
 * the account is re-read when another tab changes it or when this tab is shown
 * again. Returns the teardown.
 */
export const watchSession = (): (() => void) => {
	const removeLostHandler = setSessionLostHandler(() => {
		if (nonNullish(getSessionUser())) {
			setUser(undefined);
		}
	});

	const onVisible = (): void => {
		if (document.visibilityState === 'visible') {
			void syncSession();
		}
	};

	document.addEventListener('visibilitychange', onVisible);

	const ownChannel =
		typeof BroadcastChannel === 'undefined' ? undefined : new BroadcastChannel(SESSION_CHANNEL);

	if (nonNullish(ownChannel)) {
		ownChannel.onmessage = () => void syncSession();
		channel = ownChannel;
	}

	return () => {
		removeLostHandler();
		document.removeEventListener('visibilitychange', onVisible);
		ownChannel?.close();

		if (channel === ownChannel) {
			channel = undefined;
		}
	};
};

/**
 * Revoke the session server-side (clearing the cookie) then drop the local
 * state. The store is cleared even if the network call fails so the UI can
 * never be stuck showing a signed-in state the user asked to leave.
 */
export const clearSession = async (): Promise<void> => {
	try {
		await apiLogout();
	} finally {
		setUser(undefined);
	}
};
