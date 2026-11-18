import { logout as apiLogout, getMe, Web2ApiError, type Web2Me } from '#lib/web2/client.ts';
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

const setUser = (user: Web2Me | undefined): void => store.set({ user, authBusy: false });

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
