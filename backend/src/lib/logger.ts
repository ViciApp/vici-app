// Thin console wrapper with level prefixes. Fly captures stdout/stderr, so
// structured transports would add weight without adding signal; the prefix is
// enough to grep a level out of the stream. LOG_LEVEL gates verbosity.

import { env } from '../env';

const LEVEL_RANK: Record<string, number> = { debug: 10, info: 20, warn: 30, error: 40 };
const INFO_RANK = 20;

const threshold = LEVEL_RANK[env.logLevel] ?? INFO_RANK;

export const logger = {
	debug: (...args: unknown[]): void => {
		if (threshold <= 10) {
			console.debug('[debug]', ...args);
		}
	},
	info: (...args: unknown[]): void => {
		if (threshold <= 20) {
			console.info('[info]', ...args);
		}
	},
	warn: (...args: unknown[]): void => {
		if (threshold <= 30) {
			console.warn('[warn]', ...args);
		}
	},
	error: (...args: unknown[]): void => {
		console.error('[error]', ...args);
	}
};
