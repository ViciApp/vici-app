// Account lifecycle semantics: input validation, the blocking-league guard
// and its resolutions, the soft-delete + once-per-departure exit signal, the
// recovery window (clear inside, purge past), the hard-delete cascade with
// the survivor-transfer rule, the end of every sign-in path at hard delete,
// hibernation, and the retention sweep.

import { isNullish } from '@dfinity/utils';
import { beforeAll, describe, expect, test } from 'bun:test';
import {
	ACCOUNT_RECOVERY_WINDOW_MS,
	deleteMyAccount,
	findBlockingLeagueIds,
	hardDeleteAccount,
	hibernateMyAccount,
	recoverMyAccount,
	resumeMyAccount,
	sweepExpiredDeletions
} from '../src/account/lifecycle';
import { getOrAssignReferralCode, redeemReferralCode } from '../src/account/referrals';
import { resolveIdentity } from '../src/auth/identity';
import { createOtp, verifyOtp } from '../src/auth/otp';
import { createSession } from '../src/auth/sessions';
import { query } from '../src/db/client';
import { app } from '../src/index';
import { createLeague } from '../src/leagues/leagues';
import { joinLeagueByInvite } from '../src/leagues/members';
import { upsertMyProfile } from '../src/profiles/profile-write';
import { createTestUser, ensureMigrated, uniqueEmail } from './helpers/auth';
import { createTestProfile, uniqueNickname } from './helpers/profiles';
import { readRepoFile } from './helpers/repo-source';

beforeAll(async () => {
	await ensureMigrated();
});

const uniqueLeagueId = (): string => `lg-${crypto.randomUUID().slice(0, 12)}`;

const deletedAtMs = async (userId: string): Promise<number | undefined> => {
	const rows = await query<{ deleted_at_ms: string | null }>(
		`select deleted_at_ms from profiles where user_id = $1`,
		[userId]
	);

	const marker = rows[0]?.deleted_at_ms;

	return isNullish(marker) ? undefined : Number(marker);
};

const countRows = async (table: string, column: string, userId: string): Promise<number> => {
	const rows = await query<{ count: string }>(
		`select count(*)::text as count from ${table} where ${column} = $1`,
		[userId]
	);

	return Number(rows[0]?.count ?? 0);
};

const signInByEmail = async (email: string): Promise<string> => {
	const result = await verifyOtp({ email, code: await createOtp(email) });

	if (!result.ok) {
		throw new Error(`email sign-in refused: ${result.reason}`);
	}

	return result.userId;
};

/** An onboarded account reached through an email sign-in, with a live
 * session: the state a real user is in when they delete. */
const signedInAccount = async (): Promise<{ userId: string; email: string; token: string }> => {
	const email = uniqueEmail();
	const userId = await signInByEmail(email);

	await upsertMyProfile({ userId, body: { nickname: uniqueNickname() } });

	return { userId, email, token: await createSession(userId) };
};

const meStatus = async (token: string): Promise<number> => {
	const res = await app.handle(
		new Request('http://localhost/api/v1/me', { headers: { cookie: `vici_session=${token}` } })
	);

	return res.status;
};

const hardDeletedAt = async (userId: string): Promise<string | undefined> => {
	const rows = await query<{ hard_deleted_at: string | null }>(
		`select hard_deleted_at::text from users where id = $1`,
		[userId]
	);

	return rows[0]?.hard_deleted_at ?? undefined;
};

const exitSignalCount = async (): Promise<number> => {
	const rows = await query<{ count: string }>(`select count(*)::text as count from exit_signals`);

	return Number(rows[0]?.count ?? 0);
};

describe('input validation', () => {
	test('an unknown reason and an over-long note both refuse as invalid_input', async () => {
		const { userId } = await createTestProfile();

		expect(await deleteMyAccount({ userId, reason: 'nonsense', note: '' })).toEqual({
			ok: false,
			reason: 'invalid_input'
		});
		expect(await deleteMyAccount({ userId, reason: 'bugs', note: 'x'.repeat(241) })).toEqual({
			ok: false,
			reason: 'invalid_input'
		});
		expect(await deletedAtMs(userId)).toBeUndefined();
	});
});

describe('blocking-league guard + resolutions', () => {
	test('an owned league with another member blocks deletion and is listed in the pre-flight', async () => {
		const { userId: owner } = await createTestProfile();
		const { userId: member } = await createTestProfile();
		const league = await createLeague({
			id: uniqueLeagueId(),
			name: 'Guarded League',
			ownerUserId: owner
		});

		await joinLeagueByInvite({ inviteCode: league.inviteCode, userId: member });

		expect(await findBlockingLeagueIds(owner)).toEqual([league.id]);

		const result = await deleteMyAccount({ userId: owner, reason: 'other', note: '' });

		expect(result).toEqual({
			ok: false,
			reason: 'owns_non_empty_league',
			blockingLeagueIds: [league.id]
		});
		expect(await deletedAtMs(owner)).toBeUndefined();
	});

	test('a transfer resolution unblocks the delete; a failing resolution aborts it', async () => {
		const { userId: owner } = await createTestProfile();
		const { userId: member } = await createTestProfile();
		const league = await createLeague({
			id: uniqueLeagueId(),
			name: 'Handover League',
			ownerUserId: owner
		});

		await joinLeagueByInvite({ inviteCode: league.inviteCode, userId: member });

		const outsider = await createTestUser();
		const failing = await deleteMyAccount({
			userId: owner,
			reason: 'other',
			note: '',
			leagueResolutions: [{ leagueId: league.id, action: 'transfer', transferTo: outsider }]
		});

		expect(failing).toEqual({
			ok: false,
			reason: 'league_resolution_failed',
			failedLeagueId: league.id,
			resolutionReason: 'new_owner_not_member'
		});

		const result = await deleteMyAccount({
			userId: owner,
			reason: 'other',
			note: '',
			leagueResolutions: [{ leagueId: league.id, action: 'transfer', transferTo: member }]
		});

		expect(result).toEqual({ ok: true, softDeleted: true });

		const owners = await query<{ owner_user_id: string }>(
			`select owner_user_id from leagues where id = $1`,
			[league.id]
		);

		expect(owners[0]?.owner_user_id).toBe(member);
	});

	test('a delete resolution disbands the league on the way out', async () => {
		const { userId: owner } = await createTestProfile();
		const { userId: member } = await createTestProfile();
		const league = await createLeague({
			id: uniqueLeagueId(),
			name: 'Disband League',
			ownerUserId: owner
		});

		await joinLeagueByInvite({ inviteCode: league.inviteCode, userId: member });

		const result = await deleteMyAccount({
			userId: owner,
			reason: 'other',
			note: '',
			leagueResolutions: [{ leagueId: league.id, action: 'delete' }]
		});

		expect(result).toEqual({ ok: true, softDeleted: true });

		const leagues = await query<{ id: string }>(`select id from leagues where id = $1`, [
			league.id
		]);

		expect(leagues).toHaveLength(0);
	});
});

describe('soft delete + exit signal', () => {
	test('marks the profile, writes one anonymous exit signal, and never re-counts a re-delete', async () => {
		const { userId } = await createTestProfile();
		const before = await exitSignalCount();

		const first = await deleteMyAccount({ userId, reason: 'privacy', note: 'a short note' });

		expect(first).toEqual({ ok: true, softDeleted: true });

		const marker = await deletedAtMs(userId);

		expect(marker).toBeGreaterThan(0);
		expect(await exitSignalCount()).toBe(before + 1);

		const again = await deleteMyAccount({ userId, reason: 'bugs', note: '' });

		expect(again).toEqual({ ok: true, softDeleted: true });
		// Earliest mark wins and the signal stays single per departure.
		expect(await deletedAtMs(userId)).toBe(marker);
		expect(await exitSignalCount()).toBe(before + 1);

		const signals = await query<{ reason: string; note: string }>(
			`select reason, note from exit_signals order by created_at desc limit 1`
		);

		expect(signals[0]).toEqual({ reason: 'privacy', note: 'a short note' });
	});

	test('a caller with no profile soft-deletes nothing but still succeeds', async () => {
		const userId = await createTestUser();

		expect(await deleteMyAccount({ userId, reason: 'other', note: '' })).toEqual({
			ok: true,
			softDeleted: false
		});
	});
});

describe('recover', () => {
	test('inside the window the marker clears; not-deleted is a clean no-op', async () => {
		const { userId } = await createTestProfile();

		expect(await recoverMyAccount(userId)).toEqual({ ok: true, recovered: false });

		await deleteMyAccount({ userId, reason: 'too-busy', note: '' });

		expect(await recoverMyAccount(userId)).toEqual({ ok: true, recovered: true });
		expect(await deletedAtMs(userId)).toBeUndefined();
	});

	test('past the window the account is purged and the recovery refused', async () => {
		const { userId } = await createTestProfile();

		await deleteMyAccount({ userId, reason: 'duplicate', note: '' });
		await query(`update profiles set deleted_at_ms = $2 where user_id = $1`, [
			userId,
			Date.now() - ACCOUNT_RECOVERY_WINDOW_MS - 1000
		]);

		expect(await recoverMyAccount(userId)).toEqual({ ok: false, reason: 'expired' });
		expect(await countRows('profiles', 'user_id', userId)).toBe(0);
	});
});

describe('hard-delete cascade', () => {
	test('removes the identity-keyed rows and disbands an empty owned league', async () => {
		const { userId } = await createTestProfile();
		const { userId: friend } = await createTestProfile();
		const league = await createLeague({
			id: uniqueLeagueId(),
			name: 'Orphan League',
			ownerUserId: userId
		});

		await getOrAssignReferralCode(userId);
		await redeemReferralCode({ userId, code: await getOrAssignReferralCode(friend) });
		await query(
			`insert into affiliations (member_user_id, kind, affiliation_identifier, joined_at_ms, locked_until_ms)
			 values ($1, 'university', 'mit', $2, $2)`,
			[userId, Date.now()]
		);

		await hardDeleteAccount(userId);

		expect(await countRows('profiles', 'user_id', userId)).toBe(0);
		expect(await countRows('referral_codes', 'owner_user_id', userId)).toBe(0);
		expect(await countRows('referrals', 'referee_user_id', userId)).toBe(0);
		expect(await countRows('affiliations', 'member_user_id', userId)).toBe(0);
		expect(await countRows('relations', 'participant_one', userId)).toBe(0);
		expect(await countRows('relations', 'participant_two', userId)).toBe(0);
		expect(await countRows('league_members', 'member_user_id', userId)).toBe(0);

		const leagues = await query<{ id: string }>(`select id from leagues where id = $1`, [
			league.id
		]);

		expect(leagues).toHaveLength(0);

		// The identity anchor survives the cascade.
		expect(await countRows('users', 'id', userId)).toBe(1);
	});

	test('an owned league that gained members transfers to a deterministic survivor instead of dying', async () => {
		const { userId: owner } = await createTestProfile();
		const { userId: joiner } = await createTestProfile();
		const league = await createLeague({
			id: uniqueLeagueId(),
			name: 'Survivor League',
			ownerUserId: owner
		});

		// The member joins AFTER the soft-delete: the guard-less purge paths
		// must hand the league over rather than orphan the new member.
		await deleteMyAccount({ userId: owner, reason: 'other', note: '' });
		await joinLeagueByInvite({ inviteCode: league.inviteCode, userId: joiner });

		await hardDeleteAccount(owner);

		const owners = await query<{ owner_user_id: string }>(
			`select owner_user_id from leagues where id = $1`,
			[league.id]
		);
		const roles = await query<{ role: string }>(
			`select role from league_members where league_id = $1 and member_user_id = $2`,
			[league.id, joiner]
		);

		expect(owners[0]?.owner_user_id).toBe(joiner);
		expect(roles[0]?.role).toBe('owner');
	});
});

describe('hard delete ends every sign-in path', () => {
	test('the live session stops resolving and the sign-in rows are gone', async () => {
		const { userId, email, token } = await signedInAccount();

		expect(await meStatus(token)).toBe(200);

		const pendingCode = await createOtp(email);

		await hardDeleteAccount(userId);

		expect(await meStatus(token)).toBe(401);
		expect(await countRows('sessions', 'user_id', userId)).toBe(0);
		expect(await countRows('auth_identities', 'user_id', userId)).toBe(0);
		// A code requested before the purge cannot sign anyone in afterwards.
		expect(await verifyOtp({ email, code: pendingCode })).toEqual({
			ok: false,
			reason: 'invalid'
		});
	});

	test('signing in again with the same address provisions a new account', async () => {
		const { userId, email } = await signedInAccount();

		await hardDeleteAccount(userId);

		const again = await signInByEmail(email);

		expect(again).not.toBe(userId);
		expect(await countRows('profiles', 'user_id', again)).toBe(0);
		expect(await countRows('vxp_awards', 'user_id', again)).toBe(0);
	});

	test('the same OAuth subject never resolves to the deleted account', async () => {
		const email = uniqueEmail();
		const subject = `sub-${crypto.randomUUID()}`;
		const userId = await resolveIdentity({ provider: 'google', subject, email });

		await hardDeleteAccount(userId);

		const again = await resolveIdentity({ provider: 'google', subject, email });

		expect(again).not.toBe(userId);
	});

	test('a session or identity that outlived the purge still never reaches the account', async () => {
		const { userId, email } = await signedInAccount();
		const subject = `sub-${crypto.randomUUID()}`;

		await hardDeleteAccount(userId);

		// The rows a sign-in racing the purge could leave behind.
		const lateToken = await createSession(userId);

		await query(
			`insert into auth_identities (user_id, provider, subject, email) values ($1, 'google', $2, $3)`,
			[userId, subject, email]
		);

		expect(await meStatus(lateToken)).toBe(401);
		expect(await signInByEmail(email)).not.toBe(userId);
	});

	test('running it twice changes nothing the second time', async () => {
		const { userId } = await signedInAccount();

		await hardDeleteAccount(userId);

		const stamp = await hardDeletedAt(userId);

		expect(stamp).toBeDefined();

		await hardDeleteAccount(userId);

		expect(await hardDeletedAt(userId)).toBe(stamp);
		expect(await countRows('users', 'id', userId)).toBe(1);
		expect(await countRows('sessions', 'user_id', userId)).toBe(0);
		expect(await countRows('auth_identities', 'user_id', userId)).toBe(0);
	});

	test('a soft-deleted account keeps its session and sign-in through the recovery window', async () => {
		const { userId, email, token } = await signedInAccount();

		await deleteMyAccount({ userId, reason: 'other', note: '' });

		expect(await meStatus(token)).toBe(200);
		expect(await signInByEmail(email)).toBe(userId);
		expect(await recoverMyAccount(userId)).toEqual({ ok: true, recovered: true });
		expect(await hardDeletedAt(userId)).toBeUndefined();
	});

	test('the migration clears the sign-in rows of accounts purged before the cascade did', async () => {
		const { userId: purged, token: purgedToken } = await signedInAccount();
		const { userId: live, token: liveToken } = await signedInAccount();

		// An account purged by the old cascade: stamped, sign-in rows intact.
		await query(`update users set hard_deleted_at = now() where id = $1`, [purged]);

		const migration = readRepoFile(
			'backend/src/db/migrations/0017_purge_hard_deleted_sign_ins.sql'
		).toString('utf8');

		await query(migration);
		await query(migration);

		expect(await countRows('sessions', 'user_id', purged)).toBe(0);
		expect(await countRows('auth_identities', 'user_id', purged)).toBe(0);
		expect(await meStatus(purgedToken)).toBe(401);
		expect(await countRows('sessions', 'user_id', live)).toBe(1);
		expect(await countRows('auth_identities', 'user_id', live)).toBe(1);
		expect(await meStatus(liveToken)).toBe(200);
	});
});

describe('hibernate + resume', () => {
	test('the full round-trip, with the deleted and no-profile refusals', async () => {
		const { userId } = await createTestProfile();

		expect(await hibernateMyAccount(userId)).toEqual({ ok: true });
		expect(await resumeMyAccount(userId)).toEqual({ ok: true, resumed: true });
		expect(await resumeMyAccount(userId)).toEqual({ ok: true, resumed: false });

		await deleteMyAccount({ userId, reason: 'other', note: '' });

		expect(await hibernateMyAccount(userId)).toEqual({ ok: false, reason: 'deleted' });
		expect(await hibernateMyAccount(await createTestUser())).toEqual({
			ok: false,
			reason: 'no_profile'
		});
	});
});

describe('sweep', () => {
	test('purges only accounts past the recovery window and reports the count', async () => {
		const { userId: expired } = await createTestProfile();
		const { userId: fresh } = await createTestProfile();

		await deleteMyAccount({ userId: expired, reason: 'other', note: '' });
		await deleteMyAccount({ userId: fresh, reason: 'other', note: '' });
		await query(`update profiles set deleted_at_ms = $2 where user_id = $1`, [
			expired,
			Date.now() - ACCOUNT_RECOVERY_WINDOW_MS - 1000
		]);

		const { swept } = await sweepExpiredDeletions();

		expect(swept).toBeGreaterThanOrEqual(1);
		expect(await countRows('profiles', 'user_id', expired)).toBe(0);
		expect(await countRows('profiles', 'user_id', fresh)).toBe(1);

		// Idempotent: purged accounts carry no profile row any more.
		const again = await sweepExpiredDeletions();

		expect(await countRows('profiles', 'user_id', expired)).toBe(0);
		expect(again.swept).toBe(0);
	});
});
