// Writes come from the app's own pages only. The session cookie is
// SameSite=Lax, which a browser still sends on a form posted by a page on a
// sibling subdomain of the app's site, and the API parses a form body like a
// JSON one; so an unsafe request must come from an allowed origin, and a JSON
// route takes a JSON body only.

import { nonNullish } from '@dfinity/utils';

const SAFE_METHODS: ReadonlySet<string> = new Set(['GET', 'HEAD', 'OPTIONS']);

const JSON_MEDIA_TYPE = 'application/json';

/** Fetch metadata a browser sets on a request another site's page made. */
const OTHER_SITE_FETCHES: ReadonlySet<string> = new Set(['cross-site', 'same-site']);

/** A route that takes a body other than JSON. A `crossSite` route is posted
 * by another site's page by design and carries its own check. */
export interface NonJsonRoute {
	method: string;
	path: RegExp;
	mediaType: string;
	crossSite: boolean;
}

export type UnsafeRequestRefusal = 'origin_not_allowed' | 'unsupported_media_type';

const fromAllowedOrigin = ({
	request,
	allowedOrigins
}: {
	request: Request;
	allowedOrigins: readonly string[];
}): boolean => {
	const origin = request.headers.get('origin');

	if (nonNullish(origin)) {
		return allowedOrigins.includes(origin);
	}

	// Browsers send an Origin on every write, so its absence is a client that
	// is not a browser, unless the browser's own fetch metadata says another
	// site made the request.
	return !OTHER_SITE_FETCHES.has(request.headers.get('sec-fetch-site') ?? '');
};

const mediaTypeOf = (request: Request): string =>
	(request.headers.get('content-type') ?? '').split(';')[0]?.trim().toLowerCase() ?? '';

/** Why an unsafe request is refused, or undefined when it may proceed. */
export const refuseUnsafeRequest = ({
	request,
	allowedOrigins,
	nonJsonRoutes
}: {
	request: Request;
	allowedOrigins: readonly string[];
	nonJsonRoutes: readonly NonJsonRoute[];
}): UnsafeRequestRefusal | undefined => {
	if (SAFE_METHODS.has(request.method)) {
		return;
	}

	const { pathname } = new URL(request.url);
	const route = nonJsonRoutes.find(
		({ method, path }) => method === request.method && path.test(pathname)
	);

	if (route?.crossSite !== true && !fromAllowedOrigin({ request, allowedOrigins })) {
		return 'origin_not_allowed';
	}

	const mediaType = mediaTypeOf(request);

	if (mediaType === '' || mediaType === (route?.mediaType ?? JSON_MEDIA_TYPE)) {
		return;
	}

	return 'unsupported_media_type';
};
