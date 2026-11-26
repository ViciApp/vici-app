// What a challenge link does for the friends it reaches: the redemption that
// credits its challenger as their referrer (the one referrals row every
// channel writes, so a person is credited to one inviter ever) and the
// engine-verified answer that records their own call on its market and
// befriends the two. The links themselves are in `challenges.ts`.

import { isNullish, nonNullish } from '@dfinity/utils';
import {
	getOrAssignReferralCode,
	referralIneligibility,
	writeConfirmedFriendship,
	writeReferralRedemption
} from '../account/referrals';
import { query, tx } from '../db/client';
import { getTradeHistory } from '../engine/clearing';
import { PUBLICLY_VISIBLE_PROFILE_SQL } from '../profiles/profile';
import type { CallSide } from '../vxp/calibration';
import { heldBinaryPosition } from '../vxp/predictions';
import {
	captureChallengeEvent,
	ChallengeNoPositionError,
	ChallengeNotFoundError,
	ChallengeProfileRequiredError,
	ChallengeSelfError,
	findPublicLink,
	positionOf,
	requireChallengeId,
	toEntryPriceBps,
	type ChallengeIdentity,
	type ChallengePosition
} from './challenges';

/** Bound of the challenger's answer list (their inbox source). */
export const CHALLENGE_ANSWERS_LIST_LIMIT = 100;

export interface ChallengeAnswer {
	side: CallSide;
	entryPriceBps: number;
	answeredAtMs: number;
}

/** One answer to one of the caller's links, for their inbox. The answerer is
 * a friend by then, so their handle is shown. */
export interface ChallengeAnswerItem extends ChallengeAnswer {
	challengeId: string;
	seriesId: string;
	answerer: ChallengeIdentity;
	/** The caller's own current position on that link. */
	myPosition: ChallengePosition | null;
}

export type ChallengeRedeemOutcome = 'redeemed' | 'not_eligible';

/**
 * Credits the link's challenger as the caller's referrer, through the one
 * referrals row every channel writes (so a person is credited to one inviter
 * ever), under the same rules as a referral code. An account already
 * referred or past the signup window is not an error: nothing is written,
 * not even a friendship.
 */
export const redeemChallenge = async ({
	userId,
	id: rawId
}: {
	userId: string;
	id: string;
}): Promise<ChallengeRedeemOutcome> => {
	const link = await findPublicLink(requireChallengeId(rawId));

	if (isNullish(link)) {
		throw new ChallengeNotFoundError();
	}

	if (link.challenger_user_id === userId) {
		throw new ChallengeSelfError();
	}

	const ineligible = await referralIneligibility(userId);

	if (ineligible === 'no_profile') {
		throw new ChallengeProfileRequiredError();
	}

	if (nonNullish(ineligible)) {
		return 'not_eligible';
	}

	await writeReferralRedemption({
		userId,
		referrerUserId: link.challenger_user_id,
		code: await getOrAssignReferralCode(link.challenger_user_id),
		challengeId: link.id
	});

	return 'redeemed';
};

interface AnswerRow {
	side: CallSide;
	entry_price_bps: number;
	answered_at_ms: string;
}

const toAnswer = (row: AnswerRow): ChallengeAnswer => ({
	side: row.side,
	entryPriceBps: row.entry_price_bps,
	answeredAtMs: Number(row.answered_at_ms)
});

/**
 * Records the caller's answer to a link: their own position on its market,
 * read from their trade history in the engine (the client sends no side and
 * no price). One answer per (link, user): a repeat returns the first. The
 * first answer makes challenger and answerer friends; reading a link never
 * does.
 */
export const recordChallengeAnswer = async ({
	userId,
	id: rawId
}: {
	userId: string;
	id: string;
}): Promise<ChallengeAnswer> => {
	const link = await findPublicLink(requireChallengeId(rawId));

	if (isNullish(link)) {
		throw new ChallengeNotFoundError();
	}

	if (link.challenger_user_id === userId) {
		throw new ChallengeSelfError();
	}

	const held = heldBinaryPosition({
		events: await getTradeHistory({ userId }),
		seriesId: link.series_id
	});

	if (isNullish(held)) {
		throw new ChallengeNoPositionError();
	}

	const answered = await tx(async (q) => {
		const inserted = await q<AnswerRow>(
			`insert into challenge_answers (challenge_id, answerer_user_id, side, entry_price_bps,
			   answered_at_ms)
			 values ($1, $2, $3, $4, $5)
			 on conflict (challenge_id, answerer_user_id) do nothing
			 returning side, entry_price_bps, answered_at_ms::text`,
			[link.id, userId, held.side, toEntryPriceBps(held.entryPrice), Date.now()]
		);

		if (isNullish(inserted[0])) {
			const existing = await q<AnswerRow>(
				`select side, entry_price_bps, answered_at_ms::text from challenge_answers
				 where challenge_id = $1 and answerer_user_id = $2`,
				[link.id, userId]
			);

			return { row: existing[0], isNew: false };
		}

		await writeConfirmedFriendship({
			referrerUserId: link.challenger_user_id,
			refereeUserId: userId,
			q
		});

		return { row: inserted[0], isNew: true };
	});

	if (isNullish(answered.row)) {
		throw new ChallengeNotFoundError();
	}

	if (answered.isNew) {
		const referred = await query<{ referee_user_id: string }>(
			`select referee_user_id from referrals where referee_user_id = $1 and challenge_id = $2`,
			[userId, link.id]
		);
		const challengerSide = link.side ?? link.created_side;

		await captureChallengeEvent({
			name: 'challenge_answered',
			userId,
			props: {
				marketId: link.series_id,
				label: held.side === challengerSide ? 'same_side' : 'opposite_side',
				source: nonNullish(referred[0]) ? 'referred' : 'existing'
			}
		});
	}

	return toAnswer(answered.row);
};

interface AnswerItemRow extends AnswerRow {
	challenge_id: string;
	series_id: string;
	nickname: string;
	avatar: string | null;
	avatar_parts: string | null;
	my_side: CallSide | null;
	my_entry_price_bps: number | null;
	my_called_at_ms: string | null;
}

/** Answers to the caller's active links, newest first, bounded; answers
 * from hidden accounts are left out. One join, no per-answer reads. */
export const listChallengeAnswers = async (userId: string): Promise<ChallengeAnswerItem[]> => {
	const rows = await query<AnswerItemRow>(
		`select a.challenge_id, l.series_id, a.side, a.entry_price_bps, a.answered_at_ms::text,
		        p.nickname, p.avatar, p.avatar_parts,
		        l.side as my_side, l.entry_price_bps as my_entry_price_bps,
		        l.called_at_ms::text as my_called_at_ms
		 from challenge_answers a
		 join challenge_links l on l.id = a.challenge_id
		 join profiles p on p.user_id = a.answerer_user_id
		 where l.challenger_user_id = $1 and l.status = 'active' and ${PUBLICLY_VISIBLE_PROFILE_SQL}
		 order by a.answered_at_ms desc
		 limit $2`,
		[userId, CHALLENGE_ANSWERS_LIST_LIMIT]
	);

	return rows.map((row) => ({
		...toAnswer(row),
		challengeId: row.challenge_id,
		seriesId: row.series_id,
		answerer: {
			handle: row.nickname,
			avatar: row.avatar ?? '',
			avatarParts: row.avatar_parts ?? ''
		},
		myPosition: positionOf({
			side: row.my_side,
			entry_price_bps: row.my_entry_price_bps,
			called_at_ms: row.my_called_at_ms
		})
	}));
};
