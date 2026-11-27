import { MAX_NICKNAME_LENGTH } from '#lib/constants/profile.constants.ts';
import { nicknameFormatIssue } from '#lib/utils/nickname.utils.ts';
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

// The reason a handle is refused before any probe must be the one the API
// would give, so a visitor never sees one hint and then another.

describe('nicknameFormatIssue', () => {
	it('asks for a handle when there is none', () => {
		assert.equal(nicknameFormatIssue(''), 'required');
		assert.equal(nicknameFormatIssue('   '), 'required');
	});

	it('bounds the length', () => {
		assert.equal(nicknameFormatIssue('a'), 'too_short');
		assert.equal(nicknameFormatIssue('a'.repeat(MAX_NICKNAME_LENGTH + 1)), 'too_long');
		assert.equal(nicknameFormatIssue('a'.repeat(MAX_NICKNAME_LENGTH)), undefined);
	});

	it('refuses characters outside the charset, surrounding spaces included', () => {
		for (const nickname of ['bad name', 'user@host', 'semi;colon', ' padded ']) {
			assert.equal(nicknameFormatIssue(nickname), 'invalid');
		}
	});

	it('accepts letters with accents, digits and separators', () => {
		for (const nickname of ['José_99', 'CaféOwner', 'a.b-c_d', 'XX']) {
			assert.equal(nicknameFormatIssue(nickname), undefined);
		}
	});

	it('reserves platform handles on the uniqueness fold', () => {
		for (const nickname of ['admin', 'ADMIN', 'Ádmin', 'vici']) {
			assert.equal(nicknameFormatIssue(nickname), 'reserved');
		}
	});
});
