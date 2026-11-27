/**
 * The sign-in method we surface to the user on the account / settings
 * screens, derived from whether an email address is on file.
 */
type SignInMethod = 'email' | 'ii';

/**
 * An address on file surfaces the email-shaped affordance (it carries the
 * address); an account without one falls back to `ii`.
 */
export const resolveSignInMethod = ({ hasEmail }: { hasEmail: boolean }): SignInMethod =>
	hasEmail ? 'email' : 'ii';
