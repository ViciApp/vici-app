import { II_MAX_TIME_TO_LIVE_NS } from '#lib/constants/app.constants.ts';
import { isNullish, nonNullish } from '@dfinity/utils';
import type { Identity } from '@icp-sdk/core/agent';
import { type DelegationChain, DelegationIdentity, ECDSAKeyIdentity } from '@icp-sdk/core/identity';
import { Signer } from '@icp-sdk/signer';
import { PostMessageTransport } from '@icp-sdk/signer/web';
import { getDoc, setDoc, type UserData } from '@junobuild/core';
import { IdbStorage, KEY_STORAGE_DELEGATION, KEY_STORAGE_KEY } from 'icp-auth-openid/client';

// Juno's system collection holding one doc per authenticated principal.
const JUNO_USER_COLLECTION = '#user';

// Internet Identity 2.0 (`id.ai`) OpenID one-click endpoint. The `openid`
// query param (URL-encoded, exactly as `@icp-sdk/auth` builds it) selects
// the OIDC provider; II runs the Apple handshake and returns a delegation
// indistinguishable from a passkey II sign-in. Only the hosted endpoint
// serves this flow, so we always target `id.ai`, which also means it
// works from any origin, including local dev.
const buildAppleIdentityProviderUrl = (): string => {
	const url = new URL('https://id.ai/authorize');
	url.searchParams.set('openid', 'https://appleid.apple.com');

	return url.toString();
};

// The II popup redirects to Apple's OIDC and sits on the credential / passkey
// ceremony, during which the II page stops answering ICRC-29 heartbeats.
// `@icp-sdk/auth`'s `AuthClient` hard-codes `PostMessageTransport` with the
// default 2s `disconnectTimeout`, so the channel drops mid-ceremony and II
// shows "Connection closed". We therefore drive the transport ourselves with
// a passkey-aware timeout: which is why this flow can't use
// `AuthClient.signIn()`.
const PASSKEY_AWARE_DISCONNECT_TIMEOUT_MS = 60_000;

const SIGNER_WINDOW_CLOSED_POLL_MS = 500;

// `PostMessageTransport` opens its signer popup under a fixed window name
// derived from the identity-provider origin (`<origin>-signer-window`).
// Pre-opening a window with the same name lets the SDK reuse it, which both
// keeps the open inside the user gesture (Safari) and gives us a handle to
// poll for a user-initiated close.
const buildSignerWindowName = (identityProvider: string): string =>
	`${new URL(identityProvider).origin}-signer-window`;

/**
 * Raised when the user dismisses the sign-in popup. The transport only
 * reports a closed popup via a multi-second heartbeat timeout, so we surface
 * this synthetic signal and let callers treat it as a benign cancel.
 */
export class AppleSignInCancelledError extends Error {}

/**
 * Mirror Juno's `initUser`: load-or-create the `#user` doc for the given
 * identity.
 *
 * Juno's boot-time `loadAuth()` only *loads* an existing `#user` doc; it
 * never creates one (that happens inside Juno's interactive `signIn()`,
 * which we bypass). Without this, the next document load finds a valid
 * delegation but no user, and `loadAuth()` sets the auth store to `null`;
 * the app drops straight back to the signed-out screen. We create the doc
 * here with the freshly acquired Apple delegation (Juno's ambient identity
 * hasn't adopted it yet). It's the same owner-scoped `#user` write Juno
 * itself performs for every other provider.
 */
const ensureJunoUserDoc = async (identity: Identity): Promise<void> => {
	const key = identity.getPrincipal().toText();
	const satellite = { identity };

	const existing = await getDoc({ collection: JUNO_USER_COLLECTION, key, satellite });

	if (nonNullish(existing)) {
		return;
	}

	await setDoc<UserData>({
		collection: JUNO_USER_COLLECTION,
		// `internet_identity`: the delegation is issued by Internet Identity
		// 2.0 (`id.ai`); Apple is just the OpenID method behind it.
		doc: { key, data: { provider: 'internet_identity' } },
		satellite
	});
};

/**
 * Persist exactly as `@icp-sdk/auth`'s `AuthClient` would, so Juno's own
 * AuthClient (v5) reconstructs the session from the same IndexedDB store on
 * the next document load: ECDSA key pair under `identity`, delegation JSON
 * under `delegation`, in db `auth-client-db` / store `ic-keyval`.
 */
const persistDelegation = async ({
	key,
	chain
}: {
	key: ECDSAKeyIdentity;
	chain: DelegationChain;
}): Promise<void> => {
	const storage = new IdbStorage();
	await storage.set(KEY_STORAGE_KEY, key.getKeyPair());
	await storage.set(KEY_STORAGE_DELEGATION, JSON.stringify(chain.toJSON()));
};

interface AcquiredDelegation {
	key: ECDSAKeyIdentity;
	chain: DelegationChain;
}

// Acquire the delegation but do NOT persist here: persistence happens only
// once the acquire branch wins the cancel race (see `signInWithApple`).
// Otherwise a popup closed at the exact moment the delegation resolves could
// reject as "cancelled" while a valid delegation still lands in storage,
// surfacing a cancel to the user yet silently logging them in on reload.
const acquireDelegation = async (identityProvider: string): Promise<AcquiredDelegation> => {
	const transport = new PostMessageTransport({
		url: identityProvider,
		disconnectTimeout: PASSKEY_AWARE_DISCONNECT_TIMEOUT_MS
	});
	const signer = new Signer({ transport });

	const key = await ECDSAKeyIdentity.generate();

	// Establish the ICRC-29 channel (handshake while the popup is still on
	// `id.ai`), then request the delegation: the long step, during which II
	// bounces through Apple's OIDC ceremony.
	await signer.openChannel();

	const chain = await signer.requestDelegation({
		publicKey: key.getPublicKey(),
		maxTimeToLive: II_MAX_TIME_TO_LIVE_NS
	});

	return { key, chain };
};

/**
 * One-click "Continue with Apple" through Internet Identity 2.0's OpenID
 * flow.
 *
 * Juno's `signIn()` exposes no Apple provider, so this drives the ICRC-29
 * signer transport directly (with a passkey-aware `disconnectTimeout`),
 * persists the delegation to the same IndexedDB store Juno reads
 * (`auth-client-db`), and creates the `#user` doc: so a subsequent full
 * document load lets Juno's `initSatellite()` / `loadAuth()` resolve the
 * user and fire `onAuthStateChange`. See the caller in
 * {@link ../components/authn/SignInProviderStack.svelte}.
 *
 * The popup pre-open stays inside the user-gesture call stack so Safari does
 * not block it.
 */
export const signInWithApple = async (): Promise<void> => {
	const identityProvider = buildAppleIdentityProviderUrl();

	// Pre-open the popup synchronously, under the name the transport reuses,
	// so Safari doesn't block it and we can detect a user-initiated close. A
	// blocked/null window just opts out of the poll; we fall back to the
	// transport's heartbeat.
	const signerWindow = window.open('', buildSignerWindowName(identityProvider));

	let pollHandle: ReturnType<typeof setInterval> | undefined;

	const userInterrupt = new Promise<never>((_, reject) => {
		if (isNullish(signerWindow)) {
			return;
		}

		pollHandle = setInterval(() => {
			if (signerWindow.closed) {
				reject(new AppleSignInCancelledError('Sign-in popup closed'));
			}
		}, SIGNER_WINDOW_CLOSED_POLL_MS);
	});

	const acquire = acquireDelegation(identityProvider);

	// When the interrupt wins the race the acquire promise settles much later
	// via the transport's heartbeat disconnect; swallow it so the runtime
	// doesn't flag an unhandled rejection.
	acquire.catch(() => undefined);

	try {
		const { key, chain } = await Promise.race([acquire, userInterrupt]);

		// Acquire won the race (not a cancel), so it's safe to commit: stop
		// polling before the popup's own close is observed, persist the
		// delegation, then create the `#user` doc so Juno resolves the session
		// on the next load. Persisting only here guarantees a cancelled attempt
		// never leaves a usable session behind.
		if (nonNullish(pollHandle)) {
			clearInterval(pollHandle);
			pollHandle = undefined;
		}

		await persistDelegation({ key, chain });

		await ensureJunoUserDoc(DelegationIdentity.fromDelegation(key, chain));
	} finally {
		if (nonNullish(pollHandle)) {
			clearInterval(pollHandle);
		}
	}
};
