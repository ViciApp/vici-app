/**
 * Prints `VICI_ENGINE_ID`, so shell scripts read the Vici engine id from the
 * one place it is written.
 *
 * Usage: npx tsx scripts/lib/engine-id.ts
 */
import { VICI_ENGINE_ID } from '#lib/constants/icdc.constants.ts';

console.log(VICI_ENGINE_ID);
