import type { JsonnableDelegationChain } from '@icp-sdk/core/identity';

/**
 * Wire contract of the account-claim handoff: the legacy on-chain app signs a
 * short-lived claim message with the delegated session key and encodes the
 * payload plus proof into a URL-fragment blob for the claim portal. The
 * HTTP API mirrors these constants and the message layout; the backend
 * shared-drift suite pins the two sides together.
 *
 * The blob carries no secret: it only proves control of the principal, for a
 * few minutes, to whoever presents it. Treat it like a short-lived bearer
 * proof and never log it.
 */

export const CLAIM_AUDIENCE = 'vici-web2-claim';

export interface ClaimMessageInput {
	principal: string;
	issuedAtMs: number;
}

/** Canonical claim message; the session key signs exactly these bytes. */
export const claimMessageText = ({ principal, issuedAtMs }: ClaimMessageInput): string =>
	`${CLAIM_AUDIENCE}\n${principal}\n${issuedAtMs}`;

export const claimMessageBytes = (input: ClaimMessageInput): Uint8Array =>
	new TextEncoder().encode(claimMessageText(input));

export interface ClaimBlobPayload extends ClaimMessageInput {
	v: 1;
	aud: typeof CLAIM_AUDIENCE;
	/** Full delegation chain (root public key and every signed delegation), so
	 * the proof is verifiable off-chain. */
	chain: JsonnableDelegationChain;
	/** base64url session-key signature over {@link claimMessageBytes}. */
	sig: string;
}

export const bytesToBase64Url = (bytes: Uint8Array): string => {
	let binary = '';

	for (const byte of bytes) {
		binary += String.fromCharCode(byte);
	}

	return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
};

/** Encode the payload into the URL-fragment blob (base64url of its JSON). */
export const encodeClaimBlob = (payload: ClaimBlobPayload): string =>
	bytesToBase64Url(new TextEncoder().encode(JSON.stringify(payload)));
