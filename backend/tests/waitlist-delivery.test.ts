import { afterEach, beforeAll, beforeEach, describe, expect, test } from 'bun:test';
import { randomBytes } from 'node:crypto';
import { query } from '../src/db/client';
import { setEmailTransport, type EmailMessage } from '../src/lib/email';
import { deliverOnce, WAITLIST_EMAIL_LEASE_MS } from '../src/waitlist/delivery';
import { ensureMigrated } from './helpers/auth';
import { dbAvailable } from './helpers/setup';

const uniqueKey = (): string => `test:${randomBytes(8).toString('hex')}`;

const build = (createdAt: Date): EmailMessage => ({
	to: 'a@example.com',
	subject: 'Subject',
	text: `written at ${createdAt.toISOString()}`,
	html: ''
});

/** Moves a claim past its lease, as if the run holding it had died. */
const expireLease = async (key: string): Promise<void> => {
	await query(
		`update waitlist_email_deliveries
		 set claimed_at = now() - make_interval(secs => $2::double precision / 1000 + 1)
		 where delivery_key = $1`,
		[key, WAITLIST_EMAIL_LEASE_MS]
	);
};

describe.if(dbAvailable)('deliverOnce', () => {
	let sent: EmailMessage[] = [];
	let failNext = false;
	let restore: (() => void) | undefined;

	beforeAll(async () => {
		await ensureMigrated();
	});

	beforeEach(() => {
		sent = [];
		failNext = false;
		restore = setEmailTransport((message) => {
			if (failNext) {
				failNext = false;

				return Promise.reject(new Error('provider down'));
			}

			sent.push(message);

			return Promise.resolve();
		});
	});

	afterEach(() => {
		restore?.();
	});

	test('two concurrent runs send once', async () => {
		const key = uniqueKey();
		const outcomes = await Promise.all([deliverOnce({ key, build }), deliverOnce({ key, build })]);

		expect(outcomes.sort()).toEqual(['sent', 'skipped']);
		expect(sent).toHaveLength(1);
		expect(sent[0]?.idempotencyKey).toBe(key);
	});

	test('a run that died after the claim is retried once the lease ends', async () => {
		const key = uniqueKey();

		await query(
			`insert into waitlist_email_deliveries (delivery_key, claimed_at) values ($1, now())`,
			[key]
		);

		expect(await deliverOnce({ key, build })).toBe('skipped');

		await expireLease(key);

		expect(await deliverOnce({ key, build })).toBe('sent');
		expect(sent).toHaveLength(1);
	});

	test('a run that died after the send re-sends with the same key and content', async () => {
		const key = uniqueKey();

		await expect(
			deliverOnce({ key, build, stamp: () => Promise.reject(new Error('died')) })
		).rejects.toThrow('died');

		await expireLease(key);

		expect(await deliverOnce({ key, build })).toBe('sent');
		expect(sent).toHaveLength(2);
		expect(sent[1]?.idempotencyKey).toBe(sent[0]?.idempotencyKey);
		expect(sent[1]?.text).toBe(sent[0]?.text);
	});

	test('a returned error is retried on the next run', async () => {
		const key = uniqueKey();

		failNext = true;

		await expect(deliverOnce({ key, build })).rejects.toThrow('provider down');

		expect(await deliverOnce({ key, build })).toBe('sent');
		expect(sent).toHaveLength(1);
	});

	test('a sent key is never claimed again, and the stamp lands with it', async () => {
		const key = uniqueKey();
		let stamped = 0;

		expect(
			await deliverOnce({
				key,
				build,
				stamp: () => {
					stamped += 1;

					return Promise.resolve();
				}
			})
		).toBe('sent');

		await expireLease(key);

		expect(await deliverOnce({ key, build })).toBe('skipped');
		expect(sent).toHaveLength(1);
		expect(stamped).toBe(1);
	});
});
