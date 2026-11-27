import type { CallSide } from '#lib/types/market.ts';

/**
 * The position a challenge link shows: what its challenger holds on the market now, as the engine
 * records it. The API refreshes it on every trade, so it is never a snapshot of the moment the
 * link was shared.
 */
export interface ChallengePosition {
	side: CallSide;
	/** Side-framed probability of the held contracts' average entry, in basis points (1 to 9999). */
	entryPriceBps: number;
	/** Engine time of the fill that opened the held position. */
	calledAtMs: number;
}

/** The identity a challenger consented to show on one link. */
export interface ChallengeIdentity {
	handle: string;
	avatar: string;
	avatarParts: string;
}

/**
 * The public read of a challenge link: only what the server vouches for. No account id, email,
 * balance or call size.
 */
export interface ChallengeView {
	seriesId: string;
	/** `null` when the challenger holds nothing on the market now. */
	position: ChallengePosition | null;
	/** Whether the current side differs from the side held when the link was created. */
	sideChanged: boolean;
	/** `null` when the challenger did not consent to show their identity on this link. */
	challenger: ChallengeIdentity | null;
	/** Open for predictions: not past expiry and not settled. */
	marketOpen: boolean;
}

/** The owner's read of their own link. */
export interface OwnChallenge extends ChallengeView {
	id: string;
	showIdentity: boolean;
	createdAtMs: number;
	answerCount: number;
}

/** A recorded answer: the answerer's own position on the challenged market, engine-verified. */
export interface ChallengeAnswer {
	side: CallSide;
	entryPriceBps: number;
	answeredAtMs: number;
}

/** One answer to one of the caller's links, the source of the challenger's inbox card. */
export interface ChallengeAnswerItem extends ChallengeAnswer {
	challengeId: string;
	seriesId: string;
	answerer: ChallengeIdentity;
	/** The caller's own current position on that link. */
	myPosition: ChallengePosition | null;
}

/** A redemption credits the challenger, or the caller was not eligible (already referred through
 * any channel, or past the signup window): neither is an error. */
export type ChallengeRedeemOutcome = 'redeemed' | 'not_eligible';
