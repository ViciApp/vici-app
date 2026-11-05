import { Collection } from '#lib/constants/collections.constants.ts';
import { LeaguePrivacy } from '#lib/enums/league.ts';
import { leagueMemberKey, type LeagueMemberDoc } from '#lib/types/league-member.ts';
import {
	LEAGUE_DESCRIPTION_MAX_LENGTH,
	LEAGUE_EMBLEMS,
	LEAGUE_IMAGES_COLLECTION,
	LEAGUE_INVITE_CODE_REGEX,
	LEAGUE_NAME_MAX_LENGTH,
	LEAGUE_NAME_MIN_LENGTH,
	type LeagueDoc
} from '#lib/types/league.ts';
import { isNullish, nonNullish } from '@dfinity/utils';
import { Principal } from '@icp-sdk/core/principal';
import type { AssertSetDocContext } from '@junobuild/functions';
import { canisterSelf, msgCaller } from '@junobuild/functions/ic-cdk';
import {
	decodeDocData,
	deleteDocStore,
	encodeDocData,
	getDocStore,
	listDocsStore,
	setDocStore
} from '@junobuild/functions/sdk';

/**
 * Validate an optional league `imageUrl` against the only shape we ever
 * write: a Juno Storage download URL for THIS satellite's
 * `league_images` collection (see `uploadLeagueImage`, which resolves
 * `https://<satelliteId>.<host><fullPath>` with `fullPath` starting at
 * `/league_images/`).
 *
 * Absent or `undefined` means "no image" — allowed (the field is
 * cleared, never an empty string). When present we reject anything that
 * isn't ours: surrounding whitespace, a non-`https:` scheme (blocks
 * `data:`/`javascript:` and other foreign schemes), a host whose
 * leftmost label isn't our satellite canister id, or a path outside the
 * `league_images` collection. This stops an owner from persisting an
 * external/tracking-pixel URL that would then render for every member.
 */
const assertValidLeagueImageUrl = (imageUrl: string | undefined): void => {
	if (isNullish(imageUrl)) {
		return;
	}

	// The stored value must already be its trimmed form — the FE
	// normalises before write, so any surrounding whitespace here is a
	// crafted payload.
	if (imageUrl !== imageUrl.trim() || imageUrl.length === 0) {
		throw new Error('leagues imageUrl must be a trimmed, non-empty URL when set.');
	}

	let url: URL;

	try {
		url = new URL(imageUrl);
	} catch {
		throw new Error('leagues imageUrl must be a well-formed URL.');
	}

	// HTTPS only — blocks data:/javascript:/blob: and any foreign scheme.
	if (url.protocol !== 'https:') {
		throw new Error('leagues imageUrl must use the https scheme.');
	}

	// Host must belong to this satellite: the download URL is
	// `<satelliteId>.<host>` (e.g. `<id>.icp0.io`), so the leftmost label
	// is the canister id. Reject any other origin.
	const satelliteIdText = canisterSelf().toText();

	if (url.hostname !== satelliteIdText && !url.hostname.startsWith(`${satelliteIdText}.`)) {
		throw new Error('leagues imageUrl must point at this satellite.');
	}

	// Path must address the league_images collection.
	if (!url.pathname.startsWith(`/${LEAGUE_IMAGES_COLLECTION}/`)) {
		throw new Error(`leagues imageUrl must point at the ${LEAGUE_IMAGES_COLLECTION} collection.`);
	}
};

/**
 * Pre-write guard for `leagues`. The collection holds social cohorts;
 * the rules here keep league identity stable across the
 * lifetime of the cohort so the join-by-code flow + standings
 * leaderboards can trust the metadata.
 *
 *  1. **Key shape.** The doc key must equal the embedded `id`.
 *     Drift between key and id is the most common path to a duplicate
 *     league slipping through; this assertion makes it impossible.
 *
 *  2. **Authorisation.** On creation, the caller becomes the owner
 *     (`proposed.owner === caller`). On edits, the *current* owner is
 *     the only principal that can write — but they're free to flip
 *     `owner` to any valid principal (transfer-of-ownership flow).
 *     The owner-rotation invariant is "only the outgoing owner can
 *     authorise the swap"; the new owner must already be a member of
 *     the league (enforced by the endpoint, not this assert, since
 *     the assert can't cheaply scan `league_members`).
 *
 *  3. **Identity fields are immutable.** `id`, `createdAtMs`,
 *     `inviteCode`, and `emblem` are write-once. Even the owner can't
 *     rotate the invite code after creation — the join-by-code flow
 *     relies on codes being stable for the league's lifetime. `owner`,
 *     `privacy`, and `imageUrl` are the editable exceptions: ownership
 *     transfers (see §2), and the owner can change the league's
 *     visibility and cover image after creation.
 *
 *  4. **Shape validation.** Name 3–40 chars, description ≤240 chars,
 *     invite code matches `[A-Z0-9]{6}`. Owner is a valid principal
 *     text.
 */
export const assertSetLeague = ({
	caller,
	data: {
		collection,
		key,
		data: { current, proposed }
	}
}: AssertSetDocContext): void => {
	if (collection !== Collection.LEAGUES) {
		return;
	}

	const proposedDoc = decodeDocData<LeagueDoc>(proposed.data);

	// 1. Key shape — must match the embedded id.
	if (key !== proposedDoc.id) {
		throw new Error(`leagues key mismatch: expected ${proposedDoc.id}, got ${key}.`);
	}

	// 2. Shape validation.
	if (
		proposedDoc.name.length < LEAGUE_NAME_MIN_LENGTH ||
		proposedDoc.name.length > LEAGUE_NAME_MAX_LENGTH
	) {
		throw new Error(
			`leagues name must be ${LEAGUE_NAME_MIN_LENGTH}–${LEAGUE_NAME_MAX_LENGTH} chars (got ${proposedDoc.name.length}).`
		);
	}

	if (
		nonNullish(proposedDoc.description) &&
		proposedDoc.description.length > LEAGUE_DESCRIPTION_MAX_LENGTH
	) {
		throw new Error(`leagues description must be at most ${LEAGUE_DESCRIPTION_MAX_LENGTH} chars.`);
	}

	if (!LEAGUE_INVITE_CODE_REGEX.test(proposedDoc.inviteCode)) {
		throw new Error(
			`leagues inviteCode must match ${LEAGUE_INVITE_CODE_REGEX} (got "${proposedDoc.inviteCode}").`
		);
	}

	// Owner principal must parse — defensive against malformed writes.
	try {
		Principal.fromText(proposedDoc.owner);
	} catch {
		throw new Error('leagues owner must be a valid principal text.');
	}

	// Privacy drives every visibility decision, so any value that lands on
	// the doc — on creation OR on a later owner edit — must be one of the
	// three known variants (or absent for legacy-style rows, which resolve
	// to `open`). Validated on both paths because privacy is owner-mutable
	// after creation (an owner can tighten or loosen a league's visibility);
	// the create surface and the privacy editor both write through here.
	if (
		nonNullish(proposedDoc.privacy) &&
		!Object.values(LeaguePrivacy).includes(proposedDoc.privacy)
	) {
		throw new Error(
			`leagues privacy must be one of ${Object.values(LeaguePrivacy).join(', ')} (got "${proposedDoc.privacy}").`
		);
	}

	const callerText = Principal.fromUint8Array(caller).toText();

	// Creation path — caller must equal proposed owner. No `current`
	// to compare against, so the "current owner authorises edits"
	// rule below doesn't apply.
	if (isNullish(current)) {
		if (proposedDoc.owner !== callerText) {
			throw new Error('leagues owner must match the caller principal on creation.');
		}

		// Emblem renders in the UI and is frozen after creation, so it
		// must be one of the curated glyphs (or absent for legacy-style
		// rows). Reject arbitrary strings up front rather than letting
		// them lock in.
		if (
			nonNullish(proposedDoc.emblem) &&
			!(LEAGUE_EMBLEMS as readonly string[]).includes(proposedDoc.emblem)
		) {
			throw new Error(
				`leagues emblem must be one of ${LEAGUE_EMBLEMS.join(' ')} (got "${proposedDoc.emblem}").`
			);
		}

		// A cover image may be seeded at creation; same validation as the
		// edit path — when present it must be one of our own league_images
		// Storage URLs, else the field stays absent ("no image").
		assertValidLeagueImageUrl(proposedDoc.imageUrl);

		return;
	}

	const currentDoc = decodeDocData<LeagueDoc>(current.data);

	// 2 (edit path). The current owner is the only principal that
	// can edit. The transfer-of-ownership endpoint impersonates the
	// outgoing owner (msgCaller) for the swap, then impersonates the
	// new owner for the membership-role updates.
	if (currentDoc.owner !== callerText) {
		throw new Error('leagues edits must be made by the current owner.');
	}

	// 3. Identity fields are immutable on edits — `owner` is now
	// editable, the rest stay frozen. The emblem is chosen once at creation
	// and frozen alongside the identity fields so the league's logo glyph
	// can't silently shift under existing members.
	//
	// `privacy` and `imageUrl` are the deliberate exceptions among the
	// visual-identity fields: the owner can change a league's visibility
	// (tighten or loosen it; the FE confirm-gates the loosen-to-Open
	// direction) and set/change/clear its cover image after creation (see
	// §4 below), so neither is frozen here. The proposed privacy value is
	// still range-checked against the known variants up top.
	if (
		currentDoc.id !== proposedDoc.id ||
		currentDoc.createdAtMs !== proposedDoc.createdAtMs ||
		currentDoc.inviteCode !== proposedDoc.inviteCode ||
		(currentDoc.emblem ?? '') !== (proposedDoc.emblem ?? '')
	) {
		throw new Error('leagues identity fields are immutable (id, createdAtMs, inviteCode, emblem).');
	}

	// 4. Cover image — owner-mutable. The owner (the only principal that
	// reaches this point, per §2) may set, change, or clear `imageUrl`.
	// When present it must be one of THIS satellite's `league_images`
	// Storage download URLs; we reject blanks/external/foreign-scheme
	// values up front so a cleared image is an absent field (not an empty
	// string) and a member can never be served an untrusted URL.
	assertValidLeagueImageUrl(proposedDoc.imageUrl);
};

/**
 * League ownership transfer — defineUpdate handler.
 *
 * The flow runs three writes in order:
 *
 *  1. Flip `LEAGUES[leagueId].owner` from the outgoing owner (the
 *     caller) to the new owner. Done as the *outgoing* owner so the
 *     assert's "edits made by current owner" rule accepts the swap.
 *  2. Promote `LEAGUE_MEMBERS[${leagueId}/${newOwner}]` to
 *     `role='owner'`. Done as the *new* owner — by this point
 *     `league.owner === newOwner`, so the assert's "callerIsOwner"
 *     branch passes and the "owner role reserved for league owner
 *     principal" check also passes.
 *  3. Demote `LEAGUE_MEMBERS[${leagueId}/${oldOwner}]` from
 *     `role='owner'` to `role='admin'`. Done as the *new* owner for
 *     the same reason as step 2.
 *
 * The writes aren't atomic. If a step fails after step 1 commits the
 * league has a new `owner` field but the old member-row hint is
 * stale. The system stays functional (every authorisation downstream
 * reads `league.owner`, not the member-row role), but a follow-up
 * call would idempotently complete the missing role updates. For v1
 * we accept the partial-failure risk; a future "owner-row drift"
 * background sweeper can repair stragglers.
 *
 * Refusal reasons:
 *  - `not_owner` — caller is not the current owner.
 *  - `league_not_found` — leagueId has no doc.
 *  - `new_owner_not_member` — target principal isn't a member of the
 *    league. (Only a current member can become owner.)
 *  - `new_owner_is_caller` — caller is trying to transfer to
 *    themselves; a no-op we reject explicitly so the FE can render
 *    a clearer error than a silent success.
 *  - `invalid_input` — `newOwnerPrincipal` is not a valid principal
 *    text.
 */

export type TransferLeagueOwnershipRefusalReason =
	| 'not_owner'
	| 'league_not_found'
	| 'new_owner_not_member'
	| 'new_owner_is_caller'
	| 'invalid_input';

export interface TransferLeagueOwnershipResult {
	ok: boolean;
	reason?: TransferLeagueOwnershipRefusalReason;
}

export const transferLeagueOwnershipFn = ({
	leagueId,
	newOwnerPrincipal
}: {
	leagueId: string;
	newOwnerPrincipal: string;
}): TransferLeagueOwnershipResult => {
	let newOwner: Principal;

	try {
		newOwner = Principal.fromText(newOwnerPrincipal);
	} catch {
		return { ok: false, reason: 'invalid_input' };
	}

	const caller = msgCaller();
	const callerText = caller.toText();
	const callerBytes = caller.toUint8Array();
	const newOwnerText = newOwner.toText();
	const newOwnerBytes = newOwner.toUint8Array();

	if (callerText === newOwnerText) {
		return { ok: false, reason: 'new_owner_is_caller' };
	}

	// Read the league as the caller. If the league doc isn't visible
	// or doesn't exist, refuse.
	const leagueDoc = getDocStore({
		collection: Collection.LEAGUES,
		key: leagueId,
		caller: callerBytes
	});

	if (isNullish(leagueDoc)) {
		return { ok: false, reason: 'league_not_found' };
	}

	const league = decodeDocData<LeagueDoc>(leagueDoc.data);

	if (league.owner !== callerText) {
		return { ok: false, reason: 'not_owner' };
	}

	// Confirm the new owner is a member of the league. Their member
	// row must already exist; we read it here and reuse the `version`
	// stamp when we promote it to `owner` in step 2.
	const newOwnerMemberKey = leagueMemberKey({
		leagueId,
		memberPrincipal: newOwnerText
	});

	const newOwnerMemberDoc = getDocStore({
		collection: Collection.LEAGUE_MEMBERS,
		key: newOwnerMemberKey,
		caller: callerBytes
	});

	if (isNullish(newOwnerMemberDoc)) {
		return { ok: false, reason: 'new_owner_not_member' };
	}

	const oldOwnerMemberKey = leagueMemberKey({
		leagueId,
		memberPrincipal: callerText
	});

	const oldOwnerMemberDoc = getDocStore({
		collection: Collection.LEAGUE_MEMBERS,
		key: oldOwnerMemberKey,
		caller: callerBytes
	});

	// Step 1 — flip league.owner. Caller is the outgoing owner.
	setDocStore({
		collection: Collection.LEAGUES,
		key: leagueId,
		caller: callerBytes,
		doc: {
			data: encodeDocData<LeagueDoc>({
				...league,
				owner: newOwnerText
			}),
			version: leagueDoc.version
		}
	});

	// Step 2 — promote the new owner's member row. From here on we
	// impersonate the new owner so the assert sees `callerIsOwner`
	// (which is true now that league.owner has flipped).
	const newOwnerMember = decodeDocData<LeagueMemberDoc>(newOwnerMemberDoc.data);

	setDocStore({
		collection: Collection.LEAGUE_MEMBERS,
		key: newOwnerMemberKey,
		caller: newOwnerBytes,
		doc: {
			data: encodeDocData<LeagueMemberDoc>({
				...newOwnerMember,
				role: 'owner'
			}),
			version: newOwnerMemberDoc.version
		}
	});

	// Step 3 — demote the old owner's member row to `admin`. The
	// member doc *should* exist (every owner has a corresponding
	// `role='owner'` member row), but defensively skip if missing
	// — we've already swapped league.owner so the auth model is
	// consistent regardless.
	if (nonNullish(oldOwnerMemberDoc)) {
		const oldOwnerMember = decodeDocData<LeagueMemberDoc>(oldOwnerMemberDoc.data);

		setDocStore({
			collection: Collection.LEAGUE_MEMBERS,
			key: oldOwnerMemberKey,
			caller: newOwnerBytes,
			doc: {
				data: encodeDocData<LeagueMemberDoc>({
					...oldOwnerMember,
					role: 'admin'
				}),
				version: oldOwnerMemberDoc.version
			}
		});
	}

	return { ok: true };
};

/**
 * Owner-authorised league disband — full delete of a league and all
 * its membership rows.
 *
 * Refusal reasons:
 *  - `not_owner` — caller is not the current owner of the league.
 *
 * A missing league doc is NOT a refusal — it's a clean no-op success
 * (`{ ok: true }`). The disband is idempotent: if the league is already
 * gone (e.g. deleted by a concurrent caller between an ownership
 * precheck and this call), the desired end state already holds.
 *
 * The disband runs as the satellite SDK caller (passed in as
 * `callerBytes`), so it deletes via `deleteDocStore` directly — that
 * path does NOT re-enter `assertDeleteLeagueMember`, which is why this
 * can drop the `owner` member row too (the assert would otherwise
 * reject it as "transfer ownership first"). Order is membership rows
 * first, then the league doc, mirroring the cascade's
 * memberships → owned-empty-leagues sequencing.
 *
 * This is a deliberate, complete disband — distinct from the account-
 * delete cascade's `deleteOwnedEmptyLeagues`, which only drops leagues
 * that are ALREADY empty (every other member has left). Here the owner
 * is explicitly choosing to remove a league that may still have other
 * members, evicting everyone.
 *
 * Idempotent: a missing league doc or missing membership rows are
 * clean no-ops. The version-locked deletes detect a concurrent mutation
 * (a member joining/leaving mid-disband) by trapping — the caller can
 * retry and the prefix scan re-reads the current rows.
 */
export const deleteLeagueFn = ({
	leagueId,
	callerText,
	callerBytes
}: {
	leagueId: string;
	callerText: string;
	callerBytes: Uint8Array;
}): { ok: boolean; reason?: 'not_owner' } => {
	const leagueDoc = getDocStore({
		collection: Collection.LEAGUES,
		key: leagueId,
		caller: callerBytes
	});

	// Idempotent: nothing to disband if the league is already gone.
	if (isNullish(leagueDoc)) {
		return { ok: true };
	}

	const league = decodeDocData<LeagueDoc>(leagueDoc.data);

	if (league.owner !== callerText) {
		return { ok: false, reason: 'not_owner' };
	}

	// Delete every membership row for this league (prefix scan on
	// `${leagueId}/`). The owner row is included — the SDK drop bypasses
	// `assertDeleteLeagueMember`'s "owner row can't be deleted" guard.
	//
	// Match on the key prefix alone, NOT the decoded payload: membership
	// keys are already namespaced by `${leagueId}/`, so the prefix is
	// authoritative. Deleting a row whose payload fails to decode (or whose
	// `leagueId` field disagrees) would otherwise leave an orphan row behind
	// after the league doc is gone.
	const { items: memberItems } = listDocsStore({
		collection: Collection.LEAGUE_MEMBERS,
		caller: callerBytes,
		params: {}
	});

	const prefix = `${leagueId}/`;

	for (const [docKey, item] of memberItems) {
		if (docKey.startsWith(prefix)) {
			deleteDocStore({
				collection: Collection.LEAGUE_MEMBERS,
				key: docKey,
				caller: callerBytes,
				doc: {
					version: item.version
				}
			});
		}
	}

	// Drop the league doc itself.
	deleteDocStore({
		collection: Collection.LEAGUES,
		key: leagueId,
		caller: callerBytes,
		doc: {
			version: leagueDoc.version
		}
	});

	return { ok: true };
};
