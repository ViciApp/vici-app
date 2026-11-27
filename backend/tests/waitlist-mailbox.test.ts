import { beforeAll, describe, expect, test } from 'bun:test';
import { query } from '../src/db/client';
import { emailMailboxKey, isDomainRefused, parseDomainList } from '../src/waitlist/mailbox';
import { ensureMigrated } from './helpers/auth';
import { dbAvailable } from './helpers/setup';

const SAMPLES = [
	'Jo.Smith+vici@googlemail.com',
	'josmith@gmail.com',
	'J.O.SMITH@Gmail.com',
	'ada+a+b@Example.com',
	' ada@example.com ',
	'a.da@example.com',
	'+tag@example.com',
	'no-at-sign',
	'@example.com',
	'a@b@example.com',
	'...@gmail.com',
	'user+@example.com'
];

describe('emailMailboxKey', () => {
	test('folds a +tag, the case, and Gmail dots and domains into one mailbox', () => {
		expect(emailMailboxKey('Jo.Smith+vici@googlemail.com')).toBe('josmith@gmail.com');
		expect(emailMailboxKey('josmith@gmail.com')).toBe('josmith@gmail.com');
		expect(emailMailboxKey('Ada+vici@Example.com')).toBe('ada@example.com');
		expect(emailMailboxKey('a.da@example.com')).toBe('a.da@example.com');
	});
});

describe('disposable domains', () => {
	const listed = parseDomainList('# comment\n\nMailinator.com\nthrowaway.test\n');
	const none = { block: [], allow: [] };

	test('the list skips comments and blank lines, lowercased', () => {
		expect([...listed].sort()).toEqual(['mailinator.com', 'throwaway.test']);
	});

	test('a listed domain and a subdomain of one are refused, a lookalike is not', () => {
		expect(isDomainRefused({ domain: 'mailinator.com', listed, overlay: none })).toBe(true);
		expect(isDomainRefused({ domain: 'mx.MAILINATOR.com', listed, overlay: none })).toBe(true);
		expect(isDomainRefused({ domain: 'notmailinator.com', listed, overlay: none })).toBe(false);
		expect(isDomainRefused({ domain: 'example.com', listed, overlay: none })).toBe(false);
	});

	test('the setting blocks a domain at once, and allow wins over the file and the block', () => {
		expect(
			isDomainRefused({
				domain: 'example.com',
				listed,
				overlay: { block: ['example.com'], allow: [] }
			})
		).toBe(true);
		expect(
			isDomainRefused({
				domain: 'mx.mailinator.com',
				listed,
				overlay: { block: ['mailinator.com'], allow: ['mailinator.com'] }
			})
		).toBe(false);
	});
});

describe.if(dbAvailable)('email_mailbox_key (SQL twin)', () => {
	beforeAll(async () => {
		await ensureMigrated();
	});

	test('agrees with emailMailboxKey on every sample', async () => {
		for (const sample of SAMPLES) {
			const [row] = await query<{ key: string }>(`select email_mailbox_key($1) as key`, [sample]);

			expect({ sample, key: row?.key }).toEqual({ sample, key: emailMailboxKey(sample) });
		}
	});
});
