// Account lifecycle: soft-delete + recovery window + hard-delete cascade,
// hibernation, and the retention sweep. The user row itself survives a hard
// delete (it is the identity anchor, like the principal that outlives an
// on-chain account), stamped dead for good; what the cascade removes is every
// way back in (auth identities, sessions, pending one-time codes) and exactly
// the domain rows the account accumulated: profile, VXP award history,
// referral code and redemption, affiliations, relations, league memberships,
// and owned leagues (deleted when empty, transferred to a surviving member
// otherwise).

import { isNullish, nonNullish } from '@dfinity/utils';
import { captureServerEvents, type ServerEventInput } from '../analytics/events';
import { deleteSignInIdentities } from '../auth/identity';
import { revokeAllForUser } from '../auth/sessions';
import { query, tx, type TxQuery } from '../db/client';
import { deleteLeague, transferLeagueOwnership } from '../leagues/leagues';
import { logger } from '../lib/logger';
import { DAY_IN_MS } from '../lib/time';

/** Recovery window for soft-deleted accounts: past this the account is
 * eligible for the sweep's hard delete (and a too-late recovery attempt
 * hard-deletes on the spot). 30 days, in milliseconds. */
export const ACCOUNT_RECOVERY_WINDOW_MS = 30 * DAY_IN_MS;

/** The six reason buckets the deletion picker exposes. */
export const EXIT_SIGNAL_REASONS = [
	'not-for-me',
	'too-busy',
	'privacy',
	'duplicate',
	'bugs',
	'other'
] as const;

export type ExitSignalReason = (typeof EXIT_SIGNAL_REASONS)[number];

/** Cap on the optional free-text note (matches the picker textarea). */
export const EXIT_SIGNAL_NOTE_MAX_LENGTH = 240;

export type DeleteMyAccountRefusalReason =
	'owns_non_empty_league' | 'league_resolution_failed' | 'invalid_input';

/** One owner-league resolution applied as part of deletion: hand the league
 * to another member, or disband it entirely. */
export interface LeagueResolution {
	leagueId: string;
	action: 'transfer' | 'delete';
	transferTo?: string;
}

export interface DeleteMyAccountResult {
	ok: boolean;
	reason?: DeleteMyAccountRefusalReason;
	/** Owned leagues that still have other members (refusal CTA payload). */
	blockingLeagueIds?: string[];
	failedLeagueId?: string;
	resolutionReason?: string;
	/** True when a profile existed and is now marked soft-deleted. */
	softDeleted?: boolean;
}

export type RecoverMyAccountResult =
	{ ok: true; recovered: boolean } | { ok: false; reason: 'expired' };

export type HibernateMyAccountResult =
	{ ok: true } | { ok: false; reason: 'no_profile' | 'deleted' };

export interface ResumeMyAccountResult {
	ok: true;
	resumed: boolean;
}

export interface SweepExpiredDeletionsResult {
	swept: number;
}

/** Analytics must never block or fail an account write: capture errors are
 * logged and swallowed. */
const captureDeleteEvents = async (events: ServerEventInput[]): Promise<void> => {
	try {
		await captureServerEvents({ events });
	} catch (err) {
		logger.error('account delete analytics capture failed (deletion unaffected):', err);
	}
};

const validateInput = ({
	reason,
	note
}: {
	reason: string;
	note: string;
}): { reason: ExitSignalReason; note: string } | undefined => {
	if (!(EXIT_SIGNAL_REASONS as readonly string[]).includes(reason)) {
		return;
	}

	if (note.length > EXIT_SIGNAL_NOTE_MAX_LENGTH) {
		return;
	}

	return { reason: reason as ExitSignalReason, note };
};

/**
 * Owned leagues that still have another member. A league with only the
 * owner row counts as empty (that row is dropped by the cascade anyway);
 * the guard protects against orphaning OTHER users' membership.
 */
export const findBlockingLeagueIds = async (userId: string): Promise<string[]> => {
	const rows = await query<{ id: string }>(
		`select l.id from leagues l
		 where l.owner_user_id = $1
		   and exists (
		     select 1 from league_members m
		     where m.league_id = l.id and m.member_user_id <> $1
		   )
		 order by l.id`,
		[userId]
	);

	return rows.map((row) => row.id);
};

/**
 * Resolve every league the user still owns at hard-delete time: delete it
 * when no other member remains, otherwise transfer ownership to a
 * deterministic survivor (the first remaining member row) so self-joiners
 * during the recovery window are never orphaned. Idempotent: a re-run finds
 * no leagues still owned and does nothing.
 */
const disbandOrTransferOwnedLeagues = async ({ userId, q }: { userId: string; q: TxQuery }) => {
	const owned = await q<{ id: string }>(`select id from leagues where owner_user_id = $1`, [
		userId
	]);

	for (const { id: leagueId } of owned) {
		const survivors = await q<{ member_user_id: string }>(
			`select member_user_id from league_members
			 where league_id = $1 and member_user_id <> $2
			 order by member_user_id
			 limit 1`,
			[leagueId, userId]
		);
		const [survivor] = survivors;

		if (isNullish(survivor)) {
			await q(`delete from league_members where league_id = $1`, [leagueId]);
			await q(`delete from leagues where id = $1`, [leagueId]);
		} else {
			await q(`update leagues set owner_user_id = $2, updated_at = now() where id = $1`, [
				leagueId,
				survivor.member_user_id
			]);
			await q(
				`update league_members set role = 'owner' where league_id = $1 and member_user_id = $2`,
				[leagueId, survivor.member_user_id]
			);
		}
	}
};

/**
 * Cascade hard delete for one account, in a single transaction. Shared
 * audit rows (activities, battles, analytics) stay in place: the identity
 * is gone, so they are orphaned but immutable. The sign-in paths go first,
 * under the login locks, so the user id can never be signed into again: a
 * later sign-in with the same address provisions a new account, which is
 * why deleting the award history cannot let this id earn twice. Membership
 * rows must go before the owned-league resolution so the survivor scan sees
 * the right remaining members. Idempotent: the first stamp stands.
 */
export const hardDeleteAccount = async (userId: string): Promise<void> => {
	await tx(async (q) => {
		await deleteSignInIdentities({ q, userId });
		await revokeAllForUser(userId, q);
		await q(`delete from profiles where user_id = $1`, [userId]);
		await q(`delete from vxp_awards where user_id = $1`, [userId]);
		await q(`delete from calibration_attempts where user_id = $1`, [userId]);
		await q(`delete from referral_codes where owner_user_id = $1`, [userId]);
		// Referee-side rows go with the account; referrer-side rows stay so a
		// referred user keeps their own pending bonus. The settlement path
		// skips the referrer reward once users.hard_deleted_at is stamped.
		await q(`delete from referrals where referee_user_id = $1`, [userId]);
		await q(`delete from affiliations where member_user_id = $1`, [userId]);
		await q(`delete from relations where participant_one = $1 or participant_two = $1`, [userId]);
		await q(`delete from league_members where member_user_id = $1`, [userId]);
		await disbandOrTransferOwnedLeagues({ userId, q });
		await q(`update users set hard_deleted_at = coalesce(hard_deleted_at, now()) where id = $1`, [
			userId
		]);
	});
};

const applyLeagueResolution = async ({
	userId,
	resolution
}: {
	userId: string;
	resolution: LeagueResolution;
}): Promise<{ failedLeagueId: string; resolutionReason: string } | undefined> => {
	const { leagueId, action, transferTo } = resolution;

	// Only act on leagues the caller actually owns: a non-owned target is a
	// clean skip (the blocking guard downstream decides whether it matters).
	const owned = await query<{ id: string }>(
		`select id from leagues where id = $1 and owner_user_id = $2`,
		[leagueId, userId]
	);

	if (isNullish(owned[0])) {
		return;
	}

	if (action === 'transfer') {
		if (isNullish(transferTo)) {
			return { failedLeagueId: leagueId, resolutionReason: 'invalid_input' };
		}

		const result = await transferLeagueOwnership({
			leagueId,
			callerId: userId,
			newOwnerUserId: transferTo
		});

		return result.ok
			? undefined
			: { failedLeagueId: leagueId, resolutionReason: result.reason ?? 'unknown' };
	}

	const result = await deleteLeague({ leagueId, callerId: userId });

	return result.ok
		? undefined
		: { failedLeagueId: leagueId, resolutionReason: result.reason ?? 'unknown' };
};

/**
 * Soft-delete with league resolution, in the original's four steps:
 *
 *  1. Apply the caller's league resolutions (immediately: a real transfer /
 *     disband; a failure aborts the whole delete, already-applied
 *     resolutions stand).
 *  2. Refuse if any owned league still has another member.
 *  3. Mark the profile deleted (earliest mark wins, so re-deleting can
 *     never reset the recovery clock).
 *  4. Append the anonymous exit signal, once per departure (skipped on a
 *     re-delete inside the recovery window).
 *
 * Recovery restores identity-keyed rows only, never the league-ownership
 * decisions the user explicitly made at delete time.
 */
export const deleteMyAccount = async ({
	userId,
	reason,
	note,
	leagueResolutions
}: {
	userId: string;
	reason: string;
	note: string;
	leagueResolutions?: LeagueResolution[];
}): Promise<DeleteMyAccountResult> => {
	const validated = validateInput({ reason, note });

	if (isNullish(validated)) {
		return { ok: false, reason: 'invalid_input' };
	}

	// Reaching this endpoint with valid input IS the confirmed moment (the
	// client only calls after its type-to-confirm gate passed), including a
	// re-confirm after a refusal bounce.
	await captureDeleteEvents([{ name: 'delete_confirmed', userId }]);

	for (const resolution of leagueResolutions ?? []) {
		const failure = await applyLeagueResolution({ userId, resolution });

		if (nonNullish(failure)) {
			return {
				ok: false,
				reason: 'league_resolution_failed',
				failedLeagueId: failure.failedLeagueId,
				resolutionReason: failure.resolutionReason
			};
		}
	}

	const blockingLeagueIds = await findBlockingLeagueIds(userId);

	if (blockingLeagueIds.length > 0) {
		return { ok: false, reason: 'owns_non_empty_league', blockingLeagueIds };
	}

	const nowMs = Date.now();

	// The pre-write marker decides the one-time side effects below, so read
	// and write under one row lock: a concurrent re-delete must not observe
	// the pre-mark state twice. Earliest mark wins (the recovery clock can
	// never be reset by re-deleting). A caller who never onboarded has no
	// profile row: a clean no-op with nothing to soft-delete.
	const { softDeleted, alreadyDeleted } = await tx(async (q) => {
		const prev = await q<{ deleted_at_ms: string | null }>(
			`select deleted_at_ms from profiles where user_id = $1 for update`,
			[userId]
		);

		if (isNullish(prev[0])) {
			return { softDeleted: false, alreadyDeleted: false };
		}

		await q(
			`update profiles set deleted_at_ms = least(coalesce(deleted_at_ms, $2), $2)
			 where user_id = $1`,
			[userId, nowMs]
		);

		return { softDeleted: true, alreadyDeleted: nonNullish(prev[0].deleted_at_ms) };
	});

	// The exit signal is anonymous by design: no user reference in the row,
	// so it outlives the account while staying unlinkable. Appended once per
	// departure only, so a re-delete cannot over-count churn.
	if (!alreadyDeleted) {
		await query(`insert into exit_signals (reason, note, created_at_ms) values ($1, $2, $3)`, [
			validated.reason,
			validated.note,
			nowMs
		]);

		await captureDeleteEvents([
			{ name: 'delete_succeeded', userId },
			{ name: 'exit_signal', props: { label: validated.reason } }
		]);
	}

	return { ok: true, softDeleted };
};

/**
 * Recover the caller's own soft-deleted account: a no-op when not deleted,
 * a marker clear inside the window, and a hard delete + refusal past it (a
 * late recovery attempt is the natural trigger to finally purge the data).
 */
export const recoverMyAccount = async (userId: string): Promise<RecoverMyAccountResult> => {
	const rows = await query<{ deleted_at_ms: string | null }>(
		`select deleted_at_ms from profiles where user_id = $1`,
		[userId]
	);
	const marker = rows[0]?.deleted_at_ms;

	if (isNullish(rows[0]) || isNullish(marker)) {
		return { ok: true, recovered: false };
	}

	if (Date.now() - Number(marker) >= ACCOUNT_RECOVERY_WINDOW_MS) {
		await hardDeleteAccount(userId);

		return { ok: false, reason: 'expired' };
	}

	await query(`update profiles set deleted_at_ms = null where user_id = $1`, [userId]);

	return { ok: true, recovered: true };
};

/**
 * Hibernate: the reversible retention off-ramp offered alongside deletion.
 * Nothing is removed; the profile disappears from public reads until the
 * owner resumes. Mutually exclusive with soft-delete; the earliest mark
 * wins on a re-hibernate.
 */
export const hibernateMyAccount = async (userId: string): Promise<HibernateMyAccountResult> => {
	const rows = await query<{ deleted_at_ms: string | null }>(
		`select deleted_at_ms from profiles where user_id = $1`,
		[userId]
	);

	if (isNullish(rows[0])) {
		return { ok: false, reason: 'no_profile' };
	}

	if (nonNullish(rows[0].deleted_at_ms)) {
		return { ok: false, reason: 'deleted' };
	}

	await query(
		`update profiles set hibernated_at_ms = least(coalesce(hibernated_at_ms, $2), $2)
		 where user_id = $1`,
		[userId, Date.now()]
	);

	return { ok: true };
};

/** Resume a hibernated account. Idempotent: only an actual marker clear
 * reports resumed. */
export const resumeMyAccount = async (userId: string): Promise<ResumeMyAccountResult> => {
	const rows = await query<{ hibernated_at_ms: string | null }>(
		`update profiles set hibernated_at_ms = null
		 where user_id = $1 and hibernated_at_ms is not null
		 returning hibernated_at_ms`,
		[userId]
	);

	return { ok: true, resumed: nonNullish(rows[0]) };
};

/**
 * Hard-deletes every soft-deleted account whose recovery window elapsed.
 * Runs from the worker on a cadence and from the admin endpoint on demand.
 * Idempotent: purged accounts no longer carry a profile row, so a re-run
 * only sweeps newly-expired accounts. A failed purge is logged and does NOT
 * count as swept, so the caller can detect an under-purge.
 */
export const sweepExpiredDeletions = async (): Promise<SweepExpiredDeletionsResult> => {
	const cutoffMs = Date.now() - ACCOUNT_RECOVERY_WINDOW_MS;
	const rows = await query<{ user_id: string }>(
		`select user_id from profiles where deleted_at_ms is not null and deleted_at_ms <= $1`,
		[cutoffMs]
	);

	let swept = 0;
	let failed = 0;

	for (const { user_id } of rows) {
		try {
			await hardDeleteAccount(user_id);
			swept += 1;
		} catch (err) {
			failed += 1;
			logger.error(`deletion sweep purge failed for ${user_id}:`, err);
		}
	}

	if (failed > 0) {
		logger.error(`deletion sweep under-purged: ${swept} swept, ${failed} failed`);
	}

	return { swept };
};
