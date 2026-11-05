import { functions } from '#declarations/satellite/satellite.api.ts';
import { Collection } from '#lib/constants/collections.constants.ts';
import { REFERRAL_CODE_REGEX } from '#lib/constants/referral.constants.ts';
import { authPrincipal } from '#lib/derived/user.derived.ts';
import { LeaguePrivacy } from '#lib/enums/league.ts';
import { track } from '#lib/services/analytics.services.ts';
import { safeGetIdentityOnce } from '#lib/services/identity.services.ts';
import { getMyReferralCode } from '#lib/services/referral.services.ts';
import { leagueDirectoryStore } from '#lib/stores/league-directory.store.ts';
import {
	BATTLE_RESPOND_BY_MS,
	BATTLE_SCOPE_DEFAULT,
	BATTLE_TRASH_TALK_MAX_LENGTH,
	BATTLE_WAGER_MAX,
	BATTLE_WAGER_MIN,
	isBattleScope,
	type BattleDoc,
	type BattleScope,
	type BattleWinner
} from '#lib/types/battle.ts';
import {
	leagueMemberKey,
	type LeagueMemberDoc,
	type LeagueMemberRole
} from '#lib/types/league-member.ts';
import { leagueStatsBucket, leagueStatsKey, type LeagueStatsDoc } from '#lib/types/league-stats.ts';
import {
	LEAGUE_DESCRIPTION_MAX_LENGTH,
	LEAGUE_INVITE_CODE_REGEX,
	LEAGUE_NAME_MAX_LENGTH,
	LEAGUE_NAME_MIN_LENGTH,
	type LeagueDoc
} from '#lib/types/league.ts';
import { isWeb2Backend } from '#lib/web2/backend-mode.ts';
import {
	acceptDuel as acceptDuelWeb2,
	acceptLeagueBattle as acceptLeagueBattleWeb2,
	createLeague as createLeagueWeb2,
	declineBattle as declineBattleWeb2,
	deleteLeagueImage as deleteLeagueImageWeb2,
	expireBattle as expireBattleWeb2,
	getBattle as getBattleWeb2,
	getMyBattleStats as getMyBattleStatsWeb2,
	joinLeagueByInvite as joinLeagueByInviteWeb2,
	kickoffBattle as kickoffBattleWeb2,
	listChallengeableLeagues as listChallengeableLeaguesWeb2,
	listFriendRecommendedLeagues as listFriendRecommendedLeaguesWeb2,
	listLeagueBattles as listLeagueBattlesWeb2,
	listLeagueMembers as listLeagueMembersWeb2,
	listMyBattles as listMyBattlesWeb2,
	listMyLeagues as listMyLeaguesWeb2,
	lookupLeagueByInvite as lookupLeagueByInviteWeb2,
	proposeBattle as proposeBattleWeb2,
	readBattleLiveScore as readBattleLiveScoreWeb2,
	removeLeagueMember as removeLeagueMemberWeb2,
	resolveBattle as resolveBattleWeb2,
	retractBattle as retractBattleWeb2,
	setLeagueMemberRole as setLeagueMemberRoleWeb2,
	settleFounderAwards as settleFounderAwardsWeb2,
	transferLeagueOwnership as transferLeagueOwnershipWeb2,
	updateLeague as updateLeagueWeb2
} from '#lib/web2/client.ts';
import { getWeb2User } from '#lib/web2/session.ts';
import { isNullish, nonNullish } from '@dfinity/utils';
import { deleteDoc, getDoc, setDoc } from '@junobuild/core';
import type { PrincipalText } from '@junobuild/schema';
import { get } from 'svelte/store';

/**
 * Thin service layer wrapping the satellite's social-cohort
 * endpoints. UI screens import the camelCase domain types from
 * here so they never have to touch the generated wire schemas
 * from `juno functions build`.
 *
 * Writes go through `@junobuild/core`'s `setDoc` / `deleteDoc`;
 * reads go through the typed `functions.*` client. Both paths are
 * gated server-side by the asserts shipped in
 * through BE-5.
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

/** Project the satellite's camelCase wire league to the FE `LeagueDoc`. */
const projectLeagueWire = (league: {
	id: string;
	name: string;
	description?: string;
	inviteCode: string;
	owner: string;
	createdAtMs: number;
	accentColor?: string;
	emblem?: string;
	// The generated wire client surfaces the Candid variant as a plain
	// string union; coerce it back to the `LeaguePrivacy` enum below (the
	// runtime values are identical).
	privacy: `${LeaguePrivacy}`;
	imageUrl?: string;
}): LeagueDoc => ({
	id: league.id,
	name: league.name,
	description: league.description,
	inviteCode: league.inviteCode,
	owner: league.owner,
	createdAtMs: league.createdAtMs,
	accentColor: league.accentColor,
	emblem: league.emblem,
	privacy: league.privacy as LeaguePrivacy,
	imageUrl: league.imageUrl
});

/**
 * List every league the caller is a member of, paired with their
 * role. Sorted newest-join first per the satellite query.
 */
export const listMyLeagues = async (): Promise<LeagueWithRole[]> => {
	if (isWeb2Backend()) {
		return await listMyLeaguesWeb2();
	}

	const { items } = await functions.listMyLeagues();

	return items.map(({ league, role, joinedAtMs, memberCount }) => ({
		league: projectLeagueWire(league),
		role,
		joinedAtMs,
		memberCount
	}));
};

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
		// The web2 API also runs founder settlement from its worker; keeping the
		// lazy page-mount trigger preserves parity and is idempotent server-side.
		const { settled } = isWeb2Backend()
			? await settleFounderAwardsWeb2()
			: await functions.settleFounderAwards();

		return settled;
	} catch {
		return 0;
	}
};

/**
 * List the leagues the caller can challenge to a battle — the opponent
 * pool for the create-battle picker. Publicly listed (Open) leagues plus
 * the caller's own memberships, minus leagues the caller owns. Sorted
 * alphabetically by name per the satellite query.
 */
export const listChallengeableLeagues = async (): Promise<LeagueDoc[]> => {
	if (isWeb2Backend()) {
		return await listChallengeableLeaguesWeb2();
	}

	const { items } = await functions.listChallengeableLeagues();

	return items.map(projectLeagueWire);
};

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
 * but the caller is not — the "Friends are in" recommendations row at the
 * foot of the Leagues list. Private leagues are never surfaced. Sorted by
 * friend-overlap count descending per the satellite query.
 */
export const listFriendRecommendedLeagues = async (): Promise<FriendRecommendedLeague[]> => {
	if (isWeb2Backend()) {
		return await listFriendRecommendedLeaguesWeb2();
	}

	const { items } = await functions.listFriendRecommendedLeagues();

	return items.map(({ league, memberCount, friendMembers }) => ({
		league: projectLeagueWire(league),
		memberCount,
		friendMembers
	}));
};

/**
 * List the full member roster of a league, projected to the
 * camelCase `LeagueMemberDoc` the FE uses everywhere. Powers the
 * transfer-ownership picker (in the league detail surface and the
 * delete-account flow) where the caller needs the other members to
 * hand a league off to.
 */
export const listLeagueMembers = async ({
	leagueId
}: {
	leagueId: string;
}): Promise<LeagueMemberDoc[]> => {
	if (isWeb2Backend()) {
		return await listLeagueMembersWeb2(leagueId);
	}

	const { items } = await functions.listLeagueMembers({ leagueId });

	return items.map(({ leagueId, member, joinedAtMs, role }) => ({
		leagueId,
		member,
		joinedAtMs,
		role
	}));
};

/**
 * Resolve a 6-char invite code to its league, or `undefined` if no
 * league carries that code. Callers should treat the undefined
 * branch as "invalid code" UX, not an error.
 */
export const lookupLeagueByInvite = async ({
	inviteCode
}: {
	inviteCode: string;
}): Promise<LeagueDoc | undefined> => {
	if (isWeb2Backend()) {
		return await lookupLeagueByInviteWeb2(inviteCode);
	}

	const { league } = await functions.lookupLeagueByInvite({ inviteCode });

	if (!league) {
		return;
	}

	return projectLeagueWire(league);
};

/**
 * Read a league by id from the public `leagues` collection, or
 * `undefined` if none exists. Reads the datastore doc directly (it's
 * stored as a `LeagueDoc`, so no wire projection) rather than via a
 * typed query like `lookupLeagueByInvite`. Default-backend only: the
 * HTTP API has no public by-id league read, so the web2 branch of
 * {@link loadLeaguesByIds} resolves the directory without this helper.
 */
export const getLeagueById = async ({ id }: { id: string }): Promise<LeagueDoc | undefined> => {
	const existing = await getDoc<LeagueDoc>({
		collection: Collection.LEAGUES,
		key: id
	});

	return existing?.data;
};

/**
 * Hydrate `leagueDirectoryStore` for any uncached ids — call it from any
 * surface that names a counterpart league. Mirrors
 * `loadProfilesByPrincipals`: per-id failures are swallowed (UI falls
 * back to a shortened id) and fetches run in bounded batches so a large
 * caller can't saturate the browser's connection pool.
 */
const LEAGUE_HYDRATION_CONCURRENCY = 25;

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
	if (isWeb2Backend()) {
		try {
			const [mine, challengeable] = await Promise.all([
				listMyLeaguesWeb2(),
				listChallengeableLeaguesWeb2()
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

		return;
	}

	const docs: (LeagueDoc | undefined)[] = [];

	for (let start = 0; start < unique.length; start += LEAGUE_HYDRATION_CONCURRENCY) {
		const batch = unique.slice(start, start + LEAGUE_HYDRATION_CONCURRENCY);

		// Batches run sequentially to cap concurrency; within a batch the
		// per-id fetches are parallel.
		const settled = await Promise.all(
			batch.map((id) => getLeagueById({ id }).catch(() => undefined))
		);

		docs.push(...settled);
	}

	leagueDirectoryStore.update((current) => {
		const next = new Map(current);

		for (let i = 0; i < unique.length; i++) {
			const doc = docs[i];

			if (doc) {
				next.set(unique[i], doc);
			}
		}

		return next;
	});
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
export const deriveLeagueId = ({
	name,
	suffix
}: {
	name: string;
	suffix: number | string;
}): string => {
	const slug = name
		.toLowerCase()
		.replace(/[^a-z0-9]+/g, '-')
		.replace(/^-+|-+$/g, '')
		.slice(0, 24);

	return `${slug || 'league'}-${suffix}`;
};

/**
 * Generate a fresh 6-char `[A-Z0-9]` invite code via the platform
 * crypto. Matches `LEAGUE_INVITE_CODE_REGEX` from `#lib/types/league.ts`
 * so the satellite assert accepts it on first write.
 */
export const generateInviteCode = (): string => {
	const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
	const buf = new Uint8Array(6);
	crypto.getRandomValues(buf);

	let code = '';

	for (const byte of buf) {
		code += alphabet[byte % alphabet.length];
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
	privacy = LeaguePrivacy.OPEN,
	inviteCode
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
	 *  default — new leagues are publicly listed and battle-eligible);
	 *  persisted on the league doc and surfaced as the detail header's
	 *  privacy chip. */
	privacy?: LeaguePrivacy;
	/** Pre-generated 6-char invite code. The create sheet surfaces the
	 *  code to the owner before submit (so they can share it), so it
	 *  passes the same value here to keep the displayed and persisted
	 *  codes identical. Omitted callers get a fresh code generated here.
	 *  Re-validated against {@link LEAGUE_INVITE_CODE_REGEX} either way. */
	inviteCode?: string;
}): Promise<LeagueDoc> => {
	const validation = validateLeagueDraft({ name, description });

	if (!validation.ok) {
		throw new Error(`Invalid league draft: ${validation.reason}`);
	}

	// The API mints the invite code server-side and creates the owner
	// membership in the same transaction, so the code the create sheet
	// pre-generated for display is superseded by the one on the returned
	// league (the detail surface renders the stored code everywhere).
	if (isWeb2Backend()) {
		return await createLeagueWeb2({
			id: deriveLeagueId({ name, suffix: Date.now() }),
			name,
			description,
			accentColor,
			emblem,
			privacy
		});
	}

	const identity = await safeGetIdentityOnce();
	const ownerPrincipal = identity.getPrincipal().toText();
	const createdAtMs = Date.now();
	const leagueId = deriveLeagueId({ name, suffix: createdAtMs });
	const resolvedInviteCode = inviteCode ?? generateInviteCode();

	if (!LEAGUE_INVITE_CODE_REGEX.test(resolvedInviteCode)) {
		// `generateInviteCode` is built to satisfy the regex; this
		// branch is here so a future change to either side trips the
		// FE error path instead of failing on the satellite assert.
		throw new Error('Generated invite code is malformed.');
	}

	const league: LeagueDoc = {
		id: leagueId,
		name,
		description,
		inviteCode: resolvedInviteCode,
		owner: ownerPrincipal,
		createdAtMs,
		accentColor,
		emblem,
		privacy
	};

	await setDoc<LeagueDoc>({
		collection: Collection.LEAGUES,
		doc: {
			key: leagueId,
			data: league
		}
	});

	const ownerMembership: LeagueMemberDoc = {
		leagueId,
		member: ownerPrincipal,
		joinedAtMs: createdAtMs,
		role: 'owner'
	};

	await setDoc<LeagueMemberDoc>({
		collection: Collection.LEAGUE_MEMBERS,
		doc: {
			key: leagueMemberKey({ leagueId, memberPrincipal: ownerPrincipal }),
			data: ownerMembership
		}
	});

	return league;
};

/**
 * Edit an owner-mutable league field. Only the current owner can call
 * this; the satellite assert hard-rejects anyone else. On the edit path
 * `id`, `createdAtMs`, `inviteCode`, and `emblem` stay frozen — `name`,
 * `privacy`, and `imageUrl` are the mutable fields.
 *
 * Pass `name` to rename (trimmed + re-validated against the same 3–40
 * char window the create flow enforces; an invalid name throws before
 * any write). Pass `privacy` to change the league's visibility (any of
 * the three variants; the assert range-checks it). Pass `imageUrl` to
 * set or change the cover image, or `''` to clear it (the field is
 * dropped from the doc so a cover-less league carries an absent field,
 * matching the assert's non-empty rule). Omitting a field leaves it
 * untouched.
 *
 * Re-reads the existing doc so we round-trip the server's `version`
 * token — Juno's optimistic-concurrency guard rejects an update that
 * omits it — and so unchanged fields are carried over verbatim. Returns
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
	if (isWeb2Backend()) {
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
		const league = await updateLeagueWeb2({
			leagueId: id,
			...(nonNullish(trimmedName) ? { name: trimmedName } : {}),
			...(nonNullish(privacy) ? { privacy } : {})
		});

		// An explicit `null` clears, `undefined` leaves as-is; the typeof check
		// tells them apart without a bare null compare.
		const clearImage =
			(isNullish(imageUrl) && typeof imageUrl !== 'undefined') ||
			(nonNullish(imageUrl) && imageUrl.trim().length === 0);

		return clearImage ? await deleteLeagueImageWeb2(id) : league;
	}

	const existing = await getDoc<LeagueDoc>({
		collection: Collection.LEAGUES,
		key: id
	});

	if (!existing) {
		throw new Error('League no longer exists.');
	}

	const next: LeagueDoc = { ...existing.data };

	if (nonNullish(name)) {
		const trimmedName = name.trim();

		const validation = validateLeagueDraft({ name: trimmedName });

		if (!validation.ok) {
			throw new Error(`Invalid league name: ${validation.reason}`);
		}

		next.name = trimmedName;
	}

	if (nonNullish(privacy)) {
		next.privacy = privacy;
	}

	if (nonNullish(imageUrl)) {
		const trimmedImageUrl = imageUrl.trim();

		if (trimmedImageUrl.length === 0) {
			delete next.imageUrl;
		} else {
			// Persist the trimmed value so the stored shape matches the assert's
			// no-surrounding-whitespace rule.
			next.imageUrl = trimmedImageUrl;
		}
	}

	await setDoc<LeagueDoc>({
		collection: Collection.LEAGUES,
		doc: {
			key: id,
			data: next,
			version: existing.version
		}
	});

	return next;
};

// Cache for the caller's own referral code — the same value for a given identity,
// so resolve it once and reuse across every league-share build. Keyed to the
// signed-in principal so an in-session account switch (sign-out → sign-in without
// a reload) never reuses the previous user's code. Only a positive result is
// cached; a missing code (not yet assigned / backfilled later) stays retryable.
let cachedReferral: { owner: PrincipalText; code: string } | undefined;

const resolveMyReferralCode = async (): Promise<string | undefined> => {
	// Referral codes are an unswapped satellite domain; until they ride the
	// HTTP API the web2 share link stays plain (no `?ref=`) instead of probing
	// the satellite from a session that holds no on-chain identity.
	if (isWeb2Backend()) {
		return;
	}

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
 * invite (auto-friendship on join, plus the new-user bonus for fresh sign-ups —
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
	const base = `${window.location.origin}/league/${inviteCode}`;
	const referralCode = await resolveMyReferralCode();

	if (nonNullish(referralCode) && REFERRAL_CODE_REGEX.test(referralCode)) {
		return { url: `${base}?ref=${referralCode}`, withReferral: true };
	}

	return { url: base, withReferral: false };
};

/**
 * Join a league via its 6-char invite code. Looks the league up,
 * then writes a `LeagueMemberDoc` for the caller. Returns the
 * resolved league so the caller can route into it.
 *
 * Throws if the code is malformed, unknown, or the caller is
 * already a member (the satellite assert rejects the second-write
 * branch).
 */
export const joinLeagueByInvite = async ({
	inviteCode
}: {
	inviteCode: string;
}): Promise<LeagueDoc> => {
	if (!LEAGUE_INVITE_CODE_REGEX.test(inviteCode)) {
		throw new Error('Invite code is malformed.');
	}

	const league = await lookupLeagueByInvite({ inviteCode });

	if (!league) {
		throw new Error('No league found for that invite code.');
	}

	// The API join is idempotent (re-joining returns the existing row), so the
	// already-a-member pre-check below is web3-only: it exists to pre-empt a
	// confusing satellite assert error, which this transport cannot produce.
	if (isWeb2Backend()) {
		await joinLeagueByInviteWeb2({ inviteCode });

		track({ name: 'league_joined', leagueId: league.id, source: 'invite' });

		return league;
	}

	const identity = await safeGetIdentityOnce();
	const memberPrincipal = identity.getPrincipal().toText();
	const joinedAtMs = Date.now();
	const key = leagueMemberKey({ leagueId: league.id, memberPrincipal });

	// If the caller is already a member, the assert would reject the
	// write with "identity fields immutable" on a stale joinedAtMs.
	// Pre-empt with a getDoc to surface a clearer error.
	const existing = await getDoc<LeagueMemberDoc>({
		collection: Collection.LEAGUE_MEMBERS,
		key
	});

	if (existing) {
		throw new Error('Already a member of this league.');
	}

	const membership: LeagueMemberDoc = {
		leagueId: league.id,
		member: memberPrincipal,
		joinedAtMs,
		role: 'member'
	};

	await setDoc<LeagueMemberDoc>({
		collection: Collection.LEAGUE_MEMBERS,
		doc: {
			key,
			data: membership
		}
	});

	track({ name: 'league_joined', leagueId: league.id, source: 'invite' });

	return league;
};

/**
 * Leave a league — deletes the caller's membership row. The
 * satellite assert rejects this for the owner principal, so
 * ownership transfer is a precondition. Callers should disable the
 * "Leave" CTA on owner rows.
 */
export const leaveLeague = async ({ leagueId }: { leagueId: string }): Promise<void> => {
	if (isWeb2Backend()) {
		const me = getWeb2User();

		if (isNullish(me)) {
			throw new Error('Not signed in.');
		}

		// Idempotent server-side: a missing row is a clean success, matching the
		// early-return below.
		await removeLeagueMemberWeb2({ leagueId, memberUserId: me.id });

		return;
	}

	const identity = await safeGetIdentityOnce();
	const memberPrincipal = identity.getPrincipal().toText();
	const key = leagueMemberKey({ leagueId, memberPrincipal });

	const existing = await getDoc<LeagueMemberDoc>({
		collection: Collection.LEAGUE_MEMBERS,
		key
	});

	if (!existing) {
		// Idempotent — no row to delete is success. Avoids racing
		// against an admin kick.
		return;
	}

	await deleteDoc<LeagueMemberDoc>({
		collection: Collection.LEAGUE_MEMBERS,
		doc: existing
	});
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
	// On the web2 backend the "principal" the roster carries is the account id,
	// which is exactly what the transfer route keys the new owner by.
	isWeb2Backend()
		? transferLeagueOwnershipWeb2({ leagueId, newOwnerUserId: newOwnerPrincipal })
		: functions.transferLeagueOwnership({ leagueId, newOwnerPrincipal });

/**
 * Set a member's role inside a league — the owner-driven promote
 * (`member → admin`) / demote (`admin → member`) control. Re-reads the
 * existing membership row to round-trip the server's `version` token and
 * to carry the immutable identity fields (`leagueId`, `member`,
 * `joinedAtMs`) verbatim, then writes back the same row with the new
 * `role`.
 *
 * Owner-gated server-side: the `league_members` assert rejects a
 * role-change write from any caller that isn't the league owner, so the
 * owner-only UI guard is a convenience, not the authority. `'owner'` is
 * never a target here — promotion only ever toggles `member ↔ admin`; the
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
	if (isWeb2Backend()) {
		await setLeagueMemberRoleWeb2({ leagueId, memberUserId: memberPrincipal, role });

		return;
	}

	const key = leagueMemberKey({ leagueId, memberPrincipal });

	const existing = await getDoc<LeagueMemberDoc>({
		collection: Collection.LEAGUE_MEMBERS,
		key
	});

	if (!existing) {
		throw new Error('Member is no longer in this league.');
	}

	const next: LeagueMemberDoc = { ...existing.data, role };

	await setDoc<LeagueMemberDoc>({
		collection: Collection.LEAGUE_MEMBERS,
		doc: {
			key,
			data: next,
			version: existing.version
		}
	});
};

// ─── Battles ───────────────────────────────────────────────────────────────

const projectBattleWire = (b: {
	id: string;
	kind: BattleDoc['kind'];
	sideA: string;
	sideB: string;
	proposer: string;
	state: BattleDoc['state'];
	kickoffMs: number;
	settleMs: number;
	respondByMs?: number;
	respondedAtMs?: number;
	scope?: string;
	wager?: number;
	trashTalk?: string;
	scoreA?: number;
	scoreB?: number;
	callsA?: number;
	callsB?: number;
	winner?: BattleDoc['winner'];
	resolvedAtMs?: number;
}): BattleDoc => ({
	id: b.id,
	kind: b.kind,
	sideA: b.sideA,
	sideB: b.sideB,
	proposer: b.proposer,
	state: b.state,
	kickoffMs: b.kickoffMs,
	settleMs: b.settleMs,
	respondByMs: b.respondByMs,
	respondedAtMs: b.respondedAtMs,
	// Re-narrow the loose wire string back to the typed union; drop
	// anything outside the closed scope set (legacy / unknown).
	scope: nonNullish(b.scope) && isBattleScope(b.scope) ? b.scope : undefined,
	wager: b.wager,
	trashTalk: b.trashTalk,
	scoreA: b.scoreA,
	scoreB: b.scoreB,
	callsA: b.callsA,
	callsB: b.callsB,
	winner: b.winner,
	resolvedAtMs: b.resolvedAtMs
});

/**
 * List every battle involving the given league — both sides scanned.
 * Projects the satellite's snake_case wire schema to camelCase
 * `BattleDoc` for the FE.
 */
export const listLeagueBattles = async ({
	leagueId
}: {
	leagueId: string;
}): Promise<BattleDoc[]> => {
	if (isWeb2Backend()) {
		return await listLeagueBattlesWeb2(leagueId);
	}

	const { items } = await functions.listLeagueBattles({ leagueId });

	return items.map(projectBattleWire);
};

/**
 * List every battle across every league the caller belongs to. Powers
 * the `/arena/battles` cross-league inbox. Sorted server-side by
 * `kickoffMs` ascending.
 */
export const listMyBattles = async (): Promise<BattleDoc[]> => {
	if (isWeb2Backend()) {
		return await listMyBattlesWeb2();
	}

	const { items } = await functions.listMyBattles();

	return items.map(projectBattleWire);
};

/**
 * Count of resolved battles the caller's side won, tallied
 * server-side — duels by principal match on the winning side, league
 * bouts by ownership of the winning league. Backs the profile's
 * `boutsWon` counter in the stats sync without paging the full battle
 * list.
 */
export const getMyBattleStats = async (): Promise<{ boutsWon: number }> =>
	isWeb2Backend() ? await getMyBattleStatsWeb2() : await functions.getMyBattleStats();

/**
 * Propose a new battle (kind='league'). Caller must own the `sideA`
 * league; the satellite assert hard-rejects otherwise. The opponent
 * (sideB) league doesn't need to exist on the satellite for the
 * proposal to land — accept goes through a separate assert pass
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
	wager,
	trashTalk
}: {
	sideA: string;
	sideB: string;
	durationMs: number;
	scope?: BattleScope;
	wager?: number;
	trashTalk?: string;
}): Promise<BattleDoc> => {
	if (!Number.isFinite(durationMs) || durationMs <= 0) {
		throw new Error('Battle duration must be a positive number of milliseconds.');
	}

	if (nonNullish(scope) && !isBattleScope(scope)) {
		throw new Error(`Invalid battle scope "${scope}".`);
	}

	if (
		nonNullish(wager) &&
		(!Number.isFinite(wager) || wager < BATTLE_WAGER_MIN || wager > BATTLE_WAGER_MAX)
	) {
		throw new Error(`Wager must be within [${BATTLE_WAGER_MIN}, ${BATTLE_WAGER_MAX}].`);
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
	if (isWeb2Backend()) {
		const now = Date.now();

		return await proposeBattleWeb2({
			id: crypto.randomUUID(),
			kind: 'league',
			sideA,
			sideB,
			kickoffMs: now,
			settleMs: now + durationMs,
			...(nonNullish(scope) && scope !== 'all' ? { scope } : {}),
			...(nonNullish(wager) && wager > BATTLE_WAGER_MIN ? { wager } : {}),
			...(nonNullish(trimmedTrashTalk) && trimmedTrashTalk.length > 0
				? { trashTalk: trimmedTrashTalk }
				: {})
		});
	}

	const identity = await safeGetIdentityOnce();
	const proposerPrincipal = identity.getPrincipal().toText();
	const now = Date.now();
	const battleId = `${sideA}--vs--${sideB}-${now.toString(36)}`;

	const battle: BattleDoc = {
		id: battleId,
		kind: 'league',
		sideA,
		sideB,
		proposer: proposerPrincipal,
		state: 'proposed',
		// Provisional window — reset to the accept moment on accept. Its
		// length is the chosen duration the accept preserves.
		kickoffMs: now,
		settleMs: now + durationMs,
		respondByMs: now + BATTLE_RESPOND_BY_MS,
		// Persist scope only when narrowed (omit the 'all' default so legacy
		// reads and the default render path stay identical).
		...(nonNullish(scope) && scope !== 'all' ? { scope } : {}),
		// Persist wager only when staked (omit a 0 wager).
		...(nonNullish(wager) && wager > BATTLE_WAGER_MIN ? { wager } : {}),
		// Persist trash-talk only when non-empty after trimming.
		...(nonNullish(trimmedTrashTalk) && trimmedTrashTalk.length > 0
			? { trashTalk: trimmedTrashTalk }
			: {})
	};

	await setDoc<BattleDoc>({
		collection: Collection.BATTLES,
		doc: { key: battleId, data: battle }
	});

	return battle;
};

/**
 * Read a league's `(calls, wins)` bucket for a battle scope from the
 * public `league_stats` doc. Missing doc / category → a zero bucket.
 */
const readLeagueStatsBucket = async ({
	leagueId,
	scope
}: {
	leagueId: string;
	scope: BattleScope;
}): Promise<{ calls: number; wins: number }> => {
	const doc = await getDoc<LeagueStatsDoc>({
		collection: Collection.LEAGUE_STATS,
		key: leagueStatsKey({ leagueId })
	});

	return leagueStatsBucket({ doc: doc?.data, scope });
};

/**
 * Battle state transitions — thin write helpers. The satellite assert
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
export const acceptBattle = async ({ battle }: { battle: BattleDoc }): Promise<BattleDoc> => {
	// The two accept shapes are separate routes: the league accept fuses the
	// kickoff and stamps baselines server-side, the duel accept just moves the
	// state. Same fused-vs-plain split as the doc writes below.
	if (isWeb2Backend()) {
		return battle.kind === 'league'
			? await acceptLeagueBattleWeb2(battle.id)
			: await acceptDuelWeb2(battle.id);
	}

	const existing = await getDoc<BattleDoc>({
		collection: Collection.BATTLES,
		key: battle.id
	});

	if (!existing) {
		throw new Error('Battle no longer exists.');
	}

	const current = existing.data;

	if (current.kind !== 'league') {
		const acceptedDuel: BattleDoc = { ...current, state: 'accepted' };

		await setDoc<BattleDoc>({
			collection: Collection.BATTLES,
			doc: { key: battle.id, data: acceptedDuel, version: existing.version }
		});

		return acceptedDuel;
	}

	const scope: BattleScope = current.scope ?? BATTLE_SCOPE_DEFAULT;
	const durationMs = current.settleMs - current.kickoffMs;
	const kickoffMs = Date.now();

	const next: BattleDoc = {
		...current,
		state: 'in_flight',
		kickoffMs,
		settleMs: kickoffMs + durationMs,
		respondedAtMs: kickoffMs,
		baselineA: await readLeagueStatsBucket({ leagueId: current.sideA, scope }),
		baselineB: await readLeagueStatsBucket({ leagueId: current.sideB, scope })
	};

	await setDoc<BattleDoc>({
		collection: Collection.BATTLES,
		doc: { key: battle.id, data: next, version: existing.version }
	});

	return next;
};

/**
 * Decline a battle proposal (`proposed → declined`). Only the challenged
 * side's owner can call this; the satellite assert hard-rejects anyone
 * else and any battle past `proposed`. `respondedAtMs` records when.
 */
export const declineBattle = async ({ battle }: { battle: BattleDoc }): Promise<BattleDoc> => {
	if (isWeb2Backend()) {
		return await declineBattleWeb2(battle.id);
	}

	const existing = await getDoc<BattleDoc>({
		collection: Collection.BATTLES,
		key: battle.id
	});

	if (!existing) {
		throw new Error('Battle no longer exists.');
	}

	if (existing.data.state !== 'proposed') {
		throw new Error('Only proposed battles can be declined.');
	}

	const next: BattleDoc = { ...existing.data, state: 'declined', respondedAtMs: Date.now() };

	await setDoc<BattleDoc>({
		collection: Collection.BATTLES,
		doc: { key: battle.id, data: next, version: existing.version }
	});

	return next;
};

/**
 * Lazily expire a `proposed` battle whose respond-by deadline has passed
 * (`proposed → expired`). Idempotent: a battle that is no longer
 * `proposed`, or not yet past its deadline, is returned unchanged with no
 * write. Mirrors the lazy auto-resolve path — Juno has no scheduler, so a
 * stale proposal is swept the first time a side owner reads it. Legacy
 * rows without `respondByMs` fall back to `kickoffMs`.
 */
export const maybeExpireBattle = async ({ battle }: { battle: BattleDoc }): Promise<BattleDoc> => {
	// Same lazy sweep over the HTTP transport: re-read, gate on state and the
	// respond-by deadline locally (so a fresh proposal never fires a doomed
	// write), then let the server apply the transition.
	if (isWeb2Backend()) {
		const current = await getBattleWeb2(battle.id);

		if (isNullish(current)) {
			return battle;
		}

		if (current.state !== 'proposed' || Date.now() < (current.respondByMs ?? current.kickoffMs)) {
			return current;
		}

		return await expireBattleWeb2(battle.id);
	}

	const existing = await getDoc<BattleDoc>({
		collection: Collection.BATTLES,
		key: battle.id
	});

	if (!existing) {
		return battle;
	}

	const current = existing.data;

	if (current.state !== 'proposed') {
		return current;
	}

	const respondByMs = current.respondByMs ?? current.kickoffMs;

	if (Date.now() < respondByMs) {
		return current;
	}

	const next: BattleDoc = { ...current, state: 'expired' };

	await setDoc<BattleDoc>({
		collection: Collection.BATTLES,
		doc: { key: battle.id, data: next, version: existing.version }
	});

	return next;
};

/**
 * Kick a battle off (`accepted → in_flight`). For league battles this
 * stamps each side's current `league_stats` bucket as the baseline the
 * window delta is measured against; the satellite assert re-reads
 * `league_stats` and rejects a baseline that doesn't match. The next
 * doc is built from the freshly-read raw doc so no field is lost to a
 * stale wire projection.
 */
export const kickoffBattle = async ({ battle }: { battle: BattleDoc }): Promise<BattleDoc> => {
	if (isWeb2Backend()) {
		return await kickoffBattleWeb2(battle.id);
	}

	const existing = await getDoc<BattleDoc>({
		collection: Collection.BATTLES,
		key: battle.id
	});

	if (!existing) {
		throw new Error('Battle no longer exists.');
	}

	const current = existing.data;
	const scope: BattleScope = current.scope ?? BATTLE_SCOPE_DEFAULT;

	const next: BattleDoc =
		current.kind === 'league'
			? {
					...current,
					state: 'in_flight',
					baselineA: await readLeagueStatsBucket({ leagueId: current.sideA, scope }),
					baselineB: await readLeagueStatsBucket({ leagueId: current.sideB, scope })
				}
			: { ...current, state: 'in_flight' };

	await setDoc<BattleDoc>({
		collection: Collection.BATTLES,
		doc: { key: battle.id, data: next, version: existing.version }
	});

	return next;
};

/**
 * Retract a `proposed`-state battle. Only the original proposer can
 * call this; the satellite assert hard-rejects anyone else and any
 * battle past `proposed`.
 */
export const retractBattle = async ({ battle }: { battle: BattleDoc }): Promise<void> => {
	if (battle.state !== 'proposed') {
		throw new Error('Only proposed battles can be retracted.');
	}

	if (isWeb2Backend()) {
		await retractBattleWeb2(battle.id);

		return;
	}

	const existing = await getDoc<BattleDoc>({
		collection: Collection.BATTLES,
		key: battle.id
	});

	if (!existing) {
		throw new Error('Battle no longer exists.');
	}

	await deleteDoc<BattleDoc>({
		collection: Collection.BATTLES,
		doc: {
			key: battle.id,
			data: existing.data,
			version: existing.version
		}
	});
};

/**
 * Resolve a settled league battle (`in_flight → resolved`). Delegates to the
 * satellite `resolveBattle` endpoint, which derives each side's accuracy from
 * the clearing canister's settlement history over the battle window (scoped to
 * the battle's market category) and writes the resolved doc as a controller —
 * a client cannot forge a result. Idempotent server-side: an already-resolved
 * battle is returned unchanged. A legacy row that never got a kickoff baseline
 * resolves fine, since resolution no longer reads baselines.
 */
export const resolveBattle = async ({ battle }: { battle: BattleDoc }): Promise<BattleDoc> => {
	if (isWeb2Backend()) {
		return await resolveBattleWeb2(battle.id);
	}

	const { battle: resolved } = await functions.resolveBattle({ battleId: battle.id });

	return projectBattleWire(resolved);
};

/** Running standings for an in-flight battle, before it resolves. */
export interface BattleLiveScore {
	/** Side A accuracy (0–100) over the window so far. */
	scoreA: number;
	/** Side B accuracy (0–100) over the window so far. */
	scoreB: number;
	/** Side A window call count so far — the accuracy tie-break. */
	callsA: number;
	/** Side B window call count so far. */
	callsB: number;
	/** Who's ahead right now, by the same rule resolution uses. */
	leader: BattleWinner;
}

/**
 * Project the **current** standings of an in-flight league battle —
 * "who's winning" while the window is still open. Delegates to the satellite
 * `readBattleLiveScore` endpoint, which runs the identical clearing-settlement
 * accuracy arithmetic as {@link resolveBattle} over `[kickoff, now)`, strictly
 * read-only.
 *
 * Returns `null` for anything that can't be scored live — a duel, a
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

	if (isWeb2Backend()) {
		return (await readBattleLiveScoreWeb2(battle.id)) ?? null;
	}

	const { score } = await functions.readBattleLiveScore({ battleId: battle.id });

	return score ?? null;
};
