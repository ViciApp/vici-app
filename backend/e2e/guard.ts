// Boot guard for everything under backend/e2e/: the fake engine, the email
// outbox route and the seed script only ever run against a disposable local
// stack. Each condition alone keeps them out of production; together they
// make an accidental activation require several independent mistakes:
//
//   - NODE_ENV must be exactly `test` (the production image pins
//     `production`, and env.ts treats anything else as dev);
//   - VICI_E2E must be exactly `1`, a flag no deployed config sets;
//   - the VXP economy must run record-only (VXP_TREASURY_DISABLED=1), so no
//     award ever attempts a ledger transfer;
//   - the database and the IC host must both be loopback, so the seed can
//     never write to a shared database and any engine path the fake does not
//     cover fails locally instead of reaching mainnet.
//
// The directory is also excluded from the backend image (.dockerignore), so a
// deployed machine has no copy of these entrypoints to run.

import { isNullish } from '@dfinity/utils';
import type { EnvSource } from '../src/env';

const LOOPBACK_HOSTS = new Set(['localhost', '127.0.0.1', '[::1]', '::1']);

const isLoopbackUrl = (raw: string | undefined): boolean => {
	if (isNullish(raw) || raw === '') {
		return false;
	}

	try {
		return LOOPBACK_HOSTS.has(new URL(raw).hostname);
	} catch {
		return false;
	}
};

/** Every reason this environment must not run the E2E entrypoints; empty
 * when it is a disposable local stack. */
export const e2eEnvironmentProblems = (source: EnvSource): string[] => {
	const problems: string[] = [];

	if (source.NODE_ENV !== 'test') {
		problems.push('NODE_ENV must be "test"');
	}

	if (source.VICI_E2E !== '1') {
		problems.push('VICI_E2E must be "1"');
	}

	if (source.VXP_TREASURY_DISABLED !== '1') {
		problems.push('VXP_TREASURY_DISABLED must be "1"');
	}

	if (!isLoopbackUrl(source.DATABASE_URL)) {
		problems.push('DATABASE_URL must point at a loopback host');
	}

	if (!isLoopbackUrl(source.IC_HOST)) {
		problems.push('IC_HOST must point at a loopback host');
	}

	return problems;
};

export const assertE2eEnvironment = (source: EnvSource): void => {
	const problems = e2eEnvironmentProblems(source);

	if (problems.length > 0) {
		throw new Error(`Refusing to run the E2E stack: ${problems.join('; ')}`);
	}
};
