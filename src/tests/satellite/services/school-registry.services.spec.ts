import { Collection } from '#lib/constants/collections.constants.ts';
import {
	SCHOOL_COUNTRY_CODE_LENGTH,
	SCHOOL_NAME_MAX_LENGTH
} from '#lib/constants/school-picker.constants.ts';
import type { SchoolSubmissionDoc } from '#lib/types/school-submission.ts';
import {
	APP_CONFIG_SCHOOL_RELAY_KEY,
	SCHOOL_VERIFIED_PUBLIC_THRESHOLD,
	type SchoolDoc
} from '#lib/types/school.ts';
import {
	installSatelliteHost,
	type SatelliteHost
} from '#root/src/tests/mocks/satellite-host.mock.ts';
import { submitSchoolFn, verifySchoolCodeFn } from '#satellite/services/school.services.ts';
import { Principal } from '@icp-sdk/core/principal';
import { IcManagementIdl } from '@junobuild/functions/canisters/ic-management';
import assert from 'node:assert/strict';
import { afterEach, beforeEach, describe, it } from 'node:test';

const memberAt = (index: number): Principal =>
	Principal.fromUint8Array(new Uint8Array([2, 2, index]));

const member = memberAt(0);
const second = memberAt(1);

/** The first `count` members, each verifying on the registry row's domain. */
const firstMembers = (count: number): { principal: Principal; email: string }[] =>
	Array.from({ length: count }, (_, index) => ({
		principal: memberAt(index),
		email: `member${index}@example.edu`
	}));

// `raw_rand` answers zeros in the code bytes, so every code is this one.
const CODE = '000000';

// `spNormalize` of the typed name below.
const schoolId = 'example';

const adminRow: SchoolDoc = {
	schoolId,
	name: 'Example (as an admin listed it)',
	country: 'IT',
	domains: ['example.edu'],
	verifiedMemberCount: 0,
	status: 'public',
	createdAtMs: 1,
	updatedAtMs: 1
};

const HTTP_REQUEST_GLOBAL = '__ic_cdk_http_request';

describe('school registry', () => {
	let host: SatelliteHost;

	const registryRow = (): SchoolDoc | undefined =>
		host.readDoc<SchoolDoc>({ collection: Collection.SCHOOLS, key: schoolId });

	const seedRegistry = (row: SchoolDoc) =>
		host.putDoc({ collection: Collection.SCHOOLS, key: schoolId, data: row, owner: member });

	const submit = async ({
		principal,
		email,
		name = 'Example University',
		country = 'IT'
	}: {
		principal: Principal;
		email: string;
		name?: string;
		country?: string | null;
	}): Promise<string> => {
		host.setCaller(principal);

		const { submissionId } = await submitSchoolFn({ name, country, email, locale: 'en' });

		return submissionId;
	};

	const verify = ({ principal, submissionId }: { principal: Principal; submissionId: string }) => {
		host.setCaller(principal);

		return verifySchoolCodeFn({ submissionId, code: CODE });
	};

	const submitAndVerify = async ({ principal, email }: { principal: Principal; email: string }) =>
		verify({ principal, submissionId: await submit({ principal, email }) });

	beforeEach(() => {
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
			handler: () => {
				const bytes = crypto.getRandomValues(new Uint8Array(32));

				bytes.fill(0, 0, 4);

				return bytes;
			}
		});
		Object.defineProperty(globalThis, HTTP_REQUEST_GLOBAL, {
			value: () => Promise.resolve({ status: 200n, headers: [], body: new Uint8Array() }),
			configurable: true,
			writable: true
		});
	});

	afterEach(() => {
		Reflect.deleteProperty(globalThis, HTTP_REQUEST_GLOBAL);
		host.restore();
	});

	describe('a typed school name', () => {
		it("is refused when it names a directory school's id", async () => {
			await assert.rejects(
				submit({ principal: member, name: 'MIT', email: 'student@mit-lookalike.edu' }),
				/already listed/
			);
			assert.deepEqual(host.keys(Collection.SCHOOL_SUBMISSIONS), []);
		});

		it('is refused when the registry holds its id under other domains', async () => {
			seedRegistry(adminRow);

			await assert.rejects(
				submit({ principal: member, email: 'student@example-lookalike.edu' }),
				/already listed/
			);
		});

		it('is admitted on a domain of the registry row that holds its id', async () => {
			seedRegistry(adminRow);

			assert.equal(
				(await submitAndVerify({ principal: member, email: 'student@mail.example.edu' })).ok,
				true
			);
		});

		it('is refused past the name cap or with a country that is not a two-letter code', async () => {
			await assert.rejects(
				submit({
					principal: member,
					name: 'E'.repeat(SCHOOL_NAME_MAX_LENGTH + 1),
					email: 'student@example.edu'
				}),
				/name/
			);
			await assert.rejects(
				submit({
					principal: member,
					country: 'I'.repeat(SCHOOL_COUNTRY_CODE_LENGTH + 1),
					email: 'student@example.edu'
				}),
				/country/
			);
		});
	});

	describe('a verification', () => {
		it("keeps the registry row's name, country, domains and status", async () => {
			seedRegistry(adminRow);

			await submitAndVerify({ principal: member, email: 'student@example.edu' });

			assert.deepEqual(
				{ ...registryRow(), verifiedMemberCount: 0, updatedAtMs: 1 },
				{ ...adminRow }
			);
			assert.equal(registryRow()?.verifiedMemberCount, 1);
		});

		it('creates the row of a school the registry does not hold yet', async () => {
			await submitAndVerify({ principal: member, email: 'student@example.edu' });

			assert.equal(registryRow()?.name, 'Example University');
			assert.deepEqual(registryRow()?.domains, ['example.edu']);
			assert.equal(registryRow()?.status, 'pending');
			assert.equal(registryRow()?.verifiedMemberCount, 1);
		});

		it('turns the school public only when its count crosses the threshold', async () => {
			for (const verifier of firstMembers(SCHOOL_VERIFIED_PUBLIC_THRESHOLD)) {
				await submitAndVerify(verifier);
			}

			assert.equal(registryRow()?.status, 'public');
		});

		it('keeps a school an admin held back past the threshold pending', async () => {
			for (const verifier of firstMembers(SCHOOL_VERIFIED_PUBLIC_THRESHOLD)) {
				await submitAndVerify(verifier);
			}

			seedRegistry({
				...adminRow,
				status: 'pending',
				verifiedMemberCount: SCHOOL_VERIFIED_PUBLIC_THRESHOLD
			});

			await submitAndVerify({
				principal: memberAt(SCHOOL_VERIFIED_PUBLIC_THRESHOLD),
				email: 'next@example.edu'
			});

			assert.equal(registryRow()?.status, 'pending');
			assert.equal(registryRow()?.verifiedMemberCount, SCHOOL_VERIFIED_PUBLIC_THRESHOLD + 1);
		});

		it('is refused when another school of the same name was registered since the code was sent', async () => {
			const submissionId = await submit({ principal: second, email: 'student@example-b.edu' });

			seedRegistry(adminRow);

			assert.deepEqual(verify({ principal: second, submissionId }), {
				ok: false,
				message: 'school-taken'
			});
			assert.equal(
				host.readDoc<SchoolSubmissionDoc>({
					collection: Collection.SCHOOL_SUBMISSIONS,
					key: submissionId
				})?.status,
				'awaiting'
			);
			assert.deepEqual(registryRow(), adminRow);
		});
	});
});
