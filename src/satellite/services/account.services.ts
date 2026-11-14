import {
	ACCOUNT_RECOVERY_WINDOW_MS,
	MILLISECOND_IN_NANOSECONDS
} from '#lib/constants/app.constants.ts';
import { Collection } from '#lib/constants/collections.constants.ts';
import {
	EXIT_SIGNAL_NOTE_MAX_LENGTH,
	EXIT_SIGNAL_REASONS,
	type ExitSignalDoc,
	type ExitSignalReason
} from '#lib/types/exit-signal.ts';
import type { LeagueMemberDoc } from '#lib/types/league-member.ts';
import type { LeagueDoc } from '#lib/types/league.ts';
import type { UserProfile } from '#lib/types/profile.ts';
import type { ReferralCodeDoc, ReferralDoc } from '#lib/types/referral.ts';
import type { Relation } from '#lib/types/relation.ts';
import {
	captureServerEvents,
	type ServerEventInput
} from '#satellite/services/analytics.services.ts';
import { isAdmin } from '#satellite/services/authz.services.ts';
import { deleteLeagueFn, transferLeagueOwnershipFn } from '#satellite/services/league.services.ts';
import { isHibernated, isSoftDeleted } from '#satellite/services/profile.services.ts';
import { logError } from '#satellite/utils/logger.utils.ts';
import { timeMs } from '#satellite/utils/time.utils.ts';
import { isNullish, nonNullish } from '@dfinity/utils';
import { Principal } from '@icp-sdk/core/principal';
import { msgCaller, time } from '@junobuild/functions/ic-cdk';
import {
	decodeDocData,
	deleteDocStore,
	encodeDocData,
	getDocStore,
	listDocsStore,
	setDocStore
} from '@junobuild/functions/sdk';

/**
 * A single `[key, doc]` entry as returned by `listDocsStore(...).items`.
 * Derived from the SDK signature (rather than importing the `Doc` type,
 * which the `@junobuild/functions/sdk` barrel doesn't re-export) so the
 * helpers below can take a list entry without restating its shape.
 */
type ListedDocEntry = ReturnType<typeof listDocsStore>['items'][number];

/**
 * Account deletion: Proposal 4 in `docs/backend-proposals/README.md`
 * (Delete account v2: soft-delete + recovery + admin sweep, with
 * league resolution).
 *
 * `deleteMyAccount` runs four steps in order:
 *
 *  1. **League resolution.** If the caller passes `leagueResolutions`,
 *     each is applied IMMEDIATELY before the blocking guard: a
 *     `transfer` reuses {@link transferLeagueOwnershipFn} (hand the
 *     league to another member), a `delete` reuses {@link
 *     deleteLeagueFn} (disband the league entirely). Only leagues the
 *     caller actually owns are acted on; a resolution targeting a
 *     league the caller doesn't own is ignored (the blocking guard
 *     below decides whether that leaves a blocker). If any resolution
 *     fails, the WHOLE delete aborts with `reason:
 *     'league_resolution_failed'` (plus `failedLeagueId` +
 *     `resolutionReason`) and NOTHING further runs, but resolutions
 *     applied before the failure have already committed (see the
 *     recovery caveat below).
 *
 *  2. **Owner-leagues guard.** If, after resolution, the caller still
 *     owns any league that has another member, the deletion is refused
 *     with `reason: 'owns_non_empty_league'`. The FE surfaces a
 *     "transfer ownership first" prompt (decision 4.3).
 *
 *  3. **Soft-delete.** The caller's profile gets `deletedAtMs = now`
 *     (decision 4.1, soft-delete preserves the audit trail). NO data
 *     is removed: recovery must be able to restore the full account.
 *     The nickname is left untouched so the handle stays reserved
 *     (`checkNicknameAvailability` scans every profile doc). A second
 *     soft-delete keeps the EARLIEST `deletedAtMs` so the recovery
 *     clock can't be reset by re-deleting, and reports
 *     `alreadyDeleted` to drive step 4's idempotency.
 *
 *  4. **Exit-signal write.** A single `EXIT_SIGNALS` doc is appended
 *     with the chosen reason + optional note. The doc has no
 *     principal field: it's intentionally unlinkable from the
 *     account that wrote it. Skipped when step 3 reports
 *     `alreadyDeleted` (a re-delete inside the recovery window), so a
 *     repeated `deleteMyAccount` can't over-count churn.
 *
 * After this returns ok the FE drops auth (`signOut`). The principal
 * can `recoverMyAccount` within {@link ACCOUNT_RECOVERY_WINDOW_MS};
 * past that window the data is hard-deleted (lazily, on a too-late
 * recovery attempt, or eagerly by the admin `sweepExpiredDeletions`).
 *
 * The hard-delete cascade itself lives in {@link hardDeleteAccountFn},
 * parametrised by principal so the sweep can run it for any account.
 *
 * **Recovery caveat (deliberate, not a bug).** League resolutions are
 * applied IMMEDIATELY (a real transfer / disband), matching the
 * delete-v2 contract; they are NOT deferred to the hard-delete. So a
 * user who soft-deletes while resolving leagues and then
 * `recoverMyAccount`s within the recovery window gets their ACCOUNT
 * back but NOT the relinquished leagues: a transferred league now
 * belongs to its new owner, a deleted league is gone. Recovery
 * restores identity-keyed rows (profile, awards, relations, …), never
 * the league-ownership decisions the user explicitly made at delete
 * time.
 */

export type DeleteMyAccountRefusalReason =
	'owns_non_empty_league' | 'league_resolution_failed' | 'invalid_input';

/**
 * One owner-league resolution the caller applies as part of deletion.
 * `action: 'transfer'` hands the league to `transferTo` (required,
 * the new-owner principal text); `action: 'delete'` disbands it
 * (`transferTo` ignored). Only leagues the caller owns are acted on.
 */
export interface LeagueResolution {
	leagueId: string;
	action: 'transfer' | 'delete';
	transferTo?: string;
}

export interface DeleteMyAccountResult {
	ok: boolean;
	/** Set when `ok === false`. Drives the FE's refusal banner. */
	reason?: DeleteMyAccountRefusalReason;
	/**
	 * League ids the caller owns that still have other members. Only
	 * populated when `reason === 'owns_non_empty_league'`; the FE
	 * uses them to render a "transfer these first" CTA.
	 */
	blockingLeagueIds?: string[];
	/**
	 * The league whose resolution failed. Only populated when
	 * `reason === 'league_resolution_failed'`.
	 */
	failedLeagueId?: string;
	/**
	 * The underlying refusal reason from the transfer / delete that
	 * failed (e.g. `new_owner_not_member`, `not_owner`). Only populated
	 * when `reason === 'league_resolution_failed'`.
	 */
	resolutionReason?: string;
	/**
	 * `true` when a profile was found and marked soft-deleted; `false`
	 * when the caller had no profile (never onboarded) so there was
	 * nothing to soft-delete. Only set when `ok === true`.
	 */
	softDeleted?: boolean;
}

/** Result of {@link recoverMyAccountFn}, discriminated by `ok`. */
export type RecoverMyAccountResult =
	{ ok: true; recovered: boolean } | { ok: false; reason: 'expired' };

/**
 * Result of {@link sweepExpiredDeletionsFn}: count of accounts purged.
 *
 * Purge failures are NOT folded into this count (a failed purge does
 * NOT increment `swept`); they're logged via `logError` with the
 * stable `sweep_expired_deletions_purge_failed` tag plus a
 * `sweep_expired_deletions_under_purged` summary, so the external
 * trigger can detect an under-purge from the Console. We deliberately
 * do not surface a `failed` count on the wire: that would widen the
 * `sweepExpiredDeletions` Candid result and force a binding regen for
 * a value operators already get from the logs.
 */
export interface SweepExpiredDeletionsResult {
	swept: number;
}

/**
 * Result of {@link hibernateMyAccountFn}, discriminated by `ok`.
 *
 *  - `{ ok: true }`: the caller's profile is now hibernated (idempotent:
 *    re-hibernating keeps the earliest mark).
 *  - `{ ok: false; reason: 'no_profile' }`: the caller never onboarded,
 *    so there was no profile to hibernate.
 *  - `{ ok: false; reason: 'deleted' }`: the account is already
 *    soft-deleted. Hibernation and soft-delete are mutually exclusive
 *    states, so we refuse cleanly rather than stacking the two markers.
 */
export type HibernateMyAccountResult =
	{ ok: true } | { ok: false; reason: 'no_profile' | 'deleted' };

/**
 * Result of {@link resumeMyAccountFn}, discriminated by `ok`. `resumed` is
 * `true` when a hibernation marker was actually cleared, `false` when the
 * account wasn't hibernated (clean no-op).
 */
export interface ResumeMyAccountResult {
	ok: true;
	resumed: boolean;
}

/**
 * Outcome of {@link mutateOwnProfile}, discriminated by `status`:
 *
 *  - `'no_profile'`: the caller had no `PROFILES` doc (never onboarded,
 *    or already hard-deleted). No read-back, nothing written.
 *  - `'skipped'`: a profile existed but `transform` returned `null`, so
 *    no write was issued (a clean no-op, e.g. the marker was already in
 *    the desired state). `profile` is the decoded (pre-transform) doc.
 *  - `'written'`: `transform` returned a profile and it was persisted
 *    via a version-locked overwrite. `profile` is the decoded
 *    (pre-transform) doc.
 *
 * Callers map this onto their own typed result, reading `profile` where
 * the pre-mutation state matters (e.g. whether the marker was already
 * set).
 */
type MutateOwnProfileResult =
	| { status: 'no_profile' }
	| { status: 'skipped'; profile: UserProfile }
	| { status: 'written'; profile: UserProfile };

/**
 * Shared read-modify-write envelope for the caller's own `PROFILES` doc.
 * Reads the doc via `getDocStore` (PROFILES is keyed by principal text,
 * one doc per user, and is user-owned, so the write is authorised by the
 * REAL caller, never an admin key), null-guards a missing doc, decodes it,
 * then runs `transform`:
 *
 *  - `transform` returns a `UserProfile` → persist it with a version-locked
 *    `setDocStore` (the current `version` is threaded back so a concurrent
 *    profile write can't be silently clobbered). Result `'written'`.
 *  - `transform` returns `null` → no write (a clean no-op). Result
 *    `'skipped'`.
 *
 * The marker mutations in {@link softDeleteProfile}, {@link
 * recoverMyAccountFn}, {@link hibernateMyAccountFn} and {@link
 * resumeMyAccountFn} all share this exact envelope and differ only in the
 * one-field transform, so they each pass their transform here.
 */
const mutateOwnProfile = ({
	callerText,
	callerBytes,
	transform
}: {
	callerText: string;
	callerBytes: Uint8Array;
	transform: (profile: UserProfile) => UserProfile | null;
}): MutateOwnProfileResult => {
	const profileDoc = getDocStore({
		collection: Collection.PROFILES,
		key: callerText,
		caller: callerBytes
	});

	if (isNullish(profileDoc)) {
		return { status: 'no_profile' };
	}

	const profile = decodeDocData<UserProfile>(profileDoc.data);
	const next = transform(profile);

	if (isNullish(next)) {
		return { status: 'skipped', profile };
	}

	setDocStore({
		collection: Collection.PROFILES,
		key: callerText,
		caller: callerBytes,
		doc: {
			data: encodeDocData<UserProfile>(next),
			version: profileDoc.version
		}
	});

	return { status: 'written', profile };
};

/**
 * Best-effort server-side capture for the churn funnel. Analytics must
 * never block or fail an account write, so any capture error is logged
 * and swallowed here rather than bubbling into the deletion result.
 */
const captureDeleteEvents = (events: ServerEventInput[]): void => {
	try {
		captureServerEvents({ events });
	} catch (err) {
		logError({
			message: 'account delete analytics capture failed (deletion unaffected)',
			detail: { error: err instanceof Error ? err.message : `${err}` }
		});
	}
};

const validateInput = ({
	reason,
	note
}: {
	reason: string;
	note: string;
}): { reason: ExitSignalReason; note: string } => {
	if (!EXIT_SIGNAL_REASONS.includes(reason as ExitSignalReason)) {
		throw new Error(`deleteMyAccount: reason "${reason}" is not one of the allowed buckets.`);
	}

	if (note.length > EXIT_SIGNAL_NOTE_MAX_LENGTH) {
		throw new Error(`deleteMyAccount: note exceeds ${EXIT_SIGNAL_NOTE_MAX_LENGTH} characters.`);
	}

	return { reason: reason as ExitSignalReason, note };
};

/**
 * Scan the `LEAGUES` collection for leagues the caller owns, then for
 * each one count membership rows. Returns the ids of leagues that
 * still have other members so the caller can transfer ownership
 * before retrying delete.
 *
 * A league with only the owner row counts as empty: that row is
 * deleted by the cascade anyway, and the league itself is hard-
 * deleted at the end. The guard protects against orphaning *other*
 * users' membership in a league with no owner.
 */
const findOwnedNonEmptyLeagues = ({
	callerText,
	callerBytes
}: {
	callerText: string;
	callerBytes: Uint8Array;
}): string[] => {
	const { items: leagueItems } = listDocsStore({
		collection: Collection.LEAGUES,
		caller: callerBytes,
		params: {}
	});

	const ownedLeagueIds: string[] = [];

	for (const [, item] of leagueItems) {
		try {
			const league = decodeDocData<LeagueDoc>(item.data);

			if (league.owner === callerText) {
				ownedLeagueIds.push(league.id);
			}
		} catch {
			// skip malformed
		}
	}

	if (ownedLeagueIds.length === 0) {
		return [];
	}

	const { items: memberItems } = listDocsStore({
		collection: Collection.LEAGUE_MEMBERS,
		caller: callerBytes,
		params: {}
	});

	const nonEmpty: string[] = [];

	for (const leagueId of ownedLeagueIds) {
		const prefix = `${leagueId}/`;
		let otherMembers = 0;

		for (const [docKey, item] of memberItems) {
			if (docKey.startsWith(prefix)) {
				try {
					const member = decodeDocData<LeagueMemberDoc>(item.data);

					if (member.leagueId === leagueId && member.member !== callerText) {
						otherMembers += 1;

						break;
					}
				} catch {
					// skip malformed
				}
			}
		}

		if (otherMembers > 0) {
			nonEmpty.push(leagueId);
		}
	}

	return nonEmpty;
};

/**
 * Drop every doc whose key starts with `${callerText}/` from the
 * collection. Used for collections that prefix-key on the user's
 * principal (`affiliations`, `vxp_awards`, `vxp_onboarding`).
 */
const deletePrefixedDocs = ({
	collection,
	callerText,
	callerBytes
}: {
	collection: Collection;
	callerText: string;
	callerBytes: Uint8Array;
}): number => {
	const { items } = listDocsStore({
		collection,
		caller: callerBytes,
		params: {}
	});

	const prefix = `${callerText}/`;
	let deleted = 0;

	for (const [docKey, item] of items) {
		if (docKey === callerText || docKey.startsWith(prefix)) {
			deleteDocStore({
				collection,
				key: docKey,
				caller: callerBytes,
				doc: {
					version: item.version
				}
			});
			deleted += 1;
		}
	}

	return deleted;
};

/**
 * Drop the caller's profile (`profiles` is keyed by principal text,
 * one doc per user). The doc may not exist if the user never
 * completed onboarding: silently no-op in that case.
 */
const deleteOwnProfile = ({
	callerText,
	callerBytes
}: {
	callerText: string;
	callerBytes: Uint8Array;
}): number =>
	deletePrefixedDocs({
		collection: Collection.PROFILES,
		callerText,
		callerBytes
	});

/**
 * Drop the caller's owner-private `profile_private` doc (the account
 * email). Exactly one doc keyed by the principal, so this is a direct
 * versioned read + delete; no collection scan. Silently no-ops when the
 * account never stored one.
 */
const deleteOwnPrivateProfile = ({
	callerText,
	callerBytes
}: {
	callerText: string;
	callerBytes: Uint8Array;
}): number => {
	const doc = getDocStore({
		collection: Collection.PROFILE_PRIVATE,
		key: callerText,
		caller: callerBytes
	});

	if (isNullish(doc)) {
		return 0;
	}

	deleteDocStore({
		collection: Collection.PROFILE_PRIVATE,
		key: callerText,
		caller: callerBytes,
		doc: { version: doc.version }
	});

	return 1;
};

/**
 * Drop the caller's relations (friend / follow rows): keyed by
 * relation id, not principal, so we scan + filter by
 * `participants[*] === callerText`. Deletes the row entirely; the
 * other participant loses the relation too (mirrors the
 * `cancelFriendRequest` / `unfollow` semantics).
 */
const deleteOwnRelations = ({
	callerText,
	callerBytes
}: {
	callerText: string;
	callerBytes: Uint8Array;
}): number => {
	const { items } = listDocsStore({
		collection: Collection.RELATIONS,
		caller: callerBytes,
		params: {}
	});

	let deleted = 0;

	for (const [docKey, item] of items) {
		try {
			const relation = decodeDocData<Relation>(item.data);

			if (relation.participants.includes(callerText)) {
				deleteDocStore({
					collection: Collection.RELATIONS,
					key: docKey,
					caller: callerBytes,
					doc: {
						version: item.version
					}
				});
				deleted += 1;
			}
		} catch {
			// skip malformed
		}
	}

	return deleted;
};

/**
 * Drop the caller's referral code (`referral_codes` is reverse-
 * indexed: key is the code, value is the owner). One row max per
 * user; iterate to find theirs.
 */
const deleteOwnReferralCode = ({
	callerText,
	callerBytes
}: {
	callerText: string;
	callerBytes: Uint8Array;
}): number => {
	const { items } = listDocsStore({
		collection: Collection.REFERRAL_CODES,
		caller: callerBytes,
		params: {}
	});

	let deleted = 0;

	for (const [docKey, item] of items) {
		try {
			const codeDoc = decodeDocData<ReferralCodeDoc>(item.data);

			if (codeDoc.owner === callerText) {
				deleteDocStore({
					collection: Collection.REFERRAL_CODES,
					key: docKey,
					caller: callerBytes,
					doc: {
						version: item.version
					}
				});
				deleted += 1;
			}
		} catch {
			// skip malformed
		}
	}

	return deleted;
};

/**
 * Drop the caller's referral-redemption row (`referrals` is keyed
 * by the *referee* principal, so the caller's row lives at their
 * own principal text). Other users' rows whose `referrer` equals
 * the caller are left in place (they document the referee's
 * payout history, which is auditable independent of the referrer).
 */
const deleteOwnReferralRedemption = ({
	callerText,
	callerBytes
}: {
	callerText: string;
	callerBytes: Uint8Array;
}): number => {
	const { items } = listDocsStore({
		collection: Collection.REFERRALS,
		caller: callerBytes,
		params: {}
	});

	let deleted = 0;

	for (const [docKey, item] of items) {
		if (docKey === callerText) {
			try {
				// Belt-and-braces: only delete if the embedded doc agrees
				// the row is keyed to the caller.
				decodeDocData<ReferralDoc>(item.data);
				deleteDocStore({
					collection: Collection.REFERRALS,
					key: docKey,
					caller: callerBytes,
					doc: {
						version: item.version
					}
				});
				deleted += 1;
			} catch {
				// skip malformed
			}
		}
	}

	return deleted;
};

/**
 * Drop affiliation rows (`${member}/${kind}/${affiliationIdentifier}`:
 * prefix-keyed). The 90-day lock assert is bypassed in this code
 * path because we delete via the satellite caller with no app-side
 * `assertDeleteAffiliation` re-entry on raw datastore drops; if
 * future Juno versions tighten that, we'll need a system-bypass
 * branch in the delete assert keyed off a "during-account-delete"
 * flag. For now the satellite SDK drop is unconditional.
 */
const deleteOwnAffiliations = deletePrefixedDocs;

/**
 * Drop league memberships where the caller is the member (key
 * suffix `/${callerText}`). Owner rows are removed too: the
 * owned-empty leagues themselves are dropped in the next step.
 */
const deleteOwnLeagueMemberships = ({
	callerText,
	callerBytes
}: {
	callerText: string;
	callerBytes: Uint8Array;
}): number => {
	const { items } = listDocsStore({
		collection: Collection.LEAGUE_MEMBERS,
		caller: callerBytes,
		params: {}
	});

	const suffix = `/${callerText}`;
	let deleted = 0;

	for (const [docKey, item] of items) {
		if (docKey.endsWith(suffix)) {
			try {
				const member = decodeDocData<LeagueMemberDoc>(item.data);

				if (member.member === callerText) {
					deleteDocStore({
						collection: Collection.LEAGUE_MEMBERS,
						key: docKey,
						caller: callerBytes,
						doc: {
							version: item.version
						}
					});
					deleted += 1;
				}
			} catch {
				// skip malformed
			}
		}
	}

	return deleted;
};

/**
 * Resolve every league the caller owns, one of two ways:
 *
 *  - **No other members left** → delete the league. By the time the
 *    `deleteMyAccount` path reaches here the owner-non-empty guard
 *    already passed and `deleteOwnLeagueMemberships` dropped the
 *    caller's own membership row, so the league is a genuine orphan.
 *  - **Other members remain** → transfer ownership instead of
 *    deleting, so self-joiners during the recovery window aren't
 *    orphaned. This branch only triggers on the guard-less paths
 *    (recovery-expiry purge + admin sweep), where membership may have
 *    grown after the soft-delete. A deterministic survivor, the first
 *    remaining member row in `LEAGUE_MEMBERS` iteration order, becomes
 *    the new owner: `league.owner` is re-encoded onto the league doc
 *    (version-locked) and that member's row `role` is bumped to
 *    `'owner'` (also version-locked).
 *
 * The caller's own membership row is excluded from the survivor scan:
 * it was already dropped by `deleteOwnLeagueMemberships` earlier in the
 * cascade, but we filter defensively in case ordering ever changes.
 *
 * Idempotent: a re-run finds no leagues still owned by the caller
 * (deleted or transferred away) and returns 0.
 *
 * Returns the number of leagues deleted (transfers are not counted as
 * deletions).
 */
const disbandOrTransferOwnedLeagues = ({
	callerText,
	callerBytes
}: {
	callerText: string;
	callerBytes: Uint8Array;
}): number => {
	const { items: leagueItems } = listDocsStore({
		collection: Collection.LEAGUES,
		caller: callerBytes,
		params: {}
	});

	const { items: memberItems } = listDocsStore({
		collection: Collection.LEAGUE_MEMBERS,
		caller: callerBytes,
		params: {}
	});

	return leagueItems.reduce(
		(deleted, [leagueKey, leagueItem]) =>
			deleted + resolveOwnedLeague({ leagueKey, leagueItem, memberItems, callerText, callerBytes }),
		0
	);
};

/**
 * Resolve a single league for {@link disbandOrTransferOwnedLeagues}.
 * No-op (returns 0) unless the caller owns it; malformed league rows are
 * skipped. Deletes the league and returns 1 when no other member
 * remains; otherwise transfers ownership to the first surviving member
 * row and returns 0. Split out so the parent loop stays free of
 * `continue`.
 */
const resolveOwnedLeague = ({
	leagueKey,
	leagueItem,
	memberItems,
	callerText,
	callerBytes
}: {
	leagueKey: string;
	leagueItem: ListedDocEntry[1];
	memberItems: ReadonlyArray<ListedDocEntry>;
	callerText: string;
	callerBytes: Uint8Array;
}): number => {
	let league: LeagueDoc;

	try {
		league = decodeDocData<LeagueDoc>(leagueItem.data);
	} catch {
		// skip malformed
		return 0;
	}

	if (league.owner !== callerText) {
		return 0;
	}

	const prefix = `${league.id}/`;

	// First remaining member row that isn't the caller: deterministic
	// survivor in `LEAGUE_MEMBERS` iteration order.
	const survivor = memberItems.find(([docKey, item]) => {
		if (!docKey.startsWith(prefix)) {
			return false;
		}

		try {
			const member = decodeDocData<LeagueMemberDoc>(item.data);

			return member.leagueId === league.id && member.member !== callerText;
		} catch {
			return false;
		}
	});

	if (isNullish(survivor)) {
		// No other members: drop the orphaned league.
		deleteDocStore({
			collection: Collection.LEAGUES,
			key: leagueKey,
			caller: callerBytes,
			doc: {
				version: leagueItem.version
			}
		});

		return 1;
	}

	// Other members remain: transfer ownership instead of deleting.
	// Mirror `transferLeagueOwnershipFn`'s two-caller dance: the league-doc
	// owner swap is authorised by the OUTGOING owner (still the owner at
	// this point), but the survivor's membership-role bump must be
	// authorised by the NEW owner; once `league.owner` flips below,
	// `assertSetLeagueMember` only accepts a role change from the current
	// (survivor) owner, so writing it as `callerBytes` would be rejected
	// and leave a half-transferred league.
	const [survivorKey, survivorItem] = survivor;
	const survivorMember = decodeDocData<LeagueMemberDoc>(survivorItem.data);
	const survivorBytes = Principal.fromText(survivorMember.member).toUint8Array();

	setDocStore({
		collection: Collection.LEAGUES,
		key: leagueKey,
		caller: callerBytes,
		doc: {
			data: encodeDocData<LeagueDoc>({ ...league, owner: survivorMember.member }),
			version: leagueItem.version
		}
	});

	setDocStore({
		collection: Collection.LEAGUE_MEMBERS,
		key: survivorKey,
		caller: survivorBytes,
		doc: {
			data: encodeDocData<LeagueMemberDoc>({ ...survivorMember, role: 'owner' }),
			version: survivorItem.version
		}
	});

	return 0;
};

/**
 * Cascade hard-delete for a single account. Removes every row
 * identity-keyed to the principal: profile, VXP awards / onboarding,
 * referral code + redemption record, affiliations, relations, league
 * memberships. Owned leagues are then either deleted (no other members
 * left) or transferred to a surviving member: see
 * {@link disbandOrTransferOwnedLeagues}; self-joiners during the recovery
 * window are never orphaned. Shared audit rows (activities, battles,
 * comments) are left in place: the principal is gone, so they're
 * orphaned but immutable (decision 4.1).
 *
 * Order matters only between league memberships → owned leagues (the
 * latter scans the surviving membership rows, so the caller's own row
 * must be gone first to compute the right survivor).
 *
 * Takes the principal explicitly (does NOT call `msgCaller()`) so the
 * admin sweep can run it for any account, not just the caller. Returns
 * the number of docs deleted. Idempotent: a re-run on an
 * already-purged account finds nothing and returns 0.
 */
export const hardDeleteAccountFn = ({
	callerText,
	callerBytes
}: {
	callerText: string;
	callerBytes: Uint8Array;
}): number => {
	let docsDeleted = 0;

	docsDeleted += deleteOwnProfile({ callerText, callerBytes });
	docsDeleted += deleteOwnPrivateProfile({ callerText, callerBytes });
	docsDeleted += deletePrefixedDocs({
		collection: Collection.VXP_AWARDS,
		callerText,
		callerBytes
	});
	docsDeleted += deletePrefixedDocs({
		collection: Collection.VXP_ONBOARDING,
		callerText,
		callerBytes
	});
	docsDeleted += deleteOwnReferralCode({ callerText, callerBytes });
	docsDeleted += deleteOwnReferralRedemption({ callerText, callerBytes });
	docsDeleted += deleteOwnAffiliations({
		collection: Collection.AFFILIATIONS,
		callerText,
		callerBytes
	});
	docsDeleted += deleteOwnRelations({ callerText, callerBytes });
	docsDeleted += deleteOwnLeagueMemberships({ callerText, callerBytes });
	docsDeleted += disbandOrTransferOwnedLeagues({ callerText, callerBytes });

	return docsDeleted;
};

/**
 * Read a single `LEAGUES` doc as the caller and report whether the
 * caller owns it. Used to gate league resolutions on actual ownership;
 * a resolution targeting a league the caller doesn't own is skipped
 * (the blocking guard then decides whether that's a problem) rather
 * than surfaced as a resolution failure.
 */
const callerOwnsLeague = ({
	leagueId,
	callerText,
	callerBytes
}: {
	leagueId: string;
	callerText: string;
	callerBytes: Uint8Array;
}): boolean => {
	const leagueDoc = getDocStore({
		collection: Collection.LEAGUES,
		key: leagueId,
		caller: callerBytes
	});

	if (isNullish(leagueDoc)) {
		return false;
	}

	try {
		return decodeDocData<LeagueDoc>(leagueDoc.data).owner === callerText;
	} catch {
		return false;
	}
};

/**
 * Apply one league resolution (transfer / delete) on behalf of the
 * caller. Returns `null` on success (or when the league isn't owned by
 * the caller: a clean skip), or a populated failure object to abort
 * the surrounding delete.
 *
 * `transfer` reuses {@link transferLeagueOwnershipFn} (which reads
 * `msgCaller()` internally: the same caller as `deleteMyAccountFn`, so
 * no caller is threaded through). `delete` reuses {@link deleteLeagueFn}
 * (which takes the caller explicitly).
 */
const applyLeagueResolution = ({
	resolution,
	callerText,
	callerBytes
}: {
	resolution: LeagueResolution;
	callerText: string;
	callerBytes: Uint8Array;
}): { failedLeagueId: string; resolutionReason: string } | null => {
	const { leagueId, action, transferTo } = resolution;

	// Only act on leagues the caller actually owns. A non-owned league
	// is left untouched; the blocking guard downstream still protects
	// against orphaning other users' membership.
	if (!callerOwnsLeague({ leagueId, callerText, callerBytes })) {
		return null;
	}

	if (action === 'transfer') {
		if (isNullish(transferTo)) {
			return { failedLeagueId: leagueId, resolutionReason: 'invalid_input' };
		}

		// `transferLeagueOwnershipFn` reads `msgCaller()` internally; the
		// account-delete handler runs as the same caller (the owner), so
		// the transfer is authorised without threading the caller through.
		const result = transferLeagueOwnershipFn({ leagueId, newOwnerPrincipal: transferTo });

		return result.ok
			? null
			: { failedLeagueId: leagueId, resolutionReason: result.reason ?? 'unknown' };
	}

	const result = deleteLeagueFn({ leagueId, callerText, callerBytes });

	return result.ok
		? null
		: { failedLeagueId: leagueId, resolutionReason: result.reason ?? 'unknown' };
};

export const deleteMyAccountFn = ({
	reason,
	note,
	leagueResolutions
}: {
	reason: string;
	note: string;
	leagueResolutions?: LeagueResolution[];
}): DeleteMyAccountResult => {
	// Invalid `reason`/`note` is a typed refusal, not a trap: `validateInput`
	// throws, so catch it and return the documented `invalid_input` shape.
	let validated: { reason: ExitSignalReason; note: string };

	try {
		validated = validateInput({ reason, note });
	} catch {
		return { ok: false, reason: 'invalid_input' };
	}

	const caller = msgCaller();
	const callerText = caller.toText();
	const callerBytes = caller.toUint8Array();

	// Churn funnel: reaching this endpoint with valid input means the
	// type-to-confirm gate passed (the FE only calls after the handle
	// matched), so this call IS the `delete_confirmed` moment, including
	// a re-confirm after a refusal bounce, which is a genuine new attempt.
	captureDeleteEvents([{ name: 'delete_confirmed', principal: callerText }]);

	// Step 1: league resolution. Apply each transfer / delete the
	// caller chose, BEFORE the blocking guard. A failed resolution
	// aborts the whole delete (resolutions are applied immediately, so
	// any that already committed stand: see the recovery caveat in the
	// JSDoc above).
	for (const resolution of leagueResolutions ?? []) {
		const failure = applyLeagueResolution({ resolution, callerText, callerBytes });

		if (nonNullish(failure)) {
			return {
				ok: false,
				reason: 'league_resolution_failed',
				failedLeagueId: failure.failedLeagueId,
				resolutionReason: failure.resolutionReason
			};
		}
	}

	// Step 2: owner-leagues guard. If any owned league still has
	// another member (and wasn't resolved above), refuse and surface
	// the list to the FE.
	const blockingLeagueIds = findOwnedNonEmptyLeagues({ callerText, callerBytes });

	if (blockingLeagueIds.length > 0) {
		return {
			ok: false,
			reason: 'owns_non_empty_league',
			blockingLeagueIds
		};
	}

	const nowNs = time();
	const nowMs = Number(nowNs / MILLISECOND_IN_NANOSECONDS);

	// Step 3: soft-delete. Mark the profile `deletedAtMs = now` and keep
	// every other row intact so recovery can restore the account. A caller
	// who never onboarded has no profile doc: that's a clean no-op
	// (nothing to soft-delete). A second soft-delete keeps the earliest
	// timestamp so the recovery clock can't be reset, and reports
	// `alreadyDeleted` so the churn signal isn't double-counted below.
	const { softDeleted, alreadyDeleted } = softDeleteProfile({ callerText, callerBytes, nowMs });

	// Step 4: exit-signal write. Compact base36 key, anonymous body. The
	// chain timestamp (ns) is the entropy source; we pad it into a 16-char
	// alphanumeric string to keep the key compact. Skipped on a re-delete
	// inside the recovery window (`alreadyDeleted`): appending a second
	// anonymous signal for the same departure would over-count churn and
	// break idempotency.
	if (!alreadyDeleted) {
		const signalKey = exitSignalKeyFromNs(nowNs);
		const signalDoc: ExitSignalDoc = {
			reason: validated.reason,
			note: validated.note,
			createdAtMs: nowMs
		};

		setDocStore({
			collection: Collection.EXIT_SIGNALS,
			key: signalKey,
			caller: callerBytes,
			doc: {
				data: encodeDocData(signalDoc)
			}
		});

		// Churn funnel tail, once per departure (the `alreadyDeleted` guard
		// mirrors the exit-signal idempotency above). `exit_signal` carries
		// only the bounded reason bucket and, like the exit-signal doc, no
		// principal; the free-text note never leaves the doc.
		captureDeleteEvents([
			{ name: 'delete_succeeded', principal: callerText },
			{ name: 'exit_signal', props: { label: validated.reason } }
		]);
	}

	return {
		ok: true,
		softDeleted
	};
};

/** Outcome of {@link softDeleteProfile}. */
interface SoftDeleteProfileResult {
	/** `true` when a profile existed (and is now marked soft-deleted). */
	softDeleted: boolean;
	/**
	 * `true` when the profile was ALREADY soft-deleted before this call
	 * (a re-delete inside the recovery window). Callers use it to skip
	 * side effects that must run only once per departure: notably the
	 * anonymous churn signal in {@link deleteMyAccountFn}.
	 */
	alreadyDeleted: boolean;
}

/**
 * Set `deletedAtMs` on the caller's profile via a version-locked
 * overwrite. Reads → decodes → sets the marker → re-encodes →
 * `setDocStore` with the current `version` so a concurrent profile
 * write can't be silently clobbered. Idempotent: if the profile is
 * already soft-deleted, the EARLIEST `deletedAtMs` is preserved (a
 * re-delete must not extend the recovery window) and `alreadyDeleted`
 * is reported so the caller can suppress one-time side effects.
 * `softDeleted` is `true` when a profile existed (and is now marked),
 * `false` when there was no profile to mark.
 */
const softDeleteProfile = ({
	callerText,
	callerBytes,
	nowMs
}: {
	callerText: string;
	callerBytes: Uint8Array;
	nowMs: number;
}): SoftDeleteProfileResult => {
	const result = mutateOwnProfile({
		callerText,
		callerBytes,
		transform: (profile) => {
			// Keep the earliest mark: re-deleting must not reset the clock.
			const deletedAtMs = isNullish(profile.deletedAtMs)
				? nowMs
				: Math.min(profile.deletedAtMs, nowMs);

			return { ...profile, deletedAtMs };
		}
	});

	if (result.status === 'no_profile') {
		return { softDeleted: false, alreadyDeleted: false };
	}

	// The transform always writes, so `result.status` is `'written'` here;
	// `alreadyDeleted` reflects the marker on the PRE-mutation profile.
	return { softDeleted: true, alreadyDeleted: nonNullish(result.profile.deletedAtMs) };
};

/**
 * Recover the caller's own soft-deleted account (Delete account v2).
 *
 *  - Not soft-deleted → no-op: `{ ok: true, recovered: false }`.
 *  - Soft-deleted, still inside {@link ACCOUNT_RECOVERY_WINDOW_MS} →
 *    clear `deletedAtMs` and restore the account:
 *    `{ ok: true, recovered: true }`.
 *  - Soft-deleted past the window → the grace period is over, so we
 *    hard-delete the account now and report `{ ok: false, reason:
 *    'expired' }` (a late recovery attempt is the natural trigger to
 *    finally purge the data).
 *
 * No profile at all (never onboarded, or already hard-deleted) is a
 * clean no-op `{ ok: true, recovered: false }`. Idempotent.
 */
export const recoverMyAccountFn = (): RecoverMyAccountResult => {
	const caller = msgCaller();
	const callerText = caller.toText();
	const callerBytes = caller.toUint8Array();

	const nowMs = timeMs();

	// The expired branch hard-deletes instead of writing the cleared
	// marker, so we surface it via this flag and return `null` (no write)
	// from the transform; the caller below runs the purge.
	let expired = false;

	const result = mutateOwnProfile({
		callerText,
		callerBytes,
		transform: (profile) => {
			if (isNullish(profile.deletedAtMs)) {
				return null;
			}

			if (nowMs - profile.deletedAtMs >= ACCOUNT_RECOVERY_WINDOW_MS) {
				// Window elapsed: refuse the recovery and purge below.
				expired = true;

				return null;
			}

			// Inside the window: clear the marker via the version-locked write.
			const { deletedAtMs: _drop, ...rest } = profile;

			return rest;
		}
	});

	if (expired) {
		// Window elapsed: purge now and refuse the recovery.
		hardDeleteAccountFn({ callerText, callerBytes });

		return { ok: false, reason: 'expired' };
	}

	return { ok: true, recovered: result.status === 'written' };
};

/**
 * Hibernate the caller's own account (Delete account v2: the reversible
 * retention off-ramp offered alongside deletion). Sets `hibernatedAtMs =
 * now` on the caller's profile via a version-locked overwrite (read →
 * decode → mark → re-encode → `setDocStore` with the current `version`, so
 * a concurrent profile write can't be silently clobbered). NO data is ever
 * removed: hibernation freezes the account's shared stats (it's inactive)
 * and hides the profile from public reads, and the owner can
 * `resumeMyAccount` at any time.
 *
 *  - No profile (never onboarded) → `{ ok: false, reason: 'no_profile' }`.
 *  - Already soft-deleted → `{ ok: false, reason: 'deleted' }`. The two
 *    states are mutually exclusive; we refuse rather than stack markers.
 *  - Otherwise → `{ ok: true }`. Idempotent: a second hibernate keeps the
 *    EARLIEST `hibernatedAtMs` (mirrors `softDeleteProfile`), so re-pausing
 *    can't reset the clock.
 */
export const hibernateMyAccountFn = (): HibernateMyAccountResult => {
	const caller = msgCaller();
	const callerText = caller.toText();
	const callerBytes = caller.toUint8Array();

	const nowMs = timeMs();

	// Soft-delete and hibernation are mutually exclusive; a soft-deleted
	// account refuses with `'deleted'` instead of writing. Surface that
	// via this flag and return `null` (no write) from the transform.
	let deleted = false;

	const result = mutateOwnProfile({
		callerText,
		callerBytes,
		transform: (profile) => {
			// Mutually exclusive with soft-delete: a deleted account can't be
			// hibernated. The FE should never reach here (it offers hibernation
			// as an alternative to delete), but guard defensively.
			if (isSoftDeleted(profile)) {
				deleted = true;

				return null;
			}

			// Keep the earliest mark: re-hibernating must not reset the clock.
			const hibernatedAtMs = isHibernated(profile)
				? Math.min(profile.hibernatedAtMs ?? nowMs, nowMs)
				: nowMs;

			return { ...profile, hibernatedAtMs };
		}
	});

	if (result.status === 'no_profile') {
		return { ok: false, reason: 'no_profile' };
	}

	if (deleted) {
		return { ok: false, reason: 'deleted' };
	}

	return { ok: true };
};

/**
 * Resume the caller's own hibernated account (Delete account v2). Clears
 * `hibernatedAtMs` via a version-locked overwrite (destructure-drop +
 * re-encode, mirroring how `recoverMyAccountFn` clears `deletedAtMs`), so
 * the account becomes active again; its profile reappears on public reads
 * and stats fan-out resumes on the next trade.
 *
 *  - Not hibernated (or no profile) → no-op: `{ ok: true, resumed: false }`.
 *  - Hibernated → clear the marker: `{ ok: true, resumed: true }`.
 *
 * Idempotent. Clearing the flag changes nothing stat-relevant
 * (`totalTrades` is untouched), so the stats fan-out hooks compute a zero
 * delta and write nothing.
 */
export const resumeMyAccountFn = (): ResumeMyAccountResult => {
	const caller = msgCaller();
	const callerText = caller.toText();
	const callerBytes = caller.toUint8Array();

	const result = mutateOwnProfile({
		callerText,
		callerBytes,
		transform: (profile) => {
			if (!isHibernated(profile)) {
				return null;
			}

			// Clear the marker via the version-locked write.
			const { hibernatedAtMs: _drop, ...rest } = profile;

			return rest;
		}
	});

	// No profile and not-hibernated both collapse to a clean no-op; only an
	// actual marker clear (a write) reports `resumed: true`.
	return { ok: true, resumed: result.status === 'written' };
};

/**
 * Admin sweep that hard-deletes every soft-deleted account whose
 * recovery window has elapsed (Delete account v2). Scans `PROFILES`
 * for docs with `deletedAtMs` older than {@link
 * ACCOUNT_RECOVERY_WINDOW_MS} and runs {@link hardDeleteAccountFn} for
 * each. Returns `{ swept }`: the number of accounts purged.
 *
 * **Admin-only**: refuses non-admins via the shared `isAdmin` check.
 *
 * Juno exposes no scheduler primitive (the same reason the worlds
 * podium payout is modelled as a user-claim: see
 * `vxp-worlds-podium.services.ts`), so this is triggered externally:
 * an operator/cron calls it. Idempotent: already-purged accounts no
 * longer carry a profile doc, so a re-run only sweeps newly-expired
 * accounts.
 *
 * Returns `{ swept }`. A malformed/undecodable profile row is skipped
 * silently (the decode is the only step in the narrow try/catch). The
 * purge itself runs OUTSIDE that catch so a `Principal.fromText` /
 * cascade failure can't be mistaken for a malformed row: each failure
 * is logged via `logError` (and a summary line when any fail) so the
 * external trigger can detect an under-purge instead of seeing a
 * falsely-clean `swept`. A failed purge does NOT increment `swept`.
 */
export const sweepExpiredDeletionsFn = (): SweepExpiredDeletionsResult => {
	const caller = msgCaller();

	if (!isAdmin({ caller })) {
		throw new Error('sweepExpiredDeletions: caller is not an admin.');
	}

	const callerBytes = caller.toUint8Array();
	const nowMs = timeMs();

	const { items } = listDocsStore({
		collection: Collection.PROFILES,
		caller: callerBytes,
		params: {}
	});

	let swept = 0;
	let failed = 0;

	for (const [docKey, item] of items) {
		const outcome = isExpiredDeletion({ item, nowMs }) ? purgeSweptAccount({ docKey }) : undefined;

		if (outcome === 'swept') {
			swept += 1;
		} else if (outcome === 'failed') {
			failed += 1;
		}
	}

	if (failed > 0) {
		// Summary so the external trigger can detect an under-purge at a
		// glance without scanning every per-row failure line.
		logError({
			message: 'sweep_expired_deletions_under_purged',
			detail: { swept, failed }
		});
	}

	return { swept };
};

/**
 * Narrow decode-and-expiry check for {@link sweepExpiredDeletionsFn}.
 * Returns `true` only for a profile that is soft-deleted past the
 * recovery window. A row that can't be decoded is treated as `false`
 * (skipped, malformed); this is the ONLY step wrapped in a try/catch,
 * so a downstream purge failure can never be mistaken for a malformed
 * row.
 */
const isExpiredDeletion = ({
	item,
	nowMs
}: {
	item: ListedDocEntry[1];
	nowMs: number;
}): boolean => {
	try {
		const profile = decodeDocData<UserProfile>(item.data);

		return (
			nonNullish(profile.deletedAtMs) && nowMs - profile.deletedAtMs >= ACCOUNT_RECOVERY_WINDOW_MS
		);
	} catch {
		// skip malformed
		return false;
	}
};

/**
 * Hard-delete one swept account for {@link sweepExpiredDeletionsFn}.
 * `profiles` is keyed by the owner's principal text, so we trust the
 * DOC KEY (not the decoded `profile.owner`, which writes don't enforce
 * to equal the key): a mismatched stored `owner` can't make us purge
 * the wrong principal. Runs OUTSIDE the malformed-row guard: a bad key
 * or a cascade error is logged via `logError` and reported as
 * `'failed'` so the run can't under-purge silently. Returns `'swept'`
 * on success, `'failed'` otherwise.
 */
const purgeSweptAccount = ({ docKey }: { docKey: string }): 'swept' | 'failed' => {
	try {
		const ownerBytes = Principal.fromText(docKey).toUint8Array();

		hardDeleteAccountFn({ callerText: docKey, callerBytes: ownerBytes });

		return 'swept';
	} catch (err) {
		logError({
			message: 'sweep_expired_deletions_purge_failed',
			detail: { key: docKey, error: err instanceof Error ? err.message : String(err) }
		});

		return 'failed';
	}
};

/**
 * Build a compact 16-char alphanumeric key from the chain timestamp.
 * The endpoint runs synchronously per-caller, so even at the
 * theoretical ns-resolution collision risk the assert's
 * "current must be null" guard catches a collision cleanly.
 */
const exitSignalKeyFromNs = (nowNs: bigint): string => {
	const base36 = nowNs.toString(36);

	// Pad to a fixed width so keys sort lexicographically by write
	// order (handy when the log grows).
	return base36.padStart(16, '0');
};

/**
 * Convenience: probe whether the caller has any owned league that
 * blocks deletion. Used by the FE pre-flight so the delete CTA can
 * be disabled before the user picks a reason.
 */
export const listMyBlockingLeaguesFn = (): { leagueIds: string[] } => {
	const caller = msgCaller();

	return {
		leagueIds: findOwnedNonEmptyLeagues({
			callerText: caller.toText(),
			callerBytes: caller.toUint8Array()
		})
	};
};
