import { PublicPath } from '#lib/constants/routes.constants.ts';
import { previousPathStore } from '#lib/stores/previous-path.store.ts';
import { landingSearch } from '#lib/utils/landing-share.utils.ts';
import { goto } from '$app/navigation';
import { resolve } from '$app/paths';
import type { PathnameWithSearchOrHash, ResolvedPathname } from '$app/types';
import { nonNullish } from '@dfinity/utils';
import { get } from 'svelte/store';

/**
 * This build's own origin, for absolute links shared outside the app
 * (invites, share cards, OAuth redirects): `vici.app` on the web2 build,
 * `vici.market` on the legacy one, the dev host locally. Never hard-code a
 * domain for these: a link from one build must land on that same build.
 */
export const appOrigin = (): string => window.location.origin;

/**
 * Navigate "back" in a way that respects the user's actual entry point.
 *
 * - If a prior in-app navigation occurred, calls `history.back()` so the
 *   user returns to the page they came from (preserving scroll state).
 * - Otherwise (cold load, deep link, new tab) falls back to `goto(fallback)`.
 *
 * Relies on the root layout populating `previousPathStore` via `afterNavigate`.
 */
export const goBack = (fallback: string): void => {
	if (nonNullish(get(previousPathStore))) {
		history.back();

		return;
	}

	void goto(fallback);
};

/**
 * `resolve` for app pathnames written with a leading `/` (e.g. `AppPath`
 * values, which are also compared against `page.url.pathname`). SvelteKit's
 * `resolve` treats a leading `/` as a route ID, and route IDs include the
 * `(app)` group segment, so plain pathnames must be passed without it.
 */
export const resolveAppPath = (path: `/${PathnameWithSearchOrHash}`): ResolvedPathname =>
	// `resolve`'s rest-tuple signature only accepts a literal pathname, not a
	// union of them; every member of the union is a valid argument.
	(resolve as (pathname: PathnameWithSearchOrHash) => ResolvedPathname)(
		path.slice(1) as PathnameWithSearchOrHash
	);

/**
 * A link into the signed-out landing (`/`), with what it should open: see
 * `landingSearch`.
 */
export const landingHref = (params: Parameters<typeof landingSearch>[0] = {}): string =>
	`${resolve(PublicPath.Landing)}${landingSearch(params)}`;

/**
 * Where a signed-out visitor browses markets: the landing, on its Markets
 * view. Signed-in sessions browse the app's own board (`AppPath.Home`).
 */
export const signedOutMarketsHref = (search?: string): string =>
	landingHref({ view: 'markets', search });
