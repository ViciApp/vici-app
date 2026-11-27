import { ZERO } from '#lib/constants/app.constants.ts';
import { CHALLENGE_ID_REGEX } from '#lib/constants/challenge.constants.ts';
import { INBOX_RECENT_EVENT_WINDOW_MS } from '#lib/constants/inbox.constants.ts';
import type { AppLocale } from '#lib/constants/locale.constants.ts';
import { MILLISECOND_IN_NANOSECONDS } from '#lib/constants/time.constants.ts';
import type { ChallengeAnswerItem, ChallengeView } from '#lib/types/challenge.ts';
import type { InboxNotification } from '#lib/types/inbox.ts';
import type { CallSide, Market } from '#lib/types/market.ts';
import type { Position } from '#lib/types/position.ts';
import { formatRelativeAgoFromNs } from '#lib/utils/format.utils.ts';
import { t, type MessageKey } from '#lib/utils/i18n.utils.ts';
import { isNullish, nonNullish } from '@dfinity/utils';

/**
 * A challenge link id in its stored form, or `undefined` when the input cannot be one: the same
 * normalisation the API applies (trimmed, uppercased), so a malformed id never costs a request and
 * a pasted lowercase id still resolves.
 */
export const parseChallengeId = (raw: string): string | undefined => {
	const normalized = raw.trim().toUpperCase();

	return CHALLENGE_ID_REGEX.test(normalized) ? normalized : undefined;
};

/** The one share URL of a challenge link: the server-issued id under `/c/`, nothing else. */
export const challengeUrl = ({ origin, id }: { origin: string; id: string }): string =>
	`${origin}/c/${id}`;

const SIDE_KEYS: Record<CallSide, MessageKey> = {
	YES: 'challenge.side.yes',
	NO: 'challenge.side.no'
};

/** A side-framed entry price in basis points as the whole percentage the copy shows. */
const bpsToPct = (bps: number): number => Math.round(bps / 100);

const sideLabel = ({ side, locale }: { side: CallSide; locale: AppLocale }): string =>
	t({ locale, key: SIDE_KEYS[side] });

/** The copy key of a challenge line and the values it interpolates. */
export interface ChallengeLine {
	key: MessageKey;
	handle?: string;
	side?: CallSide;
	pct?: number;
}

/**
 * The line a challenge link reads as, for its challenger's share sheet and its recipient's page:
 * named only when the challenger consented (the server sends no identity otherwise), the side as
 * held now, and a closed market said as such. Built from the server's view only.
 */
export const challengeLineKey = (view: ChallengeView): ChallengeLine => {
	const handle = view.challenger?.handle;
	const named = nonNullish(handle);
	const { position } = view;

	if (isNullish(position)) {
		if (!view.marketOpen) {
			return named
				? { key: 'challenge.line.named_closed_no_position', handle }
				: { key: 'challenge.line.anonymous_closed_no_position' };
		}

		return named
			? { key: 'challenge.line.named_no_position', handle }
			: { key: 'challenge.line.anonymous_no_position' };
	}

	const call = { side: position.side, pct: bpsToPct(position.entryPriceBps) };

	if (!view.marketOpen) {
		return named
			? { key: 'challenge.line.named_closed', handle, ...call }
			: { key: 'challenge.line.anonymous_closed', ...call };
	}

	if (view.sideChanged) {
		return named
			? { key: 'challenge.line.named_changed', handle, ...call }
			: { key: 'challenge.line.anonymous_changed', ...call };
	}

	return named
		? { key: 'challenge.line.named', handle, ...call }
		: { key: 'challenge.line.anonymous', ...call };
};

/** {@link challengeLineKey} rendered in a locale. */
export const challengeLineText = ({
	view,
	locale
}: {
	view: ChallengeView;
	locale: AppLocale;
}): string => {
	const { key, handle, side, pct } = challengeLineKey(view);

	return t({
		locale,
		key,
		params: {
			...(nonNullish(handle) && { handle }),
			...(nonNullish(side) && { side: sideLabel({ side, locale }) }),
			...(nonNullish(pct) && { pct })
		}
	});
};

/** The text a challenge link travels with: named only with the challenger's consent. */
export const challengeShareText = ({
	view,
	locale
}: {
	view: ChallengeView;
	locale: AppLocale;
}): string => {
	const handle = view.challenger?.handle;

	return nonNullish(handle)
		? t({ locale, key: 'challenge.share.text_named', params: { handle } })
		: t({ locale, key: 'challenge.share.text_anonymous' });
};

/**
 * Whether the viewer can challenge a friend on a market: a binary market open for predictions on
 * which they hold a live position. The server checks the same against the engine on creation;
 * this only decides whether the action is offered.
 */
export const canChallengeMarket = ({
	market,
	positions,
	nowMs
}: {
	market: Market;
	positions: Position[];
	nowMs: number;
}): boolean =>
	market.payoffType === 'Binary' &&
	market.status === 'Open' &&
	Number(market.expiryDate) > nowMs &&
	positions.some(
		({ marketId, outcomeId, netQty }) =>
			marketId === market.id && (outcomeId === 'YES' || outcomeId === 'NO') && netQty !== ZERO
	);

/** The inbox id of one answer. A person answers a link once, so the link and the answer's time
 * name it, and a later handle change does not turn it into a new card. */
const answerCardId = ({ challengeId, answeredAtMs }: ChallengeAnswerItem): string =>
	`challenge-answer-${challengeId}-${answeredAtMs}`;

/**
 * One inbox card per answer to the viewer's links, newest first, within the window the inbox keeps
 * social events: the answerer's call, then the viewer's own current one on that link (or none).
 * Deep-links to the challenged market.
 */
export const challengeAnswerCards = ({
	answers,
	locale,
	nowMs
}: {
	answers: ChallengeAnswerItem[];
	locale: AppLocale;
	nowMs: number;
}): InboxNotification[] =>
	answers
		.filter(({ answeredAtMs }) => nowMs - answeredAtMs <= INBOX_RECENT_EVENT_WINDOW_MS)
		.sort((a, b) => b.answeredAtMs - a.answeredAtMs)
		.map((item) => {
			const theirs = {
				handle: item.answerer.handle,
				side: sideLabel({ side: item.side, locale }),
				pct: bpsToPct(item.entryPriceBps)
			};
			const mine = item.myPosition;

			return {
				id: answerCardId(item),
				kind: 'challenge' as const,
				title: t({ locale, key: 'inbox.challenge_answer.title' }),
				body: nonNullish(mine)
					? t({
							locale,
							key: 'inbox.challenge_answer.body',
							params: {
								...theirs,
								mySide: sideLabel({ side: mine.side, locale }),
								myPct: bpsToPct(mine.entryPriceBps)
							}
						})
					: t({ locale, key: 'inbox.challenge_answer.body_no_position', params: theirs }),
				when: formatRelativeAgoFromNs({
					timestampNs: BigInt(item.answeredAtMs) * MILLISECOND_IN_NANOSECONDS,
					locale,
					nowMs
				}),
				unread: true,
				mid: item.seriesId
			};
		});
