// The handle waitlist: a signed-out visitor holds a handle for a mailbox they
// prove with a six-digit code. No account, session, profile or VXP is
// created here.
//
// The code lives on the reservation row, never in otp_codes (a row there is
// a sign-in code), and its hash is domain-separated, so a waitlist code can
// never sign anyone in and a sign-in code can never confirm a reservation.
//
// A code request answers the same for every mailbox: one that already signs
// in to an account, or belongs to a legacy account, gets a private email
// instead of a reservation, and nothing on the wire tells the cases apart.
//
// Lock order, the same as every login path (src/auth/adoption.ts): the
// per-email login locks first (the typed address and the mailbox key), then
// the handle key's lock (`lockHandleKey`), which every profile write of a
// handle takes too, so a reservation and a profile can never both take one
// handle.

import { isNullish, nonNullish } from '@dfinity/utils';
import { captureServerEvents, type ServerEventInput } from '../analytics/events';
import { lockLoginEmails } from '../auth/adoption';
import { normalizeEmail } from '../auth/identity';
import { query, tx, type TxQuery } from '../db/client';
import { constantTimeEqual, generateOtp, peppered, randomToken } from '../lib/crypto';
import { sendEmail, type EmailMessage } from '../lib/email';
import { logger } from '../lib/logger';
import { DAY_IN_MS, TEN_MINUTES_IN_MS } from '../lib/time';
import type { AppLocale } from '../markets/locales';
import {
	checkNicknameAvailability,
	handleRuleRefusal,
	handleUniqueKey,
	lockHandleKey
} from '../profiles/nickname';
import {
	waitlistAlreadyMemberEmail,
	waitlistCodeEmail,
	waitlistLegacyAccountEmail,
	waitlistReceiptEmail,
	waitlistRemovedEmail,
	waitlistRemoveUrl
} from './emails';
import { emailMailboxKey } from './mailbox';

/** How long a code works, which is also how long its handle is held pending. */
export const WAITLIST_CODE_TTL_MS = TEN_MINUTES_IN_MS;

/** Guesses one code allows, spent before the compare. */
export const WAITLIST_CODE_MAX_ATTEMPTS = 5;

/** Mails one mailbox may be sent per rolling day, across the code, the
 * already-a-member and the legacy-account emails. */
export const WAITLIST_SENDS_PER_DAY = 5;

/** How long a confirmed handle is held before the re-confirm asks again. */
export const WAITLIST_HOLD_MONTHS = 12;

/** A never-confirmed reservation is deleted this long after its last code request. */
export const WAITLIST_UNCONFIRMED_RETENTION_MS = DAY_IN_MS;

/** The Turnstile action the landing renders its waitlist widget with
 * (mirrored, see backend/README.md "Mirrored constants"). */
export const WAITLIST_CODE_TURNSTILE_ACTION = 'waitlist_code';

/** The landing entry points that open the capsule (mirrored from
 * src/lib/constants/waitlist.constants.ts, and the `source` check of
 * migration 0030). */
export const WAITLIST_SOURCES = ['nav', 'markets', 'footer', 'call'] as const;

export type WaitlistSource = (typeof WAITLIST_SOURCES)[number];

/** RFC 5321's longest deliverable address. */
export const MAX_WAITLIST_EMAIL_LENGTH = 254;

export const MAX_PRIVACY_VERSION_LENGTH = 32;

export const MAX_WAITLIST_CODE_LENGTH = 16;

/** A status token is 32 random bytes in base64url (43 characters). */
export const MAX_WAITLIST_TOKEN_LENGTH = 128;

/** Every refusal the waitlist answers, as the wire codes of its routes. */
export type WaitlistErrorCode =
	| 'email_invalid'
	| 'email_not_accepted'
	| 'handle_invalid'
	| 'handle_taken'
	| 'invalid_code'
	| 'expired_code';

export class WaitlistError extends Error {
	constructor(readonly code: WaitlistErrorCode) {
		super(code);
	}
}

/** Why a request or confirmation was refused, as `waitlist_join_refused`
 * records it: the wire refusals, a bot check or limit, and the two private
 * outcomes the visitor is never told. */
export type WaitlistRefusalLabel =
	WaitlistErrorCode | 'bot_check_failed' | 'rate_limited' | 'already_registered' | 'legacy_account';

/** Records one waitlist event with no user, email, handle or IP; a failed
 * capture is logged and never changes the answer. */
export const captureWaitlistEvent = async (
	event: Omit<ServerEventInput, 'userId'>
): Promise<void> => {
	try {
		await captureServerEvents({ events: [event] });
	} catch (err) {
		logger.error(`waitlist analytics capture failed (${event.name}):`, err);
	}
};

/** What became of a code request; only the server and its analytics know. */
export type WaitlistCodeOutcome = 'code_sent' | 'already_registered' | 'legacy_account';

const codeHash = ({ mailboxKey, code }: { mailboxKey: string; code: string }): string =>
	peppered(`waitlist\n${mailboxKey}\n${code}`);

const statusTokenHash = (token: string): string => peppered(`waitlist-status\n${token}`);

/** The remove link's token: derived from the row id, so nothing extra is
 * stored and every email to one reservation carries the same link. */
export const waitlistRemoveToken = (id: string): string => peppered(`waitlist-remove\n${id}`);

/** The typed address trimmed and lowercased, or a refusal for one that cannot be an address. */
export const parseWaitlistEmail = (raw: string): string => {
	const email = normalizeEmail(raw);
	const at = email.lastIndexOf('@');

	if (
		email === '' ||
		at <= 0 ||
		at === email.length - 1 ||
		email.length > MAX_WAITLIST_EMAIL_LENGTH
	) {
		throw new WaitlistError('email_invalid');
	}

	return email;
};

/** The handle rule, before anything is stored or sent: a reserved name reads as invalid. */
export const assertWaitlistHandle = (handle: string): void => {
	if (nonNullish(handleRuleRefusal(handle))) {
		throw new WaitlistError('handle_invalid');
	}
};

const lockMailbox = async ({
	q,
	email,
	mailboxKey
}: {
	q: TxQuery;
	email: string;
	mailboxKey: string;
}): Promise<void> => {
	await lockLoginEmails({ q, emails: [email, mailboxKey] });
};

const assertHandleAvailable = async ({
	q,
	handle,
	mailboxKey
}: {
	q: TxQuery;
	handle: string;
	mailboxKey: string;
}): Promise<void> => {
	await lockHandleKey({ key: handleUniqueKey(handle), q });

	const result = await checkNicknameAvailability({
		nickname: handle,
		excludeReservationKey: mailboxKey,
		q
	});

	if (!result.available) {
		throw new WaitlistError(result.reason === 'taken' ? 'handle_taken' : 'handle_invalid');
	}
};

/** Whether the mailbox signs in to a live account, or belongs to a legacy one. */
const knownMailbox = async ({
	q,
	mailboxKey
}: {
	q: TxQuery;
	mailboxKey: string;
}): Promise<'already_registered' | 'legacy_account' | undefined> => {
	const [row] = await q<{ member: boolean; legacy: boolean }>(
		`select
		   exists (
		     select 1 from auth_identities ai
		     join users u on u.id = ai.user_id
		     where ai.email_mailbox_key = $1 and u.hard_deleted_at is null
		   ) as member,
		   exists (
		     select 1 from legacy_auth_identities
		     where openid_email_mailbox_key = $1 or profile_email_mailbox_key = $1
		   ) as legacy`,
		[mailboxKey]
	);

	if (row?.member === true) {
		return 'already_registered';
	}

	if (row?.legacy === true) {
		return 'legacy_account';
	}
};

/** Delivery failures are logged and never change an answer, so a route
 * answers the same whether or not the provider took the email. */
const sendQuietly = async (message: EmailMessage): Promise<void> => {
	try {
		await sendEmail(message);
	} catch (err) {
		logger.error('[waitlist] email delivery failed:', err);
	}
};

export interface WaitlistCodeRequest {
	handle: string;
	email: string;
	privacyVersion: string;
	source: WaitlistSource;
	locale: AppLocale;
	referralCode?: string;
	challengeId?: string;
}

/**
 * Stores a fresh code for the mailbox, holding `handle` pending while it
 * lives, and emails it; or, for a mailbox with an account or a legacy
 * account, emails the matching private notice and stores nothing. The
 * handle is checked the same way in all three cases, and only the third
 * holds it. Throws `handle_taken` or `handle_invalid`.
 */
export const requestWaitlistCode = async (
	request: WaitlistCodeRequest
): Promise<WaitlistCodeOutcome> => {
	const { handle, privacyVersion, source, locale, referralCode, challengeId } = request;
	const email = parseWaitlistEmail(request.email);
	const mailboxKey = emailMailboxKey(email);
	const code = generateOtp();

	const result = await tx(async (q) => {
		await lockMailbox({ q, email, mailboxKey });
		await assertHandleAvailable({ q, handle, mailboxKey });

		const known = await knownMailbox({ q, mailboxKey });

		if (nonNullish(known)) {
			return { outcome: known };
		}

		// One live code per mailbox: a fresh request replaces any earlier one
		// with its attempts. A new invite or challenge link replaces the stored
		// one; a request through neither keeps it.
		const [row] = await q<{ id: string }>(
			`insert into waitlist_reservations (
			   email, email_key, pending_handle, code_hash, code_expires_at, code_attempts,
			   locale, consent_at, privacy_version, source, invited_referral_code, invited_challenge_id
			 ) values (
			   $1, $2, $3, $4, now() + make_interval(secs => $5::double precision / 1000), 0,
			   $6, now(), $7, $8, $9, $10
			 )
			 on conflict (email_key) do update set
			   email = excluded.email,
			   pending_handle = excluded.pending_handle,
			   code_hash = excluded.code_hash,
			   code_expires_at = excluded.code_expires_at,
			   code_attempts = 0,
			   locale = excluded.locale,
			   consent_at = excluded.consent_at,
			   privacy_version = excluded.privacy_version,
			   source = excluded.source,
			   invited_referral_code = case
			     when excluded.invited_referral_code is null and excluded.invited_challenge_id is null
			     then waitlist_reservations.invited_referral_code
			     else excluded.invited_referral_code end,
			   invited_challenge_id = case
			     when excluded.invited_referral_code is null and excluded.invited_challenge_id is null
			     then waitlist_reservations.invited_challenge_id
			     else excluded.invited_challenge_id end
			 returning id`,
			[
				email,
				mailboxKey,
				handle,
				codeHash({ mailboxKey, code }),
				WAITLIST_CODE_TTL_MS,
				locale,
				privacyVersion,
				source,
				isNullish(challengeId) ? (referralCode ?? null) : null,
				challengeId ?? null
			]
		);

		if (isNullish(row)) {
			throw new Error('waitlist reservation upsert returned no row');
		}

		return { outcome: 'code_sent' as const, id: row.id };
	});

	if (result.outcome === 'code_sent') {
		await sendQuietly(
			waitlistCodeEmail({
				to: email,
				locale,
				handle,
				code,
				ttlMs: WAITLIST_CODE_TTL_MS,
				removeUrl: waitlistRemoveUrl({ id: result.id, token: waitlistRemoveToken(result.id) })
			})
		);

		return result.outcome;
	}

	await sendQuietly(
		result.outcome === 'already_registered'
			? waitlistAlreadyMemberEmail({ to: email, locale })
			: waitlistLegacyAccountEmail({ to: email, locale })
	);

	return result.outcome;
};

interface ReservationRow {
	id: string;
	email: string;
	handle: string | null;
	pending_handle: string | null;
	code_hash: string | null;
	code_live: boolean;
	code_attempts: number;
	confirmed_at: Date | null;
	locale: string;
	source: WaitlistSource;
	invited_referral_code: string | null;
	invited_challenge_id: string | null;
}

export interface WaitlistConfirmation {
	handle: string;
	statusToken: string;
	/** `new` on the first confirmation, `handle_changed` when it replaced another handle. */
	label: 'new' | 'handle_changed';
	source: WaitlistSource;
	locale: string;
	/** Arrived through an invite or a challenge link. */
	invited: boolean;
}

type ConfirmStep =
	| { kind: 'refused'; code: WaitlistErrorCode }
	| { kind: 'confirmed'; confirmation: WaitlistConfirmation; id: string; email: string };

/** A code that cannot be tried: a never-confirmed row asks for a new one, a
 * confirmed row answers like a wrong code, so the route never tells whether a
 * mailbox is on the list. */
const deadCode = (row: ReservationRow): ConfirmStep => ({
	kind: 'refused',
	code: isNullish(row.confirmed_at) ? 'expired_code' : 'invalid_code'
});

const HELD_HANDLE_INDEX = 'waitlist_reservations_held_handle_uniq';

const isHeldHandleViolation = (err: unknown): boolean =>
	typeof err === 'object' &&
	nonNullish(err) &&
	'code' in err &&
	err.code === '23505' &&
	'constraint' in err &&
	err.constraint === HELD_HANDLE_INDEX;

const confirmStep = async ({
	q,
	email,
	mailboxKey,
	code
}: {
	q: TxQuery;
	email: string;
	mailboxKey: string;
	code: string;
}): Promise<ConfirmStep> => {
	await lockMailbox({ q, email, mailboxKey });

	const [row] = await q<ReservationRow>(
		`select id, email, handle, pending_handle, code_hash, code_attempts, confirmed_at, locale,
		   source, invited_referral_code, invited_challenge_id,
		   coalesce(code_expires_at > now(), false) as code_live
		 from waitlist_reservations where email_key = $1 for update`,
		[mailboxKey]
	);

	if (isNullish(row) || isNullish(row.code_hash) || isNullish(row.pending_handle)) {
		return { kind: 'refused', code: 'invalid_code' };
	}

	if (!row.code_live) {
		return deadCode(row);
	}

	// Spent before the compare, in the statement that checks the budget, so
	// concurrent guesses cannot all slip under it.
	const [spent] = await q<{ code_hash: string }>(
		`update waitlist_reservations set code_attempts = code_attempts + 1
		 where id = $1 and code_attempts < $2
		 returning code_hash`,
		[row.id, WAITLIST_CODE_MAX_ATTEMPTS]
	);

	if (isNullish(spent)) {
		return deadCode(row);
	}

	if (!constantTimeEqual(spent.code_hash, codeHash({ mailboxKey, code }))) {
		return { kind: 'refused', code: 'invalid_code' };
	}

	const handle = row.pending_handle;

	try {
		await assertHandleAvailable({ q, handle, mailboxKey });
	} catch (err) {
		if (err instanceof WaitlistError) {
			return { kind: 'refused', code: err.code };
		}

		throw err;
	}

	const statusToken = randomToken();

	await q(
		`update waitlist_reservations set
		   handle = pending_handle,
		   pending_handle = null,
		   code_hash = null,
		   code_expires_at = null,
		   code_attempts = 0,
		   status_token_hash = $2,
		   confirmed_at = coalesce(confirmed_at, now()),
		   expires_at = coalesce(expires_at, now() + make_interval(months => $3))
		 where id = $1`,
		[row.id, statusTokenHash(statusToken), WAITLIST_HOLD_MONTHS]
	);

	return {
		kind: 'confirmed',
		id: row.id,
		email: row.email,
		confirmation: {
			handle,
			statusToken,
			label: nonNullish(row.handle) && row.handle !== handle ? 'handle_changed' : 'new',
			source: row.source,
			locale: row.locale,
			invited: nonNullish(row.invited_referral_code) || nonNullish(row.invited_challenge_id)
		}
	};
};

/**
 * Confirms the mailbox's pending handle with its code: the handle becomes the
 * held one (releasing an earlier one), the code is burnt and the receipt is
 * emailed. Mints no session. Throws `invalid_code`, `expired_code` or
 * `handle_taken`; a wrong code still spends its attempt.
 */
export const confirmWaitlistCode = async ({
	email: rawEmail,
	code
}: {
	email: string;
	code: string;
}): Promise<WaitlistConfirmation> => {
	let email: string;

	try {
		email = parseWaitlistEmail(rawEmail);
	} catch {
		throw new WaitlistError('invalid_code');
	}

	const mailboxKey = emailMailboxKey(email);

	let step: ConfirmStep;

	try {
		step = await tx((q) => confirmStep({ q, email, mailboxKey, code }));
	} catch (err) {
		// The partial unique index is the last resort if the hold ever failed.
		if (isHeldHandleViolation(err)) {
			throw new WaitlistError('handle_taken');
		}

		throw err;
	}

	if (step.kind === 'refused') {
		throw new WaitlistError(step.code);
	}

	await sendQuietly(
		waitlistReceiptEmail({
			to: step.email,
			locale: step.confirmation.locale,
			handle: step.confirmation.handle,
			holdMonths: WAITLIST_HOLD_MONTHS,
			removeUrl: waitlistRemoveUrl({ id: step.id, token: waitlistRemoveToken(step.id) })
		})
	);

	return step.confirmation;
};

/** The state a reservation is in; later parts add `admitted` and `joined`. */
export type WaitlistState = 'waiting';

/** The held handle a status token names, or nothing when it names none. */
export const readWaitlistStatus = async (
	statusToken: string
): Promise<{ handle: string; state: WaitlistState } | undefined> => {
	const [row] = await query<{ handle: string }>(
		`select handle from waitlist_reservations
		 where status_token_hash = $1 and handle is not null and hold_ended_at is null`,
		[statusTokenHash(statusToken)]
	);

	return isNullish(row) ? undefined : { handle: row.handle, state: 'waiting' };
};

const deleteReservation = async ({
	where,
	param
}: {
	where: 'id' | 'email_key';
	param: string;
}): Promise<{ email: string; locale: string; handle: string | null } | undefined> => {
	const [row] = await query<{ email: string; locale: string; handle: string | null }>(
		`delete from waitlist_reservations where ${where} = $1 returning email, locale, handle`,
		[param]
	);

	return row;
};

/**
 * The remove link's button: deletes the reservation the link names, which
 * releases its handle at once, and emails the confirmation to the address
 * just deleted. A wrong token removes nothing; the caller answers the same
 * either way.
 */
export const removeWaitlistReservation = async ({
	id,
	token
}: {
	id: string;
	token: string;
}): Promise<void> => {
	if (!constantTimeEqual(token, waitlistRemoveToken(id))) {
		return;
	}

	const removed = await deleteReservation({ where: 'id', param: id });

	if (nonNullish(removed)) {
		await sendQuietly(
			waitlistRemovedEmail({ to: removed.email, locale: removed.locale, handle: removed.handle })
		);
	}
};

/** The admin's removal (on report, or a request by mail): whether a reservation was deleted. */
export const deleteWaitlistReservationByEmail = async (rawEmail: string): Promise<boolean> => {
	const removed = await deleteReservation({
		where: 'email_key',
		param: emailMailboxKey(parseWaitlistEmail(rawEmail))
	});

	return nonNullish(removed);
};

/** Deletes never-confirmed reservations a day after their last code request; the number removed. */
export const pruneWaitlist = async (): Promise<number> => {
	const rows = await query<{ id: string }>(
		`delete from waitlist_reservations
		 where confirmed_at is null
		   and code_expires_at <= now() - make_interval(secs => $1::double precision / 1000)
		 returning id`,
		[WAITLIST_UNCONFIRMED_RETENTION_MS - WAITLIST_CODE_TTL_MS]
	);

	return rows.length;
};
