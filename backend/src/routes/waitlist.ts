// The handle waitlist's public surface: a signed-out visitor asks for a code
// for a handle and an email, confirms it, reads the reservation back with a
// status token, and removes it from the link every email carries. None of it
// creates an account or a session. Plus the admin's removal.

import { isNullish } from '@dfinity/utils';
import { Elysia, t } from 'elysia';
import { normalizeReferralCode } from '../account/referrals';
import { forbidden, requireAdmin, requireUser, unauthenticated } from '../auth/guard';
import { UUID_RE } from '../lib/constants';
import { badRequest, clientIp, serviceUnavailable, type StatusContext } from '../lib/http';
import { enforceLimit, limitedAnswer } from '../lib/rate-limit';
import { TEN_MINUTES_IN_MS } from '../lib/time';
import {
	MAX_TURNSTILE_TOKEN_LENGTH,
	turnstileRefusal,
	verifyTurnstileToken
} from '../lib/turnstile';
import { REGISTERED_LOCALE_IDS } from '../markets/locales';
import { MAX_HANDLE_LENGTH } from '../profiles/nickname';
import { normalizeChallengeId } from '../social/challenges';
import { DisposableListMissingError, isDisposableEmail } from '../waitlist/mailbox';
import {
	MAX_INVITE_FIELD_LENGTH,
	MAX_PRIVACY_VERSION_LENGTH,
	MAX_WAITLIST_CODE_LENGTH,
	MAX_WAITLIST_TOKEN_LENGTH,
	WAITLIST_CODE_TTL_MS,
	WAITLIST_CODE_TURNSTILE_ACTION,
	WAITLIST_SOURCES,
	WaitlistError,
	WaitlistSendLimitedError,
	assertWaitlistHandle,
	captureWaitlistEvent,
	confirmWaitlistCode,
	deleteWaitlistReservationByEmail,
	parseWaitlistEmail,
	readWaitlistStatus,
	removeWaitlistReservation,
	requestWaitlistCode,
	type WaitlistErrorCode,
	type WaitlistRefusalLabel
} from '../waitlist/reservations';

export const WAITLIST_CODE_LIMIT_PER_TEN_MINUTES = 5;
export const WAITLIST_CONFIRM_LIMIT_PER_TEN_MINUTES = 15;
export const WAITLIST_STATUS_LIMIT_PER_TEN_MINUTES = 30;
export const WAITLIST_REMOVE_LIMIT_PER_TEN_MINUTES = 10;

const WAITLIST_ERROR_STATUS: Record<WaitlistErrorCode, number> = {
	email_invalid: 400,
	email_not_accepted: 400,
	handle_invalid: 400,
	handle_taken: 409,
	invalid_code: 401,
	expired_code: 410
};

const refuse = ({
	set,
	code
}: {
	set: StatusContext;
	code: WaitlistErrorCode;
}): { error: string } => {
	set.status = WAITLIST_ERROR_STATUS[code];

	return { error: code };
};

const recordRefusal = (label: WaitlistRefusalLabel): Promise<void> =>
	captureWaitlistEvent({ name: 'waitlist_join_refused', props: { label } });

const literals = <T extends string>(values: readonly T[]) =>
	t.Union(values.map((v) => t.Literal(v)));

export const waitlistRoutes = new Elysia({ prefix: '/api/v1/waitlist' })
	.post(
		'/code',
		async ({ body, request, set }) => {
			const ip = clientIp(request);
			const limited = enforceLimit({
				set,
				name: 'waitlist_code',
				ip,
				limit: WAITLIST_CODE_LIMIT_PER_TEN_MINUTES,
				windowMs: TEN_MINUTES_IN_MS
			});

			if (limited) {
				return limited;
			}

			// Every request sends an email to an address the caller typed, so each
			// one costs a fresh solve of its own action.
			const refused = turnstileRefusal({
				set,
				verdict: await verifyTurnstileToken({
					token: body.turnstileToken,
					ip,
					action: WAITLIST_CODE_TURNSTILE_ACTION
				})
			});

			if (refused) {
				await recordRefusal('bot_check_failed');

				return refused;
			}

			let email: string;

			try {
				email = parseWaitlistEmail(body.email);

				if (await isDisposableEmail(email)) {
					throw new WaitlistError('email_not_accepted');
				}

				assertWaitlistHandle(body.handle);
			} catch (err) {
				if (err instanceof WaitlistError) {
					await recordRefusal(err.code);

					return refuse({ set, code: err.code });
				}

				if (err instanceof DisposableListMissingError) {
					return serviceUnavailable(set, 'waitlist_unconfigured');
				}

				throw err;
			}

			await captureWaitlistEvent({
				name: 'waitlist_code_requested',
				props: { source: body.source, locale: body.locale }
			});

			try {
				await requestWaitlistCode({
					handle: body.handle,
					email,
					privacyVersion: body.privacyVersion,
					source: body.source,
					locale: body.locale,
					// A link a visitor arrived through is credit, never a reason to
					// refuse: a malformed one is dropped.
					referralCode: isNullish(body.referralCode)
						? undefined
						: normalizeReferralCode(body.referralCode),
					challengeId: isNullish(body.challengeId)
						? undefined
						: normalizeChallengeId(body.challengeId)
				});
			} catch (err) {
				if (err instanceof WaitlistError) {
					await recordRefusal(err.code);

					return refuse({ set, code: err.code });
				}

				if (err instanceof WaitlistSendLimitedError) {
					await recordRefusal('rate_limited');

					return limitedAnswer({ set, result: { ok: false, retryAfterSec: err.retryAfterSec } });
				}

				throw err;
			}

			set.headers['cache-control'] = 'no-store';

			return { ok: true, codeTtlMs: WAITLIST_CODE_TTL_MS };
		},
		{
			body: t.Object({
				handle: t.String({ maxLength: MAX_HANDLE_LENGTH }),
				email: t.String(),
				turnstileToken: t.String({ maxLength: MAX_TURNSTILE_TOKEN_LENGTH }),
				privacyVersion: t.String({ minLength: 1, maxLength: MAX_PRIVACY_VERSION_LENGTH }),
				source: literals(WAITLIST_SOURCES),
				locale: literals(REGISTERED_LOCALE_IDS),
				referralCode: t.Optional(t.String({ maxLength: MAX_INVITE_FIELD_LENGTH })),
				challengeId: t.Optional(t.String({ maxLength: MAX_INVITE_FIELD_LENGTH }))
			})
		}
	)

	.post(
		'/confirm',
		async ({ body, request, set }) => {
			const limited = enforceLimit({
				set,
				name: 'waitlist_confirm',
				ip: clientIp(request),
				limit: WAITLIST_CONFIRM_LIMIT_PER_TEN_MINUTES,
				windowMs: TEN_MINUTES_IN_MS
			});

			if (limited) {
				return limited;
			}

			try {
				const confirmation = await confirmWaitlistCode({ email: body.email, code: body.code });

				await captureWaitlistEvent({
					name: 'waitlist_joined',
					props: {
						source: confirmation.source,
						label: confirmation.label,
						ok: confirmation.invited,
						locale: confirmation.locale
					}
				});

				set.headers['cache-control'] = 'no-store';

				return { handle: confirmation.handle, statusToken: confirmation.statusToken };
			} catch (err) {
				if (err instanceof WaitlistError) {
					await recordRefusal(err.code);

					return refuse({ set, code: err.code });
				}

				throw err;
			}
		},
		{
			body: t.Object({
				email: t.String(),
				code: t.String({ maxLength: MAX_WAITLIST_CODE_LENGTH })
			})
		}
	)

	.post(
		'/status',
		async ({ body, request, set }) => {
			const limited = enforceLimit({
				set,
				name: 'waitlist_status',
				ip: clientIp(request),
				limit: WAITLIST_STATUS_LIMIT_PER_TEN_MINUTES,
				windowMs: TEN_MINUTES_IN_MS
			});

			if (limited) {
				return limited;
			}

			const status = await readWaitlistStatus(body.statusToken);

			set.headers['cache-control'] = 'no-store';

			if (isNullish(status)) {
				set.status = 404;

				return { error: 'not_found' };
			}

			return status;
		},
		{ body: t.Object({ statusToken: t.String({ maxLength: MAX_WAITLIST_TOKEN_LENGTH }) }) }
	)

	.post(
		'/remove',
		async ({ body, request, set }) => {
			const limited = enforceLimit({
				set,
				name: 'waitlist_remove',
				ip: clientIp(request),
				limit: WAITLIST_REMOVE_LIMIT_PER_TEN_MINUTES,
				windowMs: TEN_MINUTES_IN_MS
			});

			if (limited) {
				return limited;
			}

			// The same answer whether or not the link named a reservation.
			if (UUID_RE.test(body.id)) {
				await removeWaitlistReservation({ id: body.id, token: body.token });
			}

			return { removed: true };
		},
		{
			body: t.Object({
				id: t.String({ maxLength: MAX_WAITLIST_TOKEN_LENGTH }),
				token: t.String({ maxLength: MAX_WAITLIST_TOKEN_LENGTH })
			})
		}
	)

	.delete(
		'/admin/reservations',
		async ({ body, request, set }) => {
			const user = await requireUser(request);

			if (isNullish(user)) {
				return unauthenticated(set);
			}

			if (isNullish(requireAdmin(user))) {
				return forbidden(set);
			}

			try {
				return { removed: await deleteWaitlistReservationByEmail(body.email) };
			} catch (err) {
				if (err instanceof WaitlistError) {
					return badRequest(set, err.code);
				}

				throw err;
			}
		},
		{ body: t.Object({ email: t.String() }) }
	);
