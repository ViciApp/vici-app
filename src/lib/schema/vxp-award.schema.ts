import { j } from '@junobuild/schema';

/**
 * Zod mirror of the `VxpAwardType` union in `lib/types/vxp-award.ts`, the
 * award types persisted in the `vxp_awards` collection. The backend
 * shared-drift test pins the two against each other.
 */
export const VxpAwardTypeSchema = j.enum([
	'streak',
	'calibration',
	'referral',
	'worlds_podium',
	'tournament_prize',
	'achievement',
	'comeback',
	'flow_milestone',
	'flow_overtime',
	'league_founder'
]);
