import collections from '#root/juno.collections.json';

export const Collection = {
	ROLES: collections.ROLES,
	PROFILES: collections.PROFILES,
	/**
	 * Owner-private profile data: one doc per principal (key = owner principal text), holding the
	 * fields that must never appear on the publicly-readable {@link Collection.PROFILES} doc. Today
	 * that's the account `email` (captured from an OpenID provider or the email-signup flow).
	 * `managed` read/write: only the owner and controllers can see it; `assertSetProfilePrivate`
	 * binds both the doc key and the embedded `owner` to the caller so no other user can squat or
	 * forge someone else's doc.
	 */
	PROFILE_PRIVATE: collections.PROFILE_PRIVATE,
	RELATIONS: collections.RELATIONS,
	/** Dormant: nothing in the app reads or writes it; only a satellite controller may. */
	CHATS: collections.CHATS,
	/** Dormant: nothing in the app reads or writes it; only a satellite controller may. */
	COMMENTS: collections.COMMENTS,
	MARKET_METADATA: collections.MARKET_METADATA,
	/**
	 * Reverse index from market tag to the series carrying it. One doc per tag in the closed
	 * {@link MARKET_TAGS} taxonomy, keyed by the tag id, holding that tag's `seriesIds`. Maintained
	 * inline by `upsertMarketMetadata` (diffing a market's old vs new tags); public read so battle
	 * resolution can read a single bucket, controllers write so only the satellite upsert / the admin
	 * `rebuildMarketTagIndex` endpoint can mutate it. Lets `scopeSeriesIds` read O(matching-series)
	 * instead of scanning the whole {@link Collection.MARKET_METADATA} collection on every resolve.
	 */
	MARKET_TAG_INDEX: collections.MARKET_TAG_INDEX,
	MARKET_TRANSLATIONS: collections.MARKET_TRANSLATIONS,
	ACTIVITIES: collections.ACTIVITIES,
	/**
	 * Per-liker reactions on friend-feed activities. One doc per `(activity, liker)`, keyed
	 * `${actor}#${timestamp}#${type}#${liker}` (the liked activity's doc key plus the liker). Public
	 * read/write; `assertSetActivityReaction` binds `data.liker` to the caller and the key shape, so a
	 * client can neither forge a like as another principal nor write a malformed key. The per-activity
	 * count lives in the {@link Collection.ACTIVITY_REACTION_COUNTS} rollup the hooks keep; the app reads
	 * reaction docs back only for the like-received inbox card, hence the denormalized `activityTitle` /
	 * `marketId`.
	 */
	ACTIVITY_REACTIONS: collections.ACTIVITY_REACTIONS,
	/**
	 * Per-activity like-count rollup. One doc per activity, keyed by the activity doc key
	 * (`${author}#${timestamp}#${type}` = a reaction's `activityKey`), holding the running like
	 * `count`. Public read; controllers write: only the satellite `onSetDoc`/`onDeleteDoc` hooks on
	 * {@link Collection.ACTIVITY_REACTIONS} write it (as admin), so a client can't forge a count. The
	 * admin `recomputeActivityReactionCounts` endpoint re-derives exact counts from the reaction docs.
	 */
	ACTIVITY_REACTION_COUNTS: collections.ACTIVITY_REACTION_COUNTS,
	/**
	 * Per-participant resolved-result rows for the friend-readable results feed. One doc per
	 * `(owner, market)` resolved call, keyed `${owner}#${marketId}`, holding that participant's
	 * outcome (win/loss), side, signed net VXP, and the resolution time. Public read; controllers
	 * write: only the satellite resolution hook writes it (as admin, derived from the clearing
	 * settlement plan), so a user cannot forge a win for themselves or a friend. Bulk-read
	 * friend-scoped by the digest consumer over an owner-prefix scan; rows past the retention horizon
	 * are pruned by the controllers-only cleanup.
	 */
	RESOLVED_RESULTS: collections.RESOLVED_RESULTS,
	/**
	 * Server-driven VXP new-user ladder state (owed vs paid). Server-owned: the satellite hooks
	 * write it as a controller, and its assert refuses every client write or delete, since the
	 * payout trusts the milestone states.
	 */
	VXP_ONBOARDING: collections.VXP_ONBOARDING,
	/**
	 * Per-user, per-award ledger of every VXP gameplay award the server fires: streak
	 * milestones, calibration rewards, referral payouts, Worlds podium. The doc key encodes
	 * `{recipient}/{awardType}/{awardKey}` so a second write at the same milestone collides
	 * with the first (natural idempotency). Status transitions `pending → paid | failed`
	 * are enforced by the satellite assert.
	 */
	VXP_AWARDS: collections.VXP_AWARDS,
	/**
	 * The first side a user called on a finalised market for a calibration reward, keyed
	 * `${recipient}/${seriesId}`. The claim judges that side only: a miss is recorded here, and a
	 * later call on the other side is refused. Controllers-scoped: only the satellite
	 * `claimCalibrationReward` endpoint reads and writes it.
	 */
	CALIBRATION_ATTEMPTS: collections.CALIBRATION_ATTEMPTS,
	/**
	 * An anonymous marker per one-time award a purged account was paid, keyed
	 * `${identityDigest(principal)}/${awardType}/${awardKey}` (`award-marker.utils.ts`): no
	 * principal, no data. The account purge writes them; `assertSetVxpAward`, the onboarding payout
	 * and the league-founder cap read them, so the same principal signing up again cannot collect a
	 * one-time award twice. Controllers-scoped.
	 */
	VXP_AWARD_MARKERS: collections.VXP_AWARD_MARKERS,
	/**
	 * Reverse index from referral code (key) to owning principal. One row per user; written by the
	 * satellite profile hook on first profile create.
	 */
	REFERRAL_CODES: collections.REFERRAL_CODES,
	/**
	 * Per-referee redemption record (key = referee principal). Tracks the referrer, the code, and
	 * the payout state for both sides. Server-owned: `redeemReferralCode` creates it and the
	 * referral settle path moves the payout state, both writing as a controller; its asserts refuse
	 * every client write or delete.
	 */
	REFERRALS: collections.REFERRALS,
	/**
	 * Social cohorts: user-created leagues. One doc per league, keyed by league id. Holds
	 * name, alphanumeric invite code (for the join-by-code flow), owner principal, and
	 * marketing metadata. Members and battles live in follow-up collections so a league's metadata
	 * stays cheap to read without joining the membership table.
	 */
	LEAGUES: collections.LEAGUES,
	/**
	 * Per-member membership row, keyed by `${leagueId}/${memberPrincipal}`. Holds the member's
	 * role inside the league (owner / admin / member) and the joinedAt timestamp. Self-joins
	 * write directly, always as `member`; the league owner can write rows for other principals
	 * (e.g. promote a member to admin). Drift between key and embedded fields is rejected by the
	 * satellite assert.
	 */
	LEAGUE_MEMBERS: collections.LEAGUE_MEMBERS,
	/**
	 * Invite code of each league, one doc per league keyed by the league id, the code also in the
	 * doc's description so a join resolves it with a description matcher. Controllers-only: the code
	 * is the only way into a league, so it never sits on the public {@link Collection.LEAGUES} doc;
	 * `createLeague` writes it, `joinLeagueByInvite` reads it, and members read their leagues' codes
	 * through `listMyLeagues`.
	 */
	LEAGUE_INVITES: collections.LEAGUE_INVITES,
	/**
	 * The invite codes an account looked up or joined with in the last hour that opened no league,
	 * one doc per account keyed by its principal. Controllers-only: `lookupLeagueByInvite` and
	 * `joinLeagueByInvite` refuse an account that has missed the hourly cap, so codes cannot be
	 * guessed one after another.
	 */
	LEAGUE_INVITE_ATTEMPTS: collections.LEAGUE_INVITE_ATTEMPTS,
	/**
	 * Battles: time-bound competitions. Two kinds: 'league' (leagueA vs leagueB) and
	 * 'duel' (proposer principal vs challenger principal). Doc key is the battle id. State machine
	 * `proposed → accepted → in_flight → resolved` enforced by the satellite assert; scores write
	 * once at settle, winner derived from scores.
	 */
	BATTLES: collections.BATTLES,
	/**
	 * Worlds affiliations: a user's chosen university and / or country, used for the Worlds
	 * leaderboard surface (distinct from user-created leagues so the 90-day lock doesn't leak).
	 * Keyed `${member}/${kind}/${affiliationIdentifier}` so a user can carry one university + one country
	 * simultaneously. Server computes `lockedUntilMs = joinedAtMs + 90d` on first write; the delete
	 * assert hard-rejects until the lock expires.
	 */
	AFFILIATIONS: collections.AFFILIATIONS,
	/**
	 * Frozen monthly Worlds standings. One immutable doc per `(kind, affiliationIdentifier, monthAnchor)`,
	 * keyed `${kind}/${affiliationIdentifier}/${monthAnchor}`, written once, as a controller, by the
	 * Worlds podium freeze when a closed month's podium is first claimed. The live windows (all-time,
	 * current month) are recomputed on read from the opted-in roster and never stored here.
	 */
	AFFILIATION_STATS: collections.AFFILIATION_STATS,
	/**
	 * Append-only churn-feedback log. Each doc records the `reason` + optional free-text `note`
	 * the user picked from the delete-account flow. Intentionally anonymous; no principal field,
	 * random UUID key, so the log survives the account it describes. Written exactly once by
	 * `deleteMyAccount` before the cascade hard-deletes the caller's identity.
	 */
	EXIT_SIGNALS: collections.EXIT_SIGNALS,
	/**
	 * Monthly single-elimination tournament metadata. One doc per month, keyed by month anchor
	 * (`YYYY-MM`). Holds the seeded league ids (top-16 by active members), bracket size, lifecycle
	 * state. Written by `triggerTournamentDraw` (idempotent: doc key collision rejects a second
	 * draw for the same month).
	 */
	TOURNAMENTS: collections.TOURNAMENTS,
	/**
	 * Per-match docs of every tournament. Keyed `${tournamentId}/${round}/${index}` so the
	 * bracket reads as a single prefix scan. Holds the two competing league ids, per-league
	 * accuracy (filled in by the round-resolution job), and the winning league. Written by
	 * `triggerTournamentDraw` (every match, a few per call) and `resolveTournamentRound`.
	 */
	TOURNAMENT_MATCHES: collections.TOURNAMENT_MATCHES,
	/**
	 * Per-league rolling stats: lifetime resolved-call count + wins. One doc per league
	 * keyed by `leagueId`. Written exclusively by the satellite hook on `profiles` updates:
	 * when a user's `totalTrades` increments, the hook scans their league memberships and
	 * fans the delta out. A display cache: tournament matches and league battles are scored
	 * from the members' settled history read from the clearing canister, never from it.
	 */
	LEAGUE_STATS: collections.LEAGUE_STATS,
	/**
	 * Per-user dashboard cache: one doc per principal. Holds the per-category breakdown
	 * (calls / wins per market tag) and a small recent-settlement list that drive the
	 * DashPage tiles. The FE re-syncs it from the user's clearing history on every Dash
	 * mount; the satellite assert restricts writes to the user themselves.
	 */
	USER_STATS: collections.USER_STATS,
	/**
	 * Per-user, per-month gameplay stats: one doc per `${owner}/${YYYY-MM}`. Holds the month's
	 * resolved-call count, win count, and a bounded array of consensus-at-call prices so an exact
	 * median can be computed on read. The FE re-syncs the current and prior month's docs from the
	 * user's clearing history on every stats sync (lazy month rollover; no scheduler); the
	 * satellite assert restricts writes to the user themselves and bounds the consensus array.
	 * Read by `getMonthlyLeaderboard` to award the monthly sharpest-eye (top-3 accuracy, ≥30
	 * calls) and bold-caller (best accuracy among users whose median consensus-at-call < 0.4)
	 * album awards.
	 */
	USER_MONTHLY_STATS: collections.USER_MONTHLY_STATS,
	/**
	 * School-email verification submissions (backend item B.1). One doc per pending
	 * `(member, email, school)` verification, holding an `FNV-1a(code|salt)` digest (never the
	 * plaintext code), a ~30-min TTL, and an attempt counter. Server-owned: the satellite's
	 * `submitSchool` / `verifySchoolCode` endpoints are the only writers (collection is
	 * controllers-scoped), so a client can neither read a digest nor reset an attempt counter.
	 */
	SCHOOL_SUBMISSIONS: collections.SCHOOL_SUBMISSIONS,
	/**
	 * Verified-school registry (backend item B.1). One doc per `schoolId` holding the running
	 * `verifiedMemberCount` and the `pending → public` gate (a school goes public at 3 verified
	 * members). Written exclusively by `verifySchoolCode` (controllers-scoped write); public read
	 * so picker surfaces can list public schools.
	 */
	SCHOOLS: collections.SCHOOLS,
	/**
	 * Server runtime config (backend item B.1). Controllers read+write; holds non-repo config such
	 * as the `vici-courier` email-relay URL + bearer token, set by a controller after deploy so no
	 * secret ever lands in git.
	 */
	APP_CONFIG: collections.APP_CONFIG,
	/**
	 * Product-analytics raw event log (cockpit DQ-1, "versioned event taxonomy"). Append-only,
	 * one doc per captured event. Controllers-scoped: the satellite `trackEvents` endpoint is the
	 * sole writer (it writes as an admin via the privileged `*DocStore` APIs), so clients can
	 * neither read other users' behaviour nor forge events. Bodies are behavioural only; a
	 * pseudonymous `principal` (absent pre-auth) plus the bounded `AnalyticsEventProps` vocabulary,
	 * never PII.
	 */
	EVENTS: collections.EVENTS,
	/**
	 * Per-UTC-day rollup of per-event-name counts (one doc keyed by epoch-day), bumped inline by
	 * `trackEvents` as events land so the cockpit reads cheap aggregates via `getAnalyticsSummary`
	 * instead of scanning the raw {@link Collection.EVENTS} log. Controllers-scoped.
	 */
	EVENT_ROLLUPS: collections.EVENT_ROLLUPS,
	/**
	 * The global leaderboard ranking: one doc (`LEADERBOARD_RANKING_KEY`) holding the principals
	 * ranked from their settled history, best first, written by `refreshLeaderboardRanking` and read
	 * by `listLeaderboard`, `getUserRankAndCount` and `getMyRival`. A query cannot call the clearing
	 * canister, so the ranking is computed in an update and stored. Controllers-scoped.
	 */
	LEADERBOARD_RANKING: collections.LEADERBOARD_RANKING
} as const;

export type Collection = (typeof Collection)[keyof typeof Collection];
