import {
	HANDLE_PATTERN,
	isReservedHandle,
	MAX_HANDLE_LENGTH
} from '#lib/constants/handle.constants.ts';
import {
	generateHandle,
	HANDLE_SUGGESTIONS,
	handleFormatIssue,
	sanitizeHandleInput
} from '#lib/utils/handle.utils.ts';
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

describe('sanitizeHandleInput', () => {
	it('lowercases and strips everything else as the visitor types', () => {
		assert.equal(sanitizeHandleInput('@Antonio.Ventilii'), 'antonioventilii');
		assert.equal(sanitizeHandleInput('Anna_B-99'), 'annab99');
		assert.equal(sanitizeHandleInput(' an na '), 'anna');
		assert.equal(sanitizeHandleInput('José.M'), 'josem');
	});

	it('folds accented Latin letters to their base letter', () => {
		assert.equal(sanitizeHandleInput('José'), 'jose');
		assert.equal(sanitizeHandleInput('Müller'), 'muller');
		assert.equal(sanitizeHandleInput('ñ'), 'n');
		assert.equal(sanitizeHandleInput('Peña_Çelik'), 'penacelik');
		assert.equal(sanitizeHandleInput('JOSÉ'), 'jose');
	});

	it('spells the letters with no accent to strip plainly', () => {
		assert.equal(sanitizeHandleInput('Straße'), 'strasse');
		assert.equal(sanitizeHandleInput('Strøm'), 'strom');
		assert.equal(sanitizeHandleInput('Łódź'), 'lodz');
		assert.equal(sanitizeHandleInput('Þór'), 'thor');
	});

	it('still strips other scripts and symbols', () => {
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

	it('only ever yields the rule, or something too short for it', () => {
		for (const raw of ['José.M', 'a', 'Ab', '@x.y.z', 'Straße', '東京', 'Ølé!', '  Ana  ']) {
			const handle = sanitizeHandleInput(raw);
			const issue = handleFormatIssue(handle);

			assert.ok(HANDLE_PATTERN.test(handle) || issue === 'required' || issue === 'too_short', raw);
		}
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
		assert.equal(handleFormatIssue('oracle'), 'reserved');
	});

	it('accepts every sanitized handle of a valid length', () => {
		const handle = sanitizeHandleInput('@Antonio.Ventilii');

		assert.equal(handleFormatIssue(handle), undefined);
	});
});

describe('HANDLE_SUGGESTIONS', () => {
	it('holds only claimable handles', () => {
		assert.ok(HANDLE_SUGGESTIONS.length > 0);

		for (const name of HANDLE_SUGGESTIONS) {
			assert.equal(handleFormatIssue(name), undefined, name);
		}
	});
});

describe('generateHandle', () => {
	it('is a suggestion plus two digits', () => {
		assert.equal(
			generateHandle(() => 0),
			`${HANDLE_SUGGESTIONS[0].slice(0, MAX_HANDLE_LENGTH - 2)}00`
		);
	});

	it('is always within the rule and never reserved', () => {
		for (let i = 0; i < 500; i++) {
			const handle = generateHandle();

			assert.match(handle, /[0-9]{2}$/, handle);
			assert.equal(handleFormatIssue(handle), undefined, handle);
			assert.equal(isReservedHandle(handle), false, handle);
		}
	});

	it('cuts a long name so the digits still fit', () => {
		for (let i = 0; i < HANDLE_SUGGESTIONS.length; i++) {
			const handle = generateHandle(() => (i + 0.5) / HANDLE_SUGGESTIONS.length);

			assert.ok(handle.length <= MAX_HANDLE_LENGTH, handle);
		}
	});
});
