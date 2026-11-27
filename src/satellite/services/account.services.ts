import { ACCOUNT_RECOVERY_WINDOW_MS } from '#lib/constants/app.constants.ts';
import { Collection } from '#lib/constants/collections.constants.ts';
import { DAY_IN_MS, MILLISECOND_IN_NANOSECONDS } from '#lib/constants/time.constants.ts';
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
import { releaseReactionCount } from '#satellite/services/activity-reaction-count.services.ts';
import {
	captureServerEvents,
	type ServerEventInput
} from '#satellite/services/analytics.services.ts';
import { controllerCaller, isAdmin } from '#satellite/services/authz.services.ts';
import {
	type KeysetWalk,
	type KeysetWalkArgs,
	walkKeysetPage
} from '#satellite/services/keyset-walk.services.ts';
import { deleteLeagueInvite } from '#satellite/services/league-invite.services.ts';
import {
	leagueDisbandsInProgress,
	leagueMemberRows
} from '#satellite/services/league-member.services.ts';
import { deleteLeagueFn, transferLeagueOwnershipFn } from '#satellite/services/league.services.ts';
import { isHibernated, isSoftDeleted } from '#satellite/services/profile.services.ts';
import { isReferralPayoutRecord } from '#satellite/services/referral.services.ts';
import {
	missingAccountAwardMarkers,
	recordAwardMarker
} from '#satellite/services/vxp-award-markers.services.ts';
import { logError } from '#satellite/utils/logger.utils.ts';
import { escapeRegex } from '#satellite/utils/regex.utils.ts';
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
 * Account deletion: soft-delete + recovery + admin sweep, with league
 * resolution.
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
 *     recovery caveat below). A disband deletes a bounded batch of docs
 *     per call: while one has more left, the call stops there with
 *     `reason: 'league_disband_pending'` and the FE sends the same
 *     request again until it gets past step 1. Every disband the caller
 *     has under way is finished first, named in the request or not.
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
 *     with the chosen reason + optional note. It is unlinkable from the
 *     account that wrote it: no principal field, a random key, only the
 *     UTC day as its time, written as a controller, and readable by
 *     controllers only (its Juno timestamps match the soft-delete's).
 *     Skipped when step 3 reports
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
	'owns_non_empty_league' | 'league_resolution_failed' | 'league_disband_pending' | 'invalid_input';

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
	{ ok: true; recovered: boolean } | { ok: false; reason: 'expired'; pending: boolean };

/**
 * Result of {@link sweepExpiredDeletionsFn}: how many accounts this call
 * purged (`swept`) and how many purges failed (`failed`, each logged with
 * the stable `sweep_expired_deletions_purge_failed` tag), plus where the
 * walk over `PROFILES` left off. A failed account keeps its profile and
 * the walk moves past it, so it cannot hold up the others; the next walk
 * from the first doc tries it again. A call that only got part way through
 * an account's purge counts it in neither and answers `done: false` with
 * the cursor still before that account.
 */
export interface SweepExpiredDeletionsResult extends KeysetWalk {
	swept: number;
	failed: number;
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
 * Reads the doc via `getDocStore` as the real caller (PROFILES is keyed by
 * principal text, one doc per user), null-guards a missing doc, decodes it,
 * then runs `transform`. The write signs as a controller: the account state
 * these transforms move (`deletedAtMs`, `hibernatedAtMs`) is one only the
 * satellite may change (`assertAccountStateUnchanged`).
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
		caller: controllerCaller('account state'),
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
 * How many writes one {@link hardDeleteAccountFn} call makes. Each serverless
 * write costs billions of instructions, so a call stays a few writes under the
 * update limit and an account with many docs is purged over several calls (see
 * the bulk-rewrite budget note in docs/ai/satellite/patterns.md).
 */
const ACCOUNT_PURGE_BATCH = 5;

/**
 * What every phase of the account purge ({@link hardDeleteAccountFn}) works
 * from. It reads as the purged account (`callerBytes`) and deletes or rewrites
 * as `writer`, a satellite controller: serverless writes run the collection
 * asserts too, and the purge removes rows the account itself may not (a locked
 * affiliation, a league owner row, a referral record, an award) or hands a
 * league over.
 */
interface CascadeStep {
	callerText: string;
	callerBytes: Uint8Array;
	writer: Uint8Array;
}

/**
 * One write of the purge, made only when its call still has room for it:
 * `cost` is how many serverless writes it makes, `deletes` how many of the
 * account's docs it removes.
 */
interface PurgeWrite {
	cost: number;
	deletes: number;
	run: () => void;
}

/**
 * One phase of the purge: the writes still left for it, read afresh on every
 * call, so a phase that is done costs reads only.
 */
type PurgePhase = (step: CascadeStep) => PurgeWrite[];

const deleteWrite = ({
	collection,
	entry: [key, { version }],
	writer
}: {
	collection: Collection;
	entry: ListedDocEntry;
	writer: Uint8Array;
}): PurgeWrite => ({
	cost: 1,
	deletes: 1,
	run: () => deleteDocStore({ collection, key, caller: writer, doc: { version } })
});

/**
 * The docs of `collection` whose key matches `keyPattern`, listed as `listAs`
 * by the datastore's key matcher, so the scan never reads other accounts' rows.
 */
const matchingDocs = ({
	collection,
	keyPattern,
	listAs
}: {
	collection: Collection;
	keyPattern: string;
	listAs: Uint8Array;
}): ListedDocEntry[] =>
	listDocsStore({ collection, caller: listAs, params: { matcher: { key: keyPattern } } }).items;

/**
 * Whether a listed doc decodes and passes `keep`; a malformed doc is skipped.
 */
const decodesAnd =
	<T>(keep: (data: T) => boolean) =>
	([, item]: ListedDocEntry): boolean => {
		try {
			return keep(decodeDocData<T>(item.data));
		} catch {
			return false;
		}
	};

/**
 * Deletes every doc keyed by the principal itself or under `${principal}/`:
 * `profiles`, `vxp_awards`, `vxp_onboarding`, `affiliations`, the stats and the
 * controllers-scoped collections keyed that way (listed as the controller).
 */
const ownPrefixedDocs = ({
	collection,
	listAs,
	callerText,
	writer
}: CascadeStep & { collection: Collection; listAs: Uint8Array }): PurgeWrite[] =>
	matchingDocs({ collection, keyPattern: `^${escapeRegex(callerText)}(/|$)`, listAs }).map(
		(entry) => deleteWrite({ collection, entry, writer })
	);

/**
 * The marker of each one-time award the account was paid, written before any
 * award doc goes: what keeps the same principal, signing up again, from
 * collecting a one-time award twice.
 */
const awardMarkersPhase: PurgePhase = ({ callerText, writer }) =>
	missingAccountAwardMarkers({ callerText, writer }).map((key) => ({
		cost: 1,
		deletes: 0,
		run: () => recordAwardMarker({ key, writer })
	}));

/**
 * The owner-private `profile_private` doc (the account email): one doc keyed by
 * the principal, read directly.
 */
const privateProfilePhase: PurgePhase = ({ callerText, callerBytes, writer }) => {
	const doc = getDocStore({
		collection: Collection.PROFILE_PRIVATE,
		key: callerText,
		caller: callerBytes
	});

	return isNullish(doc)
		? []
		: [deleteWrite({ collection: Collection.PROFILE_PRIVATE, entry: [callerText, doc], writer })];
};

/**
 * The account's resolved results (`resolved_results` is keyed
 * `${principal}#${marketId}`), listed as `writer`: the collection is
 * controllers-only.
 */
const resolvedResultsPhase: PurgePhase = ({ callerText, writer }) =>
	matchingDocs({
		collection: Collection.RESOLVED_RESULTS,
		keyPattern: `^${escapeRegex(callerText)}#`,
		listAs: writer
	}).map((entry) => deleteWrite({ collection: Collection.RESOLVED_RESULTS, entry, writer }));

/**
 * The likes the account gave (`activity_reactions` is keyed by the liked
 * activity's key plus `#${liker}`), each moving the liked activity's counter
 * down as an unlike would: two writes. Likes on the account's own activities
 * stay with them.
 */
const reactionsPhase: PurgePhase = ({ callerText, callerBytes, writer }) =>
	matchingDocs({
		collection: Collection.ACTIVITY_REACTIONS,
		keyPattern: `#${escapeRegex(callerText)}$`,
		listAs: callerBytes
	}).map((entry) => {
		const reactionDelete = deleteWrite({
			collection: Collection.ACTIVITY_REACTIONS,
			entry,
			writer
		});

		return {
			cost: 2,
			deletes: 1,
			run: () => {
				reactionDelete.run();
				releaseReactionCount(entry[0]);
			}
		};
	});

/**
 * The account's referral code. `referral_codes` is keyed by the code, its
 * owner held in the data, so nothing narrows the scan by key; it is listed as
 * `writer` because the collection is controllers-only.
 */
const referralCodePhase: PurgePhase = ({ callerText, writer }) =>
	listDocsStore({ collection: Collection.REFERRAL_CODES, caller: writer, params: {} })
		.items.filter(decodesAnd<ReferralCodeDoc>(({ owner }) => owner === callerText))
		.map((entry) => deleteWrite({ collection: Collection.REFERRAL_CODES, entry, writer }));

/**
 * The account's referral-redemption row (`referrals` is keyed by the referee
 * principal) unless it has started paying: that row keeps its slot in the
 * referrer's lifetime count, so deleting referred accounts can never reset the
 * referrer's tier. Other users' rows whose `referrer` is the account stay (they
 * document the referee's payout history, auditable apart from the referrer).
 */
const referralRedemptionPhase: PurgePhase = ({ callerText, callerBytes, writer }) => {
	const doc = getDocStore({
		collection: Collection.REFERRALS,
		key: callerText,
		caller: callerBytes
	});

	if (isNullish(doc)) {
		return [];
	}

	const entry: ListedDocEntry = [callerText, doc];

	return decodesAnd<ReferralDoc>((referral) => !isReferralPayoutRecord(referral))(entry)
		? [deleteWrite({ collection: Collection.REFERRALS, entry, writer })]
		: [];
};

/**
 * The account's relations (friend rows keyed `${a}#${b}`, follow rows
 * `follow#${sender}#${target}`), matched on a key segment naming the account
 * and kept to rows whose `participants` hold it. The other participant loses
 * the relation too (mirrors the `cancelFriendRequest` / `unfollow` semantics).
 */
const relationsPhase: PurgePhase = ({ callerText, callerBytes, writer }) =>
	matchingDocs({
		collection: Collection.RELATIONS,
		keyPattern: `(^|#)${escapeRegex(callerText)}(#|$)`,
		listAs: callerBytes
	})
		.filter(decodesAnd<Relation>(({ participants }) => participants.includes(callerText)))
		.map((entry) => deleteWrite({ collection: Collection.RELATIONS, entry, writer }));

/**
 * The account's own `league_members` rows (keys end in `/${principal}`) whose
 * payload names it as the member.
 */
const ownMembershipRows = ({ callerText, callerBytes }: CascadeStep): ListedDocEntry[] =>
	matchingDocs({
		collection: Collection.LEAGUE_MEMBERS,
		keyPattern: `${escapeRegex(`/${callerText}`)}$`,
		listAs: callerBytes
	}).filter(decodesAnd<LeagueMemberDoc>(({ member }) => member === callerText));

/**
 * Every league the account owns, found from its own membership rows, resolved
 * one of two ways together with that row, in one write of up to three:
 *
 *  - **No other members left** → delete the league and its invite code. On the
 *    `deleteMyAccount` path the owner-non-empty guard already passed, so the
 *    league is a genuine orphan.
 *  - **Other members remain** → transfer ownership instead of deleting, so
 *    self-joiners during the recovery window aren't orphaned. This branch only
 *    triggers on the guard-less paths (recovery-expiry purge + admin sweep),
 *    where membership may have grown after the soft-delete. A deterministic
 *    survivor, the first other member row in key order, becomes the new owner:
 *    `league.owner` is re-encoded onto the league doc (version-locked) and that
 *    member's row `role` is bumped to `'owner'` (also version-locked). Both
 *    writes are signed as the controller, which `assertSetLeague` and
 *    `assertSetLeagueMember` accept as the owner.
 *
 * A league resolved this way no longer names the account as its owner, and its
 * row is gone, so a later call finds nothing left.
 */
const ownedLeaguesPhase: PurgePhase = (step) => {
	const { callerText, callerBytes, writer } = step;
	const suffix = `/${callerText}`;

	return ownMembershipRows(step).flatMap((ownRow): PurgeWrite[] => {
		const leagueId = ownRow[0].slice(0, -suffix.length);
		const leagueDoc = getDocStore({
			collection: Collection.LEAGUES,
			key: leagueId,
			caller: callerBytes
		});

		if (isNullish(leagueDoc)) {
			return [];
		}

		let league: LeagueDoc;

		try {
			league = decodeDocData<LeagueDoc>(leagueDoc.data);
		} catch {
			// skip malformed
			return [];
		}

		if (league.owner !== callerText) {
			return [];
		}

		const ownRowDelete = deleteWrite({
			collection: Collection.LEAGUE_MEMBERS,
			entry: ownRow,
			writer
		});
		const survivor = leagueMemberRows({ leagueId, caller: callerBytes }).find(
			decodesAnd<LeagueMemberDoc>(
				(member) => member.leagueId === leagueId && member.member !== callerText
			)
		);

		if (isNullish(survivor)) {
			return [
				{
					cost: 3,
					deletes: 2,
					run: () => {
						deleteDocStore({
							collection: Collection.LEAGUES,
							key: leagueId,
							caller: writer,
							doc: { version: leagueDoc.version }
						});
						deleteLeagueInvite({ leagueId });
						ownRowDelete.run();
					}
				}
			];
		}

		const [survivorKey, survivorItem] = survivor;
		const survivorMember = decodeDocData<LeagueMemberDoc>(survivorItem.data);

		return [
			{
				cost: 3,
				deletes: 1,
				run: () => {
					setDocStore({
						collection: Collection.LEAGUES,
						key: leagueId,
						caller: writer,
						doc: {
							data: encodeDocData<LeagueDoc>({ ...league, owner: survivorMember.member }),
							version: leagueDoc.version
						}
					});
					setDocStore({
						collection: Collection.LEAGUE_MEMBERS,
						key: survivorKey,
						caller: writer,
						doc: {
							data: encodeDocData<LeagueMemberDoc>({ ...survivorMember, role: 'owner' }),
							version: survivorItem.version
						}
					});
					ownRowDelete.run();
				}
			}
		];
	});
};

/** The account's remaining league memberships, once its owned leagues are resolved. */
const membershipsPhase: PurgePhase = (step) =>
	ownMembershipRows(step).map((entry) =>
		deleteWrite({ collection: Collection.LEAGUE_MEMBERS, entry, writer: step.writer })
	);

/**
 * The purge, in the order it runs. The award markers come first, so they exist
 * before any award doc goes; owned leagues come before the other memberships,
 * since they are found from the account's own rows; the profile comes last, so
 * the account stays findable (by the sweep, by a late recovery) until nothing
 * else of it is left.
 */
const ACCOUNT_PURGE_PHASES: readonly PurgePhase[] = [
	awardMarkersPhase,
	privateProfilePhase,
	(step) =>
		ownPrefixedDocs({ ...step, collection: Collection.VXP_AWARDS, listAs: step.callerBytes }),
	(step) =>
		ownPrefixedDocs({ ...step, collection: Collection.VXP_ONBOARDING, listAs: step.callerBytes }),
	(step) =>
		ownPrefixedDocs({ ...step, collection: Collection.CALIBRATION_ATTEMPTS, listAs: step.writer }),
	(step) =>
		ownPrefixedDocs({ ...step, collection: Collection.USER_STATS, listAs: step.callerBytes }),
	(step) =>
		ownPrefixedDocs({
			...step,
			collection: Collection.USER_MONTHLY_STATS,
			listAs: step.callerBytes
		}),
	resolvedResultsPhase,
	reactionsPhase,
	// Controllers-scoped, and holds the school email.
	(step) =>
		ownPrefixedDocs({ ...step, collection: Collection.SCHOOL_SUBMISSIONS, listAs: step.writer }),
	referralCodePhase,
	referralRedemptionPhase,
	(step) =>
		ownPrefixedDocs({
			...step,
			collection: Collection.LEAGUE_INVITE_ATTEMPTS,
			listAs: step.writer
		}),
	// Whatever their 90-day lock: `assertDeleteAffiliation` lets the controller through.
	(step) =>
		ownPrefixedDocs({ ...step, collection: Collection.AFFILIATIONS, listAs: step.callerBytes }),
	relationsPhase,
	ownedLeaguesPhase,
	membershipsPhase,
	(step) => ownPrefixedDocs({ ...step, collection: Collection.PROFILES, listAs: step.callerBytes })
];

/** Result of one {@link hardDeleteAccountFn} call. */
export interface AccountPurgeBatch {
	/** How many of the account's docs this call deleted. */
	deleted: number;
	/** More is left: call again until this is `false`. */
	pending: boolean;
}

/**
 * Cascade hard-delete for a single account, at most
 * {@link ACCOUNT_PURGE_BATCH} writes per call: `pending` means more is left,
 * and the caller calls again until it is `false`. Removes every row
 * identity-keyed to the principal: profile, VXP awards / onboarding (an
 * anonymous marker of each paid one-time award stays, see
 * {@link missingAccountAwardMarkers}), calibration attempts, user stats and
 * monthly stats, resolved results, the likes it gave, school-email
 * submissions, referral code + redemption record, missed league invite codes,
 * affiliations, relations, league memberships. Owned leagues are either
 * deleted (no other members left) or transferred to a surviving member: see
 * {@link ownedLeaguesPhase}; self-joiners during the recovery window are never
 * orphaned. Shared audit rows (activities, battles, comments) are left in
 * place: the principal is gone, so they're orphaned but immutable (decision
 * 4.1).
 *
 * Every call walks {@link ACCOUNT_PURGE_PHASES} from the first, so a phase
 * finished in an earlier call costs reads only and a doc stored since (an award
 * paid mid-purge) is still caught in order. The profile goes last: until the
 * purge is done the account keeps its soft-deleted profile, so the sweep and a
 * late recovery both find it again and carry on.
 *
 * Takes the principal explicitly (does NOT call `msgCaller()`) so the
 * admin sweep can run it for any account, not just the caller. Idempotent: a
 * call on an already-purged account finds nothing, writes nothing and
 * answers `{ deleted: 0, pending: false }`.
 */
export const hardDeleteAccountFn = ({
	callerText,
	callerBytes
}: {
	callerText: string;
	callerBytes: Uint8Array;
}): AccountPurgeBatch => {
	const step: CascadeStep = {
		callerText,
		callerBytes,
		writer: controllerCaller('account purge')
	};

	let spent = 0;
	let deleted = 0;

	for (const phase of ACCOUNT_PURGE_PHASES) {
		for (const write of phase(step)) {
			if (spent > 0 && spent + write.cost > ACCOUNT_PURGE_BATCH) {
				return { deleted, pending: true };
			}

			write.run();
			spent += write.cost;
			deleted += write.deletes;
		}
	}

	return { deleted, pending: false };
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
 * the caller: a clean skip), `pendingLeagueId` when a disband has more
 * docs left for the next call, or a populated failure object to abort
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
}): { failedLeagueId: string; resolutionReason: string } | { pendingLeagueId: string } | null => {
	const { leagueId, action, transferTo } = resolution;

	if (action === 'delete') {
		// `deleteLeagueFn` checks ownership itself, the owner row standing
		// in for the league doc once a disband has deleted it; a league the
		// caller doesn't own (`not_owner`) is left untouched, as below.
		const result = deleteLeagueFn({ leagueId, callerText, callerBytes });

		return result.pending === true ? { pendingLeagueId: leagueId } : null;
	}

	// Only act on leagues the caller actually owns. A non-owned league
	// is left untouched; the blocking guard downstream still protects
	// against orphaning other users' membership.
	if (!callerOwnsLeague({ leagueId, callerText, callerBytes })) {
		return null;
	}

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
	// A call that resumes a disband an earlier call of this delete started
	// is the same attempt, so it is not counted again.
	const disbandsInProgress = leagueDisbandsInProgress({ callerText, callerBytes });

	if (disbandsInProgress.length === 0) {
		captureDeleteEvents([{ name: 'delete_confirmed', principal: callerText }]);
	}

	// Step 1: league resolution. First finish every disband an earlier
	// call started, whatever this request names (the league doc is gone, so
	// a retry may not name it, and soft-deleting with its rows left would
	// orphan them), then apply each transfer / delete the caller chose,
	// BEFORE the blocking guard. A failed resolution aborts the whole delete
	// (resolutions are applied immediately, so any that already committed
	// stand: see the recovery caveat in the JSDoc above); a disband with
	// docs left stops this call there.
	const resolutions: LeagueResolution[] = [
		...disbandsInProgress.map((leagueId): LeagueResolution => ({ leagueId, action: 'delete' })),
		...(leagueResolutions ?? []).filter(({ leagueId }) => !disbandsInProgress.includes(leagueId))
	];

	for (const resolution of resolutions) {
		const outcome = applyLeagueResolution({ resolution, callerText, callerBytes });

		if (nonNullish(outcome)) {
			return 'pendingLeagueId' in outcome
				? { ok: false, reason: 'league_disband_pending' }
				: {
						ok: false,
						reason: 'league_resolution_failed',
						failedLeagueId: outcome.failedLeagueId,
						resolutionReason: outcome.resolutionReason
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

	// Step 4: exit-signal write, anonymous: a random key, only the UTC day
	// the account left, and signed as a controller so the doc's owner is
	// not the caller. Skipped on a re-delete inside the recovery window
	// (`alreadyDeleted`): appending a second anonymous signal for the same
	// departure would over-count churn and break idempotency.
	if (!alreadyDeleted) {
		const signalDoc: ExitSignalDoc = {
			reason: validated.reason,
			note: validated.note,
			createdAtMs: nowMs - (nowMs % DAY_IN_MS)
		};

		setDocStore({
			collection: Collection.EXIT_SIGNALS,
			key: randomExitSignalKey(),
			caller: controllerCaller('exit signal'),
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
 *    'expired', pending }` (a late recovery attempt is the natural trigger
 *    to finally purge the data). The purge writes a bounded batch per
 *    call ({@link hardDeleteAccountFn}): `pending` means more is left and
 *    the caller calls again until it is `false`. The profile goes last,
 *    so every one of those calls still lands in this branch.
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
		const { pending } = hardDeleteAccountFn({ callerText, callerBytes });

		return { ok: false, reason: 'expired', pending };
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
 * How many accounts one `sweepExpiredDeletions` call purges. A purge call
 * runs a dozen key-matched scans on top of its batch of writes, each a
 * serverless write costing billions of instructions, so a call works on a
 * single account and the sweep goes in rounds (see the bulk-rewrite budget
 * note in docs/ai/satellite/patterns.md).
 */
const SWEEP_EXPIRED_DELETIONS_BATCH = 1;

/**
 * Admin sweep that hard-deletes soft-deleted accounts whose recovery
 * window has elapsed (Delete account v2). One call reads one keyset page
 * of `PROFILES` after `afterKey` (at most `limit` docs, see
 * {@link walkKeysetPage}) and runs one {@link hardDeleteAccountFn} batch for
 * at most {@link SWEEP_EXPIRED_DELETIONS_BATCH} profile with `deletedAtMs`
 * older than {@link ACCOUNT_RECOVERY_WINDOW_MS}. The operator passes the
 * returned `nextAfterKey` to the next call until `done`.
 *
 * A purge with more left than one batch keeps the account's profile (it
 * goes last), so the call stops there with the cursor before it and the
 * next call carries the same purge on; the account counts in `swept` on
 * the call that removes its profile.
 *
 * **Admin-only**: refuses non-admins via the shared `isAdmin` check.
 *
 * Juno has no on-chain scheduler for this satellite (the Worlds monthly
 * podium payout is modelled as a user-claim: see
 * `vxp-worlds-podium.services.ts`), so this is triggered externally:
 * an operator/cron calls it. Idempotent: already-purged accounts no
 * longer carry a profile doc, so a new walk only sweeps the accounts
 * still expired.
 *
 * A malformed/undecodable profile row is skipped silently (the decode is
 * the only step in the narrow try/catch). The purge itself runs OUTSIDE
 * that catch so a `Principal.fromText` / cascade failure can't be
 * mistaken for a malformed row: it is logged via `logError` and counted
 * in `failed`, never in `swept`.
 */
export const sweepExpiredDeletionsFn = ({
	afterKey,
	limit
}: KeysetWalkArgs = {}): SweepExpiredDeletionsResult => {
	const caller = msgCaller();

	if (!isAdmin({ caller })) {
		throw new Error('sweepExpiredDeletions: caller is not an admin.');
	}

	const nowMs = timeMs();

	let swept = 0;
	let failed = 0;

	const walk = walkKeysetPage({
		collection: Collection.PROFILES,
		caller: caller.toUint8Array(),
		afterKey,
		limit,
		visit: ([docKey, item]) => {
			if (!isExpiredDeletion({ item, nowMs })) {
				return 'kept';
			}

			if (swept + failed >= SWEEP_EXPIRED_DELETIONS_BATCH) {
				return 'stop';
			}

			const outcome = purgeSweptAccount({ docKey });

			if (outcome === 'swept') {
				swept += 1;

				return 'removed';
			}

			// The profile goes last, so a purge with more left keeps it: stopping
			// leaves the cursor before the account and the next call carries on.
			if (outcome === 'pending') {
				return 'stop';
			}

			failed += 1;

			return 'kept';
		}
	});

	return { swept, failed, ...walk };
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
 * once the account is gone, `'pending'` when this call's batch left more
 * of it, `'failed'` otherwise.
 */
const purgeSweptAccount = ({ docKey }: { docKey: string }): 'swept' | 'pending' | 'failed' => {
	try {
		const ownerBytes = Principal.fromText(docKey).toUint8Array();

		const { pending } = hardDeleteAccountFn({ callerText: docKey, callerBytes: ownerBytes });

		return pending ? 'pending' : 'swept';
	} catch (err) {
		logError({
			message: 'sweep_expired_deletions_purge_failed',
			detail: { key: docKey, error: err instanceof Error ? err.message : String(err) }
		});

		return 'failed';
	}
};

/**
 * A 128-bit hex key from the satellite's seeded generator (`Math.random` is
 * the one Juno installs), so the key carries neither the write time nor its
 * order. A collision is refused by the append-only assert.
 */
const randomExitSignalKey = (): string =>
	Array.from({ length: 4 }, () =>
		Math.floor(Math.random() * 2 ** 32)
			.toString(16)
			.padStart(8, '0')
	).join('');

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
