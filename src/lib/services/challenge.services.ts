import { CHALLENGE_CONTEXT_STORAGE_KEY } from '#lib/constants/challenge.constants.ts';
import type {
	ChallengeAnswer,
	ChallengeAnswerItem,
	ChallengeReadView,
	ChallengeRedeemOutcome,
	OwnChallenge
} from '#lib/types/challenge.ts';
import {
	parseChallengeContext,
	type ChallengeContext
} from '#lib/utils/challenge-context.utils.ts';
import { parseChallengeId } from '#lib/utils/challenge.utils.ts';
import {
	del as storageDel,
	get as storageGet,
	set as storageSet
} from '#lib/utils/storage.utils.ts';
import { isWeb2Backend } from '#lib/web2/backend-mode.ts';
import {
	answerChallenge as answerChallengeWeb2,
	createChallenge as createChallengeWeb2,
	getChallenge as getChallengeWeb2,
	listChallengeAnswers as listChallengeAnswersWeb2,
	listMyChallenges as listMyChallengesWeb2,
	redeemChallenge as redeemChallengeWeb2,
	revokeChallenge as revokeChallengeWeb2,
	setChallengeConsent as setChallengeConsentWeb2,
	Web2ApiError
} from '#lib/web2/client.ts';
import { isNullish, nonNullish } from '@dfinity/utils';

/**
 * Whether challenge links exist in this build. They are served by the HTTP API only: issuing one
 * reads the user's trade history through the custodial engine identity, and the link funnels into
 * a sign-up the on-chain build no longer offers. Components read this and never branch on the
 * backend themselves.
 */
export const areChallengeLinksEnabled = (): boolean => isWeb2Backend();

/** The wire code of a link that cannot be read: unknown, revoked, pruned or its challenger hidden. */
export const CHALLENGE_NOT_FOUND_CODE = 'challenge_not_found';

const assertEnabled = (): void => {
	if (!areChallengeLinksEnabled()) {
		throw new Error('Challenge links are not available in this build');
	}
};

/** The id in its stored form; a malformed one fails like an unknown link, without a request. */
const requireChallengeId = (raw: string): string => {
	const id = parseChallengeId(raw);

	if (isNullish(id)) {
		throw new Web2ApiError({ status: 404, code: CHALLENGE_NOT_FOUND_CODE });
	}

	return id;
};

/**
 * Refusals that a later attempt can turn around: the session lapsed, the redeem ran before the
 * profile existed, or the engine shows no position yet (a resting order that has not filled).
 */
const RETRYABLE_CHALLENGE_CODES: readonly string[] = [
	'unauthenticated',
	'profile_required',
	'no_position'
];

/**
 * Whether a challenge write was refused for good: a 4xx answer (unknown or revoked link, one's own
 * link) that is neither a rate limit nor one of {@link RETRYABLE_CHALLENGE_CODES}. Anything else
 * (network, 429, 5xx) is worth a retry.
 */
export const isTerminalChallengeRefusal = (err: unknown): boolean =>
	err instanceof Web2ApiError &&
	err.status >= 400 &&
	err.status < 500 &&
	err.status !== 429 &&
	!RETRYABLE_CHALLENGE_CODES.includes(err.code);

const isNotFound = (err: unknown): boolean =>
	err instanceof Web2ApiError && err.status === 404 && err.code === CHALLENGE_NOT_FOUND_CODE;

/**
 * Issues the signed-in user's link for a market, or returns their active one (same id). The
 * position on it is whatever the engine says the user holds; only the consent flag is sent.
 */
export const createChallenge = async (params: {
	seriesId: string;
	showIdentity: boolean;
}): Promise<OwnChallenge> => {
	assertEnabled();

	return await createChallengeWeb2(params);
};

/** The public read of a link, or `undefined` when it cannot be read (malformed, unknown, revoked,
 * pruned or its challenger hidden: one outcome for all). */
export const getChallenge = async (rawId: string): Promise<ChallengeReadView | undefined> => {
	assertEnabled();

	const id = parseChallengeId(rawId);

	if (isNullish(id)) {
		return;
	}

	try {
		return await getChallengeWeb2(id);
	} catch (err) {
		if (isNotFound(err)) {
			return;
		}

		throw err;
	}
};

/** The owner turns the identity on the link's public read on or off. */
export const setChallengeConsent = async ({
	id,
	showIdentity
}: {
	id: string;
	showIdentity: boolean;
}): Promise<OwnChallenge> => {
	assertEnabled();

	return await setChallengeConsentWeb2({ id: requireChallengeId(id), showIdentity });
};

/** The owner turns the link off. */
export const revokeChallenge = async (id: string): Promise<void> => {
	assertEnabled();

	await revokeChallengeWeb2(requireChallengeId(id));
};

/** Credits the link's challenger as the signed-in user's referrer, under the referral rules. */
export const redeemChallenge = async (id: string): Promise<ChallengeRedeemOutcome> => {
	assertEnabled();

	return await redeemChallengeWeb2(requireChallengeId(id));
};

/** Records the signed-in user's own call on the link's market as an answer (engine-verified). */
export const answerChallenge = async (id: string): Promise<ChallengeAnswer> => {
	assertEnabled();

	return await answerChallengeWeb2(requireChallengeId(id));
};

/** The signed-in user's active links. */
export const listMyChallenges = async (): Promise<OwnChallenge[]> => {
	assertEnabled();

	return await listMyChallengesWeb2();
};

/** Answers to the signed-in user's links, newest first. */
export const listChallengeAnswers = async (): Promise<ChallengeAnswerItem[]> => {
	assertEnabled();

	return await listChallengeAnswersWeb2();
};

/** Keeps the link the visitor just opened, for the answer; a later link replaces it. */
export const keepChallengeContext = ({ id, seriesId }: { id: string; seriesId: string }): void => {
	storageSet<ChallengeContext>({
		key: CHALLENGE_CONTEXT_STORAGE_KEY,
		value: { id, seriesId, atMs: Date.now() }
	});
};

/** The kept link, while it is live; a lapsed or malformed one is dropped. */
export const readChallengeContext = (): ChallengeContext | undefined => {
	const value = storageGet<unknown>({ key: CHALLENGE_CONTEXT_STORAGE_KEY });

	if (isNullish(value)) {
		return;
	}

	const context = parseChallengeContext({ value, nowMs: Date.now() });

	if (isNullish(context)) {
		storageDel({ key: CHALLENGE_CONTEXT_STORAGE_KEY });
	}

	return context;
};

let answering: Promise<void> | undefined;

/**
 * After the visitor's own call on `seriesId`, records it as the answer to the kept link on that
 * market, once. The server reads the position from the engine, so nothing about the call is sent.
 * A failure is silent: the context stays and the next call on the market tries again, until it
 * lapses. A refusal for good (revoked link, one's own link) drops it.
 */
export const answerPendingChallenge = async (seriesId: string): Promise<void> => {
	if (!areChallengeLinksEnabled() || nonNullish(answering)) {
		return;
	}

	const context = readChallengeContext();

	if (isNullish(context) || context.seriesId !== seriesId) {
		return;
	}

	answering = (async () => {
		try {
			await answerChallenge(context.id);
			storageDel({ key: CHALLENGE_CONTEXT_STORAGE_KEY });
		} catch (err: unknown) {
			if (isTerminalChallengeRefusal(err)) {
				storageDel({ key: CHALLENGE_CONTEXT_STORAGE_KEY });
			}
		}
	})();

	try {
		await answering;
	} finally {
		answering = undefined;
	}
};
