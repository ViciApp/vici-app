/**
 * School membership verification — submit + 6-digit code (backend B.1).
 *
 * Thin FE wrapper over the two satellite endpoints:
 *
 *   functions.submitSchool({ name, country?, schoolId?, email, locale })
 *     -> { submissionId }
 *     · the satellite re-runs the `spMatchEmail` domain gate, rate-limits,
 *       mints a `raw_rand` 6-digit code, stores its digest (~30-min TTL +
 *       attempt cap), and mails it via the `vici-courier` relay.
 *
 *   functions.verifySchoolCode({ submissionId, code })
 *     -> { ok, schoolId?, status?, message? }
 *     · on success the satellite attaches the school (bumps the verified-
 *       member count, public at 3) and flips the owner's profile
 *       `schoolStatus`.
 *
 * Both round-trips are wrapped in a hard timeout (mirroring
 * `worlds.services.ts`) so the picker's "Sending…" / "Verifying…"
 * spinners can never hang indefinitely. The call signatures are kept so
 * the picker only has to pass the active `locale`.
 *
 * Reachable only when `SCHOOL_PASS2_ENABLED` is on. Note: in any given
 * environment `submitSchool` also needs the `vici-courier` relay deployed
 * and the `app_config/school_relay` doc set there, otherwise the server
 * returns a "relay not configured" error instead of mailing a code.
 */

import { functions } from '#declarations/satellite/satellite.api.ts';
import type { AppLocale } from '#lib/constants/locale.constants.ts';
import { withTimeout } from '#lib/utils/async.utils.ts';
import { isWeb2Backend } from '#lib/web2/backend-mode.ts';
import {
	submitSchool as submitSchoolWeb2,
	verifySchoolCode as verifySchoolCodeWeb2
} from '#lib/web2/client.ts';

/** Hard timeout for either verification round-trip. */
const SCHOOL_VERIFY_TIMEOUT_MS = 15_000;

export interface SchoolSubmitInput {
	/** School display name as the user typed / picked it. */
	name: string;
	/** Inferred home country (ISO-3166 alpha-2). */
	country: string | null;
	/** The school email the code is sent to. */
	email: string;
	/** Set when verifying membership of an existing directory school. */
	schoolId?: string;
	/** Active UI locale — forwarded so the emailed code is localized. */
	locale: AppLocale;
}

export interface SchoolSubmitResult {
	/** Opaque handle echoed back to {@link verifySchoolCode}. */
	submissionId: string;
}

export interface SchoolVerifyInput {
	submissionId: string;
	/** Six-digit numeric code from the user's inbox. */
	code: string;
}

export interface SchoolVerifyResult {
	ok: boolean;
	/** Present on success — the canonical school id to attach. */
	schoolId?: string;
	/** Present on success — the resulting school visibility. */
	status?: 'pending' | 'public';
	/** Present on failure — a machine-readable reason. */
	message?: string;
}

/**
 * `POST /schools/submit`. Asks the satellite to mail a fresh 6-digit code
 * to `email`. Throws on transport failure / timeout / server rejection
 * (bad domain, rate limit, relay unconfigured) — the picker maps that to
 * its "couldn't send" copy.
 */
export const submitSchool = async ({
	name,
	country,
	email,
	schoolId,
	locale
}: SchoolSubmitInput): Promise<SchoolSubmitResult> => {
	// The HTTP route re-resolves the school from the email domain (plus
	// name/country for a new entry) server-side, so the `schoolId` hint is
	// not part of its contract; the same shared timeout wraps both transports.
	const { submissionId } = await withTimeout({
		operation: isWeb2Backend()
			? submitSchoolWeb2({ name, country, email, locale })
			: functions.submitSchool({
					name,
					country: country ?? undefined,
					schoolId: schoolId ?? undefined,
					email,
					locale
				}),
		timeoutMs: SCHOOL_VERIFY_TIMEOUT_MS,
		label: 'submitSchool'
	});

	return { submissionId };
};

/**
 * `POST /schools/verify`. Submits the entered code. Resolves to
 * `{ ok: false, message }` on a wrong / expired / capped code (the picker
 * keeps the user on the same screen) and `{ ok: true, schoolId, status }`
 * on success.
 */
export const verifySchoolCode = async ({
	submissionId,
	code
}: SchoolVerifyInput): Promise<SchoolVerifyResult> => {
	const result = await withTimeout({
		operation: isWeb2Backend()
			? verifySchoolCodeWeb2({ submissionId, code })
			: functions.verifySchoolCode({ submissionId, code }),
		timeoutMs: SCHOOL_VERIFY_TIMEOUT_MS,
		label: 'verifySchoolCode'
	});

	return {
		ok: result.ok,
		schoolId: result.schoolId,
		status: result.status,
		message: result.message
	};
};
