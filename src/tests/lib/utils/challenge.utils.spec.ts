import { CHALLENGE_ID_ALPHABET, CHALLENGE_ID_LENGTH } from '#lib/constants/challenge.constants.ts';
import type { ChallengeView } from '#lib/types/challenge.ts';
import {
	challengeLineKey,
	challengeLineLabel,
	challengeLineText,
	parseChallengeId
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

const view = (overrides: Partial<ChallengeView> = {}): ChallengeView => ({
	seriesId: 'series-1',
	position: { side: 'YES', entryPriceBps: 3800, calledAtMs: 1 },
	sideChanged: false,
	challenger: { handle: 'maya', avatar: '', avatarParts: '' },
	marketOpen: true,
	...overrides
});

const line = (overrides: Partial<ChallengeView> = {}): string =>
	challengeLineText({ view: view(overrides), locale: 'en' });

// Every row of the receiving page's table, named and without consent: the
// line repeats the server's current state and adds no rule of its own.

describe('challengeLineText', () => {
	it('reads a held position as the call', () => {
		assert.equal(line(), '@maya called Yes at 38%. Think they’re wrong?');
		assert.equal(challengeLineLabel(view()), 'called');
	});

	it('reads a flipped side with the current side and price', () => {
		const flipped = {
			position: { side: 'NO' as const, entryPriceBps: 4140, calledAtMs: 2 },
			sideChanged: true
		};

		assert.equal(line(flipped), '@maya now says No at 41%. Think they’re wrong?');
		assert.equal(challengeLineLabel(view(flipped)), 'side_changed');
	});

	it('reads a closed position as the neutral line', () => {
		assert.equal(line({ position: null }), '@maya challenged you on this. What’s your call?');
		assert.equal(challengeLineLabel(view({ position: null })), 'no_position');
	});

	it('reads a closed market in the past tense, with or without a position', () => {
		assert.equal(
			line({ marketOpen: false }),
			'@maya called Yes at 38% on this one. It has closed.'
		);
		assert.equal(
			line({ marketOpen: false, position: null, sideChanged: true }),
			'@maya challenged you on this one. It has closed.'
		);
		assert.equal(challengeLineLabel(view({ marketOpen: false, position: null })), 'market_closed');
	});

	it('says "A friend" exactly when the server sends no handle', () => {
		const anonymous = { challenger: null };

		assert.equal(line(anonymous), 'A friend called Yes at 38%. Think they’re wrong?');
		assert.equal(
			line({ ...anonymous, sideChanged: true }),
			'A friend now says Yes at 38%. Think they’re wrong?'
		);
		assert.equal(
			line({ ...anonymous, position: null }),
			'A friend challenged you on this. What’s your call?'
		);
		assert.equal(
			line({ ...anonymous, marketOpen: false }),
			'A friend called Yes at 38% on this one. It has closed.'
		);
		assert.equal(
			line({ ...anonymous, marketOpen: false, position: null }),
			'A friend challenged you on this one. It has closed.'
		);
	});

	it('rounds the side-framed entry price to a whole percentage', () => {
		assert.equal(
			challengeLineKey(view({ position: { side: 'NO', entryPriceBps: 6250, calledAtMs: 1 } })).pct,
			63
		);
		assert.equal(challengeLineKey(view({ position: null })).pct, undefined);
	});
});
