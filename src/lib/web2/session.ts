import {
	logout as apiLogout,
	getMe,
	setWeb2SessionLostHandler,
	Web2ApiError,
	type Web2Me
} from '#lib/web2/client.ts';
import { nonNullish } from '@dfinity/utils';
import { get, readonly, writable, type Readable } from 'svelte/store';

/**
 * Web2 session state, the cookie-backed counterpart to the on-chain identity
 * flow. In web2 mode there is no local identity to read: the browser holds an
 * HttpOnly session cookie and "signed in" derives from `/me` succeeding. This
 * store is the single source of that truth for the auth surface; it stays
 * inert (and unread) while the app runs on the default on-chain backend.
 */
export interface Web2SessionState {
	user: Web2Me | undefined;
	/**
	 * True until the first `/me` probe resolves. Consumers treat it as "we
	 * don't know yet" so signed-out UI never flashes before the probe returns,
	 * mirroring the on-chain `authBusy` semantics.
	 */
	authBusy: boolean;
}

const store = writable<Web2SessionState>({ user: undefined, authBusy: true });

export const web2SessionStore: Readable<Web2SessionState> = readonly(store);

// Open while `watchWeb2Session` runs: tells the app's other tabs that this
// tab's session account changed, so they re-read the cookie they share.
let channel: BroadcastChannel | undefined;

const SESSION_CHANNEL = 'vici.web2-session';

const setUser = (user: Web2Me | undefined): void => {
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
export class Web2SessionChangedError extends Error {
	constructor() {
		super('The web2 session now belongs to another account.');
	}
}

/**
 * Probe the cookie session and mirror it into the store. A 401 is the
 * signed-out steady state, not an error; any other failure also resolves to
 * signed-out so the app never hangs on `authBusy`. Returns the user (or
 * `undefined` when signed out) for callers that branch on the outcome.
 */
export const loadWeb2Session = async (): Promise<Web2Me | undefined> => {
	store.update((state) => ({ ...state, authBusy: true }));

	try {
		const user = await getMe();

		setUser(user);

		return user;
	} catch (err: unknown) {
		if (!(err instanceof Web2ApiError) || err.status !== 401) {
			console.error('web2 session probe failed', err);
		}

		// Signed out (or an unreachable API): reflect it in the store and fall
		// through to an implicit `undefined`.
		setUser(undefined);
	}
};

/**
 * Imperative read of the current session user, for services that gate work on
 * "signed in" the way the on-chain path gates on `getIdentity()`. `undefined`
 * both while the first probe is in flight and in the signed-out steady state;
 * callers that need to distinguish the two subscribe to the store instead.
 */
export const getWeb2User = (): Web2Me | undefined => get(store).user;

/**
 * Adopt a session from a login response. The OTP verify route returns the
 * `/me` body alongside the freshly set cookie, so the store can be seeded
 * without a second probe.
 */
export const adoptWeb2Session = (user: Web2Me): void => setUser(user);

/**
 * Confirm the session cookie still belongs to `owner` before a write in that
 * account's name. Tabs share the cookie, so a sign-in in another tab moves
 * every tab to the new account while this one still shows the old one: then
 * the store adopts the cookie's account (the app resets and rehydrates for it)
 * and the write is refused with {@link Web2SessionChangedError}.
 */
export const assertWeb2SessionOwner = async (owner: string): Promise<void> => {
	const me = await getMe();

	if (me.id === owner) {
		return;
	}

	setUser(me);

	throw new Web2SessionChangedError();
};

/**
 * Re-read the cookie's account without the cold-probe busy state, and move
 * the store to it when it changed. A gone session is handled by the refusal
 * handler `watchWeb2Session` registers.
 */
const syncWeb2Session = async (): Promise<void> => {
	try {
		const me = await getMe();

		if (get(store).user?.id !== me.id) {
			setUser(me);
		}
	} catch (err: unknown) {
		if (!(err instanceof Web2ApiError) || err.status !== 401) {
			console.error('web2 session sync failed', err);
		}
	}
};

/**
 * Keep the store on the cookie's account for the life of the app shell: a
 * request refused as `unauthenticated` signs the tab out (the app resets), and
 * the account is re-read when another tab changes it or when this tab is shown
 * again. Returns the teardown.
 */
export const watchWeb2Session = (): (() => void) => {
	const removeLostHandler = setWeb2SessionLostHandler(() => {
		if (nonNullish(getWeb2User())) {
			setUser(undefined);
		}
	});

	const onVisible = (): void => {
		if (document.visibilityState === 'visible') {
			void syncWeb2Session();
		}
	};

	document.addEventListener('visibilitychange', onVisible);

	const ownChannel =
		typeof BroadcastChannel === 'undefined' ? undefined : new BroadcastChannel(SESSION_CHANNEL);

	if (nonNullish(ownChannel)) {
		ownChannel.onmessage = () => void syncWeb2Session();
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
export const clearWeb2Session = async (): Promise<void> => {
	try {
		await apiLogout();
	} finally {
		setUser(undefined);
	}
};
