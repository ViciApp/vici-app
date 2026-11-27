import {
	HUMAN_PROOF_RENEW_MARGIN_MS,
	TURNSTILE_ACTION_HANDLE_CHECK
} from '#lib/constants/turnstile.constants.ts';
import { isSignedIn } from '#lib/services/identity.services.ts';
import { checkNicknameAvailability } from '#lib/services/profile.services.ts';
import { acquireTurnstileToken } from '#lib/services/turnstile.services.ts';
import {
	handleProbeFailure,
	handleProbeRoute,
	latchesPublicProbe,
	type HandleProbeFailure
} from '#lib/utils/handle-probe.utils.ts';
import { handleFormatIssue, type HandleRefusal } from '#lib/utils/handle.utils.ts';
import { createHumanProofCache } from '#lib/utils/human-proof-cache.utils.ts';
import {
	ApiError,
	checkNicknameAvailabilityPublic as checkNicknameAvailabilityPublicApi,
	issueNicknameCheckProof
} from '#lib/web2/client.ts';
import { nonNullish } from '@dfinity/utils';

export type PublicHandleAvailability =
	{ available: true } | { available: false; reason: HandleRefusal };

// Where a challenge renders when Cloudflare shows one: the latest call's
// host, never a stale one from a surface that has since unmounted.
let challengeHost: HTMLElement | undefined;

const proofs = createHumanProofCache({
	issue: async () =>
		await issueNicknameCheckProof({
			turnstileToken: await acquireTurnstileToken({
				action: TURNSTILE_ACTION_HANDLE_CHECK,
				container: challengeHost
			})
		}),
	marginMs: HUMAN_PROOF_RENEW_MARGIN_MS
});

// The API's refusal once it has said it cannot run the bot check at all. A
// server without its secret stays that way until it is redeployed, so every
// later probe in this page answers with it rather than solving Turnstile and
// asking for a proof again, which would also spend the visitor's proof quota
// and turn the hint into a rate limit.
let unconfiguredRefusal: ApiError | undefined;

const isProofRefused = (err: unknown): boolean =>
	err instanceof ApiError && err.code === 'human_proof_required';

/**
 * Whether a signed-out visitor can claim `handle`, for the sign-up surfaces
 * that probe as the visitor types. Format and reserved handles are answered
 * locally with the app's rules, so only a well-formed handle reaches the
 * network. The first probe solves one Turnstile check and trades
 * it for a short-lived proof that every later probe reuses; a proof the
 * server no longer accepts (expired, or the visitor's IP changed) is renewed
 * once and the probe retried. Pass `challengeHost` to place a challenge in the
 * page when Cloudflare asks the visitor to interact.
 *
 * Throws on a network failure, a refused bot check or a rate limit
 * ({@link ApiError} `rate_limited`); the caller treats any throw as
 * "could not verify", like the signed-in probe. After the API answers
 * `turnstile_unconfigured`, every later call in the page throws that refusal
 * again without contacting Cloudflare or the API.
 */
export const checkHandleAvailabilityPublic = async ({
	handle,
	challengeHost: host
}: {
	handle: string;
	challengeHost?: HTMLElement;
}): Promise<PublicHandleAvailability> => {
	const issue = handleFormatIssue(handle);

	if (nonNullish(issue)) {
		return { available: false, reason: issue };
	}

	if (nonNullish(unconfiguredRefusal)) {
		throw unconfiguredRefusal;
	}

	challengeHost = host;

	const probe = async () =>
		await checkNicknameAvailabilityPublicApi({ nickname: handle, proof: await proofs.get() });

	const probeRenewingProof = async () => {
		try {
			return await probe();
		} catch (err: unknown) {
			if (!isProofRefused(err)) {
				throw err;
			}

			proofs.invalidate();

			return await probe();
		}
	};

	try {
		return await probeRenewingProof();
	} catch (err: unknown) {
		if (err instanceof ApiError && latchesPublicProbe(err.code)) {
			unconfiguredRefusal = err;
		}

		throw err;
	}
};

/**
 * The live probe of a handle picker that serves both signed-in users and
 * visitors before sign-up. A signed-in user gets
 * {@link checkNicknameAvailability}; a signed-out visitor gets
 * {@link checkHandleAvailabilityPublic}, whose proof is cached
 * across calls. Neither answer is the final word: whoever claims the handle
 * re-checks it with the session probe once signed in.
 *
 * Throws like the probe it routes to; read the error with
 * {@link handleProbeFailureOf}.
 */
export const checkHandleAvailability = async ({
	handle
}: {
	handle: string;
}): Promise<PublicHandleAvailability> => {
	const route = handleProbeRoute({ signedIn: await isSignedIn() });

	return route === 'public'
		? await checkHandleAvailabilityPublic({ handle })
		: await checkNicknameAvailability({ nickname: handle });
};

/** What a throw from {@link checkHandleAvailability} means to the picker. */
export const handleProbeFailureOf = (err: unknown): HandleProbeFailure =>
	handleProbeFailure(err instanceof ApiError ? err.code : undefined);
