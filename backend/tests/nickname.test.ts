// The handle rule: validity (required / too_short / too_long / invalid /
// reserved), uniqueness on the lookalike key (case, accents and separators
// ignored), the self-exclusion, and both folds.

import { beforeAll, describe, expect, test } from 'bun:test';
import { query } from '../src/db/client';
import {
	checkNicknameAvailability,
	handleUniqueKey,
	MAX_HANDLE_LENGTH,
	nicknameUniqueKey
} from '../src/profiles/nickname';
import { createTestUser, ensureMigrated } from './helpers/auth';
import { createTestProfile, uniqueNickname } from './helpers/profiles';
import { dbAvailable } from './helpers/setup';

describe('nicknameUniqueKey', () => {
	test('folds case and accents to one key', () => {
		expect(nicknameUniqueKey('José')).toBe('jose');
		expect(nicknameUniqueKey('JOSE')).toBe('jose');
		expect(nicknameUniqueKey('jose')).toBe('jose');
	});

	test('keeps separators distinct', () => {
		expect(nicknameUniqueKey('a_b')).not.toBe(nicknameUniqueKey('ab'));
		expect(nicknameUniqueKey('a.b')).not.toBe(nicknameUniqueKey('a-b'));
	});

	test('trims surrounding whitespace before folding', () => {
		expect(nicknameUniqueKey('  Neo  ')).toBe('neo');
	});
});

describe('handleUniqueKey', () => {
	test('folds case, accents and separators to one key', () => {
		for (const handle of [
			'antonioventilii',
			'antonio.ventilii',
			'antonio_ventilii',
			'Antonioventilii',
			'antonioventílii'
		]) {
			expect(handleUniqueKey(handle)).toBe('antonioventilii');
		}
	});

	test('spells the letters with no accent to strip plainly', () => {
		expect(handleUniqueKey('Straße')).toBe('strasse');
		expect(handleUniqueKey('Strøm')).toBe('strom');
		expect(handleUniqueKey('Þór')).toBe('thor');
	});

	test('folds another script to an empty key', () => {
		expect(handleUniqueKey('東京')).toBe('');
	});
});

describe.if(dbAvailable)('checkNicknameAvailability', () => {
	beforeAll(async () => {
		await ensureMigrated();
	});

	test('rejects an empty nickname as required', async () => {
		expect(await checkNicknameAvailability({ nickname: '' })).toEqual({
			available: false,
			reason: 'required'
		});
		expect(await checkNicknameAvailability({ nickname: '   ' })).toEqual({
			available: false,
			reason: 'required'
		});
		expect(await checkNicknameAvailability({ nickname: null })).toEqual({
			available: false,
			reason: 'required'
		});
		expect(await checkNicknameAvailability({ nickname: undefined })).toEqual({
			available: false,
			reason: 'required'
		});
	});

	test('rejects one or two characters as too_short', async () => {
		for (const nickname of ['a', 'ab']) {
			expect(await checkNicknameAvailability({ nickname })).toEqual({
				available: false,
				reason: 'too_short'
			});
		}
	});

	test('rejects an over-length handle as too_long, accepts the exact ceiling', async () => {
		const ceiling = uniqueNickname().padEnd(MAX_HANDLE_LENGTH, '7');

		expect(await checkNicknameAvailability({ nickname: `${ceiling}7` })).toEqual({
			available: false,
			reason: 'too_long'
		});
		expect(await checkNicknameAvailability({ nickname: ceiling })).toEqual({
			available: true
		});
	});

	test('rejects out-of-charset values as invalid', async () => {
		for (const nickname of [
			'bad name',
			'user@host',
			'emoji\u{1F600}',
			' padded ',
			'semi;colon',
			'José_99',
			'CaféOwner',
			'a.b-c_d',
			'Upper'
		]) {
			expect(await checkNicknameAvailability({ nickname })).toEqual({
				available: false,
				reason: 'invalid'
			});
		}
	});

	test('accepts lowercase letters and digits', async () => {
		expect(await checkNicknameAvailability({ nickname: uniqueNickname() })).toEqual({
			available: true
		});
	});

	test('rejects a reserved handle as reserved', async () => {
		for (const nickname of ['admin', 'vici', 'support']) {
			expect(await checkNicknameAvailability({ nickname })).toEqual({
				available: false,
				reason: 'reserved'
			});
		}
	});

	test('reports a lookalike of a stored handle as taken', async () => {
		const base = uniqueNickname();
		const userId = await createTestUser();

		// A handle that predates the rule, as an import leaves it.
		await query(`insert into profiles (user_id, nickname, nickname_key) values ($1, $2, $3)`, [
			userId,
			`${base.slice(0, 4).toUpperCase()}.${base.slice(4)}`,
			nicknameUniqueKey(`${base.slice(0, 4)}.${base.slice(4)}`)
		]);

		expect(await checkNicknameAvailability({ nickname: base })).toEqual({
			available: false,
			reason: 'taken'
		});
	});

	test('excludes the editing user from the collision scan', async () => {
		const { userId, profile } = await createTestProfile();

		expect(
			await checkNicknameAvailability({ nickname: profile.nickname, excludeUserId: userId })
		).toEqual({ available: true });
	});
});
