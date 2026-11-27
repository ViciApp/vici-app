import { ZERO } from '#lib/constants/app.constants.ts';
import { CHALLENGE_ID_ALPHABET, CHALLENGE_ID_LENGTH } from '#lib/constants/challenge.constants.ts';
import { INBOX_RECENT_EVENT_WINDOW_MS } from '#lib/constants/inbox.constants.ts';
import type { ChallengeAnswerItem, ChallengeView } from '#lib/types/challenge.ts';
import type { Market } from '#lib/types/market.ts';
import type { Position } from '#lib/types/position.ts';
import {
	canChallengeMarket,
	challengeAnswerCards,
	challengeLineKey,
	challengeLineText,
	challengeShareText,
	challengeUrl,
	parseChallengeId,
	type ChallengeLine
} from '#lib/utils/challenge.utils.ts';
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

// The id is the only input the receiving side reads, so anything that is not
// an id must be refused before a request is made.

describe('parseChallengeId', () => {
	it('accepts every character of the alphabet at the full length', () => {
		const id = CHALLENGE_ID_ALPHABET.slice(0, CHALLENGE_ID_LENGTH);

		assert.equal(parseChallengeId(id), id);
		assert.equal(
			parseChallengeId(CHALLENGE_ID_ALPHABET.slice(-CHALLENGE_ID_LENGTH)),
			CHALLENGE_ID_ALPHABET.slice(-CHALLENGE_ID_LENGTH)
		);
	});

	it('normalises case and surrounding space like the API', () => {
		assert.equal(parseChallengeId('  abcdefghjkmnpqrs\n'), 'ABCDEFGHJKMNPQRS');
	});

	it('refuses the characters Crockford base32 leaves out', () => {
		for (const excluded of ['I', 'L', 'O', 'U']) {
			assert.equal(parseChallengeId(`ABCDEFGHJKMNPQR${excluded}`), undefined);
		}
	});

	it('refuses a wrong length, an empty string and anything else', () => {
		assert.equal(parseChallengeId('ABCDEFGHJKMNPQR'), undefined);
		assert.equal(parseChallengeId('ABCDEFGHJKMNPQRST'), undefined);
		assert.equal(parseChallengeId(''), undefined);
		assert.equal(parseChallengeId('ABCDEFGH-JKMNPQRS'), undefined);
		assert.equal(parseChallengeId("'; drop table x; --"), undefined);
	});
});

const VIEW: ChallengeView = {
	seriesId: 'series-1',
	position: { side: 'YES', entryPriceBps: 3800, calledAtMs: 1_000 },
	sideChanged: false,
	challenger: { handle: 'maya', avatar: '', avatarParts: '' },
	marketOpen: true
};

const ANONYMOUS: ChallengeView = { ...VIEW, challenger: null };

describe('challengeUrl', () => {
	it('is the server-issued id under /c/', () => {
		assert.equal(
			challengeUrl({ origin: 'https://vici.app', id: 'ABCDEFGHJKMNPQRS' }),
			'https://vici.app/c/ABCDEFGHJKMNPQRS'
		);
	});
});

describe('challengeLineKey', () => {
	const cases: { name: string; view: ChallengeView; expected: ChallengeLine }[] = [
		{
			name: 'side as created, with consent',
			view: VIEW,
			expected: { key: 'challenge.line.named', handle: 'maya', side: 'YES', pct: 38 }
		},
		{
			name: 'side as created, without consent',
			view: ANONYMOUS,
			expected: { key: 'challenge.line.anonymous', side: 'YES', pct: 38 }
		},
		{
			name: 'side changed, with consent',
			view: {
				...VIEW,
				sideChanged: true,
				position: { side: 'NO', entryPriceBps: 6150, calledAtMs: 2_000 }
			},
			expected: { key: 'challenge.line.named_changed', handle: 'maya', side: 'NO', pct: 62 }
		},
		{
			name: 'side changed, without consent',
			view: { ...ANONYMOUS, sideChanged: true },
			expected: { key: 'challenge.line.anonymous_changed', side: 'YES', pct: 38 }
		},
		{
			name: 'no position, with consent',
			view: { ...VIEW, position: null },
			expected: { key: 'challenge.line.named_no_position', handle: 'maya' }
		},
		{
			name: 'no position, without consent',
			view: { ...ANONYMOUS, position: null },
			expected: { key: 'challenge.line.anonymous_no_position' }
		},
		{
			name: 'market closed, with consent',
			view: { ...VIEW, marketOpen: false, sideChanged: true },
			expected: { key: 'challenge.line.named_closed', handle: 'maya', side: 'YES', pct: 38 }
		},
		{
			name: 'market closed, without consent',
			view: { ...ANONYMOUS, marketOpen: false },
			expected: { key: 'challenge.line.anonymous_closed', side: 'YES', pct: 38 }
		},
		{
			name: 'market closed and no position, with consent',
			view: { ...VIEW, marketOpen: false, position: null },
			expected: { key: 'challenge.line.named_closed_no_position', handle: 'maya' }
		},
		{
			name: 'market closed and no position, without consent',
			view: { ...ANONYMOUS, marketOpen: false, position: null },
			expected: { key: 'challenge.line.anonymous_closed_no_position' }
		}
	];

	for (const { name, view, expected } of cases) {
		it(name, () => {
			assert.deepEqual(challengeLineKey(view), expected);
		});
	}

	it('renders the line recipients read', () => {
		assert.equal(
			challengeLineText({ view: VIEW, locale: 'en' }),
			"@maya called Yes at 38%. Think they're wrong?"
		);
		assert.equal(
			challengeLineText({ view: ANONYMOUS, locale: 'en' }),
			"A friend called Yes at 38%. Think they're wrong?"
		);
	});
});

describe('challengeShareText', () => {
	it('names the challenger only with consent', () => {
		assert.equal(
			challengeShareText({ view: VIEW, locale: 'en' }),
			"@maya challenged you on VICI. Think they're wrong?"
		);
		assert.equal(
			challengeShareText({ view: ANONYMOUS, locale: 'en' }),
			"A friend challenged you on VICI. Think they're wrong?"
		);
	});
});

describe('canChallengeMarket', () => {
	const NOW_MS = 1_700_000_000_000;
	const market = {
		id: 'series-1',
		payoffType: 'Binary',
		status: 'Open',
		expiryDate: BigInt(NOW_MS + 60_000)
	} as Market;
	const held = (overrides: Partial<Position> = {}): Position =>
		({ marketId: 'series-1', outcomeId: 'YES', netQty: 5n, ...overrides }) as Position;

	it('offers the action on an open binary market the viewer holds', () => {
		assert.equal(canChallengeMarket({ market, positions: [held()], nowMs: NOW_MS }), true);
		assert.equal(
			canChallengeMarket({ market, positions: [held({ outcomeId: 'NO' })], nowMs: NOW_MS }),
			true
		);
	});

	it('hides it without a live position on that market', () => {
		assert.equal(canChallengeMarket({ market, positions: [], nowMs: NOW_MS }), false);
		assert.equal(
			canChallengeMarket({ market, positions: [held({ netQty: ZERO })], nowMs: NOW_MS }),
			false
		);
		assert.equal(
			canChallengeMarket({
				market,
				positions: [held({ marketId: 'other' } as Partial<Position>)],
				nowMs: NOW_MS
			}),
			false
		);
	});

	it('hides it on a closed or non-binary market', () => {
		const positions = [held()];

		assert.equal(
			canChallengeMarket({ market: { ...market, status: 'Expired' }, positions, nowMs: NOW_MS }),
			false
		);
		assert.equal(
			canChallengeMarket({ market: { ...market, status: 'Resolved' }, positions, nowMs: NOW_MS }),
			false
		);
		assert.equal(
			canChallengeMarket({ market, positions, nowMs: Number(market.expiryDate) }),
			false
		);
		assert.equal(
			canChallengeMarket({
				market: { ...market, payoffType: 'Categorical' },
				positions,
				nowMs: NOW_MS
			}),
			false
		);
	});
});

describe('challengeAnswerCards', () => {
	const NOW_MS = 1_700_000_000_000;
	const answer = (overrides: Partial<ChallengeAnswerItem> = {}): ChallengeAnswerItem => ({
		challengeId: 'ABCDEFGHJKMNPQRS',
		seriesId: 'series-1',
		side: 'NO',
		entryPriceBps: 4400,
		answeredAtMs: NOW_MS - 60_000,
		answerer: { handle: 'leo', avatar: '', avatarParts: '' },
		myPosition: { side: 'YES', entryPriceBps: 3800, calledAtMs: 1_000 },
		...overrides
	});

	it('pairs the answer with the viewer current call and opens the market', () => {
		const [card] = challengeAnswerCards({ answers: [answer()], locale: 'en', nowMs: NOW_MS });

		assert.equal(card.kind, 'challenge');
		assert.equal(card.body, '@leo called No at 44%. You said Yes at 38%.');
		assert.equal(card.mid, 'series-1');
		assert.equal(card.unread, true);
	});

	it('says only the answer when the viewer holds nothing now', () => {
		const [card] = challengeAnswerCards({
			answers: [answer({ myPosition: null })],
			locale: 'en',
			nowMs: NOW_MS
		});

		assert.equal(card.body, '@leo called No at 44% on your challenge.');
	});

	it('orders newest first, one card per answer with a stable id', () => {
		const older = answer({ answeredAtMs: NOW_MS - 120_000 });
		const newer = answer({
			challengeId: 'ZZZZZZZZZZZZZZZZ',
			answeredAtMs: NOW_MS - 10_000,
			answerer: { handle: 'ana', avatar: '', avatarParts: '' }
		});
		const cards = challengeAnswerCards({ answers: [older, newer], locale: 'en', nowMs: NOW_MS });

		assert.deepEqual(
			cards.map(({ id }) => id),
			[
				`challenge-answer-ZZZZZZZZZZZZZZZZ-${NOW_MS - 10_000}`,
				`challenge-answer-ABCDEFGHJKMNPQRS-${NOW_MS - 120_000}`
			]
		);
		assert.deepEqual(
			challengeAnswerCards({ answers: [older, newer], locale: 'en', nowMs: NOW_MS }).map(
				({ id }) => id
			),
			cards.map(({ id }) => id)
		);
	});

	it('drops answers older than the inbox window', () => {
		assert.deepEqual(
			challengeAnswerCards({
				answers: [answer({ answeredAtMs: NOW_MS - INBOX_RECENT_EVENT_WINDOW_MS - 1 })],
				locale: 'en',
				nowMs: NOW_MS
			}),
			[]
		);
	});
});
