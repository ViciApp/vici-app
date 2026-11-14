/**
 * The slug alphabet `a-z0-9-` applied to an already lowercased value: each
 * run of other characters becomes one hyphen, and leading or trailing hyphens
 * drop. Uppercase letters are outside the alphabet, so the caller lowercases
 * first, and folds diacritics first if it wants them kept: the market slug
 * lowercases before its NFKD fold, and lowercasing again after the fold would
 * change the slug of a title holding compatibility characters.
 */
export const hyphenateSlug = (lowercased: string): string =>
	lowercased.replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
