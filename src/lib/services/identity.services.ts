import { isWeb2Backend } from '#lib/web2/backend-mode.ts';
import { clearWeb2Session, getWeb2User } from '#lib/web2/session.ts';
import { isNullish, nonNullish } from '@dfinity/utils';
import { AnonymousIdentity, type Identity } from '@icp-sdk/core/agent';
import { getIdentityOnce, signOut as junoSignOut } from '@junobuild/core';

/**
 * Juno-backed sign-in: current ICP identity, or null/undefined if signed out.
 */
export const getIdentity = async (): Promise<Identity | undefined | null> =>
	await getIdentityOnce();

/**
 * Same as {@link getIdentity}, but falls back to `AnonymousIdentity` for public reads.
 */
export const getIdentityOrAnonymous = async (): Promise<Identity> => {
	const identity = await getIdentity();

	return identity ?? new AnonymousIdentity();
};

/**
 * Placeholder identity threaded through shared fetchers in web2 mode, where
 * every transport branch resolves off-identity (the API signs with the
 * caller's derived custodial identity, and public reads ride the HTTP
 * bridge). It never reaches the wire: the on-chain branches those fetchers
 * carry are unreachable with the flag on.
 */
export const web2PlaceholderIdentity = (): Identity => new AnonymousIdentity();

/**
 * Backend-agnostic "is someone signed in" probe for loaders that only gate
 * work on it. On the default on-chain backend it is the Juno identity check;
 * in web2 mode the session is a cookie mirrored into `web2SessionStore`, so
 * there is never a local identity to read and the probe must not reach for
 * one.
 */
export const isSignedIn = async (): Promise<boolean> => {
	if (isWeb2Backend()) {
		return nonNullish(getWeb2User());
	}

	return nonNullish(await getIdentity());
};

/**
 * Backend-agnostic sign-out for surfaces outside the sanctioned auth trio
 * (the settings page's sign-out and the account return gate). The default
 * on-chain path drops the Juno delegation exactly as before; web2 revokes
 * the cookie session server-side, which the app shell observes through
 * `web2SessionStore` and folds into a cleared `userStore`.
 */
export const signOut = async (): Promise<void> => {
	if (isWeb2Backend()) {
		// clearWeb2Session clears the local session store in a finally, so the
		// user is signed out locally even when the server revoke call fails;
		// throwing here would strand callers on authBusy for a session that is
		// already gone. Log and continue instead.
		try {
			await clearWeb2Session();
		} catch (e: unknown) {
			console.warn('web2 sign-out revoke failed (local session already cleared)', e);
		}

		return;
	}

	await junoSignOut();
};

/**
 * Returns the signed-in identity or throws if the user is not authenticated.
 */
export const safeGetIdentityOnce = async (): Promise<Identity> => {
	const identity = await getIdentity();

	if (isNullish(identity)) {
		throw new Error('Not authenticated');
	}

	return identity;
};
