import type { LandingClaimError, LandingClaimSubmit } from '#lib/types/landing-claim.ts';

/** The code every call answers until the waitlist API exists. */
export const LANDING_WAITLIST_UNAVAILABLE = 'unavailable';

const unavailable = (): Promise<LandingClaimError> =>
	Promise.resolve({ error: LANDING_WAITLIST_UNAVAILABLE });

/**
 * The landing capsule's waitlist calls. There is no waitlist API yet, so
 * both refuse: the capsule says it could not send the code and nothing
 * pretends a handle is held. This module is the one place the waitlist is
 * wired: the real calls replace these two functions.
 */
export const landingWaitlistSubmit: LandingClaimSubmit = {
	requestCode: unavailable,
	confirm: unavailable
};
