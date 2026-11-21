// The school code email states the lifetime the submission is issued with,
// read from the TTL the server enforces.

import { beforeAll, describe, expect, test } from 'bun:test';
import { upsertAppSetting } from '../src/admin/settings';
import { setEmailTransport, type EmailMessage } from '../src/lib/email';
import { MINUTE_IN_MS } from '../src/lib/time';
import {
	SCHOOL_CODE_TTL_MS,
	SCHOOL_VERIFICATION_SETTING_KEY,
	submitSchool
} from '../src/school/verification';
import { createTestUser, ensureMigrated } from './helpers/auth';
import { dbAvailable } from './helpers/setup';

describe.if(dbAvailable)('school verification email', () => {
	beforeAll(async () => {
		await ensureMigrated();
		await upsertAppSetting({ key: SCHOOL_VERIFICATION_SETTING_KEY, value: { enabled: true } });
	});

	test('the code email states the lifetime the code is issued with', async () => {
		const userId = await createTestUser();
		const sent: EmailMessage[] = [];
		const restore = setEmailTransport((message) => {
			sent.push(message);

			return Promise.resolve();
		});

		try {
			await submitSchool({
				userId,
				name: 'MIT',
				country: null,
				email: `student-${crypto.randomUUID().slice(0, 8)}@mit.edu`
			});
		} finally {
			restore();
		}

		const expiry = `expires in ${SCHOOL_CODE_TTL_MS / MINUTE_IN_MS} minutes.`;
		const [message] = sent;

		expect(sent).toHaveLength(1);
		expect(message?.text).toContain(expiry);
		expect(message?.html).toContain(expiry);
	});
});
