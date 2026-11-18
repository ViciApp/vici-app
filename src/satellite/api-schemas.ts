/**
 * Satellite API-compatible schemas.
 *
 * The Juno Sputnik JsonData derive macro cannot handle:
 *  - Option<Enum>   with #[json_data(nested)]
 *  - Option<Struct> with #[json_data(nested)]
 *
 * These schemas mirror the app-level schemas but replace optional enums with
 * optional strings and make optional nested objects non-optional (with defaults)
 * so the generated Rust code compiles to WASM.
 */
import { ProfileVisibility } from '#lib/enums/profile.ts';
import { RelationCategory, RelationState } from '#lib/enums/relation.ts';
import { j, PrincipalTextSchema } from '@junobuild/schema';

export const UserProfileApiSchema = j.strictObject({
	owner: PrincipalTextSchema,
	nickname: j.string().default(''),
	avatar: j.string().default(''),
	// Serialized faceted-avatar picks (compact JSON string). Stored as a
	// plain string, not a nested object, so it encodes cleanly through
	// JsonData→Candid. Mirror any change here in
	// `src/lib/schema/profile.schema.ts`.
	avatarParts: j.string().default(''),
	pnl: j.number().default(0),
	visibility: j.enum(ProfileVisibility).default(ProfileVisibility.FRIENDS_ONLY),
	role: j.string().optional(),
	totalTrades: j.number().default(0),
	winRate: j.number().default(0),
	dailyStreak: j.number().default(0),
	// Best daily-streak ever reached — running `max(longestStreak,
	// dailyStreak)`. Defaults to 0 so legacy rows decode without a
	// migration. Mirror any change here in
	// `src/lib/schema/profile.schema.ts`.
	longestStreak: j.number().default(0),
	streak: j.number().default(0),
	accuracy: j.number().default(0),
	points: j.number().default(0),
	level: j.number().default(1),
	interests: j.array(j.string()).default([]),
	lastActiveDay: j.string().optional(),
	// Soft-delete marker (Delete account v2). PRESENCE = soft-deleted (ms
	// timestamp); ABSENCE = active. Intentionally `optional()` with NO
	// default so legacy/active rows decode as active. Mirror any change
	// here in `src/lib/schema/profile.schema.ts`.
	deletedAtMs: j.number().optional(),
	// Hibernation marker (Delete account v2 — reversible sibling of
	// soft-delete). PRESENCE = hibernated (ms timestamp); ABSENCE = active.
	// `optional()` with NO default for the same reason as `deletedAtMs`.
	// Mirror any change here in `src/lib/schema/profile.schema.ts`.
	hibernatedAtMs: j.number().optional(),
	// Top-decile streak state (drives the `top-decile` achievement). The
	// consecutive-day count plus the local `YYYY-MM-DD` once-per-day guard.
	// Mirror any change here in `src/lib/schema/profile.schema.ts`.
	topDecileStreak: j.number().default(0),
	lastTopDecileDay: j.string().optional(),
	// Best monthly sharpest-eye placement ('gold' / 'silver' / 'bronze').
	// `optional()` with NO default so legacy rows decode as "never placed".
	// Mirror any change here in `src/lib/schema/profile.schema.ts`.
	sharpestEyeBestTier: j.string().optional(),
	// Alma Mater (university affiliation) verification state — a loose string
	// (`'unverified'` | `'pending'` | `'verified'`). `optional()` with NO
	// default so legacy rows decode as absent ("no school / never set"); a set
	// school with this absent is treated as `'unverified'`. Mirror any change
	// here in `src/lib/schema/profile.schema.ts`.
	schoolStatus: j.string().optional(),
	// Celebrated Menagerie tier keys (the achievement trophy layer) — each a
	// `${slug}:${tier}` string the owner has already seen a reveal for.
	// `optional()` with NO default: ABSENCE means "never seeded" (first load
	// seeds silently), so a default would re-fire celebrations for every legacy
	// row. Mirror any change here in `src/lib/schema/profile.schema.ts`.
	earnedMenagerie: j.array(j.string()).optional(),
	// Wall-clock ms of the owner's last handle (nickname) change — drives the
	// 30-day handle-change cooldown. `optional()` with NO default so legacy
	// rows decode as never-changed. Mirror any change here in
	// `src/lib/schema/profile.schema.ts`.
	handleLastChangeMs: j.number().optional(),
	// Defaults are intentionally applied at every level. The outer
	// `.default(...)` only kicks in when `preferences` is null/undefined;
	// legacy profile docs that have a partial `preferences` shape would
	// otherwise trap during JsonData→Candid encoding with `missing field`
	// because the inner `strictObject` requires every declared field.
	// Defaulting every leaf lets those rows decode cleanly without a data
	// migration. Mirror any change here in `src/lib/schema/profile.schema.ts`.
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
			// Privacy / sharing preference group. `profileVisibility` is a
			// loose string (the `public|friends|private` settings union)
			// mirrored to the top-level `visibility` enum on write;
			// `leaderboardOptIn` / `worldsOptIn` default `true`. Every leaf
			// is defaulted so a partial legacy `preferences` shape decodes
			// cleanly. Mirror any change here in
			// `src/lib/schema/profile.schema.ts`.
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
			// whether to re-prompt the user on next sign-in. Mirror any
			// change here in `src/lib/schema/profile.schema.ts`.
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

export const RelationApiSchema = j.strictObject({
	category: j.enum(RelationCategory),
	state: j.enum(RelationState),
	participants: j.array(PrincipalTextSchema),
	viewerPrincipal: PrincipalTextSchema.optional(),
	viewerRole: j.string().optional(),
	isFriend: j.boolean().optional()
});
