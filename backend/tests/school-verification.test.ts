// School verification semantics: the server-side feature gate, the domain
// gate (directory match / consumer rejection / add-your-own), the digest
// storage, the TTL + attempt-cap defenses, the verify success path with the
// registry threshold flip, and the daily rate limit.

import { isNullish } from '@dfinity/utils';
import { beforeAll, beforeEach, describe, expect, test } from 'bun:test';
import { upsertAppSetting } from '../src/admin/settings';
import { createSession } from '../src/auth/sessions';
import { query } from '../src/db/client';
import { app } from '../src/index';
import { resetRateLimits } from '../src/lib/rate-limit';
import {
	escapeHtml,
	hashSchoolCode,
	SCHOOL_CODE_MAX_ATTEMPTS,
	SCHOOL_VERIFICATION_SETTING_KEY,
	SCHOOL_VERIFY_DAILY_CAP,
	submitSchool,
	verifySchoolCode
} from '../src/school/verification';
import { createTestUser, ensureMigrated } from './helpers/auth';
import { createTestProfile } from './helpers/profiles';

beforeAll(async () => {
	await ensureMigrated();
	await upsertAppSetting({ key: SCHOOL_VERIFICATION_SETTING_KEY, value: { enabled: true } });
});

interface SubmissionRow {
	user_id: string;
	email: string;
	school_id: string;
	school_name: string;
	is_new: boolean;
	code_hash: string;
	salt: string;
	attempts: number;
	status: string;
	expires_at_ms: string;
}

const readSubmission = async (submissionId: string): Promise<SubmissionRow | undefined> => {
	const rows = await query<SubmissionRow>(
		`select user_id, email, school_id, school_name, is_new, code_hash, salt,
		        attempts, status, expires_at_ms::text
		 from school_submissions where id = $1`,
		[submissionId]
	);

	return rows[0];
};

/** The test's window into the mailed code: recompute it from the stored
 * digest by brute-forcing the 6-digit space under the row's salt. */
const recoverCode = (submission: SubmissionRow | undefined): string => {
	if (isNullish(submission)) {
		throw new Error('submission row missing');
	}

	for (let n = 0; n < 1_000_000; n++) {
		const code = n.toString().padStart(6, '0');

		if (hashSchoolCode({ code, salt: submission.salt }) === submission.code_hash) {
			return code;
		}
	}

	throw new Error('stored digest matches no 6-digit code');
};

const uniqueLocal = (): string => `student-${crypto.randomUUID().slice(0, 8)}`;

describe('feature gate', () => {
	test('submission refuses while the setting is disabled, and again when it is missing', async () => {
		const userId = await createTestUser();

		await upsertAppSetting({ key: SCHOOL_VERIFICATION_SETTING_KEY, value: { enabled: false } });

		expect(
			submitSchool({ userId, name: 'MIT', country: null, email: `${uniqueLocal()}@mit.edu` })
		).rejects.toThrow('School email verification is disabled.');

		await query(`delete from app_settings where key = $1`, [SCHOOL_VERIFICATION_SETTING_KEY]);

		expect(
			submitSchool({ userId, name: 'MIT', country: null, email: `${uniqueLocal()}@mit.edu` })
		).rejects.toThrow('School email verification is not configured.');

		// Fail closed: a present but malformed setting (no explicit true) must
		// stay disabled.
		await upsertAppSetting({ key: SCHOOL_VERIFICATION_SETTING_KEY, value: {} });

		expect(
			submitSchool({ userId, name: 'MIT', country: null, email: `${uniqueLocal()}@mit.edu` })
		).rejects.toThrow('School email verification is disabled.');

		await upsertAppSetting({ key: SCHOOL_VERIFICATION_SETTING_KEY, value: { enabled: true } });
	});
});

describe('email body safety', () => {
	test('escapeHtml neutralizes markup in a user-provided school name', () => {
		expect(escapeHtml(`<img src=x onerror=alert(1)>"Uni" & 'Co'`)).toBe(
			'&lt;img src=x onerror=alert(1)&gt;&quot;Uni&quot; &amp; &#39;Co&#39;'
		);
	});
});

describe('domain gate + submission shape', () => {
	test('a directory domain resolves to its school and stores a digest, never the code', async () => {
		const userId = await createTestUser();

		const { submissionId } = await submitSchool({
			userId,
			name: 'ignored, the directory wins',
			country: 'IT',
			email: `${uniqueLocal()}@MIT.edu`
		});

		const submission = await readSubmission(submissionId);

		expect(submission?.school_id).toBe('mit');
		expect(submission?.is_new).toBeFalse();
		expect(submission?.status).toBe('awaiting');
		expect(submission?.code_hash).toMatch(/^[0-9a-f]{64}$/);
		expect(Number(submission?.expires_at_ms)).toBeGreaterThan(Date.now());
	});

	test('a consumer mailbox is rejected; an unknown domain becomes a new school keyed by the normalized name', async () => {
		const userId = await createTestUser();

		expect(
			submitSchool({ userId, name: 'Gmail U', country: null, email: `${uniqueLocal()}@gmail.com` })
		).rejects.toThrow('Use your school email, not a personal mailbox.');

		const { submissionId } = await submitSchool({
			userId,
			name: 'The University of Testville',
			country: 'CH',
			email: `${uniqueLocal()}@testville-uni.example`
		});
		const submission = await readSubmission(submissionId);

		expect(submission?.school_id).toBe('testville');
		expect(submission?.is_new).toBeTrue();
	});
});

describe('verify', () => {
	test('wrong codes count attempts and lock out at the cap; the right code then no longer helps', async () => {
		const userId = await createTestUser();
		const { submissionId } = await submitSchool({
			userId,
			name: 'MIT',
			country: null,
			email: `${uniqueLocal()}@mit.edu`
		});
		const submission = await readSubmission(submissionId);
		const code = recoverCode(submission);
		const wrong = code === '000000' ? '000001' : '000000';

		for (let i = 0; i < SCHOOL_CODE_MAX_ATTEMPTS; i++) {
			expect(await verifySchoolCode({ userId, submissionId, code: wrong })).toEqual({
				ok: false,
				message: 'invalid-code'
			});
		}

		expect(await verifySchoolCode({ userId, submissionId, code })).toEqual({
			ok: false,
			message: 'too-many-attempts'
		});
	});

	test('concurrent wrong guesses check at most the cap; the rest are refused without a compare', async () => {
		const userId = await createTestUser();
		const { submissionId } = await submitSchool({
			userId,
			name: 'MIT',
			country: null,
			email: `${uniqueLocal()}@mit.edu`
		});
		const code = recoverCode(await readSubmission(submissionId));
		const wrong = code === '000000' ? '000001' : '000000';

		const results = await Promise.all(
			Array.from({ length: 20 }, () => verifySchoolCode({ userId, submissionId, code: wrong }))
		);
		const messages = results.map(({ message }) => message);

		expect(messages.filter((message) => message === 'invalid-code')).toHaveLength(
			SCHOOL_CODE_MAX_ATTEMPTS
		);
		expect(messages.filter((message) => message === 'too-many-attempts')).toHaveLength(
			20 - SCHOOL_CODE_MAX_ATTEMPTS
		);
		expect((await readSubmission(submissionId))?.attempts).toBe(SCHOOL_CODE_MAX_ATTEMPTS);

		expect(await verifySchoolCode({ userId, submissionId, code })).toEqual({
			ok: false,
			message: 'too-many-attempts'
		});
		expect((await readSubmission(submissionId))?.status).toBe('awaiting');
	});

	test('the right code on the last attempt of the budget still verifies', async () => {
		// A per-run school keeps this member out of the shared directory rows.
		const runId = crypto.randomUUID().slice(0, 8);
		const userId = await createTestUser();
		const { submissionId } = await submitSchool({
			userId,
			name: `Lastattempt${runId} University`,
			country: null,
			email: `${uniqueLocal()}@lastattempt-${runId}.example`
		});
		const code = recoverCode(await readSubmission(submissionId));
		const wrong = code === '000000' ? '000001' : '000000';

		for (let i = 0; i < SCHOOL_CODE_MAX_ATTEMPTS - 1; i++) {
			expect((await verifySchoolCode({ userId, submissionId, code: wrong })).message).toBe(
				'invalid-code'
			);
		}

		const result = await verifySchoolCode({ userId, submissionId, code });

		expect(result).toEqual({ ok: true, schoolId: `lastattempt${runId}`, status: 'pending' });
		expect((await readSubmission(submissionId))?.status).toBe('verified');
	});

	test('an expired submission refuses and is marked expired', async () => {
		const userId = await createTestUser();
		const { submissionId } = await submitSchool({
			userId,
			name: 'MIT',
			country: null,
			email: `${uniqueLocal()}@mit.edu`
		});

		await query(`update school_submissions set expires_at_ms = $2 where id = $1`, [
			submissionId,
			Date.now() - 1000
		]);

		const submission = await readSubmission(submissionId);

		expect(await verifySchoolCode({ userId, submissionId, code: recoverCode(submission) })).toEqual(
			{ ok: false, message: 'expired' }
		);
		expect((await readSubmission(submissionId))?.status).toBe('expired');
	});

	test('only the owner may verify; unknown submissions read as not found', async () => {
		const userId = await createTestUser();
		const other = await createTestUser();
		const { submissionId } = await submitSchool({
			userId,
			name: 'MIT',
			country: null,
			email: `${uniqueLocal()}@mit.edu`
		});

		expect(await verifySchoolCode({ userId: other, submissionId, code: '123456' })).toEqual({
			ok: false,
			message: 'not-authorized'
		});
		expect(
			await verifySchoolCode({ userId, submissionId: crypto.randomUUID(), code: '123456' })
		).toEqual({ ok: false, message: 'not-found' });
	});

	test('the success path verifies the member, flags the profile, and flips the school public at three members', async () => {
		// A per-run school id keeps the threshold arithmetic isolated from
		// prior runs' verified rows in the shared database.
		const runId = crypto
			.randomUUID()
			.slice(0, 8)
			.replace(/[^a-z0-9]/g, '');
		const schoolId = `threshold${runId}`;
		const schoolEmailDomain = `threshold-${runId}.example`;
		const results: string[] = [];

		for (let i = 0; i < 3; i++) {
			const { userId } = await createTestProfile();
			const { submissionId } = await submitSchool({
				userId,
				name: `Threshold${runId} University`,
				country: 'DE',
				email: `${uniqueLocal()}@${schoolEmailDomain}`
			});
			const submission = await readSubmission(submissionId);
			const result = await verifySchoolCode({
				userId,
				submissionId,
				code: recoverCode(submission)
			});

			expect(result.ok).toBeTrue();
			expect(result.schoolId).toBe(schoolId);

			results.push(result.status ?? '');

			const profiles = await query<{ school_status: string | null }>(
				`select school_status from profiles where user_id = $1`,
				[userId]
			);

			expect(profiles[0]?.school_status).toBe('verified');
		}

		expect(results).toEqual(['pending', 'pending', 'public']);

		const schools = await query<{ verified_member_count: number; status: string }>(
			`select verified_member_count, status from schools where school_id = $1`,
			[schoolId]
		);

		expect(schools[0]).toEqual({ verified_member_count: 3, status: 'public' });
	});
});

describe('verify route', () => {
	beforeEach(() => {
		resetRateLimits();
	});

	const verifyAs = (token: string) =>
		app.handle(
			new Request('http://localhost/api/v1/school/verify', {
				method: 'POST',
				headers: { 'content-type': 'application/json', cookie: `vici_session=${token}` },
				body: JSON.stringify({ submissionId: crypto.randomUUID(), code: '123456' })
			})
		);

	test('limits verify calls per account, leaving other accounts untouched', async () => {
		const token = await createSession(await createTestUser());
		const otherToken = await createSession(await createTestUser());

		for (let i = 0; i < 30; i++) {
			expect((await verifyAs(token)).status).toBe(200);
		}

		const limited = await verifyAs(token);

		expect(limited.status).toBe(429);
		expect(await limited.json()).toEqual({ error: 'rate_limited' });
		expect(limited.headers.get('retry-after')).not.toBeNull();
		expect((await verifyAs(otherToken)).status).toBe(200);
	});
});

describe('rate limit', () => {
	test('the per-user rolling cap refuses the next send', async () => {
		const userId = await createTestUser();

		for (let i = 0; i < SCHOOL_VERIFY_DAILY_CAP; i++) {
			await submitSchool({
				userId,
				name: 'MIT',
				country: null,
				email: `${uniqueLocal()}@mit.edu`
			});
		}

		expect(
			submitSchool({ userId, name: 'MIT', country: null, email: `${uniqueLocal()}@mit.edu` })
		).rejects.toThrow('Too many codes requested today. Try again tomorrow.');
	});

	test('the per-email cap binds across users', async () => {
		const email = `${uniqueLocal()}@mit.edu`;

		for (let i = 0; i < SCHOOL_VERIFY_DAILY_CAP; i++) {
			await submitSchool({ userId: await createTestUser(), name: 'MIT', country: null, email });
		}

		expect(
			submitSchool({ userId: await createTestUser(), name: 'MIT', country: null, email })
		).rejects.toThrow('Too many codes requested today. Try again tomorrow.');
	});
});
