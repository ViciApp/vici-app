import { slugifyMarketTitle } from '#lib/utils/market-slug.utils.ts';
import { hyphenateSlug } from '#lib/utils/slug.utils.ts';
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

// Slugs end up in stored league ids, free tags and shared market links, so
// the output for a given input must never change.

describe('hyphenateSlug', () => {
	it('joins words with one hyphen per run of other characters', () => {
		assert.equal(hyphenateSlug('will brazil  beat, norway?'), 'will-brazil-beat-norway');
	});

	it('drops leading and trailing hyphens', () => {
		assert.equal(hyphenateSlug('--- top 10 ---'), 'top-10');
	});

	it('treats uppercase as outside the alphabet', () => {
		assert.equal(hyphenateSlug('World Cup'), 'orld-up');
	});

	it('is empty when nothing is left', () => {
		assert.equal(hyphenateSlug('?!'), '');
	});
});

describe('slugifyMarketTitle', () => {
	it('lowercases and folds diacritics', () => {
		assert.equal(
			slugifyMarketTitle('Will São Paulo win the Série A?'),
			'will-sao-paulo-win-the-serie-a'
		);
	});

	it('folds after lowercasing, so a compatibility form that decomposes to capitals drops', () => {
		assert.equal(slugifyMarketTitle('Over 5 ㎆'), 'over-5');
	});
});
