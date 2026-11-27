// School-email membership verification: submit a school + school email,
// receive a 6-digit code by email, verify membership. The plaintext code
// never lands in the database: only a salted SHA-256 digest is stored, and
// the real guessing defenses are the attempt cap + TTL + the per-user /
// per-email daily rate limit. Verified members feed the schools registry,
// which flips a school public at the threshold.

import { isNullish, nonNullish } from '@dfinity/utils';
import { createHash, randomBytes, randomInt } from 'node:crypto';
import { readAppSetting } from '../admin/settings';
import { captureServerEvents, type ServerEventInput } from '../analytics/events';
import { query, tx, type TxQuery } from '../db/client';
import { codeExpiryNotice, sendEmail } from '../lib/email';
import { escapeHtml } from '../lib/html';
import { logger } from '../lib/logger';
import { MINUTE_IN_MS } from '../lib/time';
import { SCHOOL_DIRECTORY } from './directory';
import { isDomainOf, spMatchEmail, spNormalize } from './matching';

/** Time-to-live of a verification code (~30 minutes). */
export const SCHOOL_CODE_TTL_MS = 30 * MINUTE_IN_MS;

/** Max code checks per submission, the accepted one included: bounds
 * online guessing of the 6-digit space to this many tries per submission.
 * Each check claims its attempt before the compare, so concurrent guesses
 * cannot exceed it. */
export const SCHOOL_CODE_MAX_ATTEMPTS = 5;

/** Max code sends per user per rolling 24h, and (separately) per email. */
export const SCHOOL_VERIFY_DAILY_CAP = 5;

/** A school goes public once this many members have email-verified. */
export const SCHOOL_VERIFIED_PUBLIC_THRESHOLD = 3;

/** Longest school name a submission may carry: the name's slug becomes the
 * school id an affiliation is committed with, which the Worlds route caps at
 * the same length. */
export const MAX_SCHOOL_NAME_LENGTH = 128;

/** A submission's country is an ISO-3166 alpha-2 code. */
export const COUNTRY_CODE_LENGTH = 2;

/** The app_settings key gating the whole feature server-side: verification
 * stays OFF until an admin writes `{ "enabled": true }` here. */
export const SCHOOL_VERIFICATION_SETTING_KEY = 'school_verification';

export type SchoolStatus = 'pending' | 'public';

export type SchoolSubmissionStatus = 'awaiting' | 'verified' | 'expired';

/** Client-facing refusal; routes answer it as a 400 with the message. */
export class SchoolVerificationError extends Error {}

export interface SchoolRecord {
	schoolId: string;
	name: string;
	country: string | null;
	domains: string[];
	verifiedMemberCount: number;
	status: SchoolStatus;
	createdAtMs: number;
	updatedAtMs: number;
}

interface SchoolRow {
	school_id: string;
	name: string;
	country: string | null;
	domains: string[];
	verified_member_count: number;
	status: SchoolStatus;
	created_at_ms: string;
	updated_at_ms: string;
}

const shapeSchool = (row: SchoolRow): SchoolRecord => ({
	schoolId: row.school_id,
	name: row.name,
	country: row.country,
	domains: row.domains,
	verifiedMemberCount: row.verified_member_count,
	status: row.status,
	createdAtMs: Number(row.created_at_ms),
	updatedAtMs: Number(row.updated_at_ms)
});

/** Salted code digest. SHA-256 is fine here: the secrecy boundary is not
 * the digest (a 6-digit space is enumerable offline) but the attempt cap +
 * TTL + rate limit; the salt just makes stored digests non-comparable. */
export const hashSchoolCode = ({ code, salt }: { code: string; salt: string }): string =>
	createHash('sha256').update(`${code}|${salt}`).digest('hex');

/** Best-effort funnel capture: analytics must never block or fail a
 * verification write. */
const captureSchoolEvent = async (event: ServerEventInput): Promise<void> => {
	try {
		await captureServerEvents({ events: [event] });
	} catch (err) {
		logger.error('school verification analytics capture failed (verification unaffected):', err);
	}
};

interface SchoolVerificationSetting {
	enabled?: boolean;
}

/** Server-side feature gate, independent of any client flag: OFF until an
 * admin writes the setting, and killable by flipping `enabled` to false. */
const assertVerificationEnabled = async (): Promise<void> => {
	const setting = await readAppSetting<SchoolVerificationSetting>(SCHOOL_VERIFICATION_SETTING_KEY);

	if (isNullish(setting)) {
		throw new SchoolVerificationError('School email verification is not configured.');
	}

	// Fail closed: only an explicit `enabled: true` turns the feature on, so a
	// malformed or partial setting can never silently enable it.
	if (setting.enabled !== true) {
		throw new SchoolVerificationError('School email verification is disabled.');
	}
};

interface ResolvedSchool {
	schoolId: string;
	name: string;
	country: string | null;
	domains: string[];
	isNew: boolean;
}

const SCHOOL_TAKEN_MESSAGE = 'This school is already listed under another email domain.';

/**
 * Server-authoritative domain gate: a directory match wins outright, a
 * consumer mailbox (or unparseable address) is rejected, and an unknown
 * plausible school domain becomes a brand-new school keyed by its
 * normalized name, unless that name is a directory school's id: the
 * directory school is reached by its own domains only.
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
	const matched = spMatchEmail(email);

	if (isNullish(matched)) {
		throw new SchoolVerificationError('Enter a valid school email address.');
	}

	if (matched.kind === 'consumer') {
		throw new SchoolVerificationError('Use your school email, not a personal mailbox.');
	}

	if (matched.kind === 'match') {
		const { option } = matched;

		return {
			schoolId: option.id,
			name: option.name,
			country: option.country ?? country,
			domains: [...option.domains],
			isNew: false
		};
	}

	const slug = spNormalize(name);

	if (slug.length === 0) {
		throw new SchoolVerificationError('Enter the name of your university.');
	}

	if (SCHOOL_DIRECTORY.some(({ id }) => id === slug)) {
		throw new SchoolVerificationError(SCHOOL_TAKEN_MESSAGE);
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
 * Whether a brand-new school may take this id: free in the registry, or held
 * by a row whose domains cover the address. The row's domains are the
 * registry's (seeded by an admin or by the first verified member), never the
 * typed name, so a second school with the same name cannot join it.
 */
const registryAdmits = async ({
	q,
	schoolId,
	domains
}: {
	q: TxQuery;
	schoolId: string;
	domains: string[];
}): Promise<boolean> => {
	const rows = await q<{ domains: string[] }>(
		`select domains from schools where school_id = $1 for update`,
		[schoolId]
	);
	const [row] = rows;

	return (
		isNullish(row) ||
		domains.every((domain) => row.domains.some((known) => isDomainOf({ domain, known })))
	);
};

const recentSendCounts = async ({
	userId,
	email
}: {
	userId: string;
	email: string;
}): Promise<{ byUser: number; byEmail: number }> => {
	const rows = await query<{ by_user: string; by_email: string }>(
		`select
		   count(*) filter (where user_id = $1)::text as by_user,
		   count(*) filter (where email = $2)::text as by_email
		 from school_submissions
		 where created_at > now() - interval '24 hours'`,
		[userId, email]
	);

	return { byUser: Number(rows[0]?.by_user ?? 0), byEmail: Number(rows[0]?.by_email ?? 0) };
};

const sendCodeEmail = async ({
	email,
	code,
	schoolName
}: {
	email: string;
	code: string;
	schoolName: string;
}): Promise<void> => {
	// The add-your-own path makes schoolName user input: escape it for the
	// HTML body and strip header-breaking control chars from the subject.
	const safeSubjectName = schoolName.replace(/[\r\n\t]+/g, ' ').trim();
	const safeHtmlName = escapeHtml(schoolName);

	await sendEmail({
		to: email,
		subject: `Your VICI verification code for ${safeSubjectName}`,
		text: `Your VICI school verification code is ${code}. ${codeExpiryNotice(SCHOOL_CODE_TTL_MS)}`,
		html:
			`<p>Your VICI verification code for <strong>${safeHtmlName}</strong> is:</p>` +
			`<p style="font-size:24px;font-weight:700;letter-spacing:4px">${code}</p>` +
			`<p style="color:#888">${codeExpiryNotice(SCHOOL_CODE_TTL_MS)}</p>`
	});
};

/**
 * Submit a school + school email: re-runs the domain gate server-side (any
 * client check is advisory), rate-limits per user and per email over a
 * rolling 24h, then persists a fresh immutable submission (digest only) and
 * mails the 6-digit code. Every send is a NEW row: a resend can never
 * clobber a prior, possibly verified, attempt.
 */
export const submitSchool = async ({
	userId,
	name,
	country,
	email,
	locale: _locale
}: {
	userId: string;
	name: string;
	country: string | null;
	email: string;
	locale?: string;
}): Promise<{ submissionId: string }> => {
	await assertVerificationEnabled();

	const lowerEmail = email.toLowerCase().trim();
	const resolved = resolveSchool({ email: lowerEmail, name, country });

	if (resolved.isNew && !(await registryAdmits({ q: query, ...resolved }))) {
		throw new SchoolVerificationError(SCHOOL_TAKEN_MESSAGE);
	}

	const { byUser, byEmail } = await recentSendCounts({ userId, email: lowerEmail });

	if (byUser >= SCHOOL_VERIFY_DAILY_CAP || byEmail >= SCHOOL_VERIFY_DAILY_CAP) {
		throw new SchoolVerificationError('Too many codes requested today. Try again tomorrow.');
	}

	const code = randomInt(0, 1_000_000).toString().padStart(6, '0');
	const salt = randomBytes(16).toString('hex');
	const nowMs = Date.now();

	const rows = await query<{ id: string }>(
		`insert into school_submissions
		   (user_id, email, school_id, school_name, country, domains, is_new,
		    code_hash, salt, expires_at_ms, created_at_ms)
		 values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
		 returning id`,
		[
			userId,
			lowerEmail,
			resolved.schoolId,
			resolved.name,
			resolved.country,
			resolved.domains,
			resolved.isNew,
			hashSchoolCode({ code, salt }),
			salt,
			nowMs + SCHOOL_CODE_TTL_MS,
			nowMs
		]
	);
	const submissionId = rows[0]?.id;

	if (isNullish(submissionId)) {
		throw new Error('school submission insert returned no row');
	}

	await sendCodeEmail({ email: lowerEmail, code, schoolName: resolved.name });

	logger.info(
		`school code sent: user ${userId}, school ${resolved.schoolId}, new ${resolved.isNew}`
	);

	// Funnel: a code email actually went out. The label is the school id,
	// behavioural, never the address.
	await captureSchoolEvent({
		name: 'school_verify_email_submitted',
		userId,
		props: { label: resolved.schoolId }
	});

	return { submissionId };
};

/**
 * Recompute a school's verified-member count from the verified submissions
 * (distinct members) and persist it on the registry row, flipping the row
 * public when this count crosses the threshold. Recomputing from source
 * keeps it idempotent and concurrency-safe: re-running, or two members
 * verifying at once, cannot double-count. A member's verification never
 * rewrites the row's name, country, domains or a status an admin set: the
 * flip fires only on the crossing, so a school held back past the threshold
 * stays held back.
 */
const recountSchoolRegistry = async ({
	q,
	schoolId
}: {
	q: TxQuery;
	schoolId: string;
}): Promise<SchoolStatus> => {
	const counts = await q<{ count: string }>(
		`select count(distinct user_id)::text as count
		 from school_submissions
		 where school_id = $1 and status = 'verified'`,
		[schoolId]
	);
	const verifiedMemberCount = Number(counts[0]?.count ?? 0);
	const nowMs = Date.now();

	const rows = await q<{ status: SchoolStatus }>(
		`update schools set
		   verified_member_count = $2,
		   status = case
		     when verified_member_count < $3 and $2 >= $3 then 'public'
		     else status
		   end,
		   updated_at_ms = $4
		 where school_id = $1
		 returning status`,
		[schoolId, verifiedMemberCount, SCHOOL_VERIFIED_PUBLIC_THRESHOLD, nowMs]
	);
	const [row] = rows;

	if (isNullish(row)) {
		throw new Error(`school registry row ${schoolId} missing after its claim`);
	}

	return row.status;
};

/** Creates the registry row from the submission when the school has none
 * yet, and keeps an existing row as it is. */
const claimSchoolRegistry = async ({
	q,
	resolved
}: {
	q: TxQuery;
	resolved: Pick<SchoolRecord, 'schoolId' | 'name' | 'country' | 'domains'>;
}): Promise<void> => {
	const nowMs = Date.now();

	await q(
		`insert into schools
		   (school_id, name, country, domains, verified_member_count, status,
		    created_at_ms, updated_at_ms)
		 values ($1, $2, $3, $4, 0, 'pending', $5, $5)
		 on conflict (school_id) do nothing`,
		[resolved.schoolId, resolved.name, resolved.country, resolved.domains, nowMs]
	);
};

export interface VerifySchoolCodeResult {
	ok: boolean;
	schoolId?: string;
	status?: SchoolStatus;
	message?: string;
}

/** The answer to a submission id that names no submission. */
export const SUBMISSION_NOT_FOUND: Readonly<VerifySchoolCodeResult> = {
	ok: false,
	message: 'not-found'
};

/**
 * Verify a mailed code against its submission: only the submission's owner
 * may verify it; TTL and the attempt cap are enforced before the digest
 * compare, the cap by atomically claiming one attempt. Success marks the
 * submission verified, recomputes the school registry row, and flags the
 * owner's profile school-verified.
 */
export const verifySchoolCode = async ({
	userId,
	submissionId,
	code
}: {
	userId: string;
	submissionId: string;
	code: string;
}): Promise<VerifySchoolCodeResult> => {
	interface SubmissionRow {
		id: string;
		user_id: string;
		school_id: string;
		school_name: string;
		country: string | null;
		domains: string[];
		is_new: boolean;
		expires_at_ms: string;
		status: SchoolSubmissionStatus;
	}

	const rows = await query<SubmissionRow>(
		`select id, user_id, school_id, school_name, country, domains, is_new,
		        expires_at_ms::text, status
		 from school_submissions where id = $1`,
		[submissionId]
	);
	const [submission] = rows;

	if (isNullish(submission)) {
		return SUBMISSION_NOT_FOUND;
	}

	if (submission.user_id !== userId) {
		return { ok: false, message: 'not-authorized' };
	}

	const now = Date.now();

	if (submission.status === 'expired' || now > Number(submission.expires_at_ms)) {
		if (submission.status !== 'expired') {
			await query(`update school_submissions set status = 'expired' where id = $1`, [
				submission.id
			]);
		}

		return { ok: false, message: 'expired' };
	}

	// Claimed before the compare: a check-then-increment would let concurrent
	// guesses all pass the cap before any of them counted.
	const claimed = await query<{ code_hash: string; salt: string }>(
		`update school_submissions set attempts = attempts + 1
		 where id = $1 and attempts < $2
		 returning code_hash, salt`,
		[submission.id, SCHOOL_CODE_MAX_ATTEMPTS]
	);
	const [claim] = claimed;

	if (isNullish(claim)) {
		return { ok: false, message: 'too-many-attempts' };
	}

	const matches = hashSchoolCode({ code: code.trim(), salt: claim.salt }) === claim.code_hash;

	if (!matches) {
		// Funnel: a real code check ran and failed. The authz / not-found /
		// expired early-outs above are not attempts.
		await captureSchoolEvent({
			name: 'school_verify_code_submitted',
			userId,
			props: { label: submission.school_id, ok: false }
		});

		return { ok: false, message: 'invalid-code' };
	}

	const resolved = {
		schoolId: submission.school_id,
		name: submission.school_name,
		country: submission.country,
		domains: submission.domains
	};

	const status = await tx(async (q): Promise<SchoolStatus | undefined> => {
		await claimSchoolRegistry({ q, resolved });

		// Checked again here: another school of the same name may have been
		// verified into the registry since this code was sent.
		if (submission.is_new && !(await registryAdmits({ q, ...resolved }))) {
			return;
		}

		await q(
			`update school_submissions set status = 'verified', verified_at_ms = $2 where id = $1`,
			[submission.id, now]
		);

		const registryStatus = await recountSchoolRegistry({ q, schoolId: resolved.schoolId });

		// Server-set so the verification claim is authoritative rather than
		// client-asserted. No-op when the profile is missing.
		await q(`update profiles set school_status = 'verified' where user_id = $1`, [userId]);

		return registryStatus;
	});

	if (isNullish(status)) {
		return { ok: false, message: 'school-taken' };
	}

	logger.info(`school verified: user ${userId}, school ${submission.school_id}, status ${status}`);

	await captureSchoolEvent({
		name: 'school_verify_code_submitted',
		userId,
		props: { label: submission.school_id, ok: true }
	});

	return { ok: true, schoolId: submission.school_id, status };
};

/** Public directory read: schools that reached the public threshold. */
export const listPublicSchools = async (): Promise<SchoolRecord[]> => {
	const rows = await query<SchoolRow>(
		`select school_id, name, country, domains, verified_member_count, status,
		        created_at_ms::text, updated_at_ms::text
		 from schools where status = 'public'
		 order by verified_member_count desc, school_id`
	);

	return rows.map(shapeSchool);
};

/** Admin registry read: every school, pending included. */
export const listAllSchools = async (): Promise<SchoolRecord[]> => {
	const rows = await query<SchoolRow>(
		`select school_id, name, country, domains, verified_member_count, status,
		        created_at_ms::text, updated_at_ms::text
		 from schools
		 order by school_id`
	);

	return rows.map(shapeSchool);
};

/**
 * Admin upsert of a registry row (seeding or correcting an entry). The
 * verified-member count stays recompute-owned; an explicit status override
 * is allowed for editorial control, otherwise the threshold rule applies to
 * the current count.
 */
export const adminUpsertSchool = async ({
	schoolId,
	name,
	country,
	domains,
	status
}: {
	schoolId: string;
	name: string;
	country: string | null;
	domains: string[];
	status?: SchoolStatus;
}): Promise<SchoolRecord> => {
	const nowMs = Date.now();
	const rows = await query<SchoolRow>(
		`insert into schools
		   (school_id, name, country, domains, verified_member_count, status,
		    created_at_ms, updated_at_ms)
		 values ($1, $2, $3, $4, 0, coalesce($5, 'pending'), $6, $6)
		 on conflict (school_id) do update set
		   name = excluded.name,
		   country = excluded.country,
		   domains = excluded.domains,
		   status = coalesce($5, schools.status),
		   updated_at_ms = excluded.updated_at_ms
		 returning school_id, name, country, domains, verified_member_count, status,
		           created_at_ms::text, updated_at_ms::text`,
		[schoolId, name, country, domains, status ?? null, nowMs]
	);
	const [row] = rows;

	if (isNullish(row)) {
		throw new Error('school upsert returned no row');
	}

	return shapeSchool(row);
};

/** Admin delete of a registry row. Submissions stay (audit trail); a later
 * verification recreates the row from them. */
export const adminDeleteSchool = async (schoolId: string): Promise<{ deleted: boolean }> => {
	const rows = await query<{ school_id: string }>(
		`delete from schools where school_id = $1 returning school_id`,
		[schoolId]
	);

	return { deleted: nonNullish(rows[0]) };
};
