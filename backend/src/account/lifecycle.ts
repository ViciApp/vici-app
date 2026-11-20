// Account lifecycle: soft-delete + recovery window + hard-delete cascade,
// hibernation, and the retention sweep. The user row itself survives a hard
// delete (it is the identity anchor, like the principal that outlives an
// on-chain account), stamped dead for good; what the cascade removes is every
// way back in (auth identities, sessions, pending one-time codes) and exactly
// the domain rows the account accumulated: profile, VXP award history (an
// anonymous marker of each paid one-time award stays, see vxp/award-markers),
// stats and monthly stats, resolved results, the likes it gave, school-email
// submissions, referral code and redemption, affiliations, relations, league
// memberships, and owned leagues (deleted when empty, transferred to a
// surviving member otherwise). An account that still holds custody funds is
// never deleted nor purged (nobody could withdraw them afterwards), and a
// late recovery brings it back.

import { isNullish, nonNullish, toNullable } from '@dfinity/utils';
import { captureServerEvents, type ServerEventInput } from '../analytics/events';
import { deleteSignInIdentities } from '../auth/identity';
import { revokeAllForUser } from '../auth/sessions';
import { getAdapter } from '../chains/registry';
import { isWithdrawable, listEnabledAssets } from '../custody/assets';
import { listUserBookBalances } from '../custody/ledger';
import { hasWithdrawalInFlight } from '../custody/withdrawals';
import { query, tx, type TxQuery } from '../db/client';
import { getAccountState } from '../engine/clearing';
import { deleteLeague, transferLeagueOwnership } from '../leagues/leagues';
import { ZERO } from '../lib/constants';
import { logger } from '../lib/logger';
import { DAY_IN_MS } from '../lib/time';
import { deleteReactionsBy } from '../social/activities';
import { recordAwardMarkers } from '../vxp/award-markers';

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
	'holds_custody_funds' | 'owns_non_empty_league' | 'league_resolution_failed' | 'invalid_input';

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
 * Whether clearing holds real value for the user in its Settlement domain:
 * collateral deposited there or a positive cash balance (realised gains not
 * yet taken out), read the way the VXP holdings are. VXP lives in ViciXp and
 * Playground holds testnet assets, so neither counts. A read that fails
 * counts as holding: an unread balance must never let the account go.
 */
const holdsClearingFunds = async (userId: string): Promise<boolean> => {
	try {
		const { state } = await getAccountState({
			userId,
			params: { domain: toNullable({ Settlement: null }), refresh: toNullable(false) }
		});

		return (
			state.balances.some(
				([domain, assets]) => 'Settlement' in domain && assets.some(([, amount]) => amount > ZERO)
			) || state.cash_balances_usd.some(([domain, cash]) => 'Settlement' in domain && cash > ZERO)
		);
	} catch (err: unknown) {
		logger.error(`clearing funds read failed for ${userId}, counted as held:`, err);

		return true;
	}
};

/**
 * Whether the account still holds money in custody: a book balance on a chain
 * the books track, a balance on an ic ledger at its custodial principal (read
 * there, as the wallet does, since the books cannot see ic funds come and go),
 * real value in clearing, or a withdrawal still in flight. VXP is left out: it
 * never leaves the platform. The principal is read whether or not the wallet
 * was ever opened, since anyone who knows it can send to it. A ledger read
 * that fails throws, so a balance that cannot be read never passes as empty.
 */
const holdsCustodyFunds = async (userId: string): Promise<boolean> => {
	const [inFlight, bookBalances] = await Promise.all([
		hasWithdrawalInFlight(userId),
		listUserBookBalances(userId)
	]);

	if (inFlight || bookBalances.some(({ balance }) => BigInt(balance) > ZERO)) {
		return true;
	}

	const adapter = getAdapter('ic');
	const address = adapter.deriveAddress(userId);
	const icAssets = (await listEnabledAssets()).filter(
		(asset) => asset.chain === 'ic' && isWithdrawable(asset)
	);
	const icBalances = await Promise.all(
		icAssets.map((asset) => adapter.getBalance({ address, asset }))
	);

	return icBalances.some((balance) => balance > ZERO) || (await holdsClearingFunds(userId));
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
 * later sign-in with the same address provisions a new account. Before they
 * go, the one-time awards the account was paid are written as anonymous
 * markers of its identities, so that new account cannot collect them again
 * once the award history is deleted. Membership
 * rows must go before the owned-league resolution so the survivor scan sees
 * the right remaining members. Idempotent: the first stamp stands.
 */
export const hardDeleteAccount = async (userId: string): Promise<void> => {
	await tx(async (q) => {
		await recordAwardMarkers({ userId, q });
		await deleteSignInIdentities({ q, userId });
		await revokeAllForUser(userId, q);
		await q(`delete from profiles where user_id = $1`, [userId]);
		await q(`delete from vxp_awards where user_id = $1`, [userId]);
		await q(`delete from calibration_attempts where user_id = $1`, [userId]);
		await q(`delete from activity_days where user_id = $1`, [userId]);
		await q(`delete from user_stats where user_id = $1`, [userId]);
		await q(`delete from user_monthly_stats where user_id = $1`, [userId]);
		await q(`delete from resolved_results where user_id = $1`, [userId]);
		await q(`delete from school_submissions where user_id = $1`, [userId]);
		await deleteReactionsBy({ likerId: userId, q });
		await q(`delete from referral_codes where owner_user_id = $1`, [userId]);
		// Referee-side rows go with the account; referrer-side rows stay so a
		// referred user keeps their own pending bonus. The settlement path
		// skips the referrer reward once users.hard_deleted_at is stamped.
		// The referrer's award for this referee stays too, and keeps its slot
		// in the referrer's tier count.
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
 * Hard-deletes an account whose recovery window elapsed, unless it still
 * holds custody funds (a deposit that landed after the delete): purged, it
 * would leave them with nobody able to withdraw them, so it stays
 * soft-deleted, where a late recovery still brings it back, and is reported
 * for an operator. Returns whether it was purged.
 */
const purgeExpiredAccount = async (userId: string): Promise<boolean> => {
	if (await holdsCustodyFunds(userId)) {
		logger.warn(`expired account ${userId} still holds custody funds: left soft-deleted`);

		return false;
	}

	await hardDeleteAccount(userId);

	return true;
};

/**
 * Soft-delete with league resolution, in five steps:
 *
 *  1. Refuse while the account holds custody funds, before anything else
 *     changes: the caller withdraws first.
 *  2. Apply the caller's league resolutions (immediately: a real transfer /
 *     disband; a failure aborts the whole delete, already-applied
 *     resolutions stand).
 *  3. Refuse if any owned league still has another member.
 *  4. Mark the profile deleted (earliest mark wins, so re-deleting can
 *     never reset the recovery clock).
 *  5. Append the anonymous exit signal, once per departure (skipped on a
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

	if (await holdsCustodyFunds(userId)) {
		return { ok: false, reason: 'holds_custody_funds' };
	}

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
	// a random id, and only the UTC day as its time (both columns), so it
	// outlives the account while no timestamp joins it to the soft-delete
	// mark. Appended once per departure only, so a re-delete cannot
	// over-count churn.
	if (!alreadyDeleted) {
		await query(
			`insert into exit_signals (reason, note, created_at_ms, created_at)
			 values ($1, $2, $3::bigint, to_timestamp($3::bigint / 1000.0))`,
			[validated.reason, validated.note, nowMs - (nowMs % DAY_IN_MS)]
		);

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
 * Past the window an account that still holds custody funds is recovered
 * instead, so its owner can withdraw them.
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

	const expired = Date.now() - Number(marker) >= ACCOUNT_RECOVERY_WINDOW_MS;

	if (expired && !(await holdsCustodyFunds(userId))) {
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
 * count as swept, so the caller can detect an under-purge; nor does an
 * account left in place because it still holds custody funds.
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
			if (await purgeExpiredAccount(user_id)) {
				swept += 1;
			}
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
