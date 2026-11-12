/**
 * School-email verification submissions — backend item B.1.
 *
 * One doc per pending (member, email, school) verification attempt, in
 * the server-owned `school_submissions` collection. The satellite is the
 * ONLY writer (the collection is controllers-scoped); a client never
 * reads or writes these directly. The doc never stores the plaintext
 * 6-digit code — only an `FNV-1a(code|salt)` digest, mirroring the
 * existing referral code-generation idiom (the Sputnik runtime exposes
 * no cryptographic hash). The plaintext code lives only in the email
 * and the single outbound HTTPS-outcall body to `vici-courier`.
 *
 * The doc key (see {@link schoolSubmissionKey}) doubles as the opaque
 * `submissionId` handed back to the FE. It carries a per-send random
 * nonce so every send is an IMMUTABLE new row — a resend never overwrites
 * a prior attempt (in particular it can't clobber an already-`verified`
 * row back to `awaiting` and undercount a school). Spam is bounded by the
 * per-principal / per-email daily rate limit instead. The `${member}/`
 * prefix authorizes verification (only the owner can verify) and scopes
 * the rate-limit + registry scans; the `${schoolId}/` segment scopes the
 * "has this member already verified this school?" check.
 */

import { fnv1a64Hex } from '#lib/utils/hash.utils.ts';

/** Lifecycle of a verification submission. */
export type SchoolSubmissionStatus = 'awaiting' | 'verified' | 'expired';

export interface SchoolSubmissionDoc {
	/** Member principal text — matches the key prefix; authorizes verify. */
	member: string;
	/** Lower-cased school email the code was mailed to. */
	email: string;
	/**
	 * Canonical school id this submission resolves to. For a directory
	 * school it's the `WorldsAffiliationOption.id`; for a brand-new school
	 * it's the normalized-name slug. Server-derived, never client-trusted.
	 */
	schoolId: string;
	/** School display name as picked / typed (carried for new schools). */
	schoolName: string;
	/** Inferred home country (ISO-3166 alpha-2), if known. */
	country: string | null;
	/** Verified email domains for the school — fed into the registry row. */
	domains: string[];
	/** Whether `schoolId` is a new (off-directory) school. */
	isNew: boolean;
	/** `FNV-1a(code|salt)` hex digest. Never the plaintext code. */
	codeHash: string;
	/** Per-submission 128-bit salt (32 hex chars), seeded from `raw_rand`. */
	salt: string;
	/** Wall-clock ms after which the code is dead (~30 min). */
	expiresAtMs: number;
	/** Failed-attempt counter; capped to defend against guessing. */
	attempts: number;
	/** Lifecycle marker. */
	status: SchoolSubmissionStatus;
	/** Submission time (ms). Drives the per-day rate limit. */
	createdAtMs: number;
	/** Set on success — when the code was accepted (ms). */
	verifiedAtMs?: number;
}

/**
 * Digest a code under a per-submission salt for storage / comparison.
 * FNV-1a 64 is cheap and deterministic, adequate to compare a submitted
 * 6-digit code against the stored digest. NOT a cryptographic hash: a
 * 6-digit space is brute-forceable offline, so on-chain storage is not the
 * secrecy boundary (the code only ever leaves via the email + the courier
 * outcall). The real defenses are the attempt cap, TTL, and rate limit.
 */
export const hashSchoolCode = ({ code, salt }: { code: string; salt: string }): string =>
	fnv1a64Hex(`${code}|${salt}`);

/**
 * Unique submission key / `submissionId`: `${member}/${schoolId}/${nonce}`.
 * The `${member}/` prefix binds the row to its owner (verify auth) and
 * scopes per-principal scans; `${schoolId}/` scopes the per-school
 * "already verified?" check; `nonce` (per-send `raw_rand`) makes every
 * send a distinct immutable row so a resend never overwrites a prior —
 * possibly `verified` — attempt.
 */
export const schoolSubmissionKey = ({
	member,
	schoolId,
	nonce
}: {
	member: string;
	schoolId: string;
	nonce: string;
}): string => `${member}/${schoolId}/${nonce}`;
