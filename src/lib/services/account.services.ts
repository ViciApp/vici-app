import { functions } from '#declarations/satellite/satellite.api.ts';
import type { ExitSignalReason } from '#lib/types/exit-signal.ts';
import { isWeb2Backend } from '#lib/web2/backend-mode.ts';
import {
	deleteMyAccount as deleteMyAccountWeb2,
	hibernateMyAccount as hibernateMyAccountWeb2,
	listBlockingLeagues as listBlockingLeaguesWeb2,
	recoverMyAccount as recoverMyAccountWeb2,
	resumeMyAccount as resumeMyAccountWeb2
} from '#lib/web2/client.ts';

/**
 * Account deletion — Proposal 4. FE wrappers around the
 * `listMyBlockingLeagues` query + `deleteMyAccount` update.
 *
 * The deletion flow is two phases on the satellite:
 *
 *  1. **Pre-flight.** `listMyBlockingLeagues` returns the league ids
 *     the caller owns that still have other members. The Settings
 *     page calls this when the user first opens the delete flow so
 *     the "transfer ownership first" prompt is surfaced *before*
 *     they pick a reason and type a note.
 *
 *  2. **Deletion.** `deleteMyAccount({ reason, note, leagueResolutions })`
 *     first applies each league resolution (transfer ownership of, or
 *     disband, an owned league), then writes the anonymous exit-signal
 *     doc and SOFT-deletes the caller's profile. On success the FE drops
 *     auth (`signOut`) so the user lands on the sign-in screen.
 *
 * Both calls go through the satellite's authenticated update / query
 * surface; the caller is the auth principal.
 */

/** One owner-league resolution applied as part of deletion. */
export interface LeagueResolution {
	leagueId: string;
	action: 'transfer' | 'delete';
	/** New-owner principal text — required when `action === 'transfer'`. */
	transferTo?: string;
}

export interface DeleteMyAccountResult {
	ok: boolean;
	reason?: 'owns_non_empty_league' | 'league_resolution_failed' | 'invalid_input';
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
 * guard surfaces in real time — a league that drained between
 * checks will unblock the user without a page reload.
 */
export const listMyBlockingLeagues = async (): Promise<string[]> => {
	if (isWeb2Backend()) {
		return await listBlockingLeaguesWeb2();
	}

	const { leagueIds } = await functions.listMyBlockingLeagues();

	return leagueIds;
};

/**
 * Fire the account-deletion endpoint. On success the caller should
 * `signOut()` immediately — the satellite has already dropped the
 * profile + identity-keyed rows, so any subsequent read would
 * surface a half-deleted state to the UI.
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
}): Promise<DeleteMyAccountResult> =>
	// Same structured result on both transports. In web2 mode `transferTo`
	// holds the new owner's account id (the swapped league rosters already
	// key members that way), and the caller signs out through the dual-mode
	// `signOut` in `identity.services.ts` afterwards.
	isWeb2Backend()
		? deleteMyAccountWeb2({ reason, note, leagueResolutions })
		: functions.deleteMyAccount({
				reason,
				note,
				leagueResolutions
			});

export interface HibernateMyAccountResult {
	ok: boolean;
	reason?: 'no_profile' | 'deleted';
}

/**
 * Pause the caller's account for 30 days. The satellite flips the
 * profile into a hibernated state — the user can resume any time by
 * signing back in, and nothing is erased. The retention off-ramp on
 * the delete flow calls this instead of deleting so a user who only
 * wants a break never loses their record.
 */
export const hibernateMyAccount = (): Promise<HibernateMyAccountResult> =>
	isWeb2Backend() ? hibernateMyAccountWeb2() : functions.hibernateMyAccount();

export interface ResumeMyAccountResult {
	ok: boolean;
	resumed: boolean;
}

/**
 * Lift a hibernation, restoring the caller's account to active. The
 * counterpart to {@link hibernateMyAccount}; the satellite no-ops
 * (`resumed: false`) when the account was never paused.
 */
export const resumeMyAccount = (): Promise<ResumeMyAccountResult> =>
	isWeb2Backend() ? resumeMyAccountWeb2() : functions.resumeMyAccount();

/**
 * Result of {@link recoverMyAccount}, a discriminated union mirroring the
 * satellite's `recoverMyAccount` endpoint.
 *
 *  - `{ ok: true, recovered }` — the soft-delete marker was cleared
 *    (`recovered: true`), or there was nothing to clear because the
 *    account was already active (`recovered: false`).
 *  - `{ ok: false, reason: 'expired' }` — the recovery window had already
 *    elapsed, so the satellite hard-deleted the account in place rather
 *    than restoring it. The caller can no longer come back.
 *
 * The generated `AppRecoverMyAccountResult` Candid shape encodes both the
 * optional `recovered` flag and the `reason` variant as opt-arrays; the
 * `functions.recoverMyAccount` wrapper already decodes them into the flat
 * `{ ok, recovered?, reason? }` object this type narrows.
 */
export type RecoverMyAccountResult =
	{ ok: true; recovered: boolean } | { ok: false; reason: 'expired' };

/**
 * Clear a soft-delete marker, restoring the caller's account to active
 * before the recovery window lapses. The terminal counterpart to
 * `deleteMyAccount`'s soft-delete: a returning user whose profile still
 * carries `deletedAtMs` calls this to come back. If the window has
 * already passed the satellite hard-deletes instead and returns
 * `{ ok: false, reason: 'expired' }` — the account is gone.
 */
export const recoverMyAccount = async (): Promise<RecoverMyAccountResult> => {
	// The HTTP result already carries the flat discriminated shape.
	if (isWeb2Backend()) {
		return await recoverMyAccountWeb2();
	}

	const result = await functions.recoverMyAccount();

	if (!result.ok) {
		return { ok: false, reason: 'expired' };
	}

	return { ok: true, recovered: result.recovered ?? false };
};
