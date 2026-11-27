import {
	LANDING_CLAIM_CODE_LENGTH,
	LANDING_CLAIM_HANDLE_STORAGE_KEY
} from '#lib/constants/landing-claim.constants.ts';
import { MAX_HANDLE_LENGTH, MIN_HANDLE_LENGTH } from '#lib/constants/profile.constants.ts';
import type {
	LandingClaimCheck,
	LandingClaimNotice,
	LandingClaimRefusal,
	LandingClaimStep
} from '#lib/types/landing-claim.ts';
import { handleFormatIssue } from '#lib/utils/handle.utils.ts';
import type { MessageKey } from '#lib/utils/i18n.utils.ts';
import { isNullish, nonNullish } from '@dfinity/utils';

export type LandingClaimTone = 'quiet' | 'yes' | 'no';

/** The capsule's status line: a catalog key, or a line the page already wrote. */
export type LandingClaimLine =
	| { key: MessageKey; params?: Record<string, string | number>; tone: LandingClaimTone }
	| { text: string; tone: LandingClaimTone };

const KNOWN_REFUSALS: readonly LandingClaimRefusal[] = [
	'handle_taken',
	'invalid_code',
	'expired_code',
	'rate_limited',
	'email_invalid'
];

/** The capsule's reading of a waitlist error code; an unknown code is a generic failure. */
export const landingClaimRefusalOf = (code: string): LandingClaimRefusal =>
	KNOWN_REFUSALS.find((refusal) => refusal === code) ?? 'failed';

/** Loose shape check before a code is sent: the waitlist validates the address for real. */
export const isLikelyEmail = (email: string): boolean => /^\S+@\S+\.\S+$/.test(email.trim());

/** Digits only, as many as a code has: pasted spaces and dashes fall away. */
export const cleanClaimCode = (raw: string): string =>
	raw.replace(/\D/g, '').slice(0, LANDING_CLAIM_CODE_LENGTH);

/** The probe state a typed handle starts in before the network answers. */
export const localClaimCheck = (handle: string): LandingClaimCheck => {
	const issue = handleFormatIssue(handle);

	if (isNullish(issue)) {
		return { kind: 'checking' };
	}

	return issue === 'required' ? { kind: 'idle' } : { kind: 'format', issue };
};

const handleLine = ({
	handle,
	check,
	ack
}: {
	handle: string;
	check: LandingClaimCheck;
	ack: string | undefined;
}): LandingClaimLine => {
	switch (check.kind) {
		case 'checking':
			return { key: 'landing.claim.checking', params: { handle }, tone: 'quiet' };
		case 'free':
			return { key: 'landing.claim.free', params: { handle }, tone: 'yes' };
		case 'taken':
			return { key: 'landing.claim.taken', params: { handle }, tone: 'no' };
		case 'failed':
			return { key: 'landing.claim.check_failed', tone: 'no' };
		case 'format':
			if (check.issue === 'too_short') {
				return {
					key: 'landing.claim.too_short',
					params: { min: MIN_HANDLE_LENGTH },
					tone: 'quiet'
				};
			}

			if (check.issue === 'too_long') {
				return { key: 'landing.claim.too_long', params: { max: MAX_HANDLE_LENGTH }, tone: 'no' };
			}

			if (check.issue === 'invalid') {
				return { key: 'landing.claim.invalid', tone: 'no' };
			}

			if (check.issue === 'reserved') {
				return { key: 'landing.claim.taken', params: { handle }, tone: 'no' };
			}

			break;
	}

	return nonNullish(ack) && ack !== ''
		? { text: ack, tone: 'quiet' }
		: { key: 'landing.claim.intro', tone: 'quiet' };
};

const REFUSAL_KEYS: Record<Exclude<LandingClaimRefusal, 'failed'>, MessageKey> = {
	handle_taken: 'landing.claim.taken_meanwhile',
	invalid_code: 'landing.claim.code_wrong',
	expired_code: 'landing.claim.code_expired',
	rate_limited: 'landing.claim.rate_limited',
	email_invalid: 'landing.claim.email_invalid'
};

const FAILED_KEYS: Record<LandingClaimStep, MessageKey> = {
	handle: 'landing.claim.check_failed',
	email: 'landing.claim.send_failed',
	code: 'landing.claim.confirm_failed',
	done: 'landing.claim.done'
};

const BUSY_KEYS: Record<Exclude<LandingClaimStep, 'handle'>, MessageKey> = {
	email: 'landing.claim.sending',
	code: 'landing.claim.confirming',
	done: 'landing.claim.done'
};

/**
 * The one line the capsule's tray shows. A notice (busy, or the last refusal)
 * wins over the step's own line until the visitor acts again; on the handle
 * step a line the page passed when it opened the capsule (`ack`) stands in
 * for the prompt until something is typed.
 */
export const landingClaimLine = ({
	step,
	handle,
	email,
	check,
	notice,
	ack
}: {
	step: LandingClaimStep;
	handle: string;
	email: string;
	check: LandingClaimCheck;
	notice: LandingClaimNotice;
	ack?: string;
}): LandingClaimLine => {
	if (step === 'done') {
		return { key: 'landing.claim.done', tone: 'yes' };
	}

	if (notice.kind === 'busy') {
		return step === 'handle'
			? { key: 'landing.claim.checking', params: { handle }, tone: 'quiet' }
			: { key: BUSY_KEYS[step], tone: 'quiet' };
	}

	if (notice.kind === 'refused') {
		const { refusal } = notice;

		return refusal === 'failed'
			? { key: FAILED_KEYS[step], tone: 'no' }
			: { key: REFUSAL_KEYS[refusal], params: { handle }, tone: 'no' };
	}

	if (step === 'email') {
		return { key: 'landing.claim.email_prompt', params: { handle }, tone: 'quiet' };
	}

	if (step === 'code') {
		return {
			key: 'landing.claim.code_prompt',
			params: { email: email.trim(), digits: LANDING_CLAIM_CODE_LENGTH },
			tone: 'quiet'
		};
	}

	return handleLine({ handle, check, ack });
};

/** The handle this browser last put on the waitlist, when storage allows it. */
export const readClaimedHandle = (): string | undefined => {
	try {
		const handle = localStorage.getItem(LANDING_CLAIM_HANDLE_STORAGE_KEY);

		return nonNullish(handle) && handle !== '' ? handle : undefined;
	} catch {
		// Blocked storage (private mode, previews): no label, nothing else lost.
	}
};

/** Remembers the claimed handle for the top-bar label; a blocked storage only loses the label. */
export const rememberClaimedHandle = (handle: string): void => {
	try {
		localStorage.setItem(LANDING_CLAIM_HANDLE_STORAGE_KEY, handle);
	} catch {
		// Display convenience only: the waitlist holds the claim.
	}
};
