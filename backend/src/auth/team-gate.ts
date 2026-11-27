// Team-only sign-in: while vici.app is closed to the public, only addresses on
// the TEAM_SIGNIN_EMAILS allowlist may sign in, create an account or hold a
// session. Unlike the beta gate (an admin-editable rollout valve), this is a
// boundary held in server config, so it cannot be emptied from the app it
// protects. The sign-in routes check it before anything else learns the email;
// requireUser checks it on every session.

import { env } from '../env';
import { normalizeEmail } from './identity';

/** Where the team signs in, and where the OAuth callbacks land a refused or
 * failed sign-in: the public sign-in routes only redirect to the landing. */
export const TEAM_SIGNIN_PATH = '/team';

/** Whether this address may sign in. True for everyone when the gate is off. */
export const isTeamEmail = (email: string): boolean => {
	const { enforced, emails, domains } = env.teamSignin;

	if (!enforced) {
		return true;
	}

	const normalized = normalizeEmail(email);
	const domain = normalized.slice(normalized.lastIndexOf('@') + 1);

	return emails.includes(normalized) || (normalized.includes('@') && domains.includes(domain));
};

/** The bound parameters of the session check in requireUser: the account
 * must carry a sign-in identity whose email passes `isTeamEmail`. Kept here
 * so the SQL and the predicate read one config. */
export const teamSessionParams = (): { enforced: boolean; emails: string[]; domains: string[] } => {
	const { enforced, emails, domains } = env.teamSignin;

	return { enforced, emails, domains };
};
