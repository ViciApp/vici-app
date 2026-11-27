// A short-lived signed proof that the caller at one IP passed a bot check, so
// an anonymous surface probed on every keystroke costs one challenge per
// window instead of one per request. Stateless: an HMAC under the session
// pepper over the scope, the expiry and the IP, so no table backs it and a
// restart never strands a proof. Binding the IP keeps one solved challenge
// from being handed to a fleet; a client whose address changes solves again.

import { isNullish } from '@dfinity/utils';
import { constantTimeEqual, peppered } from './crypto';

// The scope is a server constant, the expiry is digits and the IP comes from a
// request header, which cannot carry a newline: no two inputs sign the same
// bytes.
const signedPayload = ({
	scope,
	expiresAtMs,
	ip
}: {
	scope: string;
	expiresAtMs: number;
	ip: string | null;
}): string => `human-proof\n${scope}\n${expiresAtMs}\n${ip ?? ''}`;

const PROOF_RE = /^(\d{1,15})\.([0-9a-f]{64})$/;

export const issueHumanProof = ({
	scope,
	ip,
	ttlMs,
	nowMs = Date.now()
}: {
	scope: string;
	ip: string | null;
	ttlMs: number;
	nowMs?: number;
}): { proof: string; expiresAtMs: number } => {
	const expiresAtMs = nowMs + ttlMs;

	return {
		proof: `${expiresAtMs}.${peppered(signedPayload({ scope, expiresAtMs, ip }))}`,
		expiresAtMs
	};
};

/** Whether `proof` was issued for this scope and IP and has not expired. Any
 * malformed, tampered or foreign value is simply not a proof. */
export const verifyHumanProof = ({
	proof,
	scope,
	ip,
	nowMs = Date.now()
}: {
	proof: string | undefined;
	scope: string;
	ip: string | null;
	nowMs?: number;
}): boolean => {
	const [, expiresAtText, signature] = PROOF_RE.exec(proof ?? '') ?? [];

	if (isNullish(expiresAtText) || isNullish(signature)) {
		return false;
	}

	const expiresAtMs = Number(expiresAtText);

	if (expiresAtMs <= nowMs) {
		return false;
	}

	return constantTimeEqual(signature, peppered(signedPayload({ scope, expiresAtMs, ip })));
};
