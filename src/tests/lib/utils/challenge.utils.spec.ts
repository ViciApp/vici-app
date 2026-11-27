import { CHALLENGE_ID_ALPHABET, CHALLENGE_ID_LENGTH } from '#lib/constants/challenge.constants.ts';
import { parseChallengeId } from '#lib/utils/challenge.utils.ts';
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
