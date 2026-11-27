import { CHALLENGE_CONTEXT_TTL_MS } from '#lib/constants/challenge.constants.ts';
import { parseChallengeId } from '#lib/utils/challenge.utils.ts';
import { isNullish, notEmptyString } from '@dfinity/utils';

/**
 * The challenge link a visitor opened, kept until their own call on its market records the answer
 * (after a sign-up, or from the market detail). It holds the link and the market only: the side
 * and the price of the answer are read by the server from the engine. Stored by
 * `challenge.services.ts`; this module is the pure shape and expiry.
 */
export interface ChallengeContext {
	id: string;
	seriesId: string;
	/** When the link was opened; the context lapses {@link CHALLENGE_CONTEXT_TTL_MS} later. */
	atMs: number;
}

/** A stored value as a context, or `undefined` when it is malformed or has lapsed at `nowMs`. */
export const parseChallengeContext = ({
	value,
	nowMs
}: {
	value: unknown;
	nowMs: number;
}): ChallengeContext | undefined => {
	if (typeof value !== 'object' || isNullish(value)) {
		return;
	}

	const { id: rawId, seriesId, atMs } = value as Record<string, unknown>;
	const id = typeof rawId === 'string' ? parseChallengeId(rawId) : undefined;

	if (
		isNullish(id) ||
		typeof seriesId !== 'string' ||
		!notEmptyString(seriesId) ||
		typeof atMs !== 'number' ||
		!Number.isFinite(atMs) ||
		atMs > nowMs ||
		nowMs - atMs >= CHALLENGE_CONTEXT_TTL_MS
	) {
		return;
	}

	return { id, seriesId, atMs };
};
