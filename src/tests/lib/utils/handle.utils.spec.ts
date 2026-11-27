import {
	HANDLE_PATTERN,
	MAX_HANDLE_LENGTH,
	MIN_HANDLE_LENGTH
} from '#lib/constants/profile.constants.ts';
import { handleFormatIssue, sanitizeHandleInput } from '#lib/utils/handle.utils.ts';
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

// A handle is lowercase a-z and 0-9 only, 3 to 15 characters, so two handles
// never differ by case, an accent or a separator.

describe('HANDLE_PATTERN', () => {
	it('is lowercase a-z and 0-9, 3 to 15 characters', () => {
		assert.equal(MIN_HANDLE_LENGTH, 3);
		assert.equal(MAX_HANDLE_LENGTH, 15);
		assert.equal(HANDLE_PATTERN.source, '^[a-z0-9]{3,15}$');
	});
});

describe('sanitizeHandleInput', () => {
	it('lowercases and strips everything else as the visitor types', () => {
		assert.equal(sanitizeHandleInput('@Antonio.Ventilii'), 'antonioventilii');
		assert.equal(sanitizeHandleInput('Anna_B-99'), 'annab99');
		assert.equal(sanitizeHandleInput(' an na '), 'anna');
	});

	it('drops accents and other scripts rather than folding them', () => {
		assert.equal(sanitizeHandleInput('José'), 'jos');
		assert.equal(sanitizeHandleInput('東京tokyo'), 'tokyo');
		assert.equal(sanitizeHandleInput('🙂'), '');
	});

	it('caps at the maximum length after cleaning', () => {
		assert.equal(sanitizeHandleInput('a'.repeat(MAX_HANDLE_LENGTH + 5)).length, MAX_HANDLE_LENGTH);
		assert.equal(
			sanitizeHandleInput(`@${'b'.repeat(MAX_HANDLE_LENGTH)}`),
			'b'.repeat(MAX_HANDLE_LENGTH)
		);
	});
});

describe('handleFormatIssue', () => {
	it('asks for a handle when there is none', () => {
		assert.equal(handleFormatIssue(''), 'required');
	});

	it('bounds the length', () => {
		assert.equal(handleFormatIssue('ab'), 'too_short');
		assert.equal(handleFormatIssue('abc'), undefined);
		assert.equal(handleFormatIssue('a'.repeat(MAX_HANDLE_LENGTH)), undefined);
		assert.equal(handleFormatIssue('a'.repeat(MAX_HANDLE_LENGTH + 1)), 'too_long');
	});

	it('refuses anything outside lowercase a-z and 0-9', () => {
		for (const handle of ['Anna', 'anna.b', 'anna_b', 'anna-b', 'josé', 'an na', '東京abc']) {
			assert.equal(handleFormatIssue(handle), 'invalid');
		}
	});

	it('keeps the platform names reserved', () => {
		assert.equal(handleFormatIssue('admin'), 'reserved');
		assert.equal(handleFormatIssue('vici'), 'reserved');
	});

	it('accepts every sanitized handle of a valid length', () => {
		const handle = sanitizeHandleInput('@Antonio.Ventilii');

		assert.equal(handleFormatIssue(handle), undefined);
		assert.equal(HANDLE_PATTERN.test(handle), true);
	});
});
