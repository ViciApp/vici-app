import {
	HUMAN_PROOF_RENEW_MARGIN_MS,
	TURNSTILE_ACTION_HANDLE_CHECK
} from '#lib/constants/turnstile.constants.ts';
import { checkNicknameAvailability } from '#lib/services/profile.services.ts';
import { acquireTurnstileToken } from '#lib/services/turnstile.services.ts';
import { createHumanProofCache } from '#lib/utils/human-proof-cache.utils.ts';
import { nicknameFormatIssue, type NicknameFormatIssue } from '#lib/utils/nickname.utils.ts';
import { isWeb2Backend } from '#lib/web2/backend-mode.ts';
import {
	checkNicknameAvailabilityPublic as checkNicknameAvailabilityPublicWeb2,
	issueNicknameCheckProof,
	Web2ApiError
} from '#lib/web2/client.ts';
import { nonNullish } from '@dfinity/utils';

export type PublicHandleAvailability =
	{ available: true } | { available: false; reason: NicknameFormatIssue | 'taken' };

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

const isProofRefused = (err: unknown): boolean =>
	err instanceof Web2ApiError && err.code === 'human_proof_required';

/**
 * Whether a signed-out visitor can claim `handle`, for the sign-up surfaces
 * that probe as the visitor types. Format and reserved handles are answered
 * locally with the app's rules, so only a well-formed handle reaches the
 * network. In web2 mode the first probe solves one Turnstile check and trades
 * it for a short-lived proof that every later probe reuses; a proof the
 * server no longer accepts (expired, or the visitor's IP changed) is renewed
 * once and the probe retried. Pass `challengeHost` to place a challenge in the
 * page when Cloudflare asks the visitor to interact.
 *
 * Throws on a network failure, a refused bot check or a rate limit
 * ({@link Web2ApiError} `rate_limited`); the caller treats any throw as
 * "could not verify", like the signed-in probe.
 */
export const checkHandleAvailabilityPublic = async ({
	handle,
	challengeHost: host
}: {
	handle: string;
	challengeHost?: HTMLElement;
}): Promise<PublicHandleAvailability> => {
	const issue = nicknameFormatIssue(handle);

	if (nonNullish(issue)) {
		return { available: false, reason: issue };
	}

	// The satellite's probe is an anonymous query already.
	if (!isWeb2Backend()) {
		return await checkNicknameAvailability({ nickname: handle });
	}

	challengeHost = host;

	const probe = async () =>
		await checkNicknameAvailabilityPublicWeb2({ nickname: handle, proof: await proofs.get() });

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
