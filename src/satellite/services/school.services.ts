/**
 * School-email membership verification — backend item B.1.
 *
 * Two `defineUpdate` endpoints, wired in `src/satellite/index.ts`:
 *
 *   submitSchool({ name, country, schoolId?, email, locale }) -> { submissionId }
 *     · re-runs the `spMatchEmail` domain gate SERVER-SIDE (the FE check
 *       is advisory; this is authoritative)
 *     · rate-limits per principal + per email (rolling 24h)
 *     · derives a 6-digit code from the management canister's `raw_rand`
 *       (real entropy — codes can't be pre-computed)
 *     · persists a submission holding only an FNV digest of the code,
 *       a ~30-min TTL, and an attempt counter
 *     · mails the code via a single HTTPS outcall to the `vici-courier`
 *       relay (`isReplicated: false` so one node sends it, not ~13–40)
 *
 *   verifySchoolCode({ submissionId, code }) -> { ok, schoolId?, status?, message? }
 *     · authorizes the caller against the submission's `${member}/` key
 *     · enforces TTL + attempt cap, compares the digest
 *     · on success: attaches the school (server bumps the verified-member
 *       count + flips the school public at 3) and marks the owner's
 *       profile `schoolStatus: 'verified'`
 *
 * The plaintext code never touches canister state — it lives only in the
 * email and the outbound outcall body. The stored digest is FNV (no
 * crypto hash exists in Sputnik); the real guessing defenses are the
 * attempt cap + TTL + rate limit (see `school-picker.constants.ts`).
 */

import { Collection } from '#lib/constants/collections.constants.ts';
import {
	SCHOOL_CODE_MAX_ATTEMPTS,
	SCHOOL_CODE_TTL_MS,
	SCHOOL_VERIFY_DAILY_CAP
} from '#lib/constants/school-picker.constants.ts';
import { WORLDS_UNIVERSITIES } from '#lib/constants/worlds-affiliations.constants.ts';
import type { UserProfile } from '#lib/types/profile.ts';
import {
	hashSchoolCode,
	schoolSubmissionKey,
	type SchoolSubmissionDoc
} from '#lib/types/school-submission.ts';
import {
	APP_CONFIG_SCHOOL_RELAY_KEY,
	SCHOOL_VERIFIED_PUBLIC_THRESHOLD,
	schoolKey,
	type SchoolDoc,
	type SchoolRelayConfig,
	type SchoolStatus
} from '#lib/types/school.ts';
import { spMatchEmail, spNormalize } from '#lib/utils/school-picker.utils.ts';
import { captureServerEvents, type ServerEventInput } from '$satellite/services/analytics.services';
import { logError, logInfo } from '$satellite/utils/logger.utils';
import { escapeRegex } from '$satellite/utils/regex.utils';
import { isNullish, nonNullish } from '@dfinity/utils';
import { Principal } from '@icp-sdk/core/principal';
import { IcManagementIdl } from '@junobuild/functions/canisters/ic-management';
import { call, httpRequest, msgCaller, time } from '@junobuild/functions/ic-cdk';
import {
	decodeDocData,
	encodeDocData,
	getAdminAccessKeys,
	getDocStore,
	listDocsStore,
	setDocStore
} from '@junobuild/functions/sdk';

const DAY_NS = 86_400_000_000_000n;
const MANAGEMENT_CANISTER_ID = 'aaaaa-aa';

/**
 * Best-effort server-side capture for the school-verification funnel.
 * Analytics must never block or fail a verification write, so a capture
 * error is logged and swallowed rather than surfacing to the caller.
 */
const captureSchoolEvent = (event: ServerEventInput): void => {
	try {
		captureServerEvents({ events: [event] });
	} catch (err) {
		logError({
			message: 'school verification analytics capture failed (verification unaffected)',
			detail: { error: err instanceof Error ? err.message : `${err}` }
		});
	}
};

/**
 * A satellite controller principal, used as the `caller` for the
 * server-owned, `controllers`-scoped collections (`app_config`,
 * `school_submissions`, `schools`). The `*DocStore` APIs enforce the
 * collection's read/write rule against the `caller` they're given — and
 * the end user who invokes these endpoints is NOT a controller — so we
 * read/write those collections as an admin. (User-owned `profiles` stays
 * on the real caller.) Throws if the satellite somehow has no controller.
 */
const adminCaller = (): Uint8Array => {
	const first = getAdminAccessKeys()[0]?.[0];

	if (isNullish(first)) {
		throw new Error('No satellite controller available for server config access.');
	}

	return first;
};

// ─── Inputs / outputs (mirror the FE service signatures) ─────────────────

interface SubmitSchoolArgs {
	name: string;
	country: string | null;
	schoolId?: string;
	email: string;
	locale: string;
}

interface VerifySchoolCodeArgs {
	submissionId: string;
	code: string;
}

interface VerifySchoolCodeResult {
	ok: boolean;
	schoolId?: string;
	status?: SchoolStatus;
	message?: string;
}

// ─── Resolved school target (server-authoritative) ───────────────────────

interface ResolvedSchool {
	schoolId: string;
	name: string;
	country: string | null;
	domains: string[];
	isNew: boolean;
}

const nowMs = (): number => Number(time() / 1_000_000n);

/**
 * Server-side re-run of the picker's domain gate. The directory is the
 * same {@link WORLDS_UNIVERSITIES} the FE uses, so a `match` here is the
 * authoritative "this email belongs to a known school" verdict and an
 * `unknown-domain` is a brand-new school keyed by its normalized name.
 * A consumer mailbox (or an unparseable address) is rejected outright.
 */
const resolveSchool = ({
	email,
	name,
	country
}: {
	email: string;
	name: string;
	country: string | null;
}): ResolvedSchool => {
	const matched = spMatchEmail({ email, directory: WORLDS_UNIVERSITIES });

	if (isNullish(matched)) {
		throw new Error('Enter a valid school email address.');
	}

	if (matched.kind === 'consumer') {
		throw new Error('Use your school email, not a personal mailbox.');
	}

	if (matched.kind === 'match') {
		const { option } = matched;

		return {
			schoolId: option.id,
			name: option.name,
			country: option.country ?? country,
			domains: [...(option.domains ?? [])],
			isNew: false
		};
	}

	// unknown-domain — a plausible new school.
	const slug = spNormalize(name);

	if (slug.length === 0) {
		throw new Error('Enter the name of your university.');
	}

	return {
		schoolId: slug,
		name: name.trim(),
		country,
		domains: [matched.domain],
		isNew: true
	};
};

/**
 * Rolling-24h send counts for the caller, split per principal and per
 * email. The scan is bounded server-side to docs created in the last 24h
 * (the `created_at` matcher), so it never grows with the lifetime size of
 * the collection — only with the day's submission volume.
 */
const recentSendCounts = ({
	caller,
	memberText,
	email,
	sinceNs
}: {
	caller: Uint8Array;
	memberText: string;
	email: string;
	sinceNs: bigint;
}): { byPrincipal: number; byEmail: number } => {
	const { items } = listDocsStore({
		collection: Collection.SCHOOL_SUBMISSIONS,
		caller,
		params: { matcher: { created_at: { greater_than: sinceNs } } }
	});

	const lowerEmail = email.toLowerCase().trim();
	let byPrincipal = 0;
	let byEmail = 0;

	for (const [, item] of items) {
		try {
			const doc = decodeDocData<SchoolSubmissionDoc>(item.data);

			if (doc.member === memberText) {
				byPrincipal += 1;
			}

			if (doc.email === lowerEmail) {
				byEmail += 1;
			}
		} catch {
			// Skip malformed rows for accounting purposes.
		}
	}

	return { byPrincipal, byEmail };
};

const toHex = (bytes: number[]): string =>
	bytes.map((b) => b.toString(16).padStart(2, '0')).join('');

/**
 * From the management canister's `raw_rand` (32 bytes of cryptographic
 * randomness): a 6-digit code (bytes 0–3), a 128-bit salt (bytes 4–19),
 * and a 96-bit submission nonce (bytes 20–31). Using `raw_rand` rather
 * than the `time()`-seeded FNV trick in `referral.services.ts` matters
 * here: a verification code must be unpredictable, not merely unique; and
 * the nonce makes every submission row distinct (immutable, never
 * overwritten).
 */
const generateCode = async (): Promise<{ code: string; salt: string; nonce: string }> => {
	const random = await call<Uint8Array | number[]>({
		canisterId: Principal.fromText(MANAGEMENT_CANISTER_ID),
		method: 'raw_rand',
		args: [],
		result: IcManagementIdl.raw_rand_result
	});

	const bytes = Array.from(random as ArrayLike<number>);

	if (bytes.length < 32) {
		throw new Error('raw_rand returned too few bytes.');
	}

	const n = (((bytes[0] << 24) | (bytes[1] << 16) | (bytes[2] << 8) | bytes[3]) >>> 0) % 1_000_000;

	return {
		code: n.toString().padStart(6, '0'),
		salt: toHex(bytes.slice(4, 20)),
		nonce: toHex(bytes.slice(20, 32))
	};
};

const readRelayConfig = (caller: Uint8Array): SchoolRelayConfig => {
	const doc = getDocStore({
		collection: Collection.APP_CONFIG,
		key: APP_CONFIG_SCHOOL_RELAY_KEY,
		caller
	});

	if (isNullish(doc)) {
		// The feature is OFF server-side until a controller writes this doc —
		// so the live endpoints can't send email even if the FE flag is on.
		throw new Error('School email relay is not configured.');
	}

	const config = decodeDocData<SchoolRelayConfig>(doc.data);

	if (isNullish(config.url) || isNullish(config.token)) {
		throw new Error('School email relay config is incomplete.');
	}

	// Explicit server-side kill switch — independent of the FE flag.
	if (config.enabled === false) {
		throw new Error('School email verification is disabled.');
	}

	return config;
};

/**
 * One HTTPS outcall to the `vici-courier` relay. `isReplicated: false`
 * keeps this non-idempotent send on a single node (the relay also dedupes
 * on `idempotency-key`, so a node-level retry never double-sends). The
 * request is semantic — `vici-courier` owns the localized template; the
 * canister carries no email copy.
 */
const sendCodeEmail = async ({
	relay,
	email,
	code,
	locale,
	schoolName,
	submissionId
}: {
	relay: SchoolRelayConfig;
	email: string;
	code: string;
	locale: string;
	schoolName: string;
	submissionId: string;
}): Promise<void> => {
	const body = new TextEncoder().encode(
		JSON.stringify({
			template: 'school_verification_code',
			to: email,
			locale,
			vars: { code, schoolName },
			idempotencyKey: submissionId
		})
	);

	const response = await httpRequest({
		url: `${relay.url}/send`,
		method: 'POST',
		headers: [
			{ name: 'content-type', value: 'application/json' },
			{ name: 'authorization', value: `Bearer ${relay.token}` },
			{ name: 'idempotency-key', value: submissionId }
		],
		body,
		maxResponseBytes: 1_024n,
		isReplicated: false
	});

	if (response.status < 200n || response.status >= 300n) {
		throw new Error(`courier send failed with status ${response.status}`);
	}
};

export const submitSchoolFn = async ({
	name,
	country,
	email,
	locale
}: SubmitSchoolArgs): Promise<{ submissionId: string }> => {
	const caller = msgCaller();

	if (caller.toText() === Principal.anonymous().toText()) {
		throw new Error('Sign in before verifying a school.');
	}

	const memberText = caller.toText();
	const lowerEmail = email.toLowerCase().trim();
	// The server-owned collections are controllers-scoped, so read/write
	// them as an admin (the invoking user isn't a controller).
	const admin = adminCaller();

	// 0. Server-side gate — throws unless a controller has set + enabled the
	// relay config doc. Enforces "OFF" on the canister regardless of the FE
	// flag, and is read before any work so a disabled feature rejects fast.
	const relay = readRelayConfig(admin);

	// 1. Server-authoritative domain gate.
	const resolved = resolveSchool({ email: lowerEmail, name, country });

	// 2. Rate limit (per principal + per email, rolling 24h).
	const { byPrincipal, byEmail } = recentSendCounts({
		caller: admin,
		memberText,
		email: lowerEmail,
		sinceNs: time() - DAY_NS
	});

	if (byPrincipal >= SCHOOL_VERIFY_DAILY_CAP || byEmail >= SCHOOL_VERIFY_DAILY_CAP) {
		throw new Error('Too many codes requested today. Try again tomorrow.');
	}

	// 3. Unpredictable code + per-submission salt + per-send nonce.
	const { code, salt, nonce } = await generateCode();
	const createdAtMs = nowMs();
	const submissionId = schoolSubmissionKey({
		member: memberText,
		schoolId: resolved.schoolId,
		nonce
	});

	// 4. Persist a fresh, immutable submission (digest only — never the
	// plaintext code). The per-send nonce makes the key unique, so this is
	// always a create and never overwrites a prior (possibly verified) row.
	const submission: SchoolSubmissionDoc = {
		member: memberText,
		email: lowerEmail,
		schoolId: resolved.schoolId,
		schoolName: resolved.name,
		country: resolved.country,
		domains: resolved.domains,
		isNew: resolved.isNew,
		codeHash: hashSchoolCode({ code, salt }),
		salt,
		expiresAtMs: createdAtMs + SCHOOL_CODE_TTL_MS,
		attempts: 0,
		status: 'awaiting',
		createdAtMs
	};

	setDocStore({
		collection: Collection.SCHOOL_SUBMISSIONS,
		key: submissionId,
		caller: admin,
		doc: {
			data: encodeDocData<SchoolSubmissionDoc>(submission)
		}
	});

	// 5. Mail the code via the relay read in step 0.
	await sendCodeEmail({
		relay,
		email: lowerEmail,
		code,
		locale,
		schoolName: resolved.name,
		submissionId
	});

	logInfo({
		message: 'school_code_sent',
		detail: { member: memberText, school: resolved.schoolId, is_new: resolved.isNew }
	});

	// Verification funnel: a code email actually went out (the submission
	// write + relay send above both succeeded). `label` is the school id —
	// behavioural, never the address.
	captureSchoolEvent({
		name: 'school_verify_email_submitted',
		principal: memberText,
		props: { label: resolved.schoolId }
	});

	return { submissionId };
};

/**
 * Recompute a school's verified-member count from the verified
 * submissions for its id (distinct members) and persist the `schools`
 * row, flipping it public at the threshold. Recomputing from source (vs
 * incrementing) keeps it idempotent + concurrency-safe — re-running, or
 * two members verifying at once, can't double-count or undercount. The
 * scan is bounded server-side to this school's rows via the `key` matcher
 * (`/${schoolId}/` is the middle key segment; the JS check re-confirms
 * `schoolId` exactly so an over-broad regex match can't miscount).
 */
const upsertSchoolRegistry = ({
	caller,
	resolved
}: {
	caller: Uint8Array;
	resolved: Pick<SchoolDoc, 'schoolId' | 'name' | 'country' | 'domains'>;
}): SchoolStatus => {
	const { items } = listDocsStore({
		collection: Collection.SCHOOL_SUBMISSIONS,
		caller,
		params: { matcher: { key: `/${escapeRegex(resolved.schoolId)}/` } }
	});

	const verifiedMembers = new Set<string>();

	for (const [, item] of items) {
		try {
			const doc = decodeDocData<SchoolSubmissionDoc>(item.data);

			if (doc.status === 'verified' && doc.schoolId === resolved.schoolId) {
				verifiedMembers.add(doc.member);
			}
		} catch {
			// Skip malformed rows.
		}
	}

	const verifiedMemberCount = verifiedMembers.size;
	const status: SchoolStatus =
		verifiedMemberCount >= SCHOOL_VERIFIED_PUBLIC_THRESHOLD ? 'public' : 'pending';

	const key = schoolKey(resolved.schoolId);
	const existing = getDocStore({
		collection: Collection.SCHOOLS,
		key,
		caller
	});

	const existingDoc = nonNullish(existing) ? decodeDocData<SchoolDoc>(existing.data) : undefined;
	const now = nowMs();

	const doc: SchoolDoc = {
		schoolId: resolved.schoolId,
		name: resolved.name,
		country: resolved.country,
		domains: resolved.domains,
		verifiedMemberCount,
		status,
		createdAtMs: existingDoc?.createdAtMs ?? now,
		updatedAtMs: now
	};

	setDocStore({
		collection: Collection.SCHOOLS,
		key,
		caller,
		doc: {
			version: existing?.version,
			data: encodeDocData<SchoolDoc>(doc)
		}
	});

	return status;
};

/**
 * Mark the owner's profile `schoolStatus: 'verified'`. Server-set so the
 * verification claim is authoritative rather than client-asserted. Reads
 * the current profile and rewrites it unchanged except for the flag, so
 * the `profiles` set-assert (nickname / handle-cooldown) passes untouched.
 * No-op if the profile is missing or already verified.
 */
const markProfileVerified = ({
	caller,
	memberText
}: {
	caller: Uint8Array;
	memberText: string;
}): void => {
	const profileDoc = getDocStore({
		collection: Collection.PROFILES,
		key: memberText,
		caller
	});

	if (isNullish(profileDoc)) {
		return;
	}

	const profile = decodeDocData<UserProfile>(profileDoc.data);

	if (profile.schoolStatus === 'verified') {
		return;
	}

	setDocStore({
		collection: Collection.PROFILES,
		key: memberText,
		caller,
		doc: {
			version: profileDoc.version,
			data: encodeDocData<UserProfile>({ ...profile, schoolStatus: 'verified' })
		}
	});
};

export const verifySchoolCodeFn = ({
	submissionId,
	code
}: VerifySchoolCodeArgs): VerifySchoolCodeResult => {
	const caller = msgCaller();
	const callerBytes = caller.toUint8Array();
	const memberText = caller.toText();
	// Server-owned collections are controllers-scoped — access as admin.
	const admin = adminCaller();

	// Authorize: the submission key is `${member}/…`, so only its owner
	// may verify it.
	if (!submissionId.startsWith(`${memberText}/`)) {
		return { ok: false, message: 'not-authorized' };
	}

	const doc = getDocStore({
		collection: Collection.SCHOOL_SUBMISSIONS,
		key: submissionId,
		caller: admin
	});

	if (isNullish(doc)) {
		return { ok: false, message: 'not-found' };
	}

	const submission = decodeDocData<SchoolSubmissionDoc>(doc.data);
	const now = nowMs();

	const persist = (next: SchoolSubmissionDoc): void => {
		setDocStore({
			collection: Collection.SCHOOL_SUBMISSIONS,
			key: submissionId,
			caller: admin,
			doc: { version: doc.version, data: encodeDocData<SchoolSubmissionDoc>(next) }
		});
	};

	if (submission.status === 'expired' || now > submission.expiresAtMs) {
		if (submission.status !== 'expired') {
			persist({ ...submission, status: 'expired' });
		}

		return { ok: false, message: 'expired' };
	}

	if (submission.attempts >= SCHOOL_CODE_MAX_ATTEMPTS) {
		return { ok: false, message: 'too-many-attempts' };
	}

	const matches =
		hashSchoolCode({ code: code.trim(), salt: submission.salt }) === submission.codeHash;

	if (!matches) {
		persist({ ...submission, attempts: submission.attempts + 1 });

		// Verification funnel: a real code check ran and failed (`ok: false`).
		// The authz / not-found / expired early-outs above are not attempts.
		captureSchoolEvent({
			name: 'school_verify_code_submitted',
			principal: memberText,
			props: { label: submission.schoolId, ok: false }
		});

		return { ok: false, message: 'invalid-code' };
	}

	// Success. Mark verified, attach the school + bump the public count,
	// flip the profile flag.
	persist({ ...submission, status: 'verified', verifiedAtMs: now });

	const status = upsertSchoolRegistry({
		caller: admin,
		resolved: {
			schoolId: submission.schoolId,
			name: submission.schoolName,
			country: submission.country,
			domains: submission.domains
		}
	});

	// `profiles` is user-owned + public-write — keep the real caller so the
	// doc stays owned by the user and the set-assert sees the right caller.
	markProfileVerified({ caller: callerBytes, memberText });

	logInfo({
		message: 'school_verified',
		detail: { member: memberText, school: submission.schoolId, status }
	});

	// Verification funnel tail: the code matched (`ok: true`).
	captureSchoolEvent({
		name: 'school_verify_code_submitted',
		principal: memberText,
		props: { label: submission.schoolId, ok: true }
	});

	return { ok: true, schoolId: submission.schoolId, status };
};
