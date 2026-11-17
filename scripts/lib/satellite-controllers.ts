/**
 * Prints `SATELLITE_CONTROLLERS`, space-separated, so shell scripts read the
 * human admin principals from the one place they are written.
 *
 * Usage: npx tsx scripts/lib/satellite-controllers.ts
 */
import { SATELLITE_CONTROLLERS } from '#lib/constants/controllers.constants.ts';

console.log(SATELLITE_CONTROLLERS.join(' '));
