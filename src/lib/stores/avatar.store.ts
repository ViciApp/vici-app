import { upsertProfile } from '#lib/services/profile.services.ts';
import { userStore } from '#lib/stores/user.store.ts';
import { parseParts, serializeParts, type ViciAvatarParts } from '#lib/utils/vici-avatar.utils.ts';
import { nonNullish } from '@dfinity/utils';
import { derived, get, writable, type Readable } from 'svelte/store';

/**
 * Session-durable in-memory cache of the last avatar parts the user committed
 * from the editor. The profile doc is the cross-session persistence layer, but
 * its write can fail (offline, satellite rejection, sandboxed/IC asset host
 * with no reachable backend). Without a fallback, a failed persist would roll
 * the optimistic `userStore` write back and the user's freshly-picked face
 * would silently revert. This cache holds the committed picks for the rest of
 * the session so an edit never vanishes mid-session even when the persist
 * never lands. It is intentionally module-scoped (lives for the page session,
 * cleared on reload) and never written to disk.
 *
 * Keyed to the committing account's `owner` (principal text) so it only ever
 * applies to the account that made the edit. Without the key, a sign-out /
 * sign-in (or switching to a different account that never saved parts) would
 * resolve {@link myAvatarParts} to the previous account's cached face — a
 * cross-account state leak, and permanently wrong for accounts with no saved
 * picks. The serialized form is stored so the parse only re-runs on change.
 */
interface CachedAvatarParts {
	owner: string;
	serialized: string;
}
const sessionAvatarParts = writable<CachedAvatarParts | undefined>(undefined);

/**
 * The logged-in user's saved avatar parts, derived from the live profile in
 * {@link userStore}. Every "you" surface (profile identity card, nav, the
 * leaderboard "You" row) reads this so a save re-renders them all at once —
 * the optimistic `userStore` write in {@link saveMyAvatarParts} flows
 * straight back out here. `undefined` means the user has never saved picks
 * (the surface falls back to a deterministic principal-seeded face).
 *
 * Narrowed to the raw serialized parts + the active `owner` first so the
 * `JSON.parse` in {@link parseParts} only re-runs when those actually change,
 * not on every unrelated `userStore` tick (`authBusy`, balance, …).
 */
const myAvatarPartsRaw: Readable<{ owner: string | undefined; raw: string | undefined }> = derived(
	userStore,
	({ profile }) => ({ owner: profile?.owner, raw: profile?.avatarParts })
);

export const myAvatarParts: Readable<ViciAvatarParts | undefined> = derived(
	[myAvatarPartsRaw, sessionAvatarParts],
	([{ owner, raw }, session]) => {
		const saved = parseParts(raw);

		if (nonNullish(saved)) {
			return saved;
		}

		// Fall back to the session cache only when it belongs to the active
		// account — never let one account see another's cached picks. Otherwise
		// resolve to nothing so the surface uses the principal-seeded default.
		return nonNullish(session) && session.owner === owner
			? parseParts(session.serialized)
			: undefined;
	}
);

/**
 * Persists the logged-in user's avatar parts. Optimistically writes the
 * serialized picks into {@link userStore} first — so every surface reading
 * {@link myAvatarParts} re-renders immediately — then commits to the
 * profile. Rolls the optimistic update back on failure.
 */
export const saveMyAvatarParts = async (parts: ViciAvatarParts): Promise<void> => {
	const { profile } = get(userStore);

	if (!profile) {
		return;
	}

	const { owner } = profile;
	const serialized = serializeParts(parts);
	const previous = profile;
	const updated = { ...profile, avatarParts: serialized };

	// Seed the session-durable cache first, keyed to this account's `owner`:
	// even if the optimistic profile write is rolled back on a persist failure
	// below, `myAvatarParts` keeps resolving to these picks for the rest of the
	// session (for THIS account only), so the user's edit never silently
	// reverts.
	sessionAvatarParts.set({ owner, serialized });

	userStore.update((curr) => ({ ...curr, profile: updated }));

	// Notify avatar-derived surfaces that render outside the reactive
	// `myAvatarParts` path (e.g. the full-bleed profile hero, which recolours
	// its gradient from the picked backdrop) so they re-sync the instant a save
	// commits rather than waiting for an incidental re-render. SSR-safe guard.
	if (typeof window !== 'undefined') {
		window.dispatchEvent(new CustomEvent('avatarchange', { detail: parts }));
	}

	try {
		await upsertProfile({ key: owner, data: updated });
	} catch (err: unknown) {
		userStore.update((curr) => ({ ...curr, profile: previous }));

		throw err;
	}
};
