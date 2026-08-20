// Beta access gate: a rollout valve over sign-in, not a security boundary.
// Admins flip the `beta_gate` app setting ({ enabled, emails }) through the
// generic settings CRUD; when enabled, sign-in is limited to the allowlisted
// addresses (case-insensitive). The gate guards only the points where a
// sign-in learns the caller's email; established sessions are untouched.

import { isNullish } from '@dfinity/utils';
import { readAppSetting } from '../admin/settings';
import { normalizeEmail } from './identity';

export const BETA_GATE_SETTING_KEY = 'beta_gate';

/** Stable wire code for a gated refusal; deliberately says nothing about
 * whether the address is known to the system. */
export const BETA_CLOSED_ERROR = 'beta_closed';

interface BetaGateSetting {
	enabled?: unknown;
	emails?: unknown;
}

/**
 * Whether `email` may sign in under the current gate. An absent setting or
 * `enabled` anything but `true` means the gate is off and everyone passes;
 * an enabled gate with a malformed or missing allowlist admits no one (the
 * valve fails closed rather than silently open).
 */
export const isBetaSignInAllowed = async (email: string): Promise<boolean> => {
	const setting = await readAppSetting<BetaGateSetting>(BETA_GATE_SETTING_KEY);

	if (isNullish(setting) || setting.enabled !== true) {
		return true;
	}

	// Fail closed on ANY malformed entry rather than quietly honouring the
	// well-formed ones: a half-broken allowlist is a config error, and letting
	// it partially admit callers would contradict the documented behaviour.
	if (!Array.isArray(setting.emails) || setting.emails.some((entry) => typeof entry !== 'string')) {
		return false;
	}

	const normalized = normalizeEmail(email);

	return setting.emails.some((entry) => normalizeEmail(entry) === normalized);
};
