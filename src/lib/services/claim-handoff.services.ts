import { CLAIM_PORTAL_URL } from '$lib/constants/claim.constants';
import { getIdentity } from '$lib/services/identity.services';
import {
	bytesToBase64Url,
	CLAIM_AUDIENCE,
	claimMessageBytes,
	encodeClaimBlob
} from '$lib/utils/claim-handoff.utils';
import { isWeb2Backend } from '$lib/web2/backend-mode';
import { postClaim, Web2ApiError } from '$lib/web2/client';
import { isNullish, nonNullish } from '@dfinity/utils';
import { DelegationIdentity } from '@icp-sdk/core/identity';

/**
 * Account-claim handoff: on the legacy on-chain build, a signed-in user can
 * carry their principal over to the new stack by signing a short-lived claim
 * payload with the current session identity and opening the claim portal
 * with the proof in the URL fragment. The portal (web2 build) verifies the
 * proof server-side and links the principal to the caller's account.
 *
 * Backend-mode gates live here (never in components): the handoff surfaces
 * exist only on the on-chain build, the portal only on the web2 build.
 */

/** Whether the "move to the new VICI" surfaces should show at all. */
export const isClaimHandoffAvailable = (): boolean => !isWeb2Backend();

/** Whether this build hosts the claim portal (`/claim`). */
export const isClaimPortalEnabled = (): boolean => isWeb2Backend();

/**
 * Sign the claim payload with the current session identity and open the
 * claim portal in a new tab. False when no signable delegation identity is
 * available (signed out, or a session shape without a delegation chain).
 */
export const startClaimHandoff = async (): Promise<boolean> => {
	// Open the tab synchronously, inside the click's call stack: signing the
	// handoff takes two awaits, and Safari blocks a popup opened after the
	// gesture has unwound. The blank tab is navigated once the blob is ready,
	// and closed if signing cannot proceed.
	const portalWindow = window.open('', '_blank', 'noopener,noreferrer');

	try {
		const identity = await getIdentity();

		if (isNullish(identity) || !(identity instanceof DelegationIdentity)) {
			portalWindow?.close();

			return false;
		}

		const principal = identity.getPrincipal().toText();
		const issuedAtMs = Date.now();
		const signature = await identity.sign(claimMessageBytes({ principal, issuedAtMs }));
		const blob = encodeClaimBlob({
			v: 1,
			aud: CLAIM_AUDIENCE,
			principal,
			issuedAtMs,
			chain: identity.getDelegation().toJSON(),
			sig: bytesToBase64Url(new Uint8Array(signature))
		});

		const href = `${CLAIM_PORTAL_URL}#${blob}`;

		if (nonNullish(portalWindow)) {
			portalWindow.location.href = href;

			return true;
		}

		// The pre-open was blocked (or unavailable): fall back to an anchor
		// click, which some browsers still honour for the original gesture.
		const anchor = document.createElement('a');

		anchor.href = href;
		anchor.target = '_blank';
		anchor.rel = 'noopener noreferrer';
		anchor.click();

		return true;
	} catch (err: unknown) {
		portalWindow?.close();

		throw err;
	}
};

export type ClaimSubmitOutcome =
	| { kind: 'linked' | 'already_linked'; principal: string }
	| { kind: 'error'; code: 'invalid' | 'stale' | 'conflict' | 'generic' };

/**
 * Submit a handoff blob to the API (portal side). Maps the stable API error
 * codes onto the portal's message states; an expired delegation reads as a
 * stale link to the user, since the fix is the same: redo the handoff.
 */
export const submitClaimBlob = async (blob: string): Promise<ClaimSubmitOutcome> => {
	try {
		const { principal, alreadyLinked } = await postClaim({ blob });

		return { kind: alreadyLinked ? 'already_linked' : 'linked', principal };
	} catch (err: unknown) {
		if (err instanceof Web2ApiError) {
			if (err.code === 'principal_already_linked') {
				return { kind: 'error', code: 'conflict' };
			}

			if (err.code === 'stale_claim' || err.code === 'expired_delegation') {
				return { kind: 'error', code: 'stale' };
			}

			if (err.code === 'invalid_claim') {
				return { kind: 'error', code: 'invalid' };
			}
		}

		console.error('claim submit failed', err);

		return { kind: 'error', code: 'generic' };
	}
};
