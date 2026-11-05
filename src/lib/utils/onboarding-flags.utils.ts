import { del } from '#lib/utils/storage.utils.ts';

/**
 * One-time "seen" flags for the onboarding / coaching overlays (`FlowCoach`
 * per surface + the Battles intro card). Identity-scoped, so they're cleared
 * on a principal change — see `reconcileIdentityScopedStorage`.
 */
export const COACH_ONBOARDING_SEEN_KEY = 'vici.coach-onboarding-seen';
export const COACH_FLOW_SEEN_KEY = 'vici.coach-flow-seen';
export const BATTLES_INTRO_SEEN_KEY = 'vici.battles-intro-seen';

/**
 * Per-surface first-visit tip flags (`SurfaceTip` / `SurfaceTipHost`). Layer 2
 * of the first-run tutorial system: one just-in-time tip per surface, shown at
 * most once per device. Same identity-scoped lifecycle as the coach flags.
 */
export const TIP_DASH_SEEN_KEY = 'vici.tip-dash-seen';
export const TIP_ARENA_SEEN_KEY = 'vici.tip-arena-seen';
export const TIP_PROFILE_SEEN_KEY = 'vici.tip-profile-seen';

/**
 * Dismissal flag for the Dash getting-started checklist (`DashGettingStarted`):
 * a once-per-device card that points first-run users at their first call, team,
 * and league. Persisted so the card stays hidden after the user dismisses it,
 * and identity-scoped like the rest of the onboarding flags.
 */
export const CHECKLIST_DASH_SEEN_KEY = 'vici.checklist-dash-seen';

const ONBOARDING_SEEN_KEYS = [
	COACH_ONBOARDING_SEEN_KEY,
	COACH_FLOW_SEEN_KEY,
	BATTLES_INTRO_SEEN_KEY,
	TIP_DASH_SEEN_KEY,
	TIP_ARENA_SEEN_KEY,
	TIP_PROFILE_SEEN_KEY,
	CHECKLIST_DASH_SEEN_KEY
] as const;

/** Drop every onboarding "seen" flag. Best-effort (see `storage.utils`). */
export const clearOnboardingSeenFlags = (): void => {
	for (const key of ONBOARDING_SEEN_KEYS) {
		del({ key });
	}
};
