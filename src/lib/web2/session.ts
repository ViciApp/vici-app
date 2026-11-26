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

// Bumped each time the store moves to another account, signs in or signs
// out, so work started in one session can tell it no longer runs in the
// current one, even when the session has since come back to the same account.
let generation = 0;

// Bumped by every write and every `/me` read that starts. Reads answer in any
// order, so only the newest one may settle the store, and only while no write
// landed after it started: an older answer would bring back an account the
// cookie no longer holds.
let turn = 0;

/** Start a `/me` read; the returned check holds while its answer is the newest. */
const startRead = (): (() => boolean) => {
	const readTurn = ++turn;

	return () => readTurn === turn;
};

const setUser = (user: Web2Me | undefined): void => {
	const changed = get(store).user?.id !== user?.id;

	turn++;

	if (changed) {
		generation++;
	}

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

/** The account the store settles on once no probe holds it busy. */
const settledUser = (): Promise<Web2Me | undefined> =>
	new Promise((resolve) => {
		let settled = false;

		// The first call runs inside `subscribe`, before it returns the real
		// teardown, so an already settled store is dropped right after it.
		let unsubscribe = (): void => {};

		unsubscribe = store.subscribe(({ user, authBusy }) => {
			if (authBusy || settled) {
				return;
			}

			settled = true;
			resolve(user);
			unsubscribe();
		});

		if (settled) {
			unsubscribe();
		}
	});

/**
 * Probe the cookie session and mirror it into the store. A 401 is the
 * signed-out steady state, not an error; any other failure also resolves to
 * signed-out so the app never hangs on `authBusy`. Returns the account the
 * store settles on (`undefined` when signed out), a newer read's when one
 * overtook this probe, for callers that branch on the outcome.
 */
export const loadWeb2Session = async (): Promise<Web2Me | undefined> => {
	store.update((state) => ({ ...state, authBusy: true }));

	const isNewest = startRead();

	try {
		const user = await getMe();

		if (isNewest()) {
			setUser(user);
		}
	} catch (err: unknown) {
		if (!(err instanceof Web2ApiError) || err.status !== 401) {
			console.error('web2 session probe failed', err);
		}

		// Signed out (or an unreachable API): reflect it in the store.
		if (isNewest()) {
			setUser(undefined);
		}
	}

	// A newer read or write that overtook this probe settles the store instead.
	return settledUser();
};

/**
 * Imperative read of the current session user, for services that gate work on
 * "signed in" the way the on-chain path gates on `getIdentity()`. `undefined`
 * both while the first probe is in flight and in the signed-out steady state;
 * callers that need to distinguish the two subscribe to the store instead.
 */
export const getWeb2User = (): Web2Me | undefined => get(store).user;

/**
 * Capture the current session; the returned check holds until the session
 * moves to another account or signs out, and stays broken if it later comes
 * back to the same account. Work started for a session checks it when it
 * resolves, so a late result never lands in the app shell of a later session.
 */
export const captureWeb2Session = (): (() => boolean) => {
	const capturedGeneration = generation;

	return () => capturedGeneration === generation;
};

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
	// Checks the turn without taking one: this read only guards a write, so it
	// never cancels a session probe already in flight.
	const checkedTurn = turn;
	const me = await getMe();

	if (me.id === owner) {
		return;
	}

	if (checkedTurn === turn) {
		setUser(me);
	}

	throw new Web2SessionChangedError();
};

/**
 * Re-read the cookie's account without the cold-probe busy state, and settle
 * the store on it: another account, or signed out when the cookie is gone.
 * Any other failure keeps the current account, unless this read overtook a
 * cold probe, which then resolves to signed-out the way the probe would.
 */
const syncWeb2Session = async (): Promise<void> => {
	const isNewest = startRead();

	try {
		const me = await getMe();

		if (isNewest()) {
			setUser(me);
		}
	} catch (err: unknown) {
		const signedOut = err instanceof Web2ApiError && err.status === 401;

		if (!signedOut) {
			console.error('web2 session sync failed', err);
		}

		if (isNewest() && (signedOut || get(store).authBusy)) {
			setUser(undefined);
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
