import { clearWeb2Session, getWeb2User } from '#lib/web2/session.ts';
import { nonNullish } from '@dfinity/utils';
import { AnonymousIdentity, type Identity } from '@icp-sdk/core/agent';

/**
 * "Is someone signed in" probe for loaders that only gate work on it. The
 * session is an HttpOnly cookie mirrored into `web2SessionStore`, so there is
 * never a local identity to read.
 */
export const isSignedIn = (): Promise<boolean> => Promise.resolve(nonNullish(getWeb2User()));

/**
 * Owner key of the signed-in user: the session account id (the key `owner`
 * fields and activity keys carry). `undefined` when signed out.
 */
export const getSignedInOwner = (): Promise<string | undefined> =>
	Promise.resolve(getWeb2User()?.id);

/**
 * Sign-out for surfaces outside the auth shell (the settings page's sign-out
 * and the account return gate). Revokes the cookie session server-side, which
 * the app shell observes through `web2SessionStore` and folds into a cleared
 * `userStore`.
 */
export const signOut = async (): Promise<void> => {
	// clearWeb2Session clears the local session store in a finally, so the
	// user is signed out locally even when the server revoke call fails;
	// throwing here would strand callers on authBusy for a session that is
	// already gone. Log and continue instead.
	try {
		await clearWeb2Session();
	} catch (e: unknown) {
		console.warn('web2 sign-out revoke failed (local session already cleared)', e);
	}
};

/**
 * The identity the shared fetchers thread through. Public on-chain reads (the
 * order books) run anonymously, and every account-scoped read rides the HTTP
 * API, which signs engine calls with the caller's derived custodial identity,
 * so there is never a signed-in identity on the client.
 */
export const anonymousIdentity = (): Identity => new AnonymousIdentity();
