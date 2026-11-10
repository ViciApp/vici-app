import { hashSchoolCode, fnv1a64Hex as fnv1a64Utf8Hex } from '#lib/types/school-submission.ts';
import { avatarSeedForPrincipal } from '#lib/utils/avatar.utils.ts';
import { fnv1a64Hex as fnv1a64Utf16Hex } from '#lib/utils/hash.utils.ts';
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

// School code hashes and referral codes are stored, and avatar seeds pick the artwork users
// already see, so these digests must never change.

describe('fnv1a64Hex (UTF-8 bytes)', () => {
	const cases: [string, string][] = [
		['', 'cbf29ce484222325'],
		['a', 'af63dc4c8601ec8c'],
		['foobar', '85944171f73967e8'],
		['2vxsx-fae', '4df5c11677cba3b1'],
		['Zürich', '0ef841596f67fdc0'],
		['São Paulo', '78cf17494fdfd5ee'],
		['東京大学', 'a2e6f3e353be2859'],
		['😀', 'feff073875020288']
	];

	for (const [input, expected] of cases) {
		it(`hashes ${JSON.stringify(input)}`, () => {
			assert.equal(fnv1a64Utf8Hex(input), expected);
		});
	}

	it('keeps the stored school code digest', () => {
		assert.equal(
			hashSchoolCode({ code: '123456', salt: '0123456789abcdef0123456789abcdef' }),
			'5cd25750bf2b4922'
		);
	});
});

describe('fnv1a64Hex (UTF-16 code units, avatar seed)', () => {
	const cases: [string, string][] = [
		['', 'cbf29ce484222325'],
		['a', 'af63dc4c8601ec8c'],
		['foobar', '85944171f73967e8'],
		['2vxsx-fae', '4df5c11677cba3b1'],
		['Zürich', '9194af66e96a27bd'],
		['São Paulo', 'c8aaa80242a9853b'],
		['東京大学', '97a5e43ccf472169'],
		['😀', 'e5e45a0a241b88d8']
	];

	for (const [input, expected] of cases) {
		it(`hashes ${JSON.stringify(input)}`, () => {
			assert.equal(fnv1a64Utf16Hex(input), expected);
		});
	}

	it('keeps the avatar seed for a principal', () => {
		assert.equal(avatarSeedForPrincipal('2vxsx-fae'), 'vici-4df5c11677cba3b1');
	});
});
