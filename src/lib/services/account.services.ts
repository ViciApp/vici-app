import type { ExitSignalReason } from '#lib/types/exit-signal.ts';
import {
	deleteMyAccount as deleteMyAccountWeb2,
	hibernateMyAccount as hibernateMyAccountWeb2,
	listBlockingLeagues as listBlockingLeaguesWeb2,
	recoverMyAccount as recoverMyAccountWeb2,
	resumeMyAccount as resumeMyAccountWeb2,
	type Web2DeleteAccountResult
} from '#lib/web2/client.ts';

/**
 * Account deletion: FE wrappers around the API's blocking-leagues query and
 * account-delete route.
 *
 * The deletion flow is two phases:
 *
 *  1. **Pre-flight.** `listMyBlockingLeagues` returns the league ids
 *     the caller owns that still have other members. The Settings
 *     page calls this when the user first opens the delete flow so
 *     the "transfer ownership first" prompt is surfaced *before*
 *     they pick a reason and type a note.
 *
 *  2. **Deletion.** `deleteMyAccount({ reason, note, leagueResolutions })`
 *     first applies each league resolution (transfer ownership of, or
 *     disband, an owned league), then writes the anonymous exit signal
 *     and SOFT-deletes the caller's account. On success the FE drops
 *     auth (`signOut`) so the user lands on the sign-in screen.
 *
 * Both calls act on the signed-in session's account.
 */

/** One owner-league resolution applied as part of deletion. */
export interface LeagueResolution {
	leagueId: string;
	action: 'transfer' | 'delete';
	/** New owner's account id: required when `action === 'transfer'`. */
	transferTo?: string;
}

export interface DeleteMyAccountResult {
	ok: boolean;
	reason?: Web2DeleteAccountResult['reason'];
	blockingLeagueIds?: string[];
	/** The league whose resolution failed (`reason === 'league_resolution_failed'`). */
	failedLeagueId?: string;
	/** Underlying transfer / disband refusal reason for the failed league. */
	resolutionReason?: string;
	/** `true` when a profile was found and soft-deleted. */
	softDeleted?: boolean;
}

/**
 * Pre-flight: list leagues the caller owns that still have other
 * members. Empty array means deletion is free to proceed.
 *
 * The FE calls this on every entry into the delete flow so the
 * guard surfaces in real time: a league that drained between
 * checks will unblock the user without a page reload.
 */
export const listMyBlockingLeagues = async (): Promise<string[]> => await listBlockingLeaguesWeb2();

/**
 * Fire the account-deletion endpoint. On success the caller should
 * `signOut()` immediately: the API has already dropped the account's
 * profile and owned rows, so any subsequent read would surface a
 * half-deleted state to the UI.
 *
 * On `ok: false` with `reason: 'owns_non_empty_league'`, the
 * `blockingLeagueIds` field tells the UI which leagues to surface
 * in the transfer-first prompt.
 */
export const deleteMyAccount = ({
	reason,
	note,
	leagueResolutions
}: {
	reason: ExitSignalReason;
	note: string;
	leagueResolutions?: LeagueResolution[];
}): Promise<DeleteMyAccountResult> => deleteMyAccountWeb2({ reason, note, leagueResolutions });

export interface HibernateMyAccountResult {
	ok: boolean;
	reason?: 'no_profile' | 'deleted';
}

/**
 * Pause the caller's account for 30 days. The API flips the
 * profile into a hibernated state: the user can resume any time by
 * signing back in, and nothing is erased. The retention off-ramp on
 * the delete flow calls this instead of deleting so a user who only
 * wants a break never loses their record.
 */
export const hibernateMyAccount = (): Promise<HibernateMyAccountResult> => hibernateMyAccountWeb2();

export interface ResumeMyAccountResult {
	ok: boolean;
	resumed: boolean;
}

/**
 * Lift a hibernation, restoring the caller's account to active. The
 * counterpart to {@link hibernateMyAccount}; the API no-ops
 * (`resumed: false`) when the account was never paused.
 */
export const resumeMyAccount = (): Promise<ResumeMyAccountResult> => resumeMyAccountWeb2();

/**
 * Result of {@link recoverMyAccount}, a discriminated union mirroring the
 * API's account-recover route.
 *
 *  - `{ ok: true, recovered }`: the soft-delete marker was cleared
 *    (`recovered: true`), or there was nothing to clear because the
 *    account was already active (`recovered: false`).
 *  - `{ ok: false, reason: 'expired' }`: the recovery window had already
 *    elapsed, so the API hard-deleted the account in place rather
 *    than restoring it. The caller can no longer come back.
 */
export type RecoverMyAccountResult =
	{ ok: true; recovered: boolean } | { ok: false; reason: 'expired' };

/**
 * Clear a soft-delete marker, restoring the caller's account to active
 * before the recovery window lapses. The terminal counterpart to
 * `deleteMyAccount`'s soft-delete: a returning user whose profile still
 * carries `deletedAtMs` calls this to come back. If the window has
 * already passed the API hard-deletes instead and returns
 * `{ ok: false, reason: 'expired' }`: the account is gone.
 */
export const recoverMyAccount = async (): Promise<RecoverMyAccountResult> =>
	await recoverMyAccountWeb2();
