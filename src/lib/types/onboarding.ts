import type { CallSide } from '#lib/types/market.ts';

/**
 * The picks the onboarding flow hands to the signup page: stashed pre-auth
 * as part of the pending onboarding payload, or written straight to the
 * profile when the user is already signed in. `null` means not picked.
 */
export interface OnboardingPicks {
	participantId: string | null;
	side: CallSide | null;
	handle: string | null;
}
