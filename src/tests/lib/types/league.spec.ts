import {
	LEAGUE_INVITE_CODE_ALPHABET,
	LEAGUE_INVITE_CODE_EXAMPLE,
	LEAGUE_INVITE_CODE_LENGTH,
	LEAGUE_INVITE_CODE_REGEX,
	LEAGUE_LEGACY_INVITE_CODE_LENGTH
} from '#lib/types/league.ts';
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

const codeOfLength = (length: number): string =>
	LEAGUE_INVITE_CODE_ALPHABET.repeat(2).slice(0, length);

describe('league invite code shape', () => {
	it('accepts a new code and an older, shorter one, and no other length', () => {
		const accepted = Array.from({ length: 16 }, (_, length) => length).filter((length) =>
			LEAGUE_INVITE_CODE_REGEX.test(codeOfLength(length))
		);

		assert.deepEqual(accepted, [LEAGUE_LEGACY_INVITE_CODE_LENGTH, LEAGUE_INVITE_CODE_LENGTH]);
	});

	it('refuses a lowercase or out-of-alphabet code', () => {
		assert.equal(
			LEAGUE_INVITE_CODE_REGEX.test(codeOfLength(LEAGUE_INVITE_CODE_LENGTH).toLowerCase()),
			false
		);
		assert.equal(LEAGUE_INVITE_CODE_REGEX.test('ABCDE-1234'), false);
	});

	it('shows an example of the new length', () => {
		assert.equal(LEAGUE_INVITE_CODE_EXAMPLE.length, LEAGUE_INVITE_CODE_LENGTH);
		assert.ok(LEAGUE_INVITE_CODE_REGEX.test(LEAGUE_INVITE_CODE_EXAMPLE));
	});
});
