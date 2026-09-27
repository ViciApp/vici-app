import { Collection } from '$lib/constants/collections.constants';
import {
	AnalyticsSummarySchema,
	AnalyticsUserStatsSchema,
	DeleteAnalyticsEventsArgsSchema,
	DeleteAnalyticsEventsResultSchema,
	GetAnalyticsEventsArgsSchema,
	GetAnalyticsEventsResultSchema,
	GetAnalyticsProfileCreatedArgsSchema,
	GetAnalyticsProfileCreatedResultSchema,
	GetAnalyticsSummaryArgsSchema,
	TrackEventsArgsSchema,
	TrackEventsResultSchema
} from '$lib/schema/analytics-event.schema';
import {
	GetAuthIdentitiesArgsSchema,
	GetAuthIdentitiesResultSchema
} from '$lib/schema/auth-identity.schema';
import {
	GetMarketMetadataArgsSchema,
	GetMarketTagsResultSchema,
	MarketMetadataSchema,
	UpsertMarketMetadataArgsSchema
} from '$lib/schema/market-metadata.schema';
import {
	GetMarketTranslationArgsSchema,
	ListMarketTranslationsArgsSchema,
	ListMarketTranslationsForLocalesArgsSchema,
	MarketTranslationSchema,
	UpsertMarketTranslationArgsSchema
} from '$lib/schema/market-translation.schema';
import { UserProfileSchema } from '$lib/schema/profile.schema';
import {
	ClaimReferralFriendshipArgsSchema,
	LookupReferralCodeArgsSchema,
	RedeemReferralCodeArgsSchema,
	SettleReferralArgsSchema
} from '$lib/schema/referral.schema';
import { CheckFriendshipArgsSchema, FriendRequestOutcomeSchema } from '$lib/schema/relation.schema';
import {
	ListFriendResolvedResultsArgsSchema,
	ResolvedResultSchema
} from '$lib/schema/resolved-result.schema';
import {
	deleteMyAccountFn,
	hibernateMyAccountFn,
	listMyBlockingLeaguesFn,
	recoverMyAccountFn,
	resumeMyAccountFn,
	sweepExpiredDeletionsFn
} from '$satellite/services/account.services';
import {
	onActivityReactionDelete,
	onActivityReactionSet,
	recomputeActivityReactionCountsFn
} from '$satellite/services/activity-reaction-count.services';
import { assertSetActivityReaction } from '$satellite/services/activity-reaction.services';
import { assertSetActivity } from '$satellite/services/activity.services';
import { assertSetAffiliationStats } from '$satellite/services/affiliation-stats.services';
import {
	assertDeleteAffiliation,
	assertSetAffiliation,
	onAffiliationDeleteForAnalytics,
	onAffiliationSetForAnalytics
} from '$satellite/services/affiliation.services';
import {
	deleteAnalyticsEventsFn,
	getAnalyticsEventsFn,
	getAnalyticsProfileCreatedFn,
	getAnalyticsSummaryFn,
	getAnalyticsUserStatsFn,
	onVxpAwardSetForAnalytics,
	trackEventsFn
} from '$satellite/services/analytics.services';
import { getAuthIdentitiesFn } from '$satellite/services/auth-identity-export.services';
import {
	readBattleLiveScoreFn,
	resolveBattleFromSettlementsFn
} from '$satellite/services/battle-resolution.services';
import { assertDeleteBattle, assertSetBattle } from '$satellite/services/battle.services';
import {
	getAffiliationStatsFn,
	getMyBattleStatsFn,
	listAffiliationChampionshipsFn,
	listAffiliationStatsFn,
	listChallengeableLeaguesFn,
	listFriendRecommendedLeaguesFn,
	listLeagueBattlesFn,
	listLeagueMembersFn,
	listMyAffiliationsFn,
	listMyBattlesFn,
	listMyLeaguesFn,
	listWorldsMemberCountsFn,
	listWorldsRosterFn,
	lookupLeagueByInviteFn
} from '$satellite/services/cohort.services';
import {
	syncRoleToEngineOnDelete,
	syncRoleToEngineOnSet
} from '$satellite/services/engine-sync.services';
import { assertSetExitSignal } from '$satellite/services/exit-signal.services';
import {
	getMyRivalFn,
	getUserRankAndCountFn,
	listLeaderboard as listLeaderboardFn
} from '$satellite/services/leaderboard.services';
import {
	assertDeleteLeagueMember,
	assertSetLeagueMember
} from '$satellite/services/league-member.services';
import {
	assertSetLeagueStats,
	onProfileSetForLeagueStats,
	onUserStatsSetForLeagueStats
} from '$satellite/services/league-stats.services';
import { assertSetLeague, transferLeagueOwnershipFn } from '$satellite/services/league.services';
import {
	getMarketMetadata as getMarketMetadataFn,
	upsertMarketMetadata as upsertMarketMetadataFn
} from '$satellite/services/market-metadata.services';
import {
	getMarketTagsFn,
	rebuildMarketTagIndexFn
} from '$satellite/services/market-tag-index.services';
import {
	getMarketTranslation as getMarketTranslationFn,
	listMarketTranslations as listMarketTranslationsFn,
	listMarketTranslationsForLocales as listMarketTranslationsForLocalesFn,
	upsertMarketTranslation as upsertMarketTranslationFn
} from '$satellite/services/market-translation.services';
import { assertNewProfileAllowed } from '$satellite/services/new-profile-gate.services';
import { assertSetProfilePrivate } from '$satellite/services/profile-private.services';
import {
	assertDailyGoalMonotonic,
	assertValidNickname,
	checkNicknameAvailabilityFn,
	getProfile as getProfileFn,
	recordFlowSwipeFn,
	searchProfiles as searchProfilesFn
} from '$satellite/services/profile.services';
import {
	assertSetReferral,
	assertSetReferralCode,
	claimReferralFriendshipFn,
	getMyReferralCodeFn,
	listMyReferralsFn,
	lookupReferralCodeFn,
	onProfileSetForReferralCode,
	onReferralSetForVxpPayout,
	onTradeActivityForReferral,
	redeemReferralCodeFn,
	settleReferralFn
} from '$satellite/services/referral.services';
import {
	acceptFriendRequest as acceptFriendRequestFn,
	cancelFriendRequest as cancelFriendRequestFn,
	checkFriendship as checkFriendshipFn,
	followUser as followUserFn,
	listFollowers as listFollowersFn,
	listFollowing as listFollowingFn,
	listFriendRequests as listFriendRequestsFn,
	listFriends as listFriendsFn,
	listSentFriendRequests as listSentFriendRequestsFn,
	rejectFriendRequest as rejectFriendRequestFn,
	sendFriendRequest as sendFriendRequestFn
} from '$satellite/services/relation.services';
import {
	listFriendResolvedResultsFn,
	onActivitySetForResolvedResults,
	pruneResolvedResultsFn
} from '$satellite/services/resolved-results.services';
import { assertSetRole } from '$satellite/services/roles.services';
import { submitSchoolFn, verifySchoolCodeFn } from '$satellite/services/school.services';
import {
	assertSetTournament,
	assertSetTournamentMatch,
	claimTournamentPrizeFn,
	getCurrentTournamentFn,
	resolveTournamentRoundFn,
	triggerTournamentDrawFn
} from '$satellite/services/tournament.services';
import {
	assertSetUserMonthlyStats,
	getMonthlyLeaderboardFn
} from '$satellite/services/user-monthly-stats.services';
import { assertSetUserStats } from '$satellite/services/user-stats.services';
import { onProfileSetForAchievementAward } from '$satellite/services/vxp-achievement-awards.services';
import { assertSetVxpAward } from '$satellite/services/vxp-awards.services';
import { claimCalibrationRewardFn } from '$satellite/services/vxp-calibration.services';
import { onProfileSetForComebackRestore } from '$satellite/services/vxp-comeback-awards.services';
import { onProfileSetForFlowMilestone } from '$satellite/services/vxp-flow-awards.services';
import {
	onLeagueSetForFounderVxpPayout,
	settleFounderAwardsFn
} from '$satellite/services/vxp-league-founder-awards.services';
import {
	onProfileSetForVxpOnboarding,
	onTradeActivityForVxpOnboarding
} from '$satellite/services/vxp-onboarding.services';
import { onProfileSetForStreakAward } from '$satellite/services/vxp-streak-awards.services';
import { backfillStreakUnderpaymentsFn } from '$satellite/services/vxp-streak-backfill.services';
import { claimWorldsPodiumPrizeFn } from '$satellite/services/vxp-worlds-podium.services';
import {
	AffiliationChampionshipWireSchema,
	AffiliationMemberCountWireSchema,
	AffiliationStatsWireSchema,
	AffiliationWireSchema,
	BattleWireSchema,
	BoldCallerEntryWireSchema,
	FriendRecommendedLeagueWireSchema,
	LeagueMemberWireSchema,
	LeagueWireSchema,
	LeagueWithRoleWireSchema,
	MarketTranslationWireSchema,
	MonthlyLeaderboardEntryWireSchema,
	ReferralWireSchema,
	RelationWireSchema,
	TournamentMatchWireSchema,
	TournamentWireSchema,
	toWireAffiliation,
	toWireAffiliationChampionship,
	toWireAffiliationMemberCount,
	toWireAffiliationStats,
	toWireBattle,
	toWireBoldCallerEntry,
	toWireFriendRecommendedLeague,
	toWireLeague,
	toWireLeagueMember,
	toWireLeagueWithRole,
	toWireMarketTranslation,
	toWireMonthlyLeaderboardEntry,
	toWireProfile,
	toWireReferral,
	toWireRelation,
	toWireTournament,
	toWireTournamentMatch,
	UserProfileWireSchema
} from '$satellite/utils/wire-format.utils';
import { isNullish } from '@dfinity/utils';
import {
	defineAssert,
	defineHook,
	defineQuery,
	defineUpdate,
	type AssertDeleteDoc,
	type AssertDeleteDocContext,
	type AssertSetDoc,
	type AssertSetDocContext,
	type OnDeleteDoc,
	type OnDeleteDocContext,
	type OnSetDoc,
	type OnSetDocContext,
	type RunFunction
} from '@junobuild/functions';
import { j, PrincipalTextSchema } from '@junobuild/schema';

export const listLeaderboard = defineQuery({
	// camelCase wire schema: with CLI ≥ 0.15.6 the codegen applies
	// `#[json_data(nested)]` to `Vec<NestedStruct>` too, so array items
	// serialise camelCase like the app-side domain types. See
	// `src/satellite/utils/wire-format.utils.ts`.
	result: j.strictObject({
		items: j.array(UserProfileWireSchema)
	}),
	handler: () => ({
		items: listLeaderboardFn().map(toWireProfile)
	})
});

// Single-pass query that returns both the 1-based rank of `principalStr`
// and the total count of non-hidden (ranked) profiles. Replaces the
// former `countProfiles` + `getUserRank` pair, which each ran a full
// `rankedProfiles()` scan+sort and were always called together in
// `calculateAndSyncStats`, doubling the work.
//
// `rank` is omitted when the principal is unranked (no profile / hidden).
// `principal` is reserved by the schema layer; exposed as `principalStr`.
export const getUserRankAndCount = defineQuery({
	args: j.strictObject({
		principalStr: PrincipalTextSchema
	}),
	result: j.strictObject({
		rank: j.optional(j.number()),
		count: j.number()
	}),
	handler: ({ principalStr }) => getUserRankAndCountFn({ principal: principalStr })
});

// The caller's rival — the profile adjacent to them across the FULL
// ranking, not the top-50 slice `listLeaderboard` returns. Lets the
// dashboard "Your rival" insight resolve for every ranked user instead
// of only those in the visible top N. Usually the competitor one rank
// above; for rank 1 it's the runner-up below, flagged `rivalIsTrailing`
// so the FE frames the gap as a lead. `rival` is omitted only when the
// caller is unranked or the lone ranked profile.
//
// `j.optional(<Record>)` returns camelCase, so the handler returns the
// domain profile directly (no `toWireProfile`) — mirrors `getProfile`.
export const getMyRival = defineQuery({
	result: j.strictObject({
		rival: j.optional(UserProfileSchema),
		rivalIsTrailing: j.boolean()
	}),
	handler: () => getMyRivalFn()
});

export const getProfile = defineQuery({
	args: j.strictObject({
		// `principal` collides with @junobuild/schema's reserved name; rename on the wire.
		principalStr: PrincipalTextSchema
	}),
	result: j.strictObject({
		profile: j.optional(UserProfileSchema)
	}),
	handler: ({ principalStr }) => ({
		profile: getProfileFn(principalStr)
	})
});

export const searchProfiles = defineQuery({
	args: j.strictObject({
		// `query` collides with @junobuild/schema's reserved name; rename on the wire.
		queryStr: j.string()
	}),
	result: j.strictObject({
		items: j.array(UserProfileWireSchema)
	}),
	handler: ({ queryStr }) => ({
		items: searchProfilesFn(queryStr).map(toWireProfile)
	})
});

// Typed availability probe used by the onboarding handle field and the
// profile-edit form so the UI can render an inline "already taken" hint
// before attempting `setDoc`. The same validator backs `assertValidNickname`
// (write-time guard), so client and server agree on what "taken" means.
//
// `excludePrincipalStr` is the editing user's principal — passed so a user
// editing their own profile is not told their own nickname is taken.
// `principal` is reserved by the schema layer; we expose it as
// `excludePrincipalStr` and treat the empty string as "no exclusion".
export const checkNicknameAvailability = defineQuery({
	args: j.strictObject({
		nickname: j.string(),
		excludePrincipalStr: j.string()
	}),
	result: j.strictObject({
		available: j.boolean(),
		reason: j.optional(j.enum(['required', 'too_short', 'invalid', 'taken']))
	}),
	handler: ({ nickname, excludePrincipalStr }) => {
		const result = checkNicknameAvailabilityFn({
			nickname,
			excludeKey: excludePrincipalStr.length > 0 ? excludePrincipalStr : undefined
		});

		return result.available
			? { available: true as const }
			: { available: false as const, reason: result.reason };
	}
});

// Server-authoritative Flow daily-cap increment. Called once per committed
// Flow swipe. The client sends only its local-day key (`YYYY-MM-DD`, from
// `todayKey`) as the rollover boundary — never a count: the server reads the
// caller's profile, rolls over by `dayKey`, and writes the capped increment
// itself. The returned `dailyGoalDone` / `capReached` are the source of truth
// for the cross-session "come back tomorrow" takeover, so a cleared or
// signed-out client can no longer reset the cap. Backed by the monotonic
// PROFILES assert (`assertDailyGoalMonotonic`).
export const recordFlowSwipe = defineUpdate({
	args: j.strictObject({
		dayKey: j.string()
	}),
	result: j.strictObject({
		dailyGoalDone: j.number(),
		dailyGoalDate: j.string(),
		capReached: j.boolean()
	}),
	handler: async ({ dayKey }) => await recordFlowSwipeFn({ dayKey })
});

export const getMarketMetadata = defineQuery({
	args: GetMarketMetadataArgsSchema,
	result: j.strictObject({
		metadata: j.optional(MarketMetadataSchema)
	}),
	handler: (args) => ({
		metadata: getMarketMetadataFn(args)
	})
});

export const upsertMarketMetadata = defineUpdate({
	args: UpsertMarketMetadataArgsSchema,
	result: j.strictObject({
		metadata: MarketMetadataSchema
	}),
	handler: async (args) => ({
		metadata: await upsertMarketMetadataFn(args)
	})
});

export const getMarketTranslation = defineQuery({
	args: GetMarketTranslationArgsSchema,
	result: j.strictObject({
		translation: j.optional(MarketTranslationSchema)
	}),
	handler: (args) => ({
		translation: getMarketTranslationFn(args)
	})
});

export const listMarketTranslations = defineQuery({
	args: ListMarketTranslationsArgsSchema,
	result: j.strictObject({
		items: j.array(MarketTranslationWireSchema)
	}),
	handler: (args) => ({
		items: listMarketTranslationsFn(args).map(toWireMarketTranslation)
	})
});

// Bulk overlay read for the markets surfaces (list board, Flow deck): one
// query returns every stored translation doc across the visible series ids ×
// the reader's candidate locales, replacing N per-card per-series reads. The
// server returns raw matching docs; the FE resolves best-per-series with the
// shared `resolveMarketTranslation`.
export const listMarketTranslationsForLocales = defineQuery({
	args: ListMarketTranslationsForLocalesArgsSchema,
	result: j.strictObject({
		items: j.array(MarketTranslationWireSchema)
	}),
	handler: (args) => ({
		items: listMarketTranslationsForLocalesFn(args).map(toWireMarketTranslation)
	})
});

export const upsertMarketTranslation = defineUpdate({
	args: UpsertMarketTranslationArgsSchema,
	result: j.strictObject({
		translation: MarketTranslationSchema
	}),
	handler: async (args) => ({
		translation: await upsertMarketTranslationFn(args)
	})
});

export const listFriends = defineQuery({
	result: j.strictObject({
		items: j.array(RelationWireSchema)
	}),
	handler: () => ({ items: listFriendsFn().map(toWireRelation) })
});

export const listFollowers = defineQuery({
	result: j.strictObject({
		items: j.array(RelationWireSchema)
	}),
	handler: () => ({ items: listFollowersFn().map(toWireRelation) })
});

export const listFollowing = defineQuery({
	result: j.strictObject({
		items: j.array(RelationWireSchema)
	}),
	handler: () => ({ items: listFollowingFn().map(toWireRelation) })
});

export const checkFriendship = defineQuery({
	args: CheckFriendshipArgsSchema,
	result: j.strictObject({
		isFriend: j.boolean()
	}),
	handler: (args) => ({ isFriend: checkFriendshipFn(args) })
});

export const listFriendRequests = defineQuery({
	result: j.strictObject({
		items: j.array(RelationWireSchema)
	}),
	handler: () => ({
		items: listFriendRequestsFn().map(toWireRelation)
	})
});

export const listSentFriendRequests = defineQuery({
	result: j.strictObject({
		items: j.array(RelationWireSchema)
	}),
	handler: () => ({
		items: listSentFriendRequestsFn().map(toWireRelation)
	})
});

export const sendFriendRequest = defineUpdate({
	args: j.strictObject({
		target: PrincipalTextSchema
	}),
	result: FriendRequestOutcomeSchema,
	handler: sendFriendRequestFn
});

export const acceptFriendRequest = defineUpdate({
	args: j.strictObject({
		relationId: j.string()
	}),
	handler: acceptFriendRequestFn
});

export const rejectFriendRequest = defineUpdate({
	args: j.strictObject({
		relationId: j.string()
	}),
	handler: rejectFriendRequestFn
});

export const cancelFriendRequest = defineUpdate({
	args: j.strictObject({
		relationId: j.string()
	}),
	handler: cancelFriendRequestFn
});

export const followUser = defineUpdate({
	args: j.strictObject({
		target: PrincipalTextSchema
	}),
	handler: followUserFn
});

// ─── Referrals ───────────────────────────────────────────────────────────

export const getMyReferralCode = defineQuery({
	result: j.strictObject({
		code: j.string().optional()
	}),
	handler: getMyReferralCodeFn
});

export const lookupReferralCode = defineQuery({
	args: LookupReferralCodeArgsSchema,
	result: j.strictObject({
		owner: PrincipalTextSchema.optional()
	}),
	handler: lookupReferralCodeFn
});

export const listMyReferrals = defineQuery({
	result: j.strictObject({
		items: j.array(ReferralWireSchema)
	}),
	handler: () => ({ items: listMyReferralsFn().map(toWireReferral) })
});

export const redeemReferralCode = defineUpdate({
	args: RedeemReferralCodeArgsSchema,
	// Synchronous: redeeming only records the `owed` referral row + friendship. The VXP bonus is
	// deferred to the referee's first prediction (driven by the `activities` hook), so there's no
	// inline async transfer here.
	handler: redeemReferralCodeFn
});

/**
 * Settles — or retries — the VXP payout for a referral row, keyed by the referee principal. The
 * bonus is normally driven by the referred user's first prediction (the `activities` hook); this
 * endpoint exists so a payout that failed (or whose triggering activity hook didn't complete) can
 * be driven to completion by the FE or an operator. Idempotent.
 */
export const settleReferral = defineUpdate({
	args: SettleReferralArgsSchema,
	handler: async (args) => await settleReferralFn(args)
});

/**
 * Friendship-only path for users who use an invite link past the signup grace period (or who
 * have already redeemed). No VXP transfer fires; only a bilateral confirmed friendship is
 * written between the caller and the code owner. Idempotent for an existing relation.
 */
export const claimReferralFriendship = defineUpdate({
	args: ClaimReferralFriendshipArgsSchema,
	handler: claimReferralFriendshipFn
});

// ─── Product analytics (cockpit DQ-1) ───────────────────────────

/**
 * Batch event capture. The FE flushes behavioural events here; the server
 * stamps the timestamp + derives the pseudonymous principal, writes the
 * append-only `events` docs, and bumps the day's rollup inline. Anyone
 * (incl. anonymous, pre-auth) may call — events are validated against the
 * taxonomy and carry no PII.
 */
export const trackEvents = defineUpdate({
	args: TrackEventsArgsSchema,
	result: TrackEventsResultSchema,
	handler: (args) => trackEventsFn(args)
});

/**
 * Admin-gated read for the cockpit: the trailing `days` daily rollups of
 * per-event-name counts.
 */
export const getAnalyticsSummary = defineQuery({
	args: GetAnalyticsSummaryArgsSchema,
	result: AnalyticsSummarySchema,
	handler: (args) => getAnalyticsSummaryFn(args)
});

/**
 * Admin-gated raw-event export for the cockpit warehouse: the next page of
 * `events` after the given keyset cursor, flattened. Same admin gate as
 * `getAnalyticsSummary` — restricted to the cockpit's reader principal.
 */
export const getAnalyticsEvents = defineQuery({
	args: GetAnalyticsEventsArgsSchema,
	result: GetAnalyticsEventsResultSchema,
	handler: (args) => getAnalyticsEventsFn(args)
});

/**
 * Admin-gated all-time registered-account count for the cockpit's
 * "Registered" tile. Same admin gate as `getAnalyticsSummary` — restricted
 * to the cockpit's reader principal. No args: the count is global.
 */
export const getAnalyticsUserStats = defineQuery({
	result: AnalyticsUserStatsSchema,
	handler: () => getAnalyticsUserStatsFn()
});

/**
 * Admin-gated profile-created export for the cockpit warehouse: doc keys +
 * envelope `created_at` (ns), keyset-paged by key. The TRUE sign-up series —
 * the event stream only starts at capture and `signed_up` was single-path
 * until #1112, so window cohorts need the profile envelope, not events. Same
 * admin gate as the other analytics exports; no profile body field leaves.
 */
export const getAnalyticsProfileCreated = defineQuery({
	args: GetAnalyticsProfileCreatedArgsSchema,
	result: GetAnalyticsProfileCreatedResultSchema,
	handler: (args) => getAnalyticsProfileCreatedFn(args)
});

// The cockpit's DRAIN step — delete a page of events after the warehouse has
// durably ingested it, so the on-chain `events` collection stays a small buffer and
// the export query never blows the instruction budget (IC0522). Admin-gated update.
export const deleteAnalyticsEvents = defineUpdate({
	args: DeleteAnalyticsEventsArgsSchema,
	result: DeleteAnalyticsEventsResultSchema,
	handler: (args) => deleteAnalyticsEventsFn(args)
});

/**
 * Admin-gated export of the principal ⇄ sign-in-identity mapping: one row per
 * `#user` doc (provider + consented OpenID email/name) joined with the
 * best-effort `profiles.email`, keyset-paged by key. Exists so an off-chain
 * system can match accounts to the same login elsewhere. Same admin gate as
 * the analytics exports; deliberately exports addresses, admin-only.
 */
export const getAuthIdentities = defineQuery({
	args: GetAuthIdentitiesArgsSchema,
	result: GetAuthIdentitiesResultSchema,
	handler: (args) => getAuthIdentitiesFn(args)
});

// ─── Social cohorts ─────────────────────────────────────────────

export const listMyLeagues = defineQuery({
	result: j.strictObject({
		items: j.array(LeagueWithRoleWireSchema)
	}),
	handler: () => ({
		items: listMyLeaguesFn().map(toWireLeagueWithRole)
	})
});

/**
 * Retroactive self-heal for the "Founder +100 VXP" reward. The `leagues`
 * `onSetDoc` hook pays this on creation going forward; this endpoint
 * back-pays leagues founded before the hook shipped. Idempotent (shares
 * the hook's dedupe key) and safe to call on every Leagues-page mount —
 * returns how many rewards it newly settled this call.
 */
export const settleFounderAwards = defineUpdate({
	result: j.strictObject({
		settled: j.number()
	}),
	handler: async () => await settleFounderAwardsFn()
});

export const listLeagueMembers = defineQuery({
	args: j.strictObject({
		leagueId: j.string()
	}),
	result: j.strictObject({
		items: j.array(LeagueMemberWireSchema)
	}),
	handler: ({ leagueId }) => ({
		items: listLeagueMembersFn({ leagueId }).map(toWireLeagueMember)
	})
});

// Join-by-code resolver. The FE join modal posts the 6-char code,
// the satellite scans `leagues` for a match, and the FE then
// derives the leagueId and writes the `league_members` row through
// the standard set-doc path (which goes through `assertSetLeagueMember`).
export const lookupLeagueByInvite = defineQuery({
	args: j.strictObject({
		inviteCode: j.string()
	}),
	result: j.strictObject({
		league: j.optional(LeagueWireSchema)
	}),
	handler: ({ inviteCode }) => {
		const league = lookupLeagueByInviteFn({ inviteCode });

		return { league: league ? toWireLeague(league) : undefined };
	}
});

// Opponent pool for the create-battle picker — public leagues plus the
// caller's own memberships, minus leagues the caller owns. Distinct from
// the join-by-code resolver (`lookupLeagueByInvite`) and from any public
// JOIN-by-directory (intentionally not built).
export const listChallengeableLeagues = defineQuery({
	result: j.strictObject({
		items: j.array(LeagueWireSchema)
	}),
	handler: () => ({
		items: listChallengeableLeaguesFn().map(toWireLeague)
	})
});

// Recommendation pool for the "Friends are in" row at the foot of the
// Leagues list — Open and Invite-only leagues the caller's confirmed
// friends are in but the caller is not, with the per-league friend
// overlap for the avatar cluster + count. "Friend" = active bilateral
// friendship (same definition as `listFriends`); Private leagues are
// never surfaced to a non-member. See `listFriendRecommendedLeaguesFn`
// for the full privacy rationale.
export const listFriendRecommendedLeagues = defineQuery({
	result: j.strictObject({
		items: j.array(FriendRecommendedLeagueWireSchema)
	}),
	handler: () => ({
		items: listFriendRecommendedLeaguesFn().map(toWireFriendRecommendedLeague)
	})
});

// ─── Battles ──────────────────────────────────────────────────────

export const listLeagueBattles = defineQuery({
	args: j.strictObject({
		leagueId: j.string()
	}),
	result: j.strictObject({
		items: j.array(BattleWireSchema)
	}),
	handler: ({ leagueId }) => ({
		items: listLeagueBattlesFn({ leagueId }).map(toWireBattle)
	})
});

export const listMyBattles = defineQuery({
	result: j.strictObject({
		items: j.array(BattleWireSchema)
	}),
	handler: () => ({
		items: listMyBattlesFn().map(toWireBattle)
	})
});

export const getMyBattleStats = defineQuery({
	result: j.strictObject({
		boutsWon: j.number()
	}),
	handler: () => getMyBattleStatsFn()
});

// Resolve a settled league battle from clearing settlement history
// (controller-trusted). Idempotent + the lazy liveness path: the FE calls this
// the first time a member of either side opens a settled battle. An `update`
// because it reads the clearing canister and writes the resolved doc.
export const resolveBattle = defineUpdate({
	args: j.strictObject({ battleId: j.string() }),
	result: j.strictObject({ battle: BattleWireSchema }),
	handler: async ({ battleId }) => ({
		battle: toWireBattle(await resolveBattleFromSettlementsFn({ battleId }))
	})
});

// Provisional standings of an in-flight league battle, projected from the same
// clearing settlement history over [kickoff, now). `score` is absent for a
// battle that can't be scored live or for a non-member caller. An `update`
// (not a query) because it makes an inter-canister call to clearing.
export const readBattleLiveScore = defineUpdate({
	args: j.strictObject({ battleId: j.string() }),
	result: j.strictObject({
		score: j.optional(
			j.strictObject({
				scoreA: j.number(),
				scoreB: j.number(),
				callsA: j.number(),
				callsB: j.number(),
				leader: j.enum(['A', 'B', 'draw'])
			})
		)
	}),
	handler: async ({ battleId }) => ({
		score: await readBattleLiveScoreFn({ battleId })
	})
});

// ─── Worlds affiliations ────────────────────────────────────────

export const listMyAffiliations = defineQuery({
	result: j.strictObject({
		university: j.optional(AffiliationWireSchema),
		country: j.optional(AffiliationWireSchema)
	}),
	// `AffiliationDoc` already matches the camelCase wire shape, so the
	// handler returns it directly (no `toWireAffiliation` projection).
	handler: () => listMyAffiliationsFn()
});

export const listWorldsRoster = defineQuery({
	args: j.strictObject({
		kind: j.enum(['university', 'country']),
		affiliationIdentifier: j.string()
	}),
	result: j.strictObject({
		items: j.array(AffiliationWireSchema)
	}),
	handler: ({ kind, affiliationIdentifier }) => ({
		items: listWorldsRosterFn({ kind, affiliationIdentifier }).map(toWireAffiliation)
	})
});

// Per-affiliation stats (rolling lifetime + monthly counters). The
// `stats` field is optional because a brand-new affiliation has no
// resolution events yet and therefore no doc.
export const getAffiliationStats = defineQuery({
	args: j.strictObject({
		kind: j.enum(['university', 'country']),
		affiliationIdentifier: j.string()
	}),
	result: j.strictObject({
		stats: j.optional(AffiliationStatsWireSchema)
	}),
	// `AffiliationStatsDoc` already matches the camelCase wire shape, so
	// the handler returns it directly (no `toWireAffiliationStats`).
	handler: ({ kind, affiliationIdentifier }) => ({
		stats: getAffiliationStatsFn({ kind, affiliationIdentifier })
	})
});

// Ranked leaderboard view across every stats doc of a kind.
// Below MIN_CALLS_FOR_RANK is filtered out by the aggregator.
export const listAffiliationStats = defineQuery({
	args: j.strictObject({
		kind: j.enum(['university', 'country']),
		limit: j.number().optional()
	}),
	result: j.strictObject({
		items: j.array(AffiliationStatsWireSchema)
	}),
	handler: ({ kind, limit }) => ({
		items: listAffiliationStatsFn({ kind, limit }).map(toWireAffiliationStats)
	})
});

// Real member tally per affiliation of a kind. One scan over
// `affiliations`, bucketed by affiliationIdentifier — feeds the "N
// members" line on the Worlds picker / detail surfaces without
// paging the full roster per affiliation.
export const listWorldsMemberCounts = defineQuery({
	args: j.strictObject({
		kind: j.enum(['university', 'country'])
	}),
	result: j.strictObject({
		items: j.array(AffiliationMemberCountWireSchema)
	}),
	handler: ({ kind }) => ({
		items: listWorldsMemberCountsFn({ kind }).map(toWireAffiliationMemberCount)
	})
});

// Champion history for one affiliation — the past months it finished
// first in its kind's monthly ranking, derived from the frozen
// `affiliation_stats` snapshots. Empty until a month has rolled over
// with a ranked leader (there is no scheduled season-conclusion job).
export const listAffiliationChampionships = defineQuery({
	args: j.strictObject({
		kind: j.enum(['university', 'country']),
		affiliationIdentifier: j.string()
	}),
	result: j.strictObject({
		items: j.array(AffiliationChampionshipWireSchema)
	}),
	handler: ({ kind, affiliationIdentifier }) => ({
		items: listAffiliationChampionshipsFn({ kind, affiliationIdentifier }).map(
			toWireAffiliationChampionship
		)
	})
});

// ─── School-email verification (backend item B.1) ───────────────
//
// `submitSchool` re-runs the domain gate server-side, rate-limits, mints
// a `raw_rand` 6-digit code, stores only its digest (~30-min TTL +
// attempt cap), and mails it via a single HTTPS outcall to the
// `vici-courier` relay. `verifySchoolCode` checks the digest and, on
// success, bumps the school's verified-member count (public at 3) and
// flips the owner's profile `schoolStatus`. Unreachable in shipped
// builds until `SCHOOL_PASS2_ENABLED` is flipped (see
// `school-picker.constants.ts`).
export const submitSchool = defineUpdate({
	args: j.strictObject({
		name: j.string(),
		country: j.optional(j.string()),
		schoolId: j.optional(j.string()),
		email: j.string(),
		locale: j.string()
	}),
	result: j.strictObject({
		submissionId: j.string()
	}),
	// MUST be `async`: `submitSchoolFn` is async, and the Sputnik runtime
	// only awaits handlers declared `async` — a plain arrow returning the
	// promise gets validated as the (un-resolved) Promise, which trips the
	// result schema with `submissionId: undefined`.
	handler: async (args) =>
		await submitSchoolFn({
			name: args.name,
			country: args.country ?? null,
			schoolId: args.schoolId,
			email: args.email,
			locale: args.locale
		})
});

export const verifySchoolCode = defineUpdate({
	args: j.strictObject({
		submissionId: j.string(),
		code: j.string()
	}),
	result: j.strictObject({
		ok: j.boolean(),
		schoolId: j.optional(j.string()),
		status: j.optional(j.enum(['pending', 'public'])),
		message: j.optional(j.string())
	}),
	handler: (args) => verifySchoolCodeFn(args)
});

// Calibration reward — pays a fixed VXP bonus when a recovering user
// (available balance below the recovery floor) correctly called a
// finalised Vici binary market. The FE passes the market and the side
// the user picked; the server re-derives the winning side from the
// clearing settlement, so a wrong guess mints nothing and there is no
// way to forge correctness. All eligibility gates (anonymous reject,
// engagement, balance floor, market shape, resolution, per-market
// dedupe, rate limits) are enforced server-side. Idempotency + rate
// limiting come off the `vxp_awards` collection by key prefix.
export const claimCalibrationReward = defineUpdate({
	args: j.strictObject({
		seriesId: j.string(),
		chosenSide: j.enum(['YES', 'NO'])
	}),
	result: j.strictObject({
		correct: j.boolean(),
		paidNow: j.boolean(),
		alreadyClaimed: j.boolean(),
		rewardBaseUnits: j.optional(j.string()),
		newBalanceBaseUnits: j.optional(j.string()),
		blockIndex: j.optional(j.string()),
		reason: j.optional(
			j.enum([
				'anonymous',
				'not_engaged_yet',
				'balance_above_floor',
				'not_vici_market',
				'not_binary',
				'not_finalised',
				'outcome_undetermined',
				'rate_limited_hourly',
				'rate_limited_daily',
				'transfer_failed'
			])
		),
		errorMessage: j.optional(j.string())
	}),
	handler: claimCalibrationRewardFn
});

// Worlds podium monthly payout — user-claim variant. The caller
// passes `monthAnchor` (YYYY-MM) for a closed month; if their
// current affiliation finished top-3 in that month's snapshot,
// VXP_AWARDS docs are created (gold/silver/bronze) and a ledger
// transfer is fired. Idempotent via the award doc key.
export const claimWorldsPodiumPrize = defineUpdate({
	args: j.strictObject({
		monthAnchor: j.string()
	}),
	result: j.strictObject({
		monthAnchor: j.string(),
		awardsCreated: j.number(),
		awardsAlreadyClaimed: j.number(),
		notEligible: j.boolean()
	}),
	handler: claimWorldsPodiumPrizeFn
});

// Account deletion — Proposal 4. Pre-flight query that surfaces the
// "you still own this non-empty league" guard so the FE can show
// the transfer-first prompt before the user even picks a reason.
export const listMyBlockingLeagues = defineQuery({
	result: j.strictObject({
		leagueIds: j.array(j.string())
	}),
	handler: listMyBlockingLeaguesFn
});

// Account deletion — the deletion itself (Delete account v2). First
// applies any `leagueResolutions` the caller chose (transfer ownership
// of, or disband, each owned league), then writes an anonymous
// `EXIT_SIGNALS` doc and SOFT-deletes the caller's profile
// (`deletedAtMs = now`). No identity-keyed data is removed — the account
// can be recovered via `recoverMyAccount` within the recovery window;
// past the window it's hard-deleted (on a late recovery attempt or by
// the admin `sweepExpiredDeletions`). The handle stays reserved because
// the profile (and its nickname) is retained.
//
// `leagueResolutions` is an array of strict objects (cleaner in Candid
// than a map). Each is `{ leagueId, action: 'transfer' | 'delete',
// transferTo? }`; `transferTo` (the new-owner principal text) is
// required when `action === 'transfer'`. Resolutions apply IMMEDIATELY
// — a recovered account does NOT get relinquished leagues back.
//
// Refusal reasons:
//  - `owns_non_empty_league` — the caller still owns a league with
//    other members after resolution; `blockingLeagueIds` lists them and
//    the FE renders a transfer-first guard.
//  - `league_resolution_failed` — a transfer / disband failed;
//    `failedLeagueId` + `resolutionReason` carry the underlying cause.
//    The whole delete aborts (resolutions that committed before the
//    failure stand).
export const deleteMyAccount = defineUpdate({
	args: j.strictObject({
		reason: j.string(),
		note: j.string(),
		leagueResolutions: j.optional(
			j.array(
				j.strictObject({
					leagueId: j.string(),
					action: j.enum(['transfer', 'delete']),
					transferTo: j.optional(PrincipalTextSchema)
				})
			)
		)
	}),
	result: j.strictObject({
		ok: j.boolean(),
		reason: j.optional(
			j.enum(['owns_non_empty_league', 'league_resolution_failed', 'invalid_input'])
		),
		blockingLeagueIds: j.optional(j.array(j.string())),
		failedLeagueId: j.optional(j.string()),
		resolutionReason: j.optional(j.string()),
		softDeleted: j.optional(j.boolean())
	}),
	handler: deleteMyAccountFn
});

// Account recovery (Delete account v2). Clears the caller's own
// `deletedAtMs` when still inside the recovery window; a no-op for an
// account that isn't soft-deleted; hard-deletes + refuses with
// `reason: 'expired'` when the window has elapsed.
export const recoverMyAccount = defineUpdate({
	result: j.strictObject({
		ok: j.boolean(),
		recovered: j.optional(j.boolean()),
		reason: j.optional(j.enum(['expired']))
	}),
	handler: recoverMyAccountFn
});

// Account hibernation (Delete account v2 — the reversible retention
// off-ramp offered alongside delete). Sets `hibernatedAtMs = now` on the
// caller's profile: stats freeze (the account is inactive) and the profile
// hides from public reads, but NO data is removed and the owner can
// `resumeMyAccount` at any time. Idempotent — keeps the earliest mark.
//
// Refusal reasons:
//  - `no_profile` — the caller never onboarded.
//  - `deleted` — the account is already soft-deleted; the two states are
//    mutually exclusive.
export const hibernateMyAccount = defineUpdate({
	result: j.strictObject({
		ok: j.boolean(),
		reason: j.optional(j.enum(['no_profile', 'deleted']))
	}),
	handler: hibernateMyAccountFn
});

// Resume from hibernation (Delete account v2). Clears the caller's own
// `hibernatedAtMs`: the profile reappears on public reads and stats
// fan-out resumes on the next trade. A no-op when the account isn't
// hibernated. `resumed` reports whether a marker was actually cleared.
export const resumeMyAccount = defineUpdate({
	result: j.strictObject({
		ok: j.boolean(),
		resumed: j.boolean()
	}),
	handler: resumeMyAccountFn
});

// Admin sweep (Delete account v2). Hard-deletes every soft-deleted
// account whose recovery window has elapsed. Admin-guarded; Juno has no
// scheduler so this is triggered externally (admin/cron).
export const sweepExpiredDeletions = defineUpdate({
	result: j.strictObject({
		swept: j.number()
	}),
	handler: sweepExpiredDeletionsFn
});

// Admin-only corrective for the friend-feed like counts: re-derives every
// activity's exact like count from `activity_reactions` and overwrites the
// `activity_reaction_counts` rollup docs. Heals any drift from a
// concurrent-like version race (the hooks are best-effort) and backfills
// counts for likes that predate the rollup. Admin-gated; `recomputed` is
// the number of counter docs written.
// One-time streak-underpayment backfill (#957 remediation). Admin-gated,
// dryRun-default, idempotent. Remove in a follow-up PR after the prod run.
export const backfillStreakUnderpayments = defineUpdate({
	// `dryRun` is optional and defaults to `true` in the handler — omitting it
	// is the safe report-only path; pass `false` to mint.
	args: j.strictObject({ dryRun: j.optional(j.boolean()) }),
	result: j.strictObject({
		scanned: j.number(),
		underpaid: j.number(),
		alreadyBackfilled: j.number(),
		minted: j.number(),
		failed: j.number(),
		totalShortfallBaseUnits: j.string()
	}),
	handler: async ({ dryRun }) => await backfillStreakUnderpaymentsFn({ dryRun })
});

export const recomputeActivityReactionCounts = defineUpdate({
	result: j.strictObject({
		recomputed: j.number()
	}),
	handler: () => recomputeActivityReactionCountsFn()
});

// Admin-only: re-derive the `market_tag_index` buckets from a single scan of
// `market_metadata`. Run once after deploy to backfill the index for markets
// that predate it; also heals any drift from a concurrent-write version race.
export const rebuildMarketTagIndex = defineUpdate({
	result: j.strictObject({
		buckets: j.number(),
		series: j.number()
	}),
	handler: () => rebuildMarketTagIndexFn()
});

/**
 * Admin-gated read of every `market_tag_index` bucket (`tag → seriesIds`) for
 * the cockpit — it classifies markets (sport vs non-sport) for the campaign
 * hypothesis register. Same admin gate as the analytics exports. Seven keyed
 * reads, never a collection scan.
 */
export const getMarketTags = defineQuery({
	result: GetMarketTagsResultSchema,
	handler: () => getMarketTagsFn()
});

// Friend-scoped bulk read for the resolved-results digest (the consumer that
// renders these rows ships separately). Returns the supplied friend set's
// resolved-result rows over the active retention window in ONE bounded
// owner-prefix scan — never one call per friend. Public read; the FE scopes the
// `friends` set to the caller's confirmed friends.
export const listFriendResolvedResults = defineQuery({
	args: ListFriendResolvedResultsArgsSchema,
	result: j.strictObject({
		items: j.array(ResolvedResultSchema)
	}),
	handler: ({ friends }) => ({
		items: listFriendResolvedResultsFn({ friends })
	})
});

// Retention cleanup for `resolved_results` — prunes rows older than the
// configured horizon. Admin-gated; Juno has no scheduler so this is triggered
// externally (admin/cron), mirroring `sweepExpiredDeletions`. `pruned` is the
// number of rows removed.
export const pruneResolvedResults = defineUpdate({
	result: j.strictObject({
		pruned: j.number()
	}),
	handler: () => pruneResolvedResultsFn()
});

// Monthly tournament — Proposal 3. The draw is fire-and-forget on
// every Tournament-page mount: idempotent via doc-key collision on
// the month anchor (a second call returns `already_drawn` cleanly).
// Round resolution + prize claim are documented Proposal 3 follow-ups
// — they need a per-window accuracy aggregation pipeline that
// doesn't exist yet, so the bracket structure ships first.
export const triggerTournamentDraw = defineUpdate({
	args: j.strictObject({
		monthAnchor: j.string()
	}),
	result: j.strictObject({
		ok: j.boolean(),
		tournamentId: j.optional(j.string()),
		reason: j.optional(
			j.enum(['already_drawn', 'month_not_started', 'insufficient_leagues', 'invalid_input'])
		),
		availableLeagues: j.optional(j.number())
	}),
	handler: triggerTournamentDrawFn
});

// League ownership transfer — used by the league-detail "transfer
// ownership" CTA and surfaced from the account-delete owner guard
// so the user can resolve the blocking guard in one click.
//
// Refusal reasons:
//  - `not_owner` — caller isn't the current owner.
//  - `league_not_found` — leagueId resolves to nothing.
//  - `new_owner_not_member` — target principal isn't a member of
//    the league.
//  - `new_owner_is_caller` — no-op self-transfer rejected
//    explicitly so the FE can render a clear error.
//  - `invalid_input` — `newOwnerPrincipal` is not a valid principal
//    text.
export const transferLeagueOwnership = defineUpdate({
	args: j.strictObject({
		leagueId: j.string(),
		newOwnerPrincipal: PrincipalTextSchema
	}),
	result: j.strictObject({
		ok: j.boolean(),
		reason: j.optional(
			j.enum([
				'not_owner',
				'league_not_found',
				'new_owner_not_member',
				'new_owner_is_caller',
				'invalid_input'
			])
		)
	}),
	handler: transferLeagueOwnershipFn
});

export const getCurrentTournament = defineQuery({
	result: j.strictObject({
		tournament: j.optional(TournamentWireSchema),
		matches: j.array(TournamentMatchWireSchema)
	}),
	handler: () => {
		const { tournament, matches } = getCurrentTournamentFn();

		return {
			tournament: isNullish(tournament) ? undefined : toWireTournament(tournament),
			matches: matches.map(toWireTournamentMatch)
		};
	}
});

// Round resolution — user-claim; idempotent via the `winnerLeagueId`
// write-once invariant on match docs. Anyone can call when a round
// has closed; the FE fires this on every Tournament-page mount for
// each round whose `endMs <= now` and which still has unresolved
// matches.
//
// Refusal reasons:
//  - `tournament_not_found` — tournamentId resolves to nothing.
//  - `round_not_yet_closed` — the round's `endMs` is still in the future.
//  - `previous_round_not_resolved` — an earlier round has unresolved
//    matches; the bracket has to advance in order.
//  - `no_matches` — no match docs for the round (shouldn't happen).
//  - `invalid_input` — `round` is not one of `r1|quarter|semifinal|final`.
export const resolveTournamentRound = defineUpdate({
	args: j.strictObject({
		tournamentId: j.string(),
		round: j.string()
	}),
	result: j.strictObject({
		ok: j.boolean(),
		reason: j.optional(
			j.enum([
				'tournament_not_found',
				'round_not_yet_closed',
				'previous_round_not_resolved',
				'no_matches',
				'invalid_input'
			])
		),
		matchesResolved: j.optional(j.number()),
		tournamentConcluded: j.optional(j.boolean())
	}),
	handler: resolveTournamentRoundFn
});

// Prize claim — user-claim; idempotent via the VXP_AWARDS doc key.
// Caller computes their highest-tier placement (1 / 2 / 3) by
// checking membership in the bracket's winning leagues; the
// satellite writes a VXP_AWARDS doc and returns the credited amount.
//
// Refusal reasons:
//  - `tournament_not_found` — tournamentId resolves to nothing.
//  - `tournament_not_concluded` — bracket is still in flight.
//  - `not_member_of_top_league` — caller isn't a member of any
//    top-3 league.
export const claimTournamentPrize = defineUpdate({
	args: j.strictObject({
		tournamentId: j.string()
	}),
	result: j.strictObject({
		ok: j.boolean(),
		reason: j.optional(
			j.enum(['tournament_not_found', 'tournament_not_concluded', 'not_member_of_top_league'])
		),
		awardsCreated: j.optional(j.number()),
		awardsAlreadyClaimed: j.optional(j.number()),
		totalVxpCredited: j.optional(j.number())
	}),
	handler: claimTournamentPrizeFn
});

// Monthly album awards — aggregates every `user_monthly_stats` doc for the
// requested `monthAnchor` (YYYY-MM) and returns:
//  - `sharpestEye`: top-3 by accuracy among users with ≥ MONTHLY_MIN_CALLS
//    resolved calls, with gold/silver/bronze `placement`.
//  - `boldCaller`: the best accuracy among those eligible users whose median
//    consensus-at-call is below the bold threshold; returns every user tied
//    at that best accuracy.
// Both arrays use the snake_case wire schemas (the `Vec<NestedStruct>`
// quirk). The median is computed on read from each doc's bounded consensus
// array.
export const getMonthlyLeaderboard = defineQuery({
	args: j.strictObject({
		monthAnchor: j.string()
	}),
	result: j.strictObject({
		items: j.array(MonthlyLeaderboardEntryWireSchema),
		boldCallers: j.array(BoldCallerEntryWireSchema)
	}),
	handler: ({ monthAnchor }) => {
		const { sharpestEye, boldCaller } = getMonthlyLeaderboardFn({ monthAnchor });

		return {
			items: sharpestEye.map(toWireMonthlyLeaderboardEntry),
			boldCallers: boldCaller.map(toWireBoldCallerEntry)
		};
	}
});

/**
 * Composed `profiles` pre-write veto. Each sub-assert (`assertNewProfileAllowed`,
 * `assertValidNickname`, `assertDailyGoalMonotonic`) is exported independently
 * from its service so they stay unit-testable; we compose them here to keep the
 * dispatch table's one-assert-per-collection invariant. A throw from any one
 * rejects the write. The new-profile gate runs first so a refused create skips
 * the nickname check's full collection scan.
 */
const assertProfile = (context: AssertSetDocContext): void => {
	assertNewProfileAllowed(context);
	assertValidNickname(context);
	assertDailyGoalMonotonic(context);
};

/** Composed `profile_private` pre-write veto: owner binding, then the new-profile gate. */
const assertProfilePrivate = (context: AssertSetDocContext): void => {
	assertSetProfilePrivate(context);
	assertNewProfileAllowed(context);
};

const assertSetDocCollections = [
	Collection.ACTIVITIES,
	Collection.ACTIVITY_REACTIONS,
	Collection.PROFILES,
	Collection.PROFILE_PRIVATE,
	Collection.ROLES,
	Collection.REFERRAL_CODES,
	Collection.REFERRALS,
	Collection.VXP_AWARDS,
	Collection.LEAGUES,
	Collection.LEAGUE_MEMBERS,
	Collection.BATTLES,
	Collection.AFFILIATIONS,
	Collection.AFFILIATION_STATS,
	Collection.EXIT_SIGNALS,
	Collection.TOURNAMENTS,
	Collection.TOURNAMENT_MATCHES,
	Collection.LEAGUE_STATS,
	Collection.USER_STATS,
	Collection.USER_MONTHLY_STATS
] as const;

type AssertSetDocCollection = (typeof assertSetDocCollections)[number];

export const assertSetDoc = defineAssert<AssertSetDoc>({
	collections: assertSetDocCollections,
	assert: (context) => {
		const fn: Record<AssertSetDocCollection, (ctx: AssertSetDocContext) => void> = {
			[Collection.ACTIVITIES]: assertSetActivity,
			[Collection.ACTIVITY_REACTIONS]: assertSetActivityReaction,
			[Collection.PROFILES]: assertProfile,
			[Collection.PROFILE_PRIVATE]: assertProfilePrivate,
			[Collection.ROLES]: assertSetRole,
			[Collection.REFERRAL_CODES]: assertSetReferralCode,
			[Collection.REFERRALS]: assertSetReferral,
			[Collection.VXP_AWARDS]: assertSetVxpAward,
			[Collection.LEAGUES]: assertSetLeague,
			[Collection.LEAGUE_MEMBERS]: assertSetLeagueMember,
			[Collection.BATTLES]: assertSetBattle,
			[Collection.AFFILIATIONS]: assertSetAffiliation,
			[Collection.AFFILIATION_STATS]: assertSetAffiliationStats,
			[Collection.EXIT_SIGNALS]: assertSetExitSignal,
			[Collection.TOURNAMENTS]: assertSetTournament,
			[Collection.TOURNAMENT_MATCHES]: assertSetTournamentMatch,
			[Collection.LEAGUE_STATS]: assertSetLeagueStats,
			[Collection.USER_STATS]: assertSetUserStats,
			[Collection.USER_MONTHLY_STATS]: assertSetUserMonthlyStats
		};

		fn[context.data.collection]?.(context);
	}
});

const assertDeleteDocCollections = [
	Collection.LEAGUE_MEMBERS,
	Collection.AFFILIATIONS,
	Collection.BATTLES
] as const;

type AssertDeleteDocCollection = (typeof assertDeleteDocCollections)[number];

export const assertDeleteDoc = defineAssert<AssertDeleteDoc>({
	collections: assertDeleteDocCollections,
	assert: (context) => {
		const fn: Record<AssertDeleteDocCollection, (ctx: AssertDeleteDocContext) => void> = {
			[Collection.LEAGUE_MEMBERS]: assertDeleteLeagueMember,
			[Collection.AFFILIATIONS]: assertDeleteAffiliation,
			[Collection.BATTLES]: assertDeleteBattle
		};

		fn[context.data.collection]?.(context);
	}
});

const setDocCollections = [
	Collection.ACTIVITIES,
	Collection.ACTIVITY_REACTIONS,
	Collection.PROFILES,
	Collection.ROLES,
	Collection.REFERRALS,
	Collection.LEAGUES,
	Collection.USER_STATS,
	Collection.VXP_AWARDS,
	Collection.AFFILIATIONS
] as const;

type OnSetDocCollection = (typeof setDocCollections)[number];

/**
 * Composed `profiles` post-write handler. Each sub-hook (`onProfileSetForVxpOnboarding`,
 * `onProfileSetForReferralCode`) is exported independently from its service so they remain
 * unit-testable; we compose them here so the dispatch table keeps its one-handler-per-collection
 * invariant.
 */
const onProfileSetComposed: RunFunction<OnSetDocContext> = async (context) => {
	await onProfileSetForVxpOnboarding(context);
	onProfileSetForReferralCode(context);
	await onProfileSetForStreakAward(context);
	await onProfileSetForFlowMilestone(context);
	await onProfileSetForAchievementAward(context);
	await onProfileSetForComebackRestore(context);
	onProfileSetForLeagueStats(context);
};

// A trade activity drives both the new-user onboarding milestones and the referral first-prediction
// payout; a settlement activity fans out the per-participant `resolved_results` rows. Onboarding
// runs first; the others are best-effort (each logs and swallows its own errors) so they can't
// disrupt the onboarding payout. Each sub-hook self-filters on the activity type, so the composition
// stays a single dispatch entry.
const onActivitySetComposed: RunFunction<OnSetDocContext> = async (context) => {
	await onTradeActivityForVxpOnboarding(context);
	await onTradeActivityForReferral(context);
	await onActivitySetForResolvedResults(context);
};

export const onSetDoc = defineHook<OnSetDoc>({
	collections: setDocCollections,
	run: async (context) => {
		const fn: Record<OnSetDocCollection, RunFunction<OnSetDocContext>> = {
			[Collection.PROFILES]: onProfileSetComposed,
			[Collection.ACTIVITIES]: onActivitySetComposed,
			[Collection.ACTIVITY_REACTIONS]: onActivityReactionSet,
			[Collection.ROLES]: syncRoleToEngineOnSet,
			[Collection.REFERRALS]: onReferralSetForVxpPayout,
			[Collection.LEAGUES]: onLeagueSetForFounderVxpPayout,
			[Collection.USER_STATS]: onUserStatsSetForLeagueStats,
			// Server-side capture: every VXP payout (any award service) emits
			// `vxp_awarded` (+ `streak_milestone`) on its pending→paid transition.
			[Collection.VXP_AWARDS]: onVxpAwardSetForAnalytics,
			// Server-side capture: a Worlds join (client `setDoc`) emits
			// `affiliation_set` on row creation.
			[Collection.AFFILIATIONS]: onAffiliationSetForAnalytics
		};

		await fn[context.data.collection]?.(context);
	}
});

const deleteDocCollections = [
	Collection.ROLES,
	Collection.ACTIVITY_REACTIONS,
	Collection.AFFILIATIONS
] as const;

type OnDeleteDocCollection = (typeof deleteDocCollections)[number];

export const onDeleteDoc = defineHook<OnDeleteDoc>({
	collections: deleteDocCollections,
	run: async (context) => {
		const fn: Record<OnDeleteDocCollection, RunFunction<OnDeleteDocContext>> = {
			[Collection.ROLES]: syncRoleToEngineOnDelete,
			[Collection.ACTIVITY_REACTIONS]: onActivityReactionDelete,
			// Server-side capture: a Worlds leave (client `deleteDoc`, only
			// reachable past the 90-day lock) emits `affiliation_removed`.
			[Collection.AFFILIATIONS]: onAffiliationDeleteForAnalytics
		};

		await fn[context.data.collection]?.(context);
	}
});
