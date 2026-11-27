import { nonNullish } from '@dfinity/utils';
import { describe, expect, test } from 'bun:test';
import { en } from '../src/waitlist/email-copy/en';
import {
	WAITLIST_EMAIL_COPY,
	waitlistAlreadyMemberEmail,
	waitlistCodeEmail,
	waitlistEmailCopy,
	waitlistLegacyAccountEmail,
	waitlistReceiptEmail,
	waitlistRemovedEmail
} from '../src/waitlist/emails';
import { importRepoModule } from './helpers/repo-source';

const REMOVE_URL = 'https://vici.app/waitlist/remove?r=id&t=token';

/** Every leaf path of a copy object, so two locales can be compared key by key. */
const leafPaths = (value: object, prefix = ''): string[] =>
	Object.entries(value).flatMap(([key, leaf]) =>
		typeof leaf === 'object' && nonNullish(leaf)
			? leafPaths(leaf, `${prefix}${key}.`)
			: [`${prefix}${key}`]
	);

describe('waitlist email copy', () => {
	test('every live app locale has copy, with every key', async () => {
		const { SUPPORTED_LOCALES } = await importRepoModule<{
			SUPPORTED_LOCALES: readonly { id: string }[];
		}>('src/lib/constants/locale.constants.ts');
		const live = SUPPORTED_LOCALES.map(({ id }) => id);

		expect(live.length).toBeGreaterThan(1);

		for (const locale of live) {
			const copy = WAITLIST_EMAIL_COPY[locale];

			expect({ locale, has: nonNullish(copy) }).toEqual({ locale, has: true });
			expect(leafPaths(copy ?? {})).toEqual(leafPaths(en));
		}
	});

	test('a regional locale falls back to its language, an unknown one to English', () => {
		expect(waitlistEmailCopy('pt-BR')).toBe(WAITLIST_EMAIL_COPY.pt as typeof en);
		expect(waitlistEmailCopy('es-MX')).toBe(WAITLIST_EMAIL_COPY.es as typeof en);
		expect(waitlistEmailCopy('ja')).toBe(en);
		expect(waitlistEmailCopy('xx')).toBe(en);
	});
});

describe('waitlist email builders', () => {
	for (const locale of Object.keys(WAITLIST_EMAIL_COPY)) {
		test(`${locale}: each builder names what it was given, and the remove link where due`, () => {
			const code = waitlistCodeEmail({
				to: 'a@example.com',
				locale,
				handle: 'ada',
				code: '123456',
				ttlMs: 10 * 60 * 1000,
				removeUrl: REMOVE_URL
			});

			expect(code.text).toContain('123456');
			expect(code.text).toContain('@ada');
			expect(code.text).toContain('10');
			expect(code.html).toContain(REMOVE_URL.replace('&', '&amp;'));

			const receipt = waitlistReceiptEmail({
				to: 'a@example.com',
				locale,
				handle: 'ada',
				holdMonths: 12,
				removeUrl: REMOVE_URL
			});

			expect(receipt.subject).toContain('@ada');
			expect(receipt.text).toContain('12');
			expect(receipt.text).toContain(REMOVE_URL);

			for (const notice of [
				waitlistAlreadyMemberEmail({ to: 'a@example.com', locale }),
				waitlistLegacyAccountEmail({ to: 'a@example.com', locale })
			]) {
				expect(notice.text).not.toContain('/waitlist/remove');
				expect(notice.text).not.toMatch(/\d{6}/);
			}

			expect(waitlistAlreadyMemberEmail({ to: 'a@example.com', locale }).text).toContain('/signin');
			expect(waitlistRemovedEmail({ to: 'a@example.com', locale, handle: 'ada' }).text).toContain(
				'@ada'
			);
		});
	}

	test('the code email subject is not the sign-in code subject', () => {
		expect(en.code.subject).not.toBe('Your VICI sign-in code');
	});
});
