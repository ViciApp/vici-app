import { Collection } from '#lib/constants/collections.constants.ts';
import { SCHOOL_VERIFY_DAILY_CAP } from '#lib/constants/school-picker.constants.ts';
import { APP_CONFIG_SCHOOL_RELAY_KEY } from '#lib/types/school.ts';
import {
	installSatelliteHost,
	type SatelliteHost
} from '#root/src/tests/mocks/satellite-host.mock.ts';
import { submitSchoolFn } from '#satellite/services/school.services.ts';
import { Principal } from '@icp-sdk/core/principal';
import { IcManagementIdl } from '@junobuild/functions/canisters/ic-management';
import assert from 'node:assert/strict';
import { afterEach, beforeEach, describe, it } from 'node:test';

const member = Principal.fromUint8Array(new Uint8Array([2, 2, 2]));
const other = Principal.fromUint8Array(new Uint8Array([3, 3, 3]));

const submission = {
	name: 'Example University',
	country: null,
	email: 'student@example-university.edu',
	locale: 'en'
};

const HTTP_REQUEST_GLOBAL = '__ic_cdk_http_request';

describe('submitSchoolFn', () => {
	let host: SatelliteHost;
	let emailsSent: number;

	beforeEach(() => {
		emailsSent = 0;
		host = installSatelliteHost({
			docs: {
				[Collection.APP_CONFIG]: {
					[APP_CONFIG_SCHOOL_RELAY_KEY]: { url: 'https://courier.test', token: 'token' }
				}
			}
		});
		host.onCall({
			method: 'raw_rand',
			argTypes: [],
			result: IcManagementIdl.raw_rand_result,
			handler: () => crypto.getRandomValues(new Uint8Array(32))
		});
		// The relay outcall: every request is one code email.
		Object.defineProperty(globalThis, HTTP_REQUEST_GLOBAL, {
			value: () => {
				emailsSent += 1;

				return Promise.resolve({ status: 200n, headers: [], body: new Uint8Array() });
			},
			configurable: true,
			writable: true
		});
	});

	afterEach(() => {
		Reflect.deleteProperty(globalThis, HTTP_REQUEST_GLOBAL);
		host.restore();
	});

	const submitAtOnce = async (count: number): Promise<number> => {
		const results = await Promise.allSettled(
			Array.from({ length: count }, () => submitSchoolFn(submission))
		);

		return results.filter(({ status }) => status === 'fulfilled').length;
	};

	it('sends at most the daily cap of codes to one account, even at once', async () => {
		host.setCaller(member);

		assert.equal(await submitAtOnce(SCHOOL_VERIFY_DAILY_CAP + 3), SCHOOL_VERIFY_DAILY_CAP);
		assert.equal(emailsSent, SCHOOL_VERIFY_DAILY_CAP);
		assert.equal(host.keys(Collection.SCHOOL_SUBMISSIONS).length, SCHOOL_VERIFY_DAILY_CAP);
	});

	it('sends at most the daily cap of codes to one address across accounts', async () => {
		host.setCaller(member);
		await submitAtOnce(SCHOOL_VERIFY_DAILY_CAP - 1);
		host.setCaller(other);

		await assert.rejects(
			Promise.all([submitSchoolFn(submission), submitSchoolFn(submission)]),
			/Too many codes/
		);
		assert.equal(emailsSent, SCHOOL_VERIFY_DAILY_CAP);
	});
});
