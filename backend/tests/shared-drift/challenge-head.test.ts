// The challenge-link preview mirrors two things it cannot import: the
// landing's generic share card (the app's landing-page constants, which the
// web image ships at that path) and the challenge id format, which the web
// image's nginx matches before it asks this API for a fragment.

import { describe, expect, test } from 'bun:test';
import { CHALLENGE_SHARE_IMAGE } from '../../src/social/challenge-head';
import { CHALLENGE_ID_ALPHABET, CHALLENGE_ID_LENGTH } from '../../src/social/challenges';
import {
	extractIntConst,
	extractStringConst,
	readRepoFile,
	readRepoSource
} from '../helpers/repo-source';

const landing = readRepoSource('src/lib/constants/landing-page.constants.ts');
const nginx = readRepoFile('nginx.web.conf').toString('utf8');

/** The character class and repeat count of the nginx location that captures
 * `name`, e.g. `(?<challenge_id>[0-9A-Z]{16})`. */
const nginxIdPattern = (name: string): { pattern: RegExp; length: number } => {
	const match = nginx.match(new RegExp(`\\(\\?<${name}>(\\[[^\\]]+\\])\\{(\\d+)\\}\\)`));

	if (!match?.[1] || !match[2]) {
		throw new Error(`no capture named ${name} in nginx.web.conf`);
	}

	return { pattern: new RegExp(`^${match[1]}$`), length: Number(match[2]) };
};

const PRINTABLE_ASCII = Array.from({ length: 95 }, (_, i) => String.fromCharCode(32 + i));

describe('challenge preview mirrors', () => {
	test('the share card is the landing one', () => {
		expect(CHALLENGE_SHARE_IMAGE.path).toBe(
			extractStringConst({ source: landing, constName: 'LANDING_SHARE_IMAGE_PATH' })
		);
		expect(CHALLENGE_SHARE_IMAGE.type).toBe(
			extractStringConst({ source: landing, constName: 'LANDING_SHARE_IMAGE_TYPE' })
		);
		expect(CHALLENGE_SHARE_IMAGE.width).toBe(
			extractIntConst({ source: landing, constName: 'LANDING_SHARE_IMAGE_WIDTH' })
		);
		expect(CHALLENGE_SHARE_IMAGE.height).toBe(
			extractIntConst({ source: landing, constName: 'LANDING_SHARE_IMAGE_HEIGHT' })
		);
		expect(CHALLENGE_SHARE_IMAGE.alt).toBe(
			extractStringConst({ source: landing, constName: 'LANDING_SHARE_TITLE' })
		);
	});

	test('the /c/ location takes exactly the id alphabet, in either case', () => {
		// The /c/ location is case-insensitive (`~*`): its class lists the
		// stored uppercase form.
		const { pattern, length } = nginxIdPattern('challenge_id');
		const accepted = PRINTABLE_ASCII.filter(
			(char) => pattern.test(char) || pattern.test(char.toUpperCase())
		);
		const expected = PRINTABLE_ASCII.filter((char) =>
			CHALLENGE_ID_ALPHABET.includes(char.toUpperCase())
		);

		expect(nginx).toContain('location ~* "^/c/(?<challenge_id>');
		expect(length).toBe(CHALLENGE_ID_LENGTH);
		expect(accepted).toEqual(expected);
	});

	test('the internal include location takes the same length', () => {
		expect(nginxIdPattern('head_id').length).toBe(CHALLENGE_ID_LENGTH);
	});
});
