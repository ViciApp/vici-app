import type { UserProfile } from '#lib/types/profile.ts';
import type { PrincipalText } from '@junobuild/schema';
import { writable } from 'svelte/store';

/**
 * Cache of `principal → UserProfile` shared across every surface that needs
 * to render a counterpart's name/avatar without re-hitting the satellite:
 * friends list, inbox, activity feed, market recent trades, market
 * discussion. Populated incrementally by `loadProfilesByPrincipals` (see
 * `profile.services.ts`) — callers pass the principals they're about to
 * render and the missing ones get fetched and merged here.
 *
 * Profiles are public (nickname + avatar etc.) so this cache intentionally
 * survives auth transitions: a fresh sign-in doesn't need to re-fetch the
 * profiles user A just looked at.
 */
export const profilesStore = writable<Map<PrincipalText, UserProfile>>(new Map());

/**
 * Merge a single `principal → profile` entry into the cache, replacing
 * any previous entry for the same principal. No-ops when the cached
 * reference already matches the incoming one so this stays cheap to call
 * from a reactive effect.
 */
export const setCachedProfile = ({
	principal,
	profile
}: {
	principal: PrincipalText;
	profile: UserProfile;
}): void => {
	profilesStore.update((current) => {
		if (current.get(principal) === profile) {
			return current;
		}

		const next = new Map(current);
		next.set(principal, profile);

		return next;
	});
};
