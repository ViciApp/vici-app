import { DAY_IN_MS } from '#lib/constants/time.constants.ts';
import { isNullish } from '@dfinity/utils';

/**
 * The legacy nickname rules, enforced by the satellite (vici.market) only.
 * Every handle picked or changed on vici.app follows the handle rule in
 * `#lib/constants/handle.constants.ts` instead; these stay until the
 * satellite moves to that rule. The STORED value keeps the owner's form:
 * case and accents preserved. Allowed charset: letters (any language) +
 * digits + `. _ -`. Uniqueness is case- AND accent-insensitive: see
 * {@link nicknameUniqueKey}. 2–16 chars.
 */
export const MIN_NICKNAME_LENGTH = 2;
export const MAX_NICKNAME_LENGTH = 16;

/**
 * Validates the stored charset (letters + digits + `. _ -`). Built via
 * guarded `new RegExp` because a `\p{L}` *literal* is a parse-time crash on a
 * JS engine without property escapes: fatal at module load in the satellite.
 * Falls back to ASCII + Latin accent ranges if the engine can't compile it.
 */
const buildNicknamePattern = (): RegExp => {
	try {
		return new RegExp('^[\\p{L}\\p{M}0-9._-]+$', 'u');
	} catch {
		return new RegExp('^[A-Za-z0-9._\\u00C0-\\u024F-]+$');
	}
};

export const NICKNAME_PATTERN = buildNicknamePattern();

/**
 * Case- + accent-insensitive uniqueness key: `José` / `JOSE` / `jose` →
 * `jose`. Trim, NFKD, strip combining marks (U+0300–U+036F range, engine-safe,
 * no property escape), lowercase. Separators `. _ -` are kept (`a_b` ≠ `ab`).
 * Trimming here keeps folding identical for raw and `.trim()`ed call sites
 * (client passes raw, satellite trimmed) so both agree on "the same handle".
 * Used for collisions AND handle-change detection, client + satellite.
 */
const COMBINING_DIACRITICAL_MARKS = new RegExp('[\\u0300-\\u036f]', 'g');
export const nicknameUniqueKey = (raw: string): string =>
	raw.trim().normalize('NFKD').replace(COMBINING_DIACRITICAL_MARKS, '').toLowerCase();

export const PENDING_ONBOARDING_STORAGE_KEY = 'vici:pending-onboarding';

/**
 * A handle can be changed once every {@link HANDLE_COOLDOWN_DAYS} days.
 *
 * Enforcement is server-authoritative: the profile carries a
 * `handleLastChangeMs` timestamp and the set-profile assertion rejects a
 * handle change while the stored value is inside the window (and stamps
 * the message time on an allowed change). The {@link HandleEditor}
 * mirrors the same rule client-side from `handleLastChangeMs` so the UI
 * disables the editor and explains the wait before a doomed write.
 *
 * This constant is shared by the frontend and the satellite assertion so
 * both sides agree on the window.
 */
export const HANDLE_COOLDOWN_DAYS = 30;

/**
 * Whole days the owner must still wait before the handle can change again,
 * given the timestamp of the last change (`handleLastChangeMs`) and a
 * reference "now" (both wall-clock ms). Returns 0 when the cooldown has
 * elapsed or no prior change is on record (`lastChangeMs` nullish), i.e.
 * the handle is changeable. Shared by the {@link HandleEditor} (to disable
 * + explain the wait) and the set-profile assertion (to reject a doomed
 * write), so the UI and the satellite agree on the window.
 */
export const handleCooldownDaysLeft = ({
	lastChangeMs,
	nowMs
}: {
	lastChangeMs: number | undefined | null;
	nowMs: number;
}): number => {
	if (isNullish(lastChangeMs) || lastChangeMs <= 0) {
		return 0;
	}

	const daysSince = Math.floor((nowMs - lastChangeMs) / DAY_IN_MS);

	if (daysSince >= HANDLE_COOLDOWN_DAYS) {
		return 0;
	}

	// Clamp to [0, HANDLE_COOLDOWN_DAYS]: a `lastChangeMs` skewed slightly into
	// the future (tolerated client clock skew) yields a negative `daysSince`,
	// which would otherwise report more than the full cooldown and over-extend
	// the lockout. The full window is the hard ceiling; never report negative.
	return Math.min(HANDLE_COOLDOWN_DAYS, HANDLE_COOLDOWN_DAYS - daysSince);
};

/**
 * Ceiling of a profile's lifetime `points` (display XP): far above any real
 * total and well inside the range where numbers stay exact. Both backends
 * refuse a profile write past it; the API's copy is pinned by a drift test.
 */
export const MAX_PROFILE_POINTS = 1_000_000_000;
