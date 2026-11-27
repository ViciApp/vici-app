import { CHALLENGE_ID_REGEX } from '#lib/constants/challenge.constants.ts';
import type { AppLocale } from '#lib/constants/locale.constants.ts';
import type { ChallengeView } from '#lib/types/challenge.ts';
import type { CallSide } from '#lib/types/market.ts';
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

/** What the receiving page says about a link, for the `challenge_opened` analytics. */
export type ChallengeLineLabel = 'called' | 'side_changed' | 'no_position' | 'market_closed';

/** The line a link reads with: the challenger's current state, exactly as the server sent it. */
export interface ChallengeLine {
	key: MessageKey;
	/** Only when the challenger consented to show it on this link. */
	handle?: string;
	side?: CallSide;
	/** The held position's side-framed entry price, as a whole percentage. */
	pct?: number;
}

/** Which state of the table a view is in. A closed market wins over everything else. */
export const challengeLineLabel = (
	view: Pick<ChallengeView, 'position' | 'sideChanged' | 'marketOpen'>
): ChallengeLineLabel => {
	if (!view.marketOpen) {
		return 'market_closed';
	}

	if (isNullish(view.position)) {
		return 'no_position';
	}

	return view.sideChanged ? 'side_changed' : 'called';
};

const LINE_KEYS: Record<
	ChallengeLineLabel,
	{ named: MessageKey; anonymous: MessageKey; namedFlat?: MessageKey; anonymousFlat?: MessageKey }
> = {
	called: { named: 'challenge.line.named', anonymous: 'challenge.line.anonymous' },
	side_changed: {
		named: 'challenge.line.named_changed',
		anonymous: 'challenge.line.anonymous_changed'
	},
	no_position: {
		named: 'challenge.line.named_no_position',
		anonymous: 'challenge.line.anonymous_no_position'
	},
	market_closed: {
		named: 'challenge.line.named_closed',
		anonymous: 'challenge.line.anonymous_closed',
		namedFlat: 'challenge.line.named_closed_no_position',
		anonymousFlat: 'challenge.line.anonymous_closed_no_position'
	}
};

/**
 * The line for a view: the handle when the server sent one ("A friend" otherwise), the current
 * side and its price when the challenger holds a position. The page adds no rule of its own.
 */
export const challengeLineKey = (view: ChallengeView): ChallengeLine => {
	const keys = LINE_KEYS[challengeLineLabel(view)];
	const handle = view.challenger?.handle;
	const named = nonNullish(handle);
	const { position } = view;

	if (isNullish(position)) {
		return {
			key: named ? (keys.namedFlat ?? keys.named) : (keys.anonymousFlat ?? keys.anonymous),
			handle
		};
	}

	return {
		key: named ? keys.named : keys.anonymous,
		handle,
		side: position.side,
		pct: Math.round(position.entryPriceBps / 100)
	};
};

/** {@link challengeLineKey} rendered in `locale`. */
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
			...(nonNullish(side) && {
				side: t({ locale, key: side === 'YES' ? 'challenge.side.yes' : 'challenge.side.no' })
			}),
			...(nonNullish(pct) && { pct })
		}
	});
};
