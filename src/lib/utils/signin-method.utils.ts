import type { User } from '@junobuild/core';

/**
 * The sign-in method we surface to the user on the account / settings
 * screens. Derived from the provider Juno records on the `#user` doc
 * (`user.data.provider`), refined by whether an email address is on file.
 */
type SignInMethod = 'email' | 'google' | 'passkey' | 'ii';

/**
 * Map Juno's recorded provider to the method we display.
 *
 * - An address on file → `email`: these accounts are passkey-backed but
 *   were created through the email flow, so the email-shaped affordance is
 *   the recognizable one (it carries the address).
 * - `google` → `google`, `webauthn` (a plain passkey) → `passkey`.
 * - `internet_identity` and anything without a recorded provider (the dev
 *   shortcut) fall back to `ii`. Apple also lands here on purpose: it signs
 *   in *through* Internet Identity 2.0, so Juno records it as
 *   `internet_identity` with no way to distinguish it from a passkey II
 *   sign-in.
 */
export const resolveSignInMethod = ({
	user,
	hasEmail
}: {
	user: User | undefined;
	hasEmail: boolean;
}): SignInMethod => {
	if (hasEmail) {
		return 'email';
	}

	switch (user?.data.provider) {
		case 'google':
			return 'google';
		case 'webauthn':
			return 'passkey';
		default:
			return 'ii';
	}
};
