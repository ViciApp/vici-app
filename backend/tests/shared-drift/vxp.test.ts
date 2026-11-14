import { describe, expect, test } from 'bun:test';
import { ZERO } from '../../src/lib/constants';
import { DAY_IN_MS } from '../../src/lib/time';
import {
	ACHIEVEMENT_XP,
	CALIBRATION_DAILY_CAP,
	CALIBRATION_HOURLY_CAP,
	CALIBRATION_RECOVERY_FLOOR_BASE_UNITS,
	COMEBACK_AWAY_DAYS,
	COMEBACK_BALANCE_FLOOR_BASE_UNITS,
	COMEBACK_RESTORE_TARGET_BASE_UNITS,
	ONBOARDING_M2_TRADE_COUNT,
	ONBOARDING_M3_TRADE_COUNT,
	ONBOARDING_MILESTONE_AMOUNTS,
	parseVxp,
	REFERRAL_MAX_PAID,
	REFERRAL_VXP_BONUS_BASE_UNITS,
	referrerRewardBaseUnits,
	TOURNAMENT_PRIZE_TIERS,
	VXP_CALIBRATION_REWARD_BASE_UNITS,
	VXP_DECIMALS,
	VXP_FLOW_MILESTONES,
	VXP_FLOW_OVERTIME_BONUS,
	VXP_FLOW_OVERTIME_ROLLING_CAP,
	VXP_FLOW_OVERTIME_ROLLING_WINDOW_MS,
	VXP_LEAGUE_FOUNDER_MAX_AWARDS,
	VXP_LEAGUE_FOUNDER_REWARD_BASE_UNITS,
	VXP_STREAK_BONUSES,
	VXP_WORLDS_PODIUM
} from '../../src/vxp/constants';
import {
	extractBlock,
	extractIntConst,
	extractNumericRecord,
	extractProductConst,
	extractUnionLiterals,
	extractVxpBaseUnitsWhole,
	importRepoModule,
	quotedStrings,
	readRepoSource
} from '../helpers/repo-source';

// The app's VXP tunables live in modules that value-import token constants and
// parse helpers, so the figures are pinned by static extraction. Base-unit
// amounts are compared through parseVxp so both sides agree on the whole-VXP
// figure AND the 10^VXP_DECIMALS scaling.

const economy = readRepoSource('src/lib/constants/vxp-economy.constants.ts');

describe('shared drift: VXP award types', () => {
	const appUnion = extractUnionLiterals({
		source: readRepoSource('src/lib/types/vxp-award.ts'),
		typeName: 'VxpAwardType'
	});

	test('the app TS union and its Zod mirror agree', () => {
		const appEnum = quotedStrings(
			extractBlock({
				source: readRepoSource('src/lib/schema/vxp-award.schema.ts'),
				marker: 'export const VxpAwardTypeSchema'
			})
		);

		expect(appEnum).toEqual(appUnion);
	});

	test('backend VxpAwardType is the app union plus the onboarding starter', () => {
		const backendUnion = extractUnionLiterals({
			source: readRepoSource('backend/src/vxp/awards.ts'),
			typeName: 'VxpAwardType'
		});

		// The backend books the onboarding starter through the same awards
		// table, while the satellite tracked it in a dedicated collection, so
		// 'onboarding' is the single deliberate backend-only member.
		expect(backendUnion).toEqual(['onboarding', ...appUnion]);
	});
});

describe('shared drift: VXP decimals', () => {
	test('VXP_DECIMALS matches the app VXP token', () => {
		const tokens = readRepoSource('src/lib/constants/tokens/tokens.ic.constants.ts');
		const block = extractBlock({
			source: tokens,
			marker: 'export const VXP_TOKEN',
			open: '{',
			close: '}'
		});
		const match = block.match(/decimals:\s*(\d+)/);

		expect(VXP_DECIMALS).toBe(Number(match?.[1]));
	});
});

describe('shared drift: VXP amounts', () => {
	test('streak bonuses', () => {
		expect({ ...VXP_STREAK_BONUSES }).toEqual(
			extractNumericRecord({ source: economy, marker: 'VXP_STREAK_BONUSES' })
		);
	});

	test('flow milestones, overtime bonus and rolling caps', () => {
		expect({ ...VXP_FLOW_MILESTONES }).toEqual(
			extractNumericRecord({ source: economy, marker: 'VXP_FLOW_MILESTONES' })
		);
		expect(VXP_FLOW_OVERTIME_BONUS).toBe(
			extractIntConst({ source: economy, constName: 'VXP_FLOW_OVERTIME_BONUS' })
		);
		expect(VXP_FLOW_OVERTIME_ROLLING_WINDOW_MS).toBe(
			extractProductConst({
				source: economy,
				constName: 'VXP_FLOW_OVERTIME_ROLLING_WINDOW_MS',
				units: { DAY_IN_MS }
			})
		);
		expect(VXP_FLOW_OVERTIME_ROLLING_CAP).toBe(
			extractIntConst({ source: economy, constName: 'VXP_FLOW_OVERTIME_ROLLING_CAP' })
		);
	});

	test('calibration reward, recovery floor and caps', () => {
		expect(VXP_CALIBRATION_REWARD_BASE_UNITS).toBe(
			parseVxp(
				extractVxpBaseUnitsWhole({
					source: economy,
					constName: 'VXP_CALIBRATION_REWARD_BASE_UNITS'
				})
			)
		);
		expect(CALIBRATION_RECOVERY_FLOOR_BASE_UNITS).toBe(
			parseVxp(
				extractVxpBaseUnitsWhole({
					source: economy,
					constName: 'CALIBRATION_RECOVERY_FLOOR_BASE_UNITS'
				})
			)
		);
		expect(CALIBRATION_DAILY_CAP).toBe(
			extractIntConst({ source: economy, constName: 'CALIBRATION_DAILY_CAP' })
		);
		expect(CALIBRATION_HOURLY_CAP).toBe(
			extractIntConst({ source: economy, constName: 'CALIBRATION_HOURLY_CAP' })
		);
	});

	test('comeback restore target, floor and away threshold', () => {
		expect(COMEBACK_RESTORE_TARGET_BASE_UNITS).toBe(
			parseVxp(
				extractVxpBaseUnitsWhole({
					source: economy,
					constName: 'COMEBACK_RESTORE_TARGET_BASE_UNITS'
				})
			)
		);
		expect(COMEBACK_BALANCE_FLOOR_BASE_UNITS).toBe(
			parseVxp(
				extractVxpBaseUnitsWhole({
					source: economy,
					constName: 'COMEBACK_BALANCE_FLOOR_BASE_UNITS'
				})
			)
		);
		expect(COMEBACK_AWAY_DAYS).toBe(
			extractIntConst({ source: economy, constName: 'COMEBACK_AWAY_DAYS' })
		);
	});

	test('league founder reward and lifetime cap', () => {
		expect(VXP_LEAGUE_FOUNDER_REWARD_BASE_UNITS).toBe(
			parseVxp(
				extractVxpBaseUnitsWhole({
					source: economy,
					constName: 'VXP_LEAGUE_FOUNDER_REWARD_BASE_UNITS'
				})
			)
		);
		expect(VXP_LEAGUE_FOUNDER_MAX_AWARDS).toBe(
			extractIntConst({ source: economy, constName: 'VXP_LEAGUE_FOUNDER_MAX_AWARDS' })
		);
	});

	test('worlds podium prizes', () => {
		const backend: Record<string, number> = { ...VXP_WORLDS_PODIUM };

		expect(backend).toEqual(extractNumericRecord({ source: economy, marker: 'VXP_WORLDS_PODIUM' }));
	});

	test('tournament prize tiers', async () => {
		const app = await importRepoModule<{
			TOURNAMENT_PRIZE_TIERS: ReadonlyArray<{ place: number; vxp: number }>;
		}>('src/lib/types/tournament.ts');

		const backend: { place: number; vxp: number }[] = TOURNAMENT_PRIZE_TIERS.map(
			({ place, vxp }) => ({ place, vxp })
		);

		expect(backend).toEqual(app.TOURNAMENT_PRIZE_TIERS.map(({ place, vxp }) => ({ place, vxp })));
	});

	test('achievement catalog XP', () => {
		const source = readRepoSource('src/lib/constants/achievements.constants.ts');
		// The marker includes the type annotation: its `[]` would otherwise be
		// taken for the array literal by the balanced-block scan.
		const block = extractBlock({ source, marker: 'export const ACHIEVEMENTS: AchievementDef[] =' });
		const anchors = [...block.matchAll(/id:\s*'([^']+)'/g)];
		const app: Record<string, number> = {};

		anchors.forEach((anchor, i) => {
			const next = anchors[i + 1];
			const objectSlice = block.slice(anchor.index, next?.index ?? block.length);
			const xp = objectSlice.match(/xp:\s*(\d+)/);

			if (!xp) {
				throw new Error(`achievement without xp: ${anchor[1]}`);
			}

			app[anchor[1] ?? ''] = Number(xp[1]);
		});

		expect(anchors.length).toBeGreaterThan(0);
		expect({ ...ACHIEVEMENT_XP }).toEqual(app);
	});
});

describe('shared drift: onboarding milestones', () => {
	const onboarding = readRepoSource('src/lib/constants/vxp-onboarding.constants.ts');

	test('milestone amounts match the app starter split', () => {
		const total = extractVxpBaseUnitsWhole({
			source: onboarding,
			constName: 'NEW_USER_VXP_TOTAL_BASE_UNITS'
		});
		const m1 = extractVxpBaseUnitsWhole({ source: onboarding, constName: 'MILESTONE_1_VXP' });
		const m2 = extractVxpBaseUnitsWhole({ source: onboarding, constName: 'MILESTONE_2_VXP' });

		expect(ONBOARDING_MILESTONE_AMOUNTS.m1).toBe(parseVxp(m1));
		expect(ONBOARDING_MILESTONE_AMOUNTS.m2).toBe(parseVxp(m2));
		// The app computes m3 as the remainder so the three always sum to the
		// starter total.
		expect(ONBOARDING_MILESTONE_AMOUNTS.m3).toBe(parseVxp(total - m1 - m2));
	});

	test('m2/m3 trade-count gates match the satellite service', () => {
		// The satellite keeps these thresholds inline in its eligibility rows
		// rather than as named constants, so they are pinned where they live.
		const satellite = readRepoSource('src/satellite/services/vxp-onboarding.services.ts');
		const m2 = satellite.match(/mk:\s*'m2',\s*eligible:\s*tradeCount\s*>=\s*(\d+)/);
		const m3 = satellite.match(/mk:\s*'m3',\s*eligible:\s*tradeCount\s*>=\s*(\d+)/);

		expect(ONBOARDING_M2_TRADE_COUNT).toBe(Number(m2?.[1]));
		expect(ONBOARDING_M3_TRADE_COUNT).toBe(Number(m3?.[1]));
	});
});

describe('shared drift: referral economy', () => {
	const referral = readRepoSource('src/lib/constants/referral.constants.ts');

	test('referee bonus and lifetime paid cap', () => {
		expect(REFERRAL_VXP_BONUS_BASE_UNITS).toBe(
			parseVxp(extractIntConst({ source: referral, constName: 'REFERRAL_VXP_BONUS_VALUE' }))
		);
		expect(REFERRAL_MAX_PAID).toBe(
			extractIntConst({ source: referral, constName: 'REFERRAL_MAX_PAID' })
		);
	});

	test('referrer reward curve matches the app tiers at every boundary', () => {
		const maxPaid = extractIntConst({ source: referral, constName: 'REFERRAL_MAX_PAID' });
		const block = extractBlock({ source: referral, marker: 'const REFERRAL_REWARD_TIERS' });
		const tiers = [...block.matchAll(/throughIndex:\s*([\w$]+),\s*value:\s*'(\d+)'/g)].map(
			(match) => ({
				throughIndex: match[1] === 'REFERRAL_MAX_PAID' ? maxPaid : Number(match[1]),
				vxp: Number(match[2])
			})
		);

		expect(tiers.length).toBeGreaterThan(0);

		let firstIndex = 1;

		for (const { throughIndex, vxp } of tiers) {
			// priorPaidCount = redemptionIndex - 1: probe both ends of the tier.
			expect(referrerRewardBaseUnits(firstIndex - 1)).toBe(parseVxp(vxp));
			expect(referrerRewardBaseUnits(throughIndex - 1)).toBe(parseVxp(vxp));

			firstIndex = throughIndex + 1;
		}

		expect(referrerRewardBaseUnits(maxPaid)).toBe(ZERO);
	});
});
