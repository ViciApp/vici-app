import {
	HANDLE_LETTER_FOLDS,
	HANDLE_PATTERN,
	handleUniqueKey,
	isReservedHandle,
	MAX_HANDLE_LENGTH,
	MIN_HANDLE_LENGTH,
	RESERVED_HANDLES
} from '#lib/constants/handle.constants.ts';
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

// A handle is lowercase a-z and 0-9 only, 3 to 15 characters, and two
// handles are the same one when only case, accents or separators differ.

describe('HANDLE_PATTERN', () => {
	it('is lowercase a-z and 0-9, 3 to 15 characters', () => {
		assert.equal(MIN_HANDLE_LENGTH, 3);
		assert.equal(MAX_HANDLE_LENGTH, 15);
		assert.equal(HANDLE_PATTERN.source, '^[a-z0-9]{3,15}$');
	});
});

describe('handleUniqueKey', () => {
	it('folds lookalikes to one key', () => {
		for (const handle of [
			'antonioventilii',
			'antonio.ventilii',
			'antonio_ventilii',
			'Antonioventilii',
			'antonioventílii',
			'Antonio-Ventilii'
		]) {
			assert.equal(handleUniqueKey(handle), 'antonioventilii', handle);
		}
	});

	it('spells the letters with no accent to strip plainly', () => {
		assert.deepEqual(
			HANDLE_LETTER_FOLDS.map(([letter]) => handleUniqueKey(`a${letter}b`)),
			['assb', 'aaeb', 'aoeb', 'aob', 'alb', 'adb', 'adb', 'athb', 'aib']
		);
		assert.equal(handleUniqueKey('Strøm'), 'strom');
		assert.equal(handleUniqueKey('STRAẞE'), 'strasse');
		assert.equal(handleUniqueKey('Æsir'), 'aesir');
		assert.equal(handleUniqueKey('İstanbul'), 'istanbul');
	});

	it('folds other scripts, symbols and spaces away', () => {
		assert.equal(handleUniqueKey('東京'), '');
		assert.equal(handleUniqueKey('🙂'), '');
		assert.equal(handleUniqueKey(' an na '), 'anna');
	});

	it('is the handle itself for a handle within the rule', () => {
		for (const handle of ['abc', 'seneca42', 'a1b2c3']) {
			assert.equal(handleUniqueKey(handle), handle);
		}
	});
});

describe('RESERVED_HANDLES', () => {
	it('holds only handle keys within the rule', () => {
		for (const handle of RESERVED_HANDLES) {
			assert.match(handle, HANDLE_PATTERN, handle);
			assert.equal(handleUniqueKey(handle), handle, handle);
		}
	});

	it('carries no digit, so a generated handle is never reserved', () => {
		for (const handle of RESERVED_HANDLES) {
			assert.doesNotMatch(handle, /[0-9]/, handle);
		}
	});

	it('reserves the brand, staff roles and system voices', () => {
		for (const handle of ['vici', 'viciofficial', 'founders', 'noreply', 'oracle', 'everyone']) {
			assert.ok(RESERVED_HANDLES.has(handle), handle);
		}
	});
});

describe('isReservedHandle', () => {
	it('matches a reserved handle whatever its case, accents or separators', () => {
		for (const handle of [
			'vici',
			'VICI',
			'VÍCI',
			'vicí',
			'vi.ci',
			'Vi_Ci',
			'vici-official',
			' Founders '
		]) {
			assert.ok(isReservedHandle(handle), handle);
		}
	});

	it('leaves ordinary handles alone, including ones that start with vici', () => {
		for (const handle of ['victoria', 'vicinity', 'vicious', 'aurelia']) {
			assert.equal(isReservedHandle(handle), false, handle);
		}
	});
});
