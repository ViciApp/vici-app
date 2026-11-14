/**
 * Prints the satellite id `juno.config.ts` pins for a mode, so shell scripts
 * and workflows read it from the one place it is written.
 *
 * Usage: npx tsx scripts/lib/satellite-id.ts <production|development>
 *
 * `development` follows the config's own `JUNO_EMULATOR` swap to the emulator
 * id.
 */
import config from '#root/juno.config.ts';
import { isNullish } from '@dfinity/utils';

const MODES = ['production', 'development'] as const;

type Mode = (typeof MODES)[number];

const isMode = (value: string | undefined): value is Mode => MODES.some((mode) => mode === value);

const [mode] = process.argv.slice(2);

if (!isMode(mode)) {
	console.error(`Usage: npx tsx scripts/lib/satellite-id.ts <${MODES.join('|')}>`);
	process.exit(1);
}

const id = config({ mode }).satellite.ids?.[mode];

if (isNullish(id)) {
	console.error(`juno.config.ts pins no satellite id for ${mode}.`);
	process.exit(1);
}

console.log(id);
