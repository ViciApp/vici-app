import { LeaguePrivacy } from '#lib/enums/league.ts';
import { ProfileVisibility } from '#lib/enums/profile.ts';
import { RelationCategory, RelationState } from '#lib/enums/relation.ts';
import { UserRole } from '#lib/enums/user.ts';
import type { MarketTranslation } from '#lib/types/market-translation.ts';
import type { UserProfile } from '#lib/types/profile.ts';
import type { ReferralListItem } from '#lib/types/referral.ts';
import type { VxpMilestoneState } from '#lib/types/vxp-onboarding.ts';
import { visibilityFromProfile } from '#lib/utils/visibility.utils.ts';
import { j, PrincipalTextSchema } from '@junobuild/schema';

/**
 * Wire-format schemas + converters for Sputnik typed queries.
 *
 * Since junobuild/juno-js#895 + the juno#2814 macro fix (juno ≥ `v0.0.78`,
 * CLI ≥ 0.15.6), the codegen emits `#[json_data(nested)]` for
 * `Vec<NestedStruct>` as well as `Option<…>`, so **both** serialise nested
 * structs in camelCase on the wire. These schemas therefore use camelCase keys
 * matching the app-side domain types, identically for `j.array(...)` and
 * `j.optional(...)` results: no more snake_case parallel schemas. The
 * `toWire…` converters just project the domain shape (defaults / enum
 * normalisation); `fromWire…` re-narrows loose wire string unions back to the
 * app enums.
 *
 * Requires juno CLI ≥ 0.15.6 to build/deploy: older toolchains expect
 * snake_case for `Vec` results and will trap at runtime.
 */

// ─── UserProfile wire format ─────────────────────────────────────────────

export const UserProfileWireSchema = j.strictObject({
	owner: PrincipalTextSchema,
	nickname: j.string().default(''),
	avatar: j.string().default(''),
	// Serialized faceted-avatar picks (compact JSON string): carried so
	// every surface renders the owner's saved face, not a principal-seeded
	// fallback. Empty = never customised.
	avatarParts: j.string().default(''),
	pnl: j.number().default(0),
	visibility: j.enum(ProfileVisibility).default(ProfileVisibility.FRIENDS_ONLY),
	role: j.enum(UserRole).optional(),
	totalTrades: j.number().default(0),
	winRate: j.number().default(0),
	dailyStreak: j.number().default(0),
	streak: j.number().default(0),
	accuracy: j.number().default(0),
	points: j.number().default(0),
	level: j.number().default(1),
	archetype: j.string().default(''),
	interests: j.array(j.string()).default([]),
	lastActiveDay: j.string().optional(),
	unlockedAchievements: j.array(j.string()).default([]),
	contrarianWins: j.number().default(0),
	preferences: j
		.strictObject({
			defaultAmount: j
				.strictObject({
					flow: j.string().default('0'),
					manual: j.string().default('0')
				})
				.default({ flow: '0', manual: '0' })
		})
		.optional()
});

export type WireUserProfile = j.infer<typeof UserProfileWireSchema>;

// Local TS shape this converter accepts: exactly mirrors UserProfile from
// `src/lib/types/profile.ts`. Kept inline (instead of importing UserProfile)
// so a future divergence of either shape doesn't silently break the wire.
interface AppProfileLike {
	owner: string;
	nickname?: string;
	avatar?: string;
	avatarParts?: string;
	pnl?: number;
	visibility: WireUserProfile['visibility'];
	role?: WireUserProfile['role'];
	totalTrades?: number;
	winRate?: number;
	dailyStreak?: number;
	streak?: number;
	accuracy?: number;
	points?: number;
	level?: number;
	archetype?: string;
	interests?: string[];
	lastActiveDay?: string;
	unlockedAchievements?: string[];
	contrarianWins?: number;
	preferences?: { defaultAmount?: { flow?: string; manual?: string } };
}

export const toWireProfile = (profile: AppProfileLike): WireUserProfile => ({
	owner: profile.owner,
	nickname: profile.nickname ?? '',
	avatar: profile.avatar ?? '',
	avatarParts: profile.avatarParts ?? '',
	pnl: profile.pnl ?? 0,
	visibility: profile.visibility,
	role: profile.role,
	totalTrades: profile.totalTrades ?? 0,
	winRate: profile.winRate ?? 0,
	dailyStreak: profile.dailyStreak ?? 0,
	streak: profile.streak ?? 0,
	accuracy: profile.accuracy ?? 0,
	points: profile.points ?? 0,
	level: profile.level ?? 1,
	archetype: profile.archetype ?? '',
	interests: profile.interests ?? [],
	lastActiveDay: profile.lastActiveDay,
	unlockedAchievements: profile.unlockedAchievements ?? [],
	contrarianWins: profile.contrarianWins ?? 0,
	preferences: profile.preferences
		? {
				defaultAmount: {
					flow: profile.preferences.defaultAmount?.flow ?? '0',
					manual: profile.preferences.defaultAmount?.manual ?? '0'
				}
			}
		: undefined
});

/**
 * Wire-format profile as produced by the generated satellite API client
 * (`src/declarations/satellite/satellite.api.ts`). The codegen emits
 * `visibility` / `role` as string-literal unions rather than as the
 * `ProfileVisibility` / `UserRole` enum types used by {@link UserProfileWireSchema},
 * even though the runtime strings are identical. We mirror that exact
 * structural shape here so {@link fromWireProfile} can consume both the
 * generated-API output and any in-process value that satisfies
 * {@link WireUserProfile}.
 */
export interface ApiWireProfile {
	owner: string;
	nickname: string;
	avatar: string;
	avatarParts: string;
	pnl: number;
	visibility: `${ProfileVisibility}`;
	role?: `${UserRole}`;
	totalTrades: number;
	winRate: number;
	dailyStreak: number;
	streak: number;
	accuracy: number;
	points: number;
	level: number;
	archetype: string;
	interests: string[];
	lastActiveDay?: string;
	unlockedAchievements: string[];
	contrarianWins: number;
	preferences?: {
		defaultAmount: { flow: string; manual: string };
	};
}

/**
 * Inverse of {@link toWireProfile}. Re-camelCases a row coming back from a
 * satellite query whose `result` schema uses {@link UserProfileWireSchema}
 * (i.e. every `j.array(UserProfileWireSchema)` endpoint:
 * `listLeaderboard`, `searchProfiles`, …). Frontend callers should funnel
 * wire items through this before handing them to UI / stores typed as
 * {@link UserProfile}.
 */
export const fromWireProfile = (profile: ApiWireProfile): UserProfile => ({
	owner: profile.owner,
	nickname: profile.nickname,
	avatar: profile.avatar,
	avatarParts: profile.avatarParts,
	pnl: profile.pnl,
	visibility: profile.visibility as ProfileVisibility,
	role: profile.role as UserRole | undefined,
	totalTrades: profile.totalTrades,
	winRate: profile.winRate,
	dailyStreak: profile.dailyStreak,
	// `longestStreak` / daily goal aren't carried on the leaderboard /
	// search wire (those surfaces don't read them), so default them like
	// the other non-wire fields below to keep the rebuilt UserProfile fully
	// shaped.
	longestStreak: 0,
	dailyGoalDone: 0,
	onFireStreak: 0,
	comebacks: 0,
	winningCategories: 0,
	leaguesJoined: 0,
	boutsWon: 0,
	leaguesFounded: 0,
	streak: profile.streak,
	accuracy: profile.accuracy,
	points: profile.points,
	level: profile.level,
	archetype: profile.archetype,
	interests: profile.interests,
	lastActiveDay: profile.lastActiveDay,
	unlockedAchievements: profile.unlockedAchievements,
	contrarianWins: profile.contrarianWins,
	// Top-decile streak state isn't carried on the leaderboard / search
	// wire (those surfaces don't read it), so default it like the other
	// non-wire fields below to keep the rebuilt UserProfile fully shaped.
	topDecileStreak: 0,
	// The wire format only carries `default_amount`: the leaderboard /
	// search endpoints don't read the user-experience preferences
	// (`notify`, `flowTags`, `savedMarketIds`, etc.), so they're not
	// round-tripped on this path. Default the rest to the schema's
	// initial values so the rebuilt UserProfile is fully shaped.
	preferences: {
		defaultAmount: {
			flow: profile.preferences?.defaultAmount?.flow ?? '0',
			manual: profile.preferences?.defaultAmount?.manual ?? '0'
		},
		notify: {
			streakReminder: true,
			marketAlerts: true,
			friendActivity: false,
			weeklyDigest: true
		},
		flowSessionLength: 10,
		hapticsEnabled: true,
		soundEnabled: true,
		sharing: {
			// Derive from the canonical top-level `visibility` so the settings
			// source-of-truth slice agrees with the real visibility on this
			// wire profile (FRIENDS_ONLY → 'private') instead of hard-coding it.
			profileVisibility: visibilityFromProfile(profile.visibility as ProfileVisibility),
			callsPublic: true,
			leaderboardOptIn: true,
			worldsOptIn: true
		},
		flowTags: [],
		worldCupMode: false,
		savedMarketIds: [],
		favoriteParticipantId: '',
		favoriteSide: '',
		onboardingCompleted: false
	}
});

// ─── Relation wire format ────────────────────────────────────────────────

export const RelationWireSchema = j.strictObject({
	category: j.enum(RelationCategory),
	state: j.enum(RelationState),
	participants: j.array(PrincipalTextSchema),
	viewerPrincipal: PrincipalTextSchema.optional(),
	viewerRole: j.enum(UserRole).optional(),
	isFriend: j.boolean().optional()
});

export type WireRelation = j.infer<typeof RelationWireSchema>;

interface AppRelationLike {
	category: WireRelation['category'];
	state: WireRelation['state'];
	participants: string[];
	viewerPrincipal?: string;
	viewerRole?: WireRelation['viewerRole'];
	isFriend?: boolean;
}

export const toWireRelation = (relation: AppRelationLike): WireRelation => ({
	category: relation.category,
	state: relation.state,
	participants: relation.participants,
	viewerPrincipal: relation.viewerPrincipal,
	viewerRole: relation.viewerRole,
	isFriend: relation.isFriend
});

// ─── MarketTranslation wire format ───────────────────────────────────────

export const OutcomeTranslationWireSchema = j.strictObject({
	id: j.string(),
	title: j.string()
});

export const MarketTranslationWireSchema = j.strictObject({
	seriesId: j.string(),
	locale: j.string(),
	title: j.string(),
	description: j.string(),
	resolution: j.string(),
	outcomes: j.array(OutcomeTranslationWireSchema).default([]),
	updatedAt: j.number(),
	updatedBy: PrincipalTextSchema
});

export type WireMarketTranslation = j.infer<typeof MarketTranslationWireSchema>;

interface AppMarketTranslationLike {
	seriesId: string;
	locale: string;
	title: string;
	description: string;
	resolution: string;
	outcomes?: { id: string; title: string }[];
	updatedAt: number;
	updatedBy: string;
}

export const toWireMarketTranslation = (
	translation: AppMarketTranslationLike
): WireMarketTranslation => ({
	seriesId: translation.seriesId,
	locale: translation.locale,
	title: translation.title,
	description: translation.description,
	resolution: translation.resolution,
	outcomes: translation.outcomes ?? [],
	updatedAt: translation.updatedAt,
	updatedBy: translation.updatedBy
});

/**
 * Inverse of {@link toWireMarketTranslation}. Used by frontend services
 * consuming `listMarketTranslations` (which returns
 * `j.array(MarketTranslationWireSchema)`) so the items land typed as
 * {@link MarketTranslation}.
 */
export const fromWireMarketTranslation = (
	translation: WireMarketTranslation
): MarketTranslation => ({
	seriesId: translation.seriesId,
	locale: translation.locale,
	title: translation.title,
	description: translation.description,
	resolution: translation.resolution,
	outcomes: translation.outcomes,
	updatedAt: translation.updatedAt,
	updatedBy: translation.updatedBy
});

// ─── Referral wire format ────────────────────────────────────────────────

const VxpMilestoneStateWireSchema = j.strictObject({
	status: j.enum(['none', 'owed', 'processing', 'paid']),
	amountBaseUnits: j.string(),
	blockIndex: j.string().optional(),
	lastError: j.string().optional()
});

export const ReferralWireSchema = j.strictObject({
	referee: PrincipalTextSchema,
	referrer: PrincipalTextSchema,
	code: j.string(),
	redeemedAtMs: j.number(),
	withinReferrerCap: j.boolean(),
	refereePayout: VxpMilestoneStateWireSchema,
	referrerPayout: VxpMilestoneStateWireSchema
});

export type WireReferral = j.infer<typeof ReferralWireSchema>;
export type WireVxpMilestoneState = j.infer<typeof VxpMilestoneStateWireSchema>;

const toWireMilestone = (state: VxpMilestoneState): WireVxpMilestoneState => ({
	status: state.status,
	amountBaseUnits: state.amountBaseUnits,
	blockIndex: state.blockIndex,
	lastError: state.lastError
});

export const toWireReferral = (referral: ReferralListItem): WireReferral => ({
	referee: referral.referee,
	referrer: referral.referrer,
	code: referral.code,
	redeemedAtMs: referral.redeemedAtMs,
	withinReferrerCap: referral.withinReferrerCap,
	refereePayout: toWireMilestone(referral.refereePayout),
	referrerPayout: toWireMilestone(referral.referrerPayout)
});

/**
 * Wire-format referral as produced by the generated satellite API client. Mirrors
 * {@link ReferralWireSchema} structurally but keeps `status` as a string-literal union
 * (matching the codegen output) so {@link fromWireReferral} accepts both in-process
 * {@link WireReferral} values and freshly-fetched API rows.
 */
export interface ApiWireReferral {
	referee: string;
	referrer: string;
	code: string;
	redeemedAtMs: number;
	withinReferrerCap: boolean;
	refereePayout: {
		status: 'none' | 'owed' | 'processing' | 'paid';
		amountBaseUnits: string;
		blockIndex?: string;
		lastError?: string;
	};
	referrerPayout: {
		status: 'none' | 'owed' | 'processing' | 'paid';
		amountBaseUnits: string;
		blockIndex?: string;
		lastError?: string;
	};
}

const fromWireMilestone = (state: ApiWireReferral['refereePayout']): VxpMilestoneState => ({
	status: state.status,
	amountBaseUnits: state.amountBaseUnits,
	blockIndex: state.blockIndex,
	lastError: state.lastError
});

/**
 * Inverse of {@link toWireReferral}. Frontend callers funnel `listMyReferrals` items
 * through this so the UI consumes camelCase {@link ReferralListItem} values.
 */
export const fromWireReferral = (referral: ApiWireReferral): ReferralListItem => ({
	version: 1,
	referee: referral.referee,
	referrer: referral.referrer,
	code: referral.code,
	redeemedAtMs: referral.redeemedAtMs,
	withinReferrerCap: referral.withinReferrerCap,
	refereePayout: fromWireMilestone(referral.refereePayout),
	referrerPayout: fromWireMilestone(referral.referrerPayout)
});

// ─── Leagues ────────────────────────────────────────────────────
// Wire schemas use snake_case per the juno codegen constraint on
// `Vec<NestedStruct>` (see UserProfileWireSchema header). FE callers
// hit `fromWireLeague` / `fromWireLeagueMember` to project back to
// the camelCase domain types.

export const LeagueWireSchema = j.strictObject({
	id: j.string(),
	name: j.string(),
	description: j.string().optional(),
	inviteCode: j.string(),
	owner: PrincipalTextSchema,
	createdAtMs: j.number(),
	accentColor: j.string().optional(),
	emblem: j.string().optional(),
	// Two-way visibility. `toWireLeague` always emits a concrete value
	// (mapping the legacy `private` boolean and the retired `'invite'`
	// tier to `private`, else `open`), so this default only guards a
	// genuinely absent field.
	privacy: j.enum(LeaguePrivacy).default(LeaguePrivacy.OPEN),
	imageUrl: j.string().optional()
});

export type WireLeague = j.infer<typeof LeagueWireSchema>;

export const LeagueWithRoleWireSchema = j.strictObject({
	league: LeagueWireSchema,
	role: j.enum(['owner', 'admin', 'member']),
	joinedAtMs: j.number(),
	memberCount: j.number().default(1)
});

export type WireLeagueWithRole = j.infer<typeof LeagueWithRoleWireSchema>;

export const LeagueMemberWireSchema = j.strictObject({
	leagueId: j.string(),
	member: PrincipalTextSchema,
	joinedAtMs: j.number(),
	role: j.enum(['owner', 'admin', 'member'])
});

export type WireLeagueMember = j.infer<typeof LeagueMemberWireSchema>;

export const toWireLeague = (league: {
	id: string;
	name: string;
	description?: string;
	inviteCode: string;
	owner: string;
	createdAtMs: number;
	accentColor?: string;
	emblem?: string;
	privacy?: LeaguePrivacy;
	/** Legacy boolean still carried by rows written before the typed
	 *  model; mapped to a concrete `privacy` below so an old private
	 *  league doesn't serialize as `open`. */
	private?: boolean;
	imageUrl?: string;
}): WireLeague => ({
	id: league.id,
	name: league.name,
	description: league.description,
	inviteCode: league.inviteCode,
	owner: league.owner,
	createdAtMs: league.createdAtMs,
	accentColor: league.accentColor,
	emblem: league.emblem,
	// Emit a concrete privacy on the wire, coercing legacy at-rest shapes
	// to the narrowed two-tier enum. Asserts only run on WRITE, so docs
	// persisted under the retired three-way model are still read here:
	// and once the Candid variant no longer contains `invite`, emitting it
	// would fail encoding and break league listing. So:
	//   - a stored `privacy === 'invite'` (retired invite-only tier; hidden
	//     from public lists) → `private` so it's never leaked as Open;
	//   - a legacy `private === true` boolean (code-gated + hidden) →
	//     `private`;
	//   - everything else → its stored value, or `open` (the old
	//     publicly-listed default) when truly absent.
	// Legacy invite docs thus encode validly as Private and self-heal to
	// `'private'` on their next write.
	privacy:
		(league.privacy as string | undefined) === 'invite'
			? LeaguePrivacy.PRIVATE
			: (league.privacy ?? (league.private === true ? LeaguePrivacy.PRIVATE : LeaguePrivacy.OPEN)),
	imageUrl: league.imageUrl
});

export const toWireLeagueWithRole = (entry: {
	league: Parameters<typeof toWireLeague>[0];
	role: 'owner' | 'admin' | 'member';
	joinedAtMs: number;
	memberCount: number;
}): WireLeagueWithRole => ({
	league: toWireLeague(entry.league),
	role: entry.role,
	joinedAtMs: entry.joinedAtMs,
	memberCount: entry.memberCount
});

export const FriendRecommendedLeagueWireSchema = j.strictObject({
	league: LeagueWireSchema,
	memberCount: j.number().default(1),
	friendMembers: j.array(PrincipalTextSchema)
});

export type WireFriendRecommendedLeague = j.infer<typeof FriendRecommendedLeagueWireSchema>;

export const toWireFriendRecommendedLeague = (entry: {
	league: Parameters<typeof toWireLeague>[0];
	memberCount: number;
	friendMembers: string[];
}): WireFriendRecommendedLeague => ({
	league: toWireLeague(entry.league),
	memberCount: entry.memberCount,
	friendMembers: entry.friendMembers
});

export const toWireLeagueMember = (member: {
	leagueId: string;
	member: string;
	joinedAtMs: number;
	role: 'owner' | 'admin' | 'member';
}): WireLeagueMember => ({
	leagueId: member.leagueId,
	member: member.member,
	joinedAtMs: member.joinedAtMs,
	role: member.role
});

// ─── Battles ──────────────────────────────────────────────────────

export const BattleWireSchema = j.strictObject({
	id: j.string(),
	kind: j.enum(['league', 'duel']),
	sideA: j.string(),
	sideB: j.string(),
	proposer: PrincipalTextSchema,
	state: j.enum(['proposed', 'accepted', 'in_flight', 'resolved', 'declined', 'expired']),
	kickoffMs: j.number(),
	settleMs: j.number(),
	// Deadline to accept before the proposal lapses to `expired`, and when
	// the challenged side responded (accept/decline). Both optional:
	// absent on legacy rows and on still-`proposed` battles respectively.
	respondByMs: j.number().optional(),
	respondedAtMs: j.number().optional(),
	// Scope is a loose string on the wire (not a j.enum) so legacy rows
	// without the field, and any future category tag, decode without a
	// migration. The FE re-narrows via `isBattleScope`.
	scope: j.string().optional(),
	wager: j.number().optional(),
	trashTalk: j.string().optional(),
	scoreA: j.number().optional(),
	scoreB: j.number().optional(),
	// Window call counts per side (`Δcalls`): let the FE tell a real
	// draw (tied accuracy) from a void face-off (both sides zero calls).
	callsA: j.number().optional(),
	callsB: j.number().optional(),
	winner: j.enum(['A', 'B', 'draw']).optional(),
	resolvedAtMs: j.number().optional()
});

export type WireBattle = j.infer<typeof BattleWireSchema>;

export const toWireBattle = (battle: {
	id: string;
	kind: 'league' | 'duel';
	sideA: string;
	sideB: string;
	proposer: string;
	state: 'proposed' | 'accepted' | 'in_flight' | 'resolved' | 'declined' | 'expired';
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
	winner?: 'A' | 'B' | 'draw';
	resolvedAtMs?: number;
}): WireBattle => ({
	id: battle.id,
	kind: battle.kind,
	sideA: battle.sideA,
	sideB: battle.sideB,
	proposer: battle.proposer,
	state: battle.state,
	kickoffMs: battle.kickoffMs,
	settleMs: battle.settleMs,
	respondByMs: battle.respondByMs,
	respondedAtMs: battle.respondedAtMs,
	scope: battle.scope,
	wager: battle.wager,
	trashTalk: battle.trashTalk,
	scoreA: battle.scoreA,
	scoreB: battle.scoreB,
	callsA: battle.callsA,
	callsB: battle.callsB,
	winner: battle.winner,
	resolvedAtMs: battle.resolvedAtMs
});

// ─── Affiliations ───────────────────────────────────────────────

// Wire shape for both `j.array(...)` (`listWorldsRoster`) and
// `j.optional(...)` (`listMyAffiliations`) endpoints: camelCase keys
// matching the in-memory `AffiliationDoc`, so optional handlers can
// return the projected doc directly without a `toWire` step.
export const AffiliationWireSchema = j.strictObject({
	member: PrincipalTextSchema,
	kind: j.enum(['university', 'country']),
	affiliationIdentifier: j.string(),
	joinedAtMs: j.number(),
	lockedUntilMs: j.number()
});

export type WireAffiliation = j.infer<typeof AffiliationWireSchema>;

export const toWireAffiliation = (aff: {
	member: string;
	kind: 'university' | 'country';
	affiliationIdentifier: string;
	joinedAtMs: number;
	lockedUntilMs: number;
}): WireAffiliation => ({
	member: aff.member,
	kind: aff.kind,
	affiliationIdentifier: aff.affiliationIdentifier,
	joinedAtMs: aff.joinedAtMs,
	lockedUntilMs: aff.lockedUntilMs
});

// ─── Affiliation stats ──────────────────────────────────────────────

// Wire shape for both `j.array(...)` (`listAffiliationStats`) and
// `j.optional(...)` (`getAffiliationStats`) endpoints.
export const AffiliationStatsWireSchema = j.strictObject({
	affiliationIdentifier: j.string(),
	kind: j.enum(['university', 'country']),
	totalCalls: j.number(),
	wins: j.number(),
	monthAnchor: j.string(),
	monthTotalCalls: j.number(),
	monthWins: j.number(),
	updatedAtMs: j.number()
});

export type WireAffiliationStats = j.infer<typeof AffiliationStatsWireSchema>;

export const toWireAffiliationStats = (stats: {
	affiliationIdentifier: string;
	kind: 'university' | 'country';
	totalCalls: number;
	wins: number;
	monthAnchor: string;
	monthTotalCalls: number;
	monthWins: number;
	updatedAtMs: number;
}): WireAffiliationStats => ({
	affiliationIdentifier: stats.affiliationIdentifier,
	kind: stats.kind,
	totalCalls: stats.totalCalls,
	wins: stats.wins,
	monthAnchor: stats.monthAnchor,
	monthTotalCalls: stats.monthTotalCalls,
	monthWins: stats.monthWins,
	updatedAtMs: stats.updatedAtMs
});

// Per-affiliation real member tally for the `j.array(...)`
// member-count endpoint.
export const AffiliationMemberCountWireSchema = j.strictObject({
	affiliationIdentifier: j.string(),
	kind: j.enum(['university', 'country']),
	memberCount: j.number()
});

export type WireAffiliationMemberCount = j.infer<typeof AffiliationMemberCountWireSchema>;

export const toWireAffiliationMemberCount = (count: {
	affiliationIdentifier: string;
	kind: 'university' | 'country';
	memberCount: number;
}): WireAffiliationMemberCount => ({
	affiliationIdentifier: count.affiliationIdentifier,
	kind: count.kind,
	memberCount: count.memberCount
});

// A past month an affiliation finished first in its kind, for the
// `j.array(...)` champion-history endpoint.
export const AffiliationChampionshipWireSchema = j.strictObject({
	monthAnchor: j.string(),
	accuracy: j.number(),
	monthTotalCalls: j.number()
});

export type WireAffiliationChampionship = j.infer<typeof AffiliationChampionshipWireSchema>;

export const toWireAffiliationChampionship = (cup: {
	monthAnchor: string;
	accuracy: number;
	monthTotalCalls: number;
}): WireAffiliationChampionship => ({
	monthAnchor: cup.monthAnchor,
	accuracy: cup.accuracy,
	monthTotalCalls: cup.monthTotalCalls
});

// ─── Tournament + matches ───────────────────────────────────────────

export const TournamentWireSchema = j.strictObject({
	id: j.string(),
	monthStartMs: j.number(),
	monthEndMs: j.number(),
	bracketSize: j.number(),
	state: j.enum(['in_flight', 'concluded']),
	seededLeagueIds: j.array(j.string()),
	createdAtMs: j.number()
});

export type WireTournament = j.infer<typeof TournamentWireSchema>;

export const toWireTournament = (doc: {
	id: string;
	monthStartMs: number;
	monthEndMs: number;
	bracketSize: number;
	state: 'in_flight' | 'concluded';
	seededLeagueIds: string[];
	createdAtMs: number;
}): WireTournament => ({
	id: doc.id,
	monthStartMs: doc.monthStartMs,
	monthEndMs: doc.monthEndMs,
	bracketSize: doc.bracketSize,
	state: doc.state,
	seededLeagueIds: doc.seededLeagueIds,
	createdAtMs: doc.createdAtMs
});

export const TournamentMatchWireSchema = j.strictObject({
	tournamentId: j.string(),
	round: j.enum(['r1', 'quarter', 'semifinal', 'final']),
	index: j.number(),
	fromLeagueId: j.optional(j.string()),
	toLeagueId: j.optional(j.string()),
	fromStartCalls: j.optional(j.number()),
	fromStartWins: j.optional(j.number()),
	toStartCalls: j.optional(j.number()),
	toStartWins: j.optional(j.number()),
	fromAcc: j.optional(j.number()),
	toAcc: j.optional(j.number()),
	winnerLeagueId: j.optional(j.string()),
	startMs: j.number(),
	endMs: j.number()
});

export type WireTournamentMatch = j.infer<typeof TournamentMatchWireSchema>;

export const toWireTournamentMatch = (doc: {
	tournamentId: string;
	round: 'r1' | 'quarter' | 'semifinal' | 'final';
	index: number;
	fromLeagueId: string | null;
	toLeagueId: string | null;
	fromStartCalls: number | null;
	fromStartWins: number | null;
	toStartCalls: number | null;
	toStartWins: number | null;
	fromAcc: number | null;
	toAcc: number | null;
	winnerLeagueId: string | null;
	startMs: number;
	endMs: number;
}): WireTournamentMatch => ({
	tournamentId: doc.tournamentId,
	round: doc.round,
	index: doc.index,
	fromLeagueId: doc.fromLeagueId ?? undefined,
	toLeagueId: doc.toLeagueId ?? undefined,
	fromStartCalls: doc.fromStartCalls ?? undefined,
	fromStartWins: doc.fromStartWins ?? undefined,
	toStartCalls: doc.toStartCalls ?? undefined,
	toStartWins: doc.toStartWins ?? undefined,
	fromAcc: doc.fromAcc ?? undefined,
	toAcc: doc.toAcc ?? undefined,
	winnerLeagueId: doc.winnerLeagueId ?? undefined,
	startMs: doc.startMs,
	endMs: doc.endMs
});

// ─── Monthly leaderboard wire format ─────────────────────────────────────
//
// `getMonthlyLeaderboard` returns a result with two arrays:
// `items` (sharpest-eye podium, IDL field `items`) and `boldCallers`
// (bold-caller winners, IDL field `bold_callers`). Both contain
// `Vec<NestedStruct>` values, so both need snake_case wire schemas per
// the `Vec<NestedStruct>` quirk above.

export const MonthlyLeaderboardEntryWireSchema = j.strictObject({
	owner: PrincipalTextSchema,
	monthCalls: j.number(),
	monthWins: j.number(),
	accuracy: j.number(),
	placement: j.number()
});

export type WireMonthlyLeaderboardEntry = j.infer<typeof MonthlyLeaderboardEntryWireSchema>;

export const toWireMonthlyLeaderboardEntry = (entry: {
	owner: string;
	monthCalls: number;
	monthWins: number;
	accuracy: number;
	placement: number;
}): WireMonthlyLeaderboardEntry => ({
	owner: entry.owner,
	monthCalls: entry.monthCalls,
	monthWins: entry.monthWins,
	accuracy: entry.accuracy,
	placement: entry.placement
});

export const BoldCallerEntryWireSchema = j.strictObject({
	owner: PrincipalTextSchema,
	monthCalls: j.number(),
	monthWins: j.number(),
	accuracy: j.number(),
	medianConsensus: j.number()
});

export type WireBoldCallerEntry = j.infer<typeof BoldCallerEntryWireSchema>;

export const toWireBoldCallerEntry = (entry: {
	owner: string;
	monthCalls: number;
	monthWins: number;
	accuracy: number;
	medianConsensus: number;
}): WireBoldCallerEntry => ({
	owner: entry.owner,
	monthCalls: entry.monthCalls,
	monthWins: entry.monthWins,
	accuracy: entry.accuracy,
	medianConsensus: entry.medianConsensus
});
