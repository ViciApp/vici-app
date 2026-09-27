// Beta access gate: a rollout valve over sign-in, not a security boundary.
// Admins flip the `beta_gate` app setting ({ enabled, emails, allowNewUsers })
// through the generic settings CRUD. When enabled, sign-in is limited to the
// allowlisted addresses (case-insensitive); with `allowNewUsers` it also
// admits brand-new people while still holding back anyone who already has an
// account on the legacy stack, so nobody forks their history into an empty
// twin account before the data moves over. The gate guards only the points
// where a sign-in learns the caller's email; established sessions are
// untouched.

import { isNullish, nonNullish } from '@dfinity/utils';
import { readAppSetting } from '../admin/settings';
import { query } from '../db/client';
import { normalizeEmail, type Provider } from './identity';

export const BETA_GATE_SETTING_KEY = 'beta_gate';

/** Stable wire code for a gated refusal; deliberately says nothing about
 * whether the address is known to the system. */
export const BETA_CLOSED_ERROR = 'beta_closed';

/** Stable wire code for an address that belongs to a legacy account while
 * new users are admitted: "keep using the current app until moving day". It
 * necessarily reveals that the address has a legacy account (the whole point
 * of the message) and nothing more about it. */
export const LEGACY_ACCOUNT_PENDING_ERROR = 'legacy_account_pending';

export type BetaGateVerdict =
	'allowed' | typeof BETA_CLOSED_ERROR | typeof LEGACY_ACCOUNT_PENDING_ERROR;

interface BetaGateSetting {
	enabled?: unknown;
	emails?: unknown;
	allowNewUsers?: unknown;
}

interface BetaGateCaller {
	email: string;
	/** The provider identity asserting the email, when the flow has one
	 * (OAuth). Lets an onboarded user whose provider email changed since
	 * their first sign-in still be recognised, as resolveIdentity would. */
	identity?: { provider: Provider; subject: string };
}

/** Whether this caller already holds a web2 sign-in identity. Same matching
 * as resolveIdentity (subject first, then case-insensitive email), so the
 * gate never refuses someone resolveIdentity would log into an existing
 * account. */
const hasWeb2Identity = async ({ email, identity }: BetaGateCaller): Promise<boolean> => {
	const rows = await query<{ found: number }>(
		`select 1 as found from auth_identities
		 where lower(email) = $1 or (provider = $2 and subject = $3)
		 limit 1`,
		[email, identity?.provider ?? null, identity?.subject ?? null]
	);

	return nonNullish(rows[0]);
};

/** Whether the exported legacy identities carry this address, matched
 * exactly like the login auto-link (lower() on the stored column against
 * the normalized address). Legacy logins without an email on file (passkey,
 * Internet Identity) cannot match here: those people read as new. */
const hasLegacyAccount = async (email: string): Promise<boolean> => {
	const rows = await query<{ found: number }>(
		`select 1 as found from legacy_auth_identities
		 where lower(openid_email) = $1 or lower(profile_email) = $1
		 limit 1`,
		[email]
	);

	return nonNullish(rows[0]);
};

/**
 * The gate's verdict for a sign-in attempt. An absent setting or `enabled`
 * anything but `true` means the gate is off and everyone passes; an enabled
 * gate with a malformed or missing allowlist admits no one (the valve fails
 * closed rather than silently open). `allowNewUsers` only opens the gate
 * when it is exactly `true`; any other value keeps the strict allowlist.
 *
 * With `allowNewUsers`, in order: allowlisted passes; an existing web2
 * identity passes (already onboarded people are never locked out); a legacy
 * account is held back with `legacy_account_pending`; anyone else is new
 * and passes.
 */
export const betaGateVerdict = async (caller: BetaGateCaller): Promise<BetaGateVerdict> => {
	const setting = await readAppSetting<BetaGateSetting>(BETA_GATE_SETTING_KEY);

	if (isNullish(setting) || setting.enabled !== true) {
		return 'allowed';
	}

	// Fail closed on ANY malformed entry rather than quietly honouring the
	// well-formed ones: a half-broken allowlist is a config error, and letting
	// it partially admit callers would contradict the documented behaviour.
	if (!Array.isArray(setting.emails) || setting.emails.some((entry) => typeof entry !== 'string')) {
		return BETA_CLOSED_ERROR;
	}

	const email = normalizeEmail(caller.email);

	if (setting.emails.some((entry) => normalizeEmail(entry) === email)) {
		return 'allowed';
	}

	if (setting.allowNewUsers !== true) {
		return BETA_CLOSED_ERROR;
	}

	const normalizedCaller: BetaGateCaller = { ...caller, email };

	if (await hasWeb2Identity(normalizedCaller)) {
		return 'allowed';
	}

	if (await hasLegacyAccount(email)) {
		return LEGACY_ACCOUNT_PENDING_ERROR;
	}

	return 'allowed';
};
