import {
	answerChallenge as answerChallengeApi,
	ApiError,
	createChallenge as createChallengeApi,
	getChallenge as getChallengeApi,
	listChallengeAnswers as listChallengeAnswersApi,
	listMyChallenges as listMyChallengesApi,
	redeemChallenge as redeemChallengeApi,
	revokeChallenge as revokeChallengeApi,
	setChallengeConsent as setChallengeConsentApi
} from '#lib/api-client/client.ts';
import type {
	ChallengeAnswer,
	ChallengeAnswerItem,
	ChallengeRedeemOutcome,
	ChallengeView,
	OwnChallenge
} from '#lib/types/challenge.ts';
import { parseChallengeId } from '#lib/utils/challenge.utils.ts';
import { isNullish } from '@dfinity/utils';

/** Whether challenge links exist in this build: always, since the API serves them. */
export const areChallengeLinksEnabled = (): boolean => true;

/** The wire code of a link that cannot be read: unknown, revoked, pruned or its challenger hidden. */
export const CHALLENGE_NOT_FOUND_CODE = 'challenge_not_found';

/** The id in its stored form; a malformed one fails like an unknown link, without a request. */
const requireChallengeId = (raw: string): string => {
	const id = parseChallengeId(raw);

	if (isNullish(id)) {
		throw new ApiError({ status: 404, code: CHALLENGE_NOT_FOUND_CODE });
	}

	return id;
};

const isNotFound = (err: unknown): boolean =>
	err instanceof ApiError && err.status === 404 && err.code === CHALLENGE_NOT_FOUND_CODE;

/**
 * Issues the signed-in user's link for a market, or returns their active one (same id). The
 * position on it is whatever the engine says the user holds; only the consent flag is sent.
 */
export const createChallenge = async (params: {
	seriesId: string;
	showIdentity: boolean;
}): Promise<OwnChallenge> => await createChallengeApi(params);

/** The public read of a link, or `undefined` when it cannot be read (malformed, unknown, revoked,
 * pruned or its challenger hidden: one outcome for all). */
export const getChallenge = async (rawId: string): Promise<ChallengeView | undefined> => {
	const id = parseChallengeId(rawId);

	if (isNullish(id)) {
		return;
	}

	try {
		return await getChallengeApi(id);
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
}): Promise<OwnChallenge> =>
	await setChallengeConsentApi({ id: requireChallengeId(id), showIdentity });

/** The owner turns the link off. */
export const revokeChallenge = async (id: string): Promise<void> => {
	await revokeChallengeApi(requireChallengeId(id));
};

/** Credits the link's challenger as the signed-in user's referrer, under the referral rules. */
export const redeemChallenge = async (id: string): Promise<ChallengeRedeemOutcome> =>
	await redeemChallengeApi(requireChallengeId(id));

/** Records the signed-in user's own call on the link's market as an answer (engine-verified). */
export const answerChallenge = async (id: string): Promise<ChallengeAnswer> =>
	await answerChallengeApi(requireChallengeId(id));

/** The signed-in user's active links. */
export const listMyChallenges = async (): Promise<OwnChallenge[]> => await listMyChallengesApi();

/** Answers to the signed-in user's links, newest first. */
export const listChallengeAnswers = async (): Promise<ChallengeAnswerItem[]> =>
	await listChallengeAnswersApi();
