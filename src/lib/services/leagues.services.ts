import { REFERRAL_CODE_REGEX } from '#lib/constants/referral.constants.ts';
import { authPrincipal } from '#lib/derived/user.derived.ts';
import { LeaguePrivacy } from '#lib/enums/league.ts';
import { track } from '#lib/services/analytics.services.ts';
import { getMyReferralCode } from '#lib/services/referral.services.ts';
import { leagueDirectoryStore } from '#lib/stores/league-directory.store.ts';
import {
	BATTLE_AMOUNT_MAX,
	BATTLE_AMOUNT_MIN,
	BATTLE_TRASH_TALK_MAX_LENGTH,
	isBattleScope,
	type BattleDoc,
	type BattleScope,
	type BattleWinner
} from '#lib/types/battle.ts';
import type { LeagueMemberDoc, LeagueMemberRole } from '#lib/types/league-member.ts';
import {
	LEAGUE_DESCRIPTION_MAX_LENGTH,
	LEAGUE_INVITE_CODE_ALPHABET,
	LEAGUE_INVITE_CODE_LENGTH,
	LEAGUE_INVITE_CODE_REGEX,
	LEAGUE_NAME_MAX_LENGTH,
	LEAGUE_NAME_MIN_LENGTH,
	type JoinLeagueRefusalReason,
	type LeagueDoc
} from '#lib/types/league.ts';
import { appOrigin } from '#lib/utils/nav.utils.ts';
import { hyphenateSlug } from '#lib/utils/slug.utils.ts';
import {
	acceptDuel as acceptDuelApi,
	acceptLeagueBattle as acceptLeagueBattleApi,
	createLeague as createLeagueApi,
	declineBattle as declineBattleApi,
	deleteLeagueImage as deleteLeagueImageApi,
	expireBattle as expireBattleApi,
	getBattle as getBattleApi,
	getMyBattleStats as getMyBattleStatsApi,
	joinLeagueByInvite as joinLeagueByInviteApi,
	kickoffBattle as kickoffBattleApi,
	listChallengeableLeagues as listChallengeableLeaguesApi,
	listFriendRecommendedLeagues as listFriendRecommendedLeaguesApi,
	listLeagueBattles as listLeagueBattlesApi,
	listLeagueMembers as listLeagueMembersApi,
	listMyBattles as listMyBattlesApi,
	listMyLeagues as listMyLeaguesApi,
	lookupLeagueByInvite as lookupLeagueByInviteApi,
	proposeBattle as proposeBattleApi,
	readBattleLiveScore as readBattleLiveScoreApi,
	removeLeagueMember as removeLeagueMemberApi,
	resolveBattle as resolveBattleApi,
	retractBattle as retractBattleApi,
	setLeagueMemberRole as setLeagueMemberRoleApi,
	settleFounderAwards as settleFounderAwardsApi,
	transferLeagueOwnership as transferLeagueOwnershipApi,
	updateLeague as updateLeagueApi
} from '#lib/web2/client.ts';
import { getSessionUser } from '#lib/web2/session.ts';
import { isNullish, nonNullish } from '@dfinity/utils';
import type { PrincipalText } from '@dfinity/zod-schemas';
import { get } from 'svelte/store';

/**
 * Thin service layer over the API's league and battle routes. UI screens
 * import the camelCase domain types from here so they never touch the wire
 * shapes; every write is gated server-side.
 */

/** League hydrated with the caller's membership role. */
export interface LeagueWithRole {
	league: LeagueDoc;
	role: LeagueMemberRole;
	joinedAtMs: number;
	/** Total members in the league (owner included). */
	memberCount: number;
}

// ─── Reads ───────────────────────────────────────────────────────────────

/** The error a refused join or lookup throws, by the satellite's refusal reason. */
export const JOIN_LEAGUE_ERRORS: Record<JoinLeagueRefusalReason, string> = {
	not_found: 'No league found for that invite code.',
	already_member: 'Already a member of this league.',
	rate_limited: 'Too many invite codes missed this hour.'
};

/**
 * List every league the caller is a member of, paired with their
 * role. Sorted newest-join first per the satellite query.
 */
export const listMyLeagues = async (): Promise<LeagueWithRole[]> => await listMyLeaguesApi();

/**
 * Retroactively back-pay the "Founder +100 VXP" reward for any league the
 * caller owns that predates the founder-award hook. New leagues are paid
 * by the satellite hook on creation; this self-heal endpoint covers the
 * backlog and is idempotent (it shares the hook's dedupe key, so a league
 * already paid is never double-credited).
 *
 * Returns how many rewards were newly settled this call, so the Leagues
 * screen can surface a one-off beat. Best-effort: a transport error
 * resolves to `0` rather than rejecting, so it can never break the page
 * load it rides along with.
 */
export const settleFounderAwards = async (): Promise<number> => {
	try {
		// The API also runs founder settlement from its worker; the lazy
		// page-mount trigger stays and is idempotent server-side.
		const { settled } = await settleFounderAwardsApi();

		return settled;
	} catch {
		return 0;
	}
};

/**
 * List the leagues the caller can challenge to a battle; the opponent
 * pool for the create-battle picker. Publicly listed (Open) leagues plus
 * the caller's own memberships, minus leagues the caller owns. Sorted
 * alphabetically by name per the satellite query.
 */
export const listChallengeableLeagues = async (): Promise<LeagueDoc[]> =>
	await listChallengeableLeaguesApi();

/**
 * A non-private (Open or Invite-only) league a friend is in but the
 * caller is not, plus the overlap.
 */
export interface FriendRecommendedLeague {
	league: LeagueDoc;
	/** Total members in the league (owner included). */
	memberCount: number;
	/** Principals of the caller's friends who are members of this league. */
	friendMembers: string[];
}

/**
 * List Open and Invite-only leagues the caller's confirmed friends are in
 * but the caller is not: the "Friends are in" recommendations row at the
 * foot of the Leagues list. Private leagues are never surfaced. Sorted by
 * friend-overlap count descending per the satellite query.
 */
export const listFriendRecommendedLeagues = async (): Promise<FriendRecommendedLeague[]> =>
	await listFriendRecommendedLeaguesApi();

/**
 * List the full member roster of a league as the `LeagueMemberDoc` the
 * FE uses everywhere (the wire row already has that shape). Powers the
 * transfer-ownership picker (in the league detail surface and the
 * delete-account flow) where the caller needs the other members to
 * hand a league off to.
 */
export const listLeagueMembers = async ({
	leagueId
}: {
	leagueId: string;
}): Promise<LeagueMemberDoc[]> => await listLeagueMembersApi(leagueId);

/**
 * Resolve an invite code to its league, or `undefined` if no league
 * carries that code. Callers should treat the undefined branch as
 * "invalid code" UX, not an error. Throws once the caller has missed too
 * many codes this hour (the satellite's cap; the API answers 429).
 */
export const lookupLeagueByInvite = async ({
	inviteCode
}: {
	inviteCode: string;
}): Promise<LeagueDoc | undefined> => await lookupLeagueByInviteApi(inviteCode);

export const loadLeaguesByIds = async ({ ids }: { ids: string[] }): Promise<void> => {
	const cached = get(leagueDirectoryStore);
	const unique = Array.from(new Set(ids)).filter((id) => id.length > 0 && !cached.has(id));

	if (unique.length === 0) {
		return;
	}

	// The HTTP API has no public by-id league read yet, but every id this
	// hydration is asked for (battle opponents, bracket slots) is either a
	// league the caller belongs to or one in their challengeable pool, so two
	// list reads cover the directory. An id outside both (a private opponent
	// the caller never joined) stays unresolved and the UI falls back to the
	// shortened id, the same as a failed per-id fetch on the default path.
	try {
		const [mine, challengeable] = await Promise.all([
			listMyLeaguesApi(),
			listChallengeableLeaguesApi()
		]);
		const byId = new Map<string, LeagueDoc>([
			...mine.map(({ league }): [string, LeagueDoc] => [league.id, league]),
			...challengeable.map((league): [string, LeagueDoc] => [league.id, league])
		]);

		leagueDirectoryStore.update((current) => {
			const next = new Map(current);

			for (const id of unique) {
				const doc = byId.get(id);

				if (doc) {
					next.set(id, doc);
				}
			}

			return next;
		});
	} catch {
		// Best-effort like the per-id path: missing entries fall back in the UI.
	}
};

// ─── Writes ──────────────────────────────────────────────────────────────

/**
 * Validate a league name + description per the same rules the
 * satellite assert enforces. Surfaced so the FE form can show
 * inline errors before submitting.
 */
export const validateLeagueDraft = ({
	name,
	description
}: {
	name: string;
	description?: string;
}):
	| { ok: true }
	| { ok: false; reason: 'name_too_short' | 'name_too_long' | 'description_too_long' } => {
	if (name.length < LEAGUE_NAME_MIN_LENGTH) {
		return { ok: false, reason: 'name_too_short' };
	}

	if (name.length > LEAGUE_NAME_MAX_LENGTH) {
		return { ok: false, reason: 'name_too_long' };
	}

	if (nonNullish(description) && description.length > LEAGUE_DESCRIPTION_MAX_LENGTH) {
		return { ok: false, reason: 'description_too_long' };
	}

	return { ok: true };
};

/**
 * Derive a stable, URL-friendly league id from a display name.
 * Lowercase, ASCII alphanumerics + hyphen, collapsed and trimmed.
 * Callers may pass a creation timestamp so the slug is unique even
 * when two users pick the same name.
 */
const deriveLeagueId = ({ name, suffix }: { name: string; suffix: number | string }): string => {
	const slug = hyphenateSlug(name.toLowerCase()).slice(0, 24);

	return `${slug || 'league'}-${suffix}`;
};

/**
 * Generate a fresh {@link LEAGUE_INVITE_CODE_LENGTH}-char invite code via
 * the platform crypto. Matches `LEAGUE_INVITE_CODE_REGEX` from
 * `#lib/types/league.ts` at the length `createLeague` requires of a new
 * league, so the satellite accepts it on first write.
 */
export const generateInviteCode = (): string => {
	const buf = new Uint8Array(LEAGUE_INVITE_CODE_LENGTH);
	crypto.getRandomValues(buf);

	let code = '';

	for (const byte of buf) {
		code += LEAGUE_INVITE_CODE_ALPHABET[byte % LEAGUE_INVITE_CODE_ALPHABET.length];
	}

	return code;
};

/**
 * Create a new league + write the owner-membership row. The
 * satellite assert enforces caller-binds-owner on both writes, so
 * the FE just signs and submits.
 *
 * Returns the created `LeagueDoc` so the caller can route to the
 * detail page or update their local list optimistically.
 */
export const createLeague = async ({
	name,
	description,
	accentColor,
	emblem,
	privacy = LeaguePrivacy.OPEN
}: {
	name: string;
	description?: string;
	/** Optional accent colour (hex) the owner picked in the create
	 *  sheet. Persisted on the league doc so the gradient logo tile is
	 *  consistent everywhere the league is rendered. */
	accentColor?: string;
	/** Single-glyph emblem the owner picked in the create sheet.
	 *  Persisted on the league doc so the logo tile reads the same
	 *  everywhere the league is rendered. */
	emblem?: string;
	/** Three-way visibility the owner picked in the create sheet.
	 *  Defaults to {@link LeaguePrivacy.OPEN} (the create surface's
	 *  default: new leagues are publicly listed and battle-eligible);
	 *  persisted on the league doc and surfaced as the detail header's
	 *  privacy chip. */
	privacy?: LeaguePrivacy;
}): Promise<LeagueDoc> => {
	const validation = validateLeagueDraft({ name, description });

	if (!validation.ok) {
		throw new Error(`Invalid league draft: ${validation.reason}`);
	}

	// The API mints the invite code server-side and creates the owner
	// membership in the same transaction, so the code the create sheet
	// pre-generated for display is superseded by the one on the returned
	// league (the detail surface renders the stored code everywhere).
	return await createLeagueApi({
		id: deriveLeagueId({ name, suffix: Date.now() }),
		name,
		description,
		accentColor,
		emblem,
		privacy
	});
};

/**
 * Edit an owner-mutable league field. Only the current owner can call
 * this; the satellite assert hard-rejects anyone else. On the edit path
 * `id`, `createdAtMs`, `inviteCode`, and `emblem` stay frozen: `name`,
 * `privacy`, and `imageUrl` are the mutable fields.
 *
 * Pass `name` to rename (trimmed + re-validated against the same
 * `LEAGUE_NAME_MIN_LENGTH`–`LEAGUE_NAME_MAX_LENGTH` window the create
 * flow enforces; an invalid name throws before
 * any write). Pass `privacy` to change the league's visibility (any of
 * the three variants; the assert range-checks it). Pass `imageUrl` to
 * set or change the cover image, or `''` to clear it (the field is
 * dropped from the doc so a cover-less league carries an absent field,
 * matching the assert's non-empty rule). Omitting a field leaves it
 * untouched.
 *
 * Re-reads the existing doc so we round-trip the server's `version`
 * token: Juno's optimistic-concurrency guard rejects an update that
 * omits it, and so unchanged fields are carried over verbatim. Returns
 * the updated `LeagueDoc` so the caller can reflect the change
 * optimistically.
 */
export const updateLeague = async ({
	id,
	name,
	privacy,
	imageUrl
}: {
	id: string;
	name?: string;
	/** New three-way visibility, or omitted to leave as-is. */
	privacy?: LeaguePrivacy;
	/** New cover-image URL, `''` to clear, or omitted to leave as-is. */
	imageUrl?: string;
}): Promise<LeagueDoc> => {
	const trimmedName = nonNullish(name) ? name.trim() : undefined;

	if (nonNullish(trimmedName)) {
		const validation = validateLeagueDraft({ name: trimmedName });

		if (!validation.ok) {
			throw new Error(`Invalid league name: ${validation.reason}`);
		}
	}

	// A fresh cover URL was already persisted by the image upload route, so
	// a non-empty `imageUrl` needs no write here; the PATCH (possibly empty)
	// doubles as the read-back of the updated row. Clearing goes through the
	// dedicated image endpoint because the PATCH surface carries no image
	// field.
	const league = await updateLeagueApi({
		leagueId: id,
		...(nonNullish(trimmedName) ? { name: trimmedName } : {}),
		...(nonNullish(privacy) ? { privacy } : {})
	});

	// An explicit `null` clears, `undefined` leaves as-is; the typeof check
	// tells them apart without a bare null compare.
	const clearImage =
		(isNullish(imageUrl) && typeof imageUrl !== 'undefined') ||
		(nonNullish(imageUrl) && imageUrl.trim().length === 0);

	return clearImage ? await deleteLeagueImageApi(id) : league;
};

// Cache for the caller's own referral code; the same value for a given identity,
// so resolve it once and reuse across every league-share build. Keyed to the
// signed-in principal so an in-session account switch (sign-out → sign-in without
// a reload) never reuses the previous user's code. Only a positive result is
// cached; a missing code (not yet assigned / backfilled later) stays retryable.
let cachedReferral: { owner: PrincipalText; code: string } | undefined;

const resolveMyReferralCode = async (): Promise<string | undefined> => {
	const owner = get(authPrincipal);

	if (isNullish(owner)) {
		return;
	}

	if (cachedReferral?.owner === owner) {
		return cachedReferral.code;
	}

	try {
		const code = await getMyReferralCode();

		if (nonNullish(code)) {
			cachedReferral = { owner, code };
		}

		return code;
	} catch {
		// Best-effort: a failed lookup falls through to `undefined`, yielding a
		// plain (no-`?ref=`) share link.
	}
};

/**
 * Builds the canonical league-invite URL (`{origin}/league/{code}`), appending
 * the sharer's referral code as `?ref={code}` so the invite also implies a friend
 * invite (auto-friendship on join, plus the new-user bonus for fresh sign-ups,
 * the landing route + onboarding drain redeem the `?ref=` exactly like a plain
 * friend invite). The param is appended only when a real referral code resolves;
 * with none available the plain link is returned (a handle would fail
 * `REFERRAL_CODE_REGEX` on the consuming side and be dropped, so it is never
 * substituted). `withReferral` lets the caller annotate analytics.
 */
export const buildLeagueShareUrl = async ({
	inviteCode
}: {
	inviteCode: string;
}): Promise<{ url: string; withReferral: boolean }> => {
	const base = `${appOrigin()}/league/${inviteCode}`;
	const referralCode = await resolveMyReferralCode();

	if (nonNullish(referralCode) && REFERRAL_CODE_REGEX.test(referralCode)) {
		return { url: `${base}?ref=${referralCode}`, withReferral: true };
	}

	return { url: base, withReferral: false };
};

/**
 * Join a league via its invite code, the only way into a league.
 * Returns the league so the caller can route into it.
 *
 * Throws if the code is malformed, unknown, or the caller is already a
 * member.
 */
export const joinLeagueByInvite = async ({
	inviteCode
}: {
	inviteCode: string;
}): Promise<LeagueDoc> => {
	if (!LEAGUE_INVITE_CODE_REGEX.test(inviteCode)) {
		throw new Error('Invite code is malformed.');
	}

	// The API join is idempotent (re-joining returns the existing row).
	const league = await lookupLeagueByInvite({ inviteCode });

	if (!league) {
		throw new Error(JOIN_LEAGUE_ERRORS.not_found);
	}

	await joinLeagueByInviteApi({ inviteCode });

	track({ name: 'league_joined', leagueId: league.id, source: 'invite' });

	return league;
};

/**
 * Leave a league: deletes the caller's membership row. The
 * satellite assert rejects this for the owner principal, so
 * ownership transfer is a precondition. Callers should disable the
 * "Leave" CTA on owner rows.
 */
export const leaveLeague = async ({ leagueId }: { leagueId: string }): Promise<void> => {
	const me = getSessionUser();

	if (isNullish(me)) {
		throw new Error('Not signed in.');
	}

	// Idempotent server-side: a missing row is a clean success, matching the
	// early-return below.
	await removeLeagueMemberApi({ leagueId, memberUserId: me.id });
};

/**
 * Transfer league ownership to another member. The current owner
 * calls this; the satellite swaps `LEAGUES.owner` and the matching
 * `LEAGUE_MEMBERS` role rows (old owner → admin, new owner → owner).
 *
 * The call surfaces structured refusal reasons so the FE can render
 * a meaningful error: `not_owner`, `league_not_found`,
 * `new_owner_not_member`, `new_owner_is_caller`, `invalid_input`.
 * On success returns `{ ok: true }`.
 */
export interface TransferLeagueOwnershipResult {
	ok: boolean;
	reason?:
		| 'not_owner'
		| 'league_not_found'
		| 'new_owner_not_member'
		| 'new_owner_is_caller'
		| 'invalid_input';
}

export const transferLeagueOwnership = ({
	leagueId,
	newOwnerPrincipal
}: {
	leagueId: string;
	newOwnerPrincipal: string;
}): Promise<TransferLeagueOwnershipResult> =>
	// The "principal" the roster carries is the account id, which is exactly
	// what the transfer route keys the new owner by.
	transferLeagueOwnershipApi({ leagueId, newOwnerUserId: newOwnerPrincipal });

/**
 * Set a member's role inside a league; the owner-driven promote
 * (`member → admin`) / demote (`admin → member`) control. Re-reads the
 * existing membership row to round-trip the server's `version` token and
 * to carry the immutable identity fields (`leagueId`, `member`,
 * `joinedAtMs`) verbatim, then writes back the same row with the new
 * `role`.
 *
 * Owner-gated server-side: the `league_members` assert rejects a
 * role-change write from any caller that isn't the league owner, so the
 * owner-only UI guard is a convenience, not the authority. `'owner'` is
 * never a target here: promotion only ever toggles `member ↔ admin`; the
 * owner role is reserved for the league's owner principal.
 */
export const setMemberRole = async ({
	leagueId,
	memberPrincipal,
	role
}: {
	leagueId: string;
	memberPrincipal: string;
	role: Extract<LeagueMemberRole, 'admin' | 'member'>;
}): Promise<void> => {
	await setLeagueMemberRoleApi({ leagueId, memberUserId: memberPrincipal, role });
};

// ─── Battles ───────────────────────────────────────────────────────────────

/**
 * List every battle involving the given league: both sides scanned.
 * Projects the satellite's wire rows to the FE `BattleDoc`.
 */
export const listLeagueBattles = async ({ leagueId }: { leagueId: string }): Promise<BattleDoc[]> =>
	await listLeagueBattlesApi(leagueId);

/**
 * List every battle across every league the caller belongs to. Powers
 * the `/arena/battles` cross-league inbox. Sorted server-side by
 * `kickoffMs` ascending.
 */
export const listMyBattles = async (): Promise<BattleDoc[]> => await listMyBattlesApi();

/**
 * Count of resolved battles the caller's side won, tallied
 * server-side: duels by principal match on the winning side, league
 * bouts by ownership of the winning league. Backs the profile's
 * `boutsWon` counter in the stats sync without paging the full battle
 * list.
 */
export const getMyBattleStats = async (): Promise<{ boutsWon: number }> =>
	await getMyBattleStatsApi();

/**
 * Propose a new battle (kind='league'). Caller must own the `sideA`
 * league; the satellite assert hard-rejects otherwise. The opponent
 * (sideB) league doesn't need to exist on the satellite for the
 * proposal to land: accept goes through a separate assert pass
 * under the opponent owner's caller identity.
 *
 * The competition window starts when the opponent **accepts**, so the
 * proposer only chooses a `durationMs` (the window length). We persist a
 * provisional window (`kickoffMs = now`, `settleMs = now + durationMs`)
 * whose length encodes the duration; accept resets `kickoffMs` to its own
 * "now" and preserves that length. `respondByMs` bounds how long the
 * proposal waits before it lapses to `expired`.
 */
export const proposeBattle = async ({
	sideA,
	sideB,
	durationMs,
	scope,
	amount,
	trashTalk
}: {
	sideA: string;
	sideB: string;
	durationMs: number;
	scope?: BattleScope;
	amount?: number;
	trashTalk?: string;
}): Promise<BattleDoc> => {
	if (!Number.isFinite(durationMs) || durationMs <= 0) {
		throw new Error('Battle duration must be a positive number of milliseconds.');
	}

	if (nonNullish(scope) && !isBattleScope(scope)) {
		throw new Error(`Invalid battle scope "${scope}".`);
	}

	if (
		nonNullish(amount) &&
		(!Number.isFinite(amount) || amount < BATTLE_AMOUNT_MIN || amount > BATTLE_AMOUNT_MAX)
	) {
		throw new Error(`Amount must be within [${BATTLE_AMOUNT_MIN}, ${BATTLE_AMOUNT_MAX}].`);
	}

	// Trim, then drop an empty trash-talk so we never persist a blank
	// string for an absent message.
	const trimmedTrashTalk = trashTalk?.trim();

	if (nonNullish(trimmedTrashTalk) && trimmedTrashTalk.length > BATTLE_TRASH_TALK_MAX_LENGTH) {
		throw new Error(`Trash talk must be at most ${BATTLE_TRASH_TALK_MAX_LENGTH} characters.`);
	}

	// The server stamps proposer, state and respond-by from the session, and
	// caps ids at 64 chars, so the id is a uuid rather than the readable
	// two-sided slug (which can exceed the cap). The provisional window
	// semantics are identical: its length encodes the duration accept keeps.
	const now = Date.now();

	return await proposeBattleApi({
		id: crypto.randomUUID(),
		kind: 'league',
		sideA,
		sideB,
		kickoffMs: now,
		settleMs: now + durationMs,
		...(nonNullish(scope) && scope !== 'all' ? { scope } : {}),
		...(nonNullish(amount) && amount > BATTLE_AMOUNT_MIN ? { amount } : {}),
		...(nonNullish(trimmedTrashTalk) && trimmedTrashTalk.length > 0
			? { trashTalk: trimmedTrashTalk }
			: {})
	});
};

/**
 * Battle state transitions: thin write helpers. The satellite assert
 * (BE-6) enforces the forward-only state machine + per-transition
 * authorisation; the FE just packages the doc + signs the call. Each
 * reads the existing doc first to round-trip the server's `version`
 * token, which Juno's optimistic-concurrency guard requires.
 */

/**
 * Accept a battle proposal. For a **league** battle this fuses the
 * kickoff: the window starts now (`kickoffMs = now`, the proposed
 * duration preserved as `settleMs - kickoffMs`), each side's current
 * `league_stats` bucket is stamped as the baseline the window delta is
 * measured against, and the state goes straight to `in_flight`. Duels
 * (no `league_stats` to delta) just move to `accepted` and kick off
 * separately. `respondedAtMs` records when the challenged side answered.
 */
export const acceptBattle = async ({ battle }: { battle: BattleDoc }): Promise<BattleDoc> =>
	// The two accept shapes are separate routes: the league accept fuses the
	// kickoff and stamps baselines server-side, the duel accept just moves the
	// state. Same fused-vs-plain split as the doc writes below.
	battle.kind === 'league'
		? await acceptLeagueBattleApi(battle.id)
		: await acceptDuelApi(battle.id);

/**
 * Decline a battle proposal (`proposed → declined`). Only the challenged
 * side's owner can call this; the satellite assert hard-rejects anyone
 * else and any battle past `proposed`. `respondedAtMs` records when.
 */
export const declineBattle = async ({ battle }: { battle: BattleDoc }): Promise<BattleDoc> =>
	await declineBattleApi(battle.id);

/**
 * Lazily expire a `proposed` battle whose respond-by deadline has passed
 * (`proposed → expired`). Idempotent: a battle that is no longer
 * `proposed`, or not yet past its deadline, is returned unchanged with no
 * write. Mirrors the lazy auto-resolve path: Juno has no scheduler, so a
 * stale proposal is swept the first time a side owner reads it. Legacy
 * rows without `respondByMs` fall back to `kickoffMs`.
 */
export const maybeExpireBattle = async ({ battle }: { battle: BattleDoc }): Promise<BattleDoc> => {
	// Same lazy sweep over the HTTP transport: re-read, gate on state and the
	// respond-by deadline locally (so a fresh proposal never fires a doomed
	// write), then let the server apply the transition.
	const current = await getBattleApi(battle.id);

	if (isNullish(current)) {
		return battle;
	}

	if (current.state !== 'proposed' || Date.now() < (current.respondByMs ?? current.kickoffMs)) {
		return current;
	}

	return await expireBattleApi(battle.id);
};

/**
 * Kick a battle off (`accepted → in_flight`). For league battles this
 * stamps each side's current `league_stats` bucket as the baseline the
 * window delta is measured against; the satellite assert re-reads
 * `league_stats` and rejects a baseline that doesn't match. The next
 * doc is built from the freshly-read raw doc so no field is lost to a
 * stale wire projection.
 */
export const kickoffBattle = async ({ battle }: { battle: BattleDoc }): Promise<BattleDoc> =>
	await kickoffBattleApi(battle.id);

/**
 * Retract a `proposed`-state battle. Only the original proposer can
 * call this; the satellite assert hard-rejects anyone else and any
 * battle past `proposed`.
 */
export const retractBattle = async ({ battle }: { battle: BattleDoc }): Promise<void> => {
	if (battle.state !== 'proposed') {
		throw new Error('Only proposed battles can be retracted.');
	}

	await retractBattleApi(battle.id);
};

/**
 * Resolve a settled league battle (`in_flight → resolved`). Delegates to the
 * satellite `resolveBattle` endpoint, which derives each side's accuracy from
 * the clearing canister's settlement history over the battle window (scoped to
 * the battle's market category) and writes the resolved doc as a controller;
 * a client cannot forge a result. Idempotent server-side: an already-resolved
 * battle is returned unchanged. A legacy row that never got a kickoff baseline
 * resolves fine, since resolution no longer reads baselines.
 */
export const resolveBattle = async ({ battle }: { battle: BattleDoc }): Promise<BattleDoc> =>
	await resolveBattleApi(battle.id);

/** Running standings for an in-flight battle, before it resolves. */
export interface BattleLiveScore {
	/** Side A accuracy (0–100) over the window so far. */
	scoreA: number;
	/** Side B accuracy (0–100) over the window so far. */
	scoreB: number;
	/** Side A window call count so far; the accuracy tie-break. */
	callsA: number;
	/** Side B window call count so far. */
	callsB: number;
	/** Who's ahead right now, by the same rule resolution uses. */
	leader: BattleWinner;
}

/**
 * Project the **current** standings of an in-flight league battle:
 * "who's winning" while the window is still open. Delegates to the satellite
 * `readBattleLiveScore` endpoint, which runs the identical clearing-settlement
 * accuracy arithmetic as {@link resolveBattle} over `[kickoff, now)`, strictly
 * read-only.
 *
 * Returns `null` for anything that can't be scored live; a duel, a
 * non-`in_flight` battle, or a caller who is not a member of either side.
 */
export const readBattleLiveScore = async ({
	battle
}: {
	battle: BattleDoc;
}): Promise<BattleLiveScore | null> => {
	if (battle.state !== 'in_flight' || battle.kind !== 'league') {
		return null;
	}

	return (await readBattleLiveScoreApi(battle.id)) ?? null;
};
