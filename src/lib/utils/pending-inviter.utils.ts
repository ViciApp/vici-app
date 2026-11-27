import { isNullish, nonNullish } from '@dfinity/utils';

/**
 * Who invited a signed-out visitor, as the pending-onboarding payload records it: a referral code
 * (an invite link, a league invite's `?ref=`, a share link's `?ref=`) or a challenge link. The
 * payload holds one of them, never both.
 */
export type PendingInviter = { referralCode: string } | { challengeId: string };

/** A stored value as a payload object; anything else reads as empty. */
export const pendingPayloadOf = (raw: string | null | undefined): Record<string, unknown> => {
	if (isNullish(raw)) {
		return {};
	}

	try {
		const value: unknown = JSON.parse(raw);

		return typeof value === 'object' && nonNullish(value) ? (value as Record<string, unknown>) : {};
	} catch {
		return {};
	}
};

/** Whether the payload already holds a referral code (a challenge link does not count). */
export const hasPendingReferralCode = (payload: Record<string, unknown>): boolean =>
	typeof payload.referralCode === 'string' && payload.referralCode.length > 0;

/**
 * The payload crediting `inviter`, the last touch: the other channel and its retry counter are
 * removed, every other field (onboarding picks, a league invite) is kept.
 */
export const withPendingInviter = ({
	payload,
	inviter
}: {
	payload: Record<string, unknown>;
	inviter: PendingInviter;
}): Record<string, unknown> => {
	const {
		referralCode: _code,
		challengeId: _challenge,
		referralAttempts: _tries,
		...rest
	} = payload;

	return { ...rest, ...inviter };
};
