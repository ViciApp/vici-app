// Nickname rules: validity (required / too_short / too_long / invalid),
// case- and accent-insensitive uniqueness, the self-exclusion, and the
// fold's separator handling.

import { beforeAll, describe, expect, test } from 'bun:test';
import {
	checkNicknameAvailability,
	MAX_NICKNAME_LENGTH,
	nicknameUniqueKey
} from '../src/profiles/nickname';
import { ensureMigrated } from './helpers/auth';
import { createTestProfile } from './helpers/profiles';
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

	test('rejects a single character as too_short', async () => {
		expect(await checkNicknameAvailability({ nickname: 'a' })).toEqual({
			available: false,
			reason: 'too_short'
		});
	});

	test('rejects an over-length nickname as too_long, accepts the exact ceiling', async () => {
		expect(
			await checkNicknameAvailability({ nickname: 'a'.repeat(MAX_NICKNAME_LENGTH + 1) })
		).toEqual({
			available: false,
			reason: 'too_long'
		});
		expect(await checkNicknameAvailability({ nickname: 'a'.repeat(MAX_NICKNAME_LENGTH) })).toEqual({
			available: true
		});
	});

	test('rejects out-of-charset values as invalid', async () => {
		for (const nickname of ['bad name', 'user@host', 'emoji\u{1F600}', ' padded ', 'semi;colon']) {
			expect(await checkNicknameAvailability({ nickname })).toEqual({
				available: false,
				reason: 'invalid'
			});
		}
	});

	test('accepts letters with accents, digits and separators', async () => {
		for (const nickname of ['José_99', 'CaféOwner', 'a.b-c_d', 'XX']) {
			expect(await checkNicknameAvailability({ nickname })).toEqual({ available: true });
		}
	});

	test('reports a case-folded collision as taken', async () => {
		const { profile } = await createTestProfile();

		expect(await checkNicknameAvailability({ nickname: profile.nickname.toUpperCase() })).toEqual({
			available: false,
			reason: 'taken'
		});
	});

	test('reports an accent-folded collision as taken', async () => {
		const { profile } = await createTestProfile();
		// Rebuild the same fold with an accent on the first letter.
		const accented = `${profile.nickname[0]}́${profile.nickname.slice(1)}`.normalize('NFC');

		expect(await checkNicknameAvailability({ nickname: accented })).toEqual({
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
