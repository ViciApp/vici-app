import { ProfileVisibility } from '#lib/enums/profile.ts';
import { UserRole } from '#lib/enums/user.ts';
import { j, PrincipalTextSchema } from '@junobuild/schema';

export const UserRoleSchema = j.enum(UserRole);

export const ProfileVisibilitySchema = j.enum(ProfileVisibility);

export const NicknameSchema = j.string();

/**
 * Owner-private profile data — one doc per principal in the
 * `profile_private` collection (key = owner principal text). Holds the
 * fields that must never land on the publicly-readable `profiles` doc.
 * Today that's the account `email`, captured from an OpenID provider or
 * the email-signup flow; the collection is `managed`, so only the owner
 * and controllers can read it.
 */
export const ProfilePrivateSchema = j.strictObject({
	owner: PrincipalTextSchema,
	email: j.string().default('')
});

export const UserProfileSchema = j.strictObject({
	owner: PrincipalTextSchema,
	nickname: NicknameSchema.default(''),
	avatar: j.string().default(''),
	// The user's faceted-avatar picks, serialized to a compact JSON string
	// (the seven catalog keys — see `serializeParts` in
	// `#lib/utils/vici-avatar.utils.ts`). Stored as a plain string (not a nested
	// object) so it round-trips through the satellite JsonData→Candid encoder
	// without the `Option<Struct>` limitation; empty string = "no saved picks"
	// (the surface falls back to a deterministic face seeded by the
	// principal). Uploaded avatar images still win over this. Mirror any
	// change here in `src/satellite/api-schemas.ts`.
	avatarParts: j.string().default(''),
	pnl: j.number().default(0),
	visibility: ProfileVisibilitySchema.default(ProfileVisibility.FRIENDS_ONLY),
	role: UserRoleSchema.optional(),
	totalTrades: j.number().default(0),
	winRate: j.number().default(0),
	dailyStreak: j.number().default(0),
	// Best daily-streak the user has ever reached — the running
	// `max(longestStreak, dailyStreak)` maintained wherever `dailyStreak`
	// is persisted (Flow Mode's first-swipe write and the trade-execution
	// `recordActivity` path). Drives the "Longest {N}" readout on the dash
	// streak hero. Defaults to 0 so legacy rows decode without a migration
	// and self-heal up to their current `dailyStreak` on the next bump.
	// Mirror any change here in `src/satellite/api-schemas.ts`.
	longestStreak: j.number().default(0),
	// Daily-goal counter — predictions committed on `dailyGoalDate`
	// (local `YYYY-MM-DD`). `dailyGoalDone` rolls back to 0 the first
	// time it's touched on a new local day, mirroring the `dailyStreak`
	// / `lastActiveDay` pairing. The target itself is a client constant,
	// so only the count and its day are persisted.
	dailyGoalDone: j.number().default(0),
	dailyGoalDate: j.string().optional(),
	streak: j.number().default(0),
	accuracy: j.number().default(0),
	points: j.number().default(0),
	level: j.number().default(1),
	archetype: j.string().default(''),
	interests: j.array(j.string()).default([]),
	lastActiveDay: j.string().optional(),
	// Soft-delete marker (Delete account v2). PRESENCE = the account is
	// soft-deleted (the wall-clock ms at which `deleteMyAccount` ran);
	// ABSENCE = an active account. Intentionally `optional()` with NO
	// default: a default would force every legacy/active row to look
	// soft-deleted, and absence is the meaningful "still active" state.
	// Within the recovery window the owner can `recoverMyAccount` to clear
	// it; past the window the admin sweep hard-deletes the account. Mirror
	// any change here in `src/satellite/api-schemas.ts`.
	deletedAtMs: j.number().optional(),
	// Hibernation marker (Delete account v2 — the reversible sibling of
	// soft-delete). PRESENCE = the account is hibernated (the wall-clock ms
	// at which `hibernateMyAccount` ran); ABSENCE = an active account. Like
	// `deletedAtMs` it's intentionally `optional()` with NO default —
	// absence is the meaningful "active" state. Hibernation is fully
	// reversible (no data is ever removed): stats freeze (the account is
	// inactive) and the profile hides from public reads, but the owner can
	// `resumeMyAccount` at any time to clear it. Mutually exclusive with
	// `deletedAtMs` (a soft-deleted account can't be hibernated). Mirror any
	// change here in `src/satellite/api-schemas.ts`.
	hibernatedAtMs: j.number().optional(),
	// IDs of achievements the user has ever unlocked (append-only). Source of
	// truth for the achievement system — `evaluateAchievements` re-derives
	// current eligibility on every stats sync, and any newly-true ids are
	// merged in here (with their XP credited to `points`). Unlocks never
	// rescind: if a stat regresses, the achievement stays "earned".
	unlockedAchievements: j.array(j.string()).default([]),
	// Lifetime count of wins on long-shot trades (execution price at or
	// below `CONTRARIAN_PRICE_THRESHOLD`). Drives the `contrarian`
	// achievement progress; recomputed from clearing history during
	// `calculateAndSyncStats`.
	contrarianWins: j.number().default(0),
	// Rarest single upset — the smallest execution consensus (0..1) among
	// the user's settled wins; lower = rarer. Drives the Octopus trophy's
	// reversed ladder. `optional()` with NO default: absence means "no
	// settled win yet", and a numeric default would either fake a
	// world-class upset (0) or a never-matched worst case that still reads
	// as data (1). Recomputed from clearing history during
	// `calculateAndSyncStats`.
	bestUpsetConsensus: j.number().optional(),
	// Longest consecutive-win run the user has ever recorded across settled
	// history — the high-water sibling of `streak` (which tracks only the
	// CURRENT run and resets on every loss). Drives the Snake trophy, whose
	// rungs must not regress when a run ends. Recomputed from clearing
	// history during `calculateAndSyncStats`, kept monotonic via
	// `max(existing, recomputed)`.
	onFireStreak: j.number().default(0),
	// Lifetime cold-streak recoveries — settled wins that snapped a run of
	// at least `COMEBACK_COLD_STREAK_LOSSES` consecutive settled losses.
	// Drives the Honey Badger trophy. Recomputed from clearing history
	// during `calculateAndSyncStats`, kept monotonic via `max(existing,
	// recomputed)`.
	comebacks: j.number().default(0),
	// Breadth — distinct market categories where the user has at least
	// `MAGPIE_MIN_CATEGORY_CALLS` settled calls at a win ratio of at least
	// `MAGPIE_MIN_CATEGORY_ACCURACY`. Drives the Magpie trophy. Recomputed
	// from clearing history + market tags during `calculateAndSyncStats`,
	// kept monotonic via `max(existing, recomputed)` (the tag lookup
	// degrades to "untagged" when market metadata isn't hydrated, and a
	// thin sync must not strip an earned rung).
	winningCategories: j.number().default(0),
	// League-life milestones (drive the Bee trophy's join → win-a-bout →
	// found ladder). All three are recomputed from the caller's league
	// memberships / battles during `calculateAndSyncStats` and kept
	// monotonic via `max(existing, recomputed)` — leaving a league or a
	// failed read must not strip an earned rung.
	// High-water count of league memberships (any role) — because of the
	// monotonic guard, leaving a league never decrements it.
	leaguesJoined: j.number().default(0),
	// High-water count of resolved battles (league bouts or duels) the
	// user's side won.
	boutsWon: j.number().default(0),
	// High-water count of leagues the user has owned — transferring or
	// deleting a league never decrements it.
	leaguesFounded: j.number().default(0),
	// Consecutive calendar days the user has held a top-10% global
	// leaderboard position (rank ≤ profileCount / 10). Drives the
	// `top-decile` achievement. Bumped at most once per local day in
	// `calculateAndSyncStats` (mirrors the `dailyStreak` once-per-day
	// pattern) and reset to 0 the first time a sync on a new day finds the
	// user outside the top decile. Mirror any change here in
	// `src/satellite/api-schemas.ts`.
	topDecileStreak: j.number().default(0),
	// Local `YYYY-MM-DD` of the last day `topDecileStreak` was evaluated —
	// the once-per-day guard for the streak bump. `optional()` with no
	// default so a never-evaluated profile reads as absent. Mirror any
	// change here in `src/satellite/api-schemas.ts`.
	lastTopDecileDay: j.string().optional(),
	// Best monthly sharpest-eye placement the user has ever earned —
	// `'gold'` (#1), `'silver'` (#2), or `'bronze'` (#3). Drives the
	// `sharpest-eye` album award's tier wash. The client sets it (keeping the
	// best of the existing and the new tier) when a completed month's
	// `getMonthlyLeaderboard` places the user top-3. `optional()` with NO
	// default — absence means "never placed", which is the meaningful
	// backward-compatible state for every legacy row. A single field (not
	// per-month history) is the v1 storage shape. Mirror any change here in
	// `src/satellite/api-schemas.ts`.
	sharpestEyeBestTier: j.string().optional(),
	// Verification state of the owner's Alma Mater (university affiliation):
	// `'unverified'` | `'pending'` | `'verified'`. Drives the verification
	// pill on the profile's Alma Mater slot. Stored as a loose string (not an
	// enum) so it round-trips through JsonData→Candid without the
	// `Option<Enum>` limitation. `optional()` with NO default — absence is the
	// meaningful "no school / never set" state, and a default would force every
	// legacy row to look like it had a verification status. When a university
	// affiliation exists but this field is absent, the surface treats it as
	// `'unverified'`. Membership-email verification (the path that would move
	// this to `'verified'`) is deferred to its own roadmap item; until then the
	// only reachable state for a set school is `'unverified'`. Mirror any
	// change here in `src/satellite/api-schemas.ts`.
	schoolStatus: j.string().optional(),
	// Celebrated Menagerie tier keys (the achievement "trophy layer"). Each
	// entry is a `${slug}:${tier}` string (e.g. `owl:gold`) the owner has
	// already SEEN a celebration for. The set is the de-dupe ledger that keeps
	// the one-time unlock reveal from re-firing — the live tier is always
	// re-derived from the owner's real stats, this field only records what was
	// already shown. Intentionally `optional()` with NO default: ABSENCE is the
	// meaningful "never seeded" state, which the reveal pipeline reads as
	// "first-ever load → seed silently" (so a fully-stocked profile doesn't
	// spam a dozen celebrations on its first visit). A default of `[]` would
	// instead make every legacy row look like it had explicitly celebrated
	// nothing, turning that first load into a celebration storm. Mirror any
	// change here in `src/satellite/api-schemas.ts`.
	earnedMenagerie: j.array(j.string()).optional(),
	// Wall-clock ms at which the owner last CHANGED their handle (nickname).
	// Drives the {@link HANDLE_COOLDOWN_DAYS}-day handle-change cooldown: a
	// rename is only allowed once this is older than the window. PRESENCE = a
	// prior change is on record; ABSENCE = no prior change ("changeable").
	// Intentionally `optional()` with NO default so every legacy row decodes
	// without a migration and reads as never-changed (immediately
	// changeable). The set-profile assert is the authority — it sets this to
	// the message time on a change and rejects any other movement. Mirror any
	// change here in `src/satellite/api-schemas.ts`.
	handleLastChangeMs: j.number().optional(),
	// `preferences` carries every cross-device user setting. Defaults are
	// applied at every leaf because the satellite-side encoder traps with
	// `missing field X` the moment `app_list_leaderboard` / `app_get_profile`
	// / `app_search_profiles` encounter a partial `preferences` shape (the
	// inner `strictObject` requires every declared field). Defaulting each
	// leaf lets legacy rows decode cleanly without a data migration. Mirror
	// every change here in `src/satellite/api-schemas.ts`.
	//
	// `defaultAmount` is the wallet-side default-bet preference; the rest
	// of the fields are the user-experience preferences (notifications,
	// flow deck, haptics, saved-markets list, privacy/sharing) — they
	// migrated off per-device localStorage and now round-trip through the
	// profile so they sync across devices.
	preferences: j
		.strictObject({
			defaultAmount: j
				.strictObject({
					flow: j.string().default('0'),
					manual: j.string().default('0')
				})
				.default({ flow: '0', manual: '0' }),
			notify: j
				.strictObject({
					streakReminder: j.boolean().default(true),
					marketAlerts: j.boolean().default(true),
					friendActivity: j.boolean().default(false),
					weeklyDigest: j.boolean().default(true)
				})
				.default({
					streakReminder: true,
					marketAlerts: true,
					friendActivity: false,
					weeklyDigest: true
				}),
			flowSessionLength: j.number().default(10),
			hapticsEnabled: j.boolean().default(true),
			soundEnabled: j.boolean().default(true),
			// Privacy / sharing preference group (Settings privacy
			// sections). Every leaf is defaulted for the same reason as the
			// surrounding fields — a partial `preferences` shape on a legacy
			// row must decode cleanly. `profileVisibility` is stored as a
			// loose string (the `public|friends|private` settings union) and
			// is mirrored to the top-level `visibility` enum on write, which
			// is the field the satellite wire format reads. `leaderboardOptIn`
			// / `worldsOptIn` default to `true` to match the current
			// always-shown behaviour. Mirror any change here in
			// `src/satellite/api-schemas.ts`.
			sharing: j
				.strictObject({
					profileVisibility: j.string().default('private'),
					callsPublic: j.boolean().default(true),
					leaderboardOptIn: j.boolean().default(true),
					worldsOptIn: j.boolean().default(true)
				})
				.default({
					profileVisibility: 'private',
					callsPublic: true,
					leaderboardOptIn: true,
					worldsOptIn: true
				}),
			flowTags: j.array(j.string()).default([]),
			worldCupMode: j.boolean().default(false),
			savedMarketIds: j.array(j.string()).default([]),
			// Onboarding picks (Beat 1.a + 1.b). Empty string for
			// `favoriteParticipantId` means the user skipped the team
			// pick; empty string for `favoriteSide` means no YES/NO
			// commitment was made. `onboardingCompleted` flips to true
			// once the 3-beat flow finishes, regardless of which picks
			// were ultimately persisted — it's the source of truth for
			// whether to re-prompt the user on next sign-in.
			favoriteParticipantId: j.string().default(''),
			favoriteSide: j.string().default(''),
			onboardingCompleted: j.boolean().default(false)
		})
		.default({
			defaultAmount: { flow: '0', manual: '0' },
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
				profileVisibility: 'private',
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
		})
});
