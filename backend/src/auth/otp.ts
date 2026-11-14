// Email one-time-code flow. Single-use, 10-minute TTL, 5-attempt lockout,
// hashed at rest. The request route always responds identically whether or
// not the address is known, so the endpoint cannot be used as an oracle.

import { isNullish } from '@dfinity/utils';
import { query } from '../db/client';
import { constantTimeEqual, generateOtp, peppered } from '../lib/crypto';
import { sendOtpEmail } from '../lib/email';
import { logger } from '../lib/logger';
import { MINUTE_IN_MS } from '../lib/time';
import { normalizeEmail, resolveIdentity } from './identity';

export const OTP_TTL_MINUTES = 10;
export const OTP_MAX_ATTEMPTS = 5;
/** Live codes one address may hold at once. Each code gets its own attempts,
 * so without a cap a fresh request would buy a fresh set of guesses. */
export const OTP_MAX_LIVE_CODES = 3;

interface OtpRow {
	id: string;
	code_hash: string;
}

/** Store a fresh code for the address; the plaintext code (for delivery).
 * Exported separately from `requestOtp` so tests can drive the verify path
 * without intercepting email. */
export const createOtp = async (email: string): Promise<string> => {
	const e = normalizeEmail(email);
	const code = generateOtp();
	const expiresAt = new Date(Date.now() + OTP_TTL_MINUTES * MINUTE_IN_MS);

	// Opportunistic cleanup of expired codes for this address.
	await query(`delete from otp_codes where lower(email) = $1 and expires_at <= now()`, [e]);

	await query(`insert into otp_codes (email, code_hash, expires_at) values ($1, $2, $3)`, [
		e,
		peppered(code),
		expiresAt
	]);

	return code;
};

/** Issue and deliver a code. Delivery failures are logged server-side and
 * never change the route response, so the response stays identical for every
 * address. */
export const requestOtp = async (email: string): Promise<void> => {
	const e = normalizeEmail(email);
	const [live] = await query<{ count: number }>(
		`select count(*)::int as count from otp_codes where lower(email) = $1 and expires_at > now()`,
		[e]
	);

	if ((live?.count ?? 0) >= OTP_MAX_LIVE_CODES) {
		logger.warn(`[otp] ${e} already holds ${OTP_MAX_LIVE_CODES} live codes; none issued`);

		return;
	}

	const code = await createOtp(e);

	try {
		await sendOtpEmail(e, code);
	} catch (err) {
		logger.error(`[otp] delivery failed for ${e}:`, err);
	}
};

export type VerifyResult =
	{ ok: true; userId: string } | { ok: false; reason: 'invalid' | 'locked' };

/** Verify a code. Success resolves (or provisions) the user for the verified
 * address and burns every outstanding code for it (single-use). Every attempt
 * spends one of the code's OTP_MAX_ATTEMPTS before the comparison, in the same
 * statement that checks the budget, so concurrent guesses cannot all slip
 * under the limit; a spent code is locked even for the right code. */
export const verifyOtp = async ({
	email,
	code
}: {
	email: string;
	code: string;
}): Promise<VerifyResult> => {
	const e = normalizeEmail(email);

	const latest = await query<{ id: string }>(
		`select id from otp_codes
		 where lower(email) = $1 and expires_at > now()
		 order by created_at desc limit 1`,
		[e]
	);
	const [current] = latest;

	if (isNullish(current)) {
		return { ok: false, reason: 'invalid' };
	}

	const claimed = await query<OtpRow>(
		`update otp_codes set attempts = attempts + 1
		 where id = $1 and attempts < $2
		 returning id, code_hash`,
		[current.id, OTP_MAX_ATTEMPTS]
	);
	const [otp] = claimed;

	if (isNullish(otp)) {
		return { ok: false, reason: 'locked' };
	}

	if (!constantTimeEqual(otp.code_hash, peppered(code))) {
		return { ok: false, reason: 'invalid' };
	}

	await query(`delete from otp_codes where lower(email) = $1`, [e]);

	const userId = await resolveIdentity({ provider: 'email', subject: e, email: e });

	return { ok: true, userId };
};
