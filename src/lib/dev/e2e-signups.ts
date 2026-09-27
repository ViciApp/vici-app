import { browser } from '$app/environment';
import { E2E_OPEN_SIGNUPS_STORAGE_KEY } from '$lib/constants/e2e.constants';
import { isDev } from '$lib/env/app.env';

/**
 * True only on a dev build whose storage carries the Playwright opt-in
 * ({@link E2E_OPEN_SIGNUPS_STORAGE_KEY}). Every spec signs in through the
 * `/signup` onboarding with a principal that may have no profile yet, which the
 * legacy build otherwise turns away to the new app. A production bundle never
 * honours the flag (`isDev()` is statically false there), so a visitor cannot
 * re-open sign-ups by writing the key by hand. Specs that assert the moved
 * screen clear the flag first.
 */
export const isE2eOpenSignups = (): boolean => {
	if (!browser || !isDev()) {
		return false;
	}

	try {
		return localStorage.getItem(E2E_OPEN_SIGNUPS_STORAGE_KEY) === '1';
	} catch {
		return false;
	}
};
