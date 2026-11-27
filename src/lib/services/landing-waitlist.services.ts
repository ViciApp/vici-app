import * as waitlist from '#lib/services/waitlist.services.ts';
import { localeStore } from '#lib/stores/locale.store.ts';
import type { LandingClaimSubmit } from '#lib/types/landing-claim.ts';
import { readPendingReferralCode } from '#lib/utils/pending-onboarding.utils.ts';
import { isWeb2Backend } from '#lib/web2/backend-mode.ts';
import { get } from 'svelte/store';

/**
 * The landing capsule's waitlist calls: the web2 API's waitlist on the web2
 * build, with the page's language and any referral code a link left; on the
 * legacy build, `waitlistUnavailable`. The one place the landing is wired to
 * the waitlist.
 */
export const landingWaitlistSubmit: LandingClaimSubmit = isWeb2Backend()
	? {
			requestCode: (params) =>
				waitlist.requestCode({
					...params,
					locale: get(localeStore),
					referralCode: readPendingReferralCode()
				}),
			confirm: waitlist.confirm,
			cachedHandle: waitlist.cachedHandle,
			restore: waitlist.restore
		}
	: waitlist.waitlistUnavailable;
