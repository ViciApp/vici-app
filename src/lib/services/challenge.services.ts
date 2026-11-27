import type {
	ChallengeAnswer,
	ChallengeAnswerItem,
	ChallengeRedeemOutcome,
	ChallengeView,
	OwnChallenge
} from '#lib/types/challenge.ts';
import { parseChallengeId } from '#lib/utils/challenge.utils.ts';
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
import { isNullish } from '@dfinity/utils';

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

const isNotFound = (err: unknown): boolean =>
	err instanceof Web2ApiError && err.status === 404 && err.code === CHALLENGE_NOT_FOUND_CODE;

/** Why the API refused to issue or update a link, when the user can be told: the position was
 * closed meanwhile, the market stopped taking predictions, or the account hit the hourly limit. */
export type ChallengeRefusal = 'no_position' | 'market_closed' | 'rate_limited';

const CHALLENGE_REFUSALS: readonly ChallengeRefusal[] = [
	'no_position',
	'market_closed',
	'rate_limited'
];

const isChallengeRefusal = (code: string): code is ChallengeRefusal =>
	(CHALLENGE_REFUSALS as readonly string[]).includes(code);

/** The refusal behind a failed challenge write, or `undefined` for any other failure. */
export const challengeRefusalOf = (err: unknown): ChallengeRefusal | undefined =>
	err instanceof Web2ApiError && isChallengeRefusal(err.code) ? err.code : undefined;

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
export const getChallenge = async (rawId: string): Promise<ChallengeView | undefined> => {
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
