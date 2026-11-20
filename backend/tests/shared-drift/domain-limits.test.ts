import { describe, expect, test } from 'bun:test';
import {
	ACCOUNT_RECOVERY_WINDOW_MS,
	EXIT_SIGNAL_NOTE_MAX_LENGTH,
	EXIT_SIGNAL_REASONS
} from '../../src/account/lifecycle';
import {
	REFERRAL_CODE_ALPHABET,
	REFERRAL_CODE_LENGTH,
	REFERRAL_CODE_REGEX,
	REFERRAL_EXISTING_USER_REASON,
	REFERRAL_SIGNUP_WINDOW_MS
} from '../../src/account/referrals';
import { VICI_ORACLE_V1 } from '../../src/admin/engine-sync';
import { VICI_ENGINE_ID } from '../../src/engine/registry';
import {
	BATTLE_AMOUNT_MAX,
	BATTLE_AMOUNT_MIN,
	BATTLE_RESPOND_BY_MS,
	BATTLE_TRASH_TALK_MAX_LENGTH
} from '../../src/leagues/battles';
import { LEAGUE_IMAGE_JPEG_QUALITY, LEAGUE_IMAGE_SIZE_PX } from '../../src/leagues/images';
import {
	LEAGUE_DESCRIPTION_MAX_LENGTH,
	LEAGUE_EMBLEMS,
	LEAGUE_INVITE_CODE_ALPHABET,
	LEAGUE_INVITE_CODE_LENGTH,
	LEAGUE_INVITE_CODE_REGEX,
	LEAGUE_LEGACY_INVITE_CODE_LENGTH,
	LEAGUE_NAME_MAX_LENGTH,
	LEAGUE_NAME_MIN_LENGTH
} from '../../src/leagues/leagues';
import { DAY_IN_MS, HOUR_IN_MS, MINUTE_IN_MS, MONTH_ANCHOR_RE } from '../../src/lib/time';
import { DAILY_HARD_CAP } from '../../src/profiles/flow';
import {
	HANDLE_COOLDOWN_DAYS,
	MAX_NICKNAME_LENGTH,
	MIN_NICKNAME_LENGTH,
	NICKNAME_PATTERN
} from '../../src/profiles/nickname';
import {
	BOLD_CALLER_MEDIAN_THRESHOLD,
	MONTHLY_MIN_CALLS,
	USER_STATS_RECENT_LIMIT
} from '../../src/profiles/stats';
import {
	SCHOOL_CODE_MAX_ATTEMPTS,
	SCHOOL_CODE_TTL_MS,
	SCHOOL_VERIFIED_PUBLIC_THRESHOLD,
	SCHOOL_VERIFY_DAILY_CAP
} from '../../src/school/verification';
import { FRIEND_REQUEST_REJECTED_COOLDOWN_MS } from '../../src/social/relations';
import { RESOLVED_RESULTS_RETENTION_MS } from '../../src/social/resolved-results';
import {
	TOURNAMENT_BRACKET_SIZE,
	TOURNAMENT_MIN_CALLS_PER_MATCH,
	TOURNAMENT_ROUND_DURATION_MS,
	TOURNAMENT_ROUNDS
} from '../../src/tournaments/tournaments';
import { MIN_CALLS_FOR_RANK } from '../../src/worlds/affiliation-stats';
import { AFFILIATION_LOCK_MS } from '../../src/worlds/affiliations';
import {
	extractBlock,
	extractDecimalConst,
	extractIntConst,
	extractProductConst,
	extractRegexLiteral,
	extractRegExpConstructor,
	extractStringConst,
	importRepoModule,
	quotedStrings,
	readRepoSource
} from '../helpers/repo-source';

// The validation bounds, windows and wire strings the API enforces on the
// same documents and calls the app validates. Most app modules here
// value-import the app's time units or SDK helpers, so their figures are read
// from the source text; durations resolve the app's unit names through the
// backend's own units. tournament.ts imports nothing the backend CI lacks,
// so it is loaded as-is.

const units = { MINUTE_IN_MS, HOUR_IN_MS, DAY_IN_MS };

const appSource = {
	app: readRepoSource('src/lib/constants/app.constants.ts'),
	affiliation: readRepoSource('src/lib/types/affiliation.ts'),
	affiliationStats: readRepoSource('src/lib/types/affiliation-stats.ts'),
	battle: readRepoSource('src/lib/types/battle.ts'),
	exitSignal: readRepoSource('src/lib/types/exit-signal.ts'),
	flowRewards: readRepoSource('src/lib/constants/flow-rewards.constants.ts'),
	icdc: readRepoSource('src/lib/constants/icdc.constants.ts'),
	league: readRepoSource('src/lib/types/league.ts'),
	monthAnchor: readRepoSource('src/lib/utils/month-anchor.utils.ts'),
	monthlyStats: readRepoSource('src/lib/types/user-monthly-stats.ts'),
	profile: readRepoSource('src/lib/constants/profile.constants.ts'),
	referral: readRepoSource('src/lib/constants/referral.constants.ts'),
	relation: readRepoSource('src/lib/constants/relation.constants.ts'),
	school: readRepoSource('src/lib/types/school.ts'),
	schoolPicker: readRepoSource('src/lib/constants/school-picker.constants.ts'),
	userStats: readRepoSource('src/lib/types/user-stats.ts')
};

/** Compares each backend value with the app figure read by `read`, naming the
 * constant so a failure says which pair drifted. */
const expectPairs = ({
	pairs,
	read
}: {
	pairs: Record<string, number>;
	read: (constName: string) => number;
}): void => {
	for (const [constName, value] of Object.entries(pairs)) {
		expect({ constName, value }).toEqual({ constName, value: read(constName) });
	}
};

describe('shared drift: account lifecycle', () => {
	test('recovery window, exit-signal reasons and note cap', () => {
		expect(ACCOUNT_RECOVERY_WINDOW_MS).toBe(
			extractProductConst({
				source: appSource.app,
				constName: 'ACCOUNT_RECOVERY_WINDOW_MS',
				units
			})
		);

		const reasons: string[] = [...EXIT_SIGNAL_REASONS];

		expect(reasons).toEqual(
			quotedStrings(
				extractBlock({ source: appSource.exitSignal, marker: 'export const EXIT_SIGNAL_REASONS' })
			)
		);
		expect(EXIT_SIGNAL_NOTE_MAX_LENGTH).toBe(
			extractIntConst({ source: appSource.exitSignal, constName: 'EXIT_SIGNAL_NOTE_MAX_LENGTH' })
		);
	});
});

describe('shared drift: profiles', () => {
	test('nickname bounds and handle cooldown', () => {
		expectPairs({
			pairs: { MIN_NICKNAME_LENGTH, MAX_NICKNAME_LENGTH, HANDLE_COOLDOWN_DAYS },
			read: (constName) => extractIntConst({ source: appSource.profile, constName })
		});
	});

	test('nickname charset matches the app pattern', () => {
		// The app builds the pattern behind a try/catch fallback for engines
		// without property escapes; the first constructor is the real one.
		const app = extractRegExpConstructor({
			source: appSource.profile,
			marker: 'const buildNicknamePattern'
		});

		expect({ source: NICKNAME_PATTERN.source, flags: NICKNAME_PATTERN.flags }).toEqual({
			source: app.source,
			flags: app.flags
		});
	});

	test('Flow daily hard cap', () => {
		expect(DAILY_HARD_CAP).toBe(
			extractIntConst({ source: appSource.flowRewards, constName: 'DAILY_HARD_CAP' })
		);
	});

	test('user stats and monthly award gates', () => {
		expect(USER_STATS_RECENT_LIMIT).toBe(
			extractIntConst({ source: appSource.userStats, constName: 'USER_STATS_RECENT_LIMIT' })
		);

		expectPairs({
			pairs: { MONTHLY_MIN_CALLS, BOLD_CALLER_MEDIAN_THRESHOLD },
			read: (constName) => extractDecimalConst({ source: appSource.monthlyStats, constName })
		});
	});
});

describe('shared drift: leagues and battles', () => {
	test('league name and description bounds, invite code and emblems', () => {
		expectPairs({
			pairs: { LEAGUE_NAME_MIN_LENGTH, LEAGUE_NAME_MAX_LENGTH, LEAGUE_DESCRIPTION_MAX_LENGTH },
			read: (constName) => extractIntConst({ source: appSource.league, constName })
		});

		const inviteCode = extractRegexLiteral({
			source: appSource.league,
			constName: 'LEAGUE_INVITE_CODE_REGEX'
		});

		expect(LEAGUE_INVITE_CODE_REGEX.source).toBe(inviteCode.source);
		expect(LEAGUE_INVITE_CODE_REGEX.flags).toBe(inviteCode.flags);

		expectPairs({
			pairs: { LEAGUE_INVITE_CODE_LENGTH, LEAGUE_LEGACY_INVITE_CODE_LENGTH },
			read: (constName) => extractIntConst({ source: appSource.league, constName })
		});

		expect(LEAGUE_INVITE_CODE_ALPHABET).toBe(
			extractStringConst({ source: appSource.league, constName: 'LEAGUE_INVITE_CODE_ALPHABET' })
		);

		const emblems: string[] = [...LEAGUE_EMBLEMS];

		expect(emblems).toEqual(
			quotedStrings(
				extractBlock({ source: appSource.league, marker: 'export const LEAGUE_EMBLEMS' })
			)
		);
	});

	test('league cover size and JPEG quality', () => {
		expect(LEAGUE_IMAGE_SIZE_PX).toBe(
			extractIntConst({ source: appSource.league, constName: 'LEAGUE_IMAGE_SIZE_PX' })
		);
		// The browser encoder takes quality as 0..1, the server encoder as
		// 1..100: the same setting on two scales.
		expect(LEAGUE_IMAGE_JPEG_QUALITY).toBe(
			Math.round(
				extractDecimalConst({ source: appSource.league, constName: 'LEAGUE_IMAGE_JPEG_QUALITY' }) *
					100
			)
		);
	});

	test('battle amount range, trash-talk cap and respond-by window', () => {
		expectPairs({
			pairs: { BATTLE_AMOUNT_MIN, BATTLE_AMOUNT_MAX, BATTLE_TRASH_TALK_MAX_LENGTH },
			read: (constName) => extractIntConst({ source: appSource.battle, constName })
		});

		expect(BATTLE_RESPOND_BY_MS).toBe(
			extractProductConst({ source: appSource.battle, constName: 'BATTLE_RESPOND_BY_MS', units })
		);
	});

	test('tournament bracket, rounds, round window and qualification bar', async () => {
		const app = await importRepoModule<{
			TOURNAMENT_BRACKET_SIZE: number;
			TOURNAMENT_MIN_CALLS_PER_MATCH: number;
			TOURNAMENT_ROUND_DURATION_MS: number;
			TOURNAMENT_ROUNDS: readonly string[];
		}>('src/lib/types/tournament.ts');

		expect(TOURNAMENT_BRACKET_SIZE).toBe(app.TOURNAMENT_BRACKET_SIZE);
		expect(TOURNAMENT_MIN_CALLS_PER_MATCH).toBe(app.TOURNAMENT_MIN_CALLS_PER_MATCH);
		expect(TOURNAMENT_ROUND_DURATION_MS).toBe(app.TOURNAMENT_ROUND_DURATION_MS);

		const rounds: string[] = [...TOURNAMENT_ROUNDS];

		expect(rounds).toEqual([...app.TOURNAMENT_ROUNDS]);
	});
});

describe('shared drift: worlds', () => {
	test('affiliation switch lock and ranked-leaderboard bar', () => {
		expect(AFFILIATION_LOCK_MS).toBe(
			extractProductConst({
				source: appSource.affiliation,
				constName: 'AFFILIATION_LOCK_MS',
				units
			})
		);
		expect(MIN_CALLS_FOR_RANK).toBe(
			extractIntConst({ source: appSource.affiliationStats, constName: 'MIN_CALLS_FOR_RANK' })
		);
	});

	test('month anchor format', () => {
		const app = extractRegexLiteral({
			source: appSource.monthAnchor,
			constName: 'MONTH_ANCHOR_RE'
		});

		expect(MONTH_ANCHOR_RE.source).toBe(app.source);
		expect(MONTH_ANCHOR_RE.flags).toBe(app.flags);
	});

	test('school verification code, caps and public threshold', () => {
		expect(SCHOOL_CODE_TTL_MS).toBe(
			extractProductConst({
				source: appSource.schoolPicker,
				constName: 'SCHOOL_CODE_TTL_MS',
				units
			})
		);

		expectPairs({
			pairs: { SCHOOL_CODE_MAX_ATTEMPTS, SCHOOL_VERIFY_DAILY_CAP },
			read: (constName) => extractIntConst({ source: appSource.schoolPicker, constName })
		});

		expect(SCHOOL_VERIFIED_PUBLIC_THRESHOLD).toBe(
			extractIntConst({ source: appSource.school, constName: 'SCHOOL_VERIFIED_PUBLIC_THRESHOLD' })
		);
	});
});

describe('shared drift: social', () => {
	test('rejected friend-request cooldown and resolved-results retention', () => {
		expect(FRIEND_REQUEST_REJECTED_COOLDOWN_MS).toBe(
			extractProductConst({
				source: appSource.relation,
				constName: 'FRIEND_REQUEST_REJECTED_COOLDOWN_MS',
				units
			})
		);
		expect(RESOLVED_RESULTS_RETENTION_MS).toBe(
			extractProductConst({
				source: appSource.app,
				constName: 'RESOLVED_RESULTS_RETENTION_MS',
				units
			})
		);
	});
});

describe('shared drift: referral codes', () => {
	test('code length, alphabet, format and signup window', () => {
		const length = extractIntConst({
			source: appSource.referral,
			constName: 'REFERRAL_CODE_LENGTH'
		});
		const alphabet = extractStringConst({
			source: appSource.referral,
			constName: 'REFERRAL_CODE_ALPHABET'
		});

		expect(REFERRAL_CODE_LENGTH).toBe(length);
		expect(REFERRAL_CODE_ALPHABET).toBe(alphabet);

		// The app derives the format from the alphabet and length; evaluate its
		// template with the app's own values, and read its flags too, since a
		// flag such as `i` changes what the format accepts.
		const args = extractBlock({
			source: appSource.referral,
			marker: 'export const REFERRAL_CODE_REGEX = new RegExp',
			open: '(',
			close: ')'
		})
			.trim()
			.match(/^`([^`]*)`\s*(?:,\s*'([a-z]*)')?\s*,?$/);

		expect(args).not.toBeNull();

		const [, rawTemplate = '', flags = ''] = args ?? [];
		const template = rawTemplate
			.replace('${REFERRAL_CODE_ALPHABET}', alphabet)
			.replace('${REFERRAL_CODE_LENGTH}', String(length));
		const appRegex = new RegExp(template, flags);

		expect(REFERRAL_CODE_REGEX.source).toBe(appRegex.source);
		expect(REFERRAL_CODE_REGEX.flags).toBe(appRegex.flags);

		expect(REFERRAL_SIGNUP_WINDOW_MS).toBe(
			extractProductConst({
				source: appSource.referral,
				constName: 'REFERRAL_SIGNUP_WINDOW_MS',
				units
			})
		);
	});

	test('the existing-user refusal reason the client matches on', () => {
		expect(REFERRAL_EXISTING_USER_REASON).toBe(
			extractStringConst({ source: appSource.referral, constName: 'REFERRAL_EXISTING_USER_REASON' })
		);
	});
});

describe('shared drift: engine identifiers', () => {
	test('Vici engine id and oracle name', () => {
		expect(VICI_ENGINE_ID).toBe(
			extractStringConst({ source: appSource.icdc, constName: 'VICI_ENGINE_ID' })
		);
		expect(VICI_ORACLE_V1).toBe(
			extractStringConst({ source: appSource.app, constName: 'VICI_ORACLE_V1' })
		);
	});
});
