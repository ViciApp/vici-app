// OAuth (Google/Apple) returns to `/auth/callback/*` as a HARD document fetch
// from the IC HTTP gateway. When the gateway transiently fails (certification
// not yet settled, cold canister, boundary-node throttle), it serves its own
// "500 Internal error" page before any app JS runs, so the in-page callback
// handler never executes and the sign-in dies. This worker's sole job is to
// intercept that failed navigation and serve the cached app shell, letting the
// SPA boot and finish the callback. It is navigation-fallback only.
//
// Cache-scope safety: the ONLY things cached are (a) the immutable,
// content-hashed Vite `build` assets and (b) the SPA shell HTML. We never cache
// API / canister / satellite / auth / dynamic responses: those come back from
// the IC uncertified inside the SW, and caching them would risk serving stale
// or incorrect on-chain data. Anything that is not a same-origin build asset or
// a navigation passes straight through to the network, untouched.

import { version } from '$app/env';
import { immutable } from '$app/manifest';
import { self } from '$app/service-worker';

// Manifest paths are relative to the base path, and the worker script is
// served from the base path, so resolving against it gives the absolute
// pathname that `fetch` events carry.
const toPathname = (path: string): string => new URL(path, self.location.href).pathname;

const build = immutable.map(({ path }) => toPathname(path));

// Versioned so each deployment invalidates the previous build's assets.
const ASSET_CACHE = `vici-cache-${version}`;

// The shell lives in a SEPARATE, NON-versioned cache so the last-good shell
// survives a version bump: on the deploy that ships a new SW, the gateway may
// still be flaky for the navigation that bootstraps it. Keeping the shell out
// of the versioned cache means `activate` does not evict it, so the fallback
// stays available across upgrades.
const SHELL_CACHE = 'vici-shell';

// Stable key under which any successful navigation response is stored. Because
// the app is `prerender:false` + SPA `fallback`, every route returns the same
// shell HTML, so a single stored entry is a valid fallback for ALL routes,
// including the OAuth callback.
const SHELL_KEY = toPathname('__app_shell');

self.addEventListener('install', (event) => {
	event.waitUntil(
		(async () => {
			const cache = await caches.open(ASSET_CACHE);

			// Best-effort pre-cache: a flaky gateway is the exact condition this
			// worker exists for, so one asset failing to fetch at install must not
			// abort the whole install (`addAll` is all-or-nothing). Misses are
			// fetched on demand and cached by the build-asset handler.
			await Promise.allSettled(build.map((asset) => cache.add(asset)));

			await self.skipWaiting();
		})()
	);
});

self.addEventListener('activate', (event) => {
	event.waitUntil(
		(async () => {
			const keys = await caches.keys();

			await Promise.all(
				keys
					.filter((key) => key !== ASSET_CACHE && key !== SHELL_CACHE)
					.map((key) => caches.delete(key))
			);

			await self.clients.claim();
		})()
	);
});

const BUILD_ASSETS = new Set(build);

const handleNavigation = async (request: Request): Promise<Response> => {
	const shellCache = await caches.open(SHELL_CACHE);

	try {
		const res = await fetch(request);

		// Every SUCCESSFUL navigation passes through untouched, including
		// non-HTML documents (sitemap.xml, robots.txt), which the previous
		// shell-substitution turned into an SPA 404 for any browser with this
		// worker installed. Only cache a genuinely-served HTML shell (2xx +
		// text/html): a gateway error page (the 5xx we exist to mask, but
		// equally a 4xx/3xx HTML page) must never overwrite the last-good
		// shell, or the fallback would serve the wrong document and break
		// sign-in/recovery.
		const contentType = res.headers.get('content-type') ?? '';

		if (res.ok) {
			if (contentType.includes('text/html')) {
				await shellCache.put(SHELL_KEY, res.clone());
			}

			return res;
		}

		// Error response: prefer the last-good shell so the SPA still boots.
		const cached = await shellCache.match(SHELL_KEY);

		return cached ?? res;
	} catch (_err) {
		const cached = await shellCache.match(SHELL_KEY);

		return cached ?? Response.error();
	}
};

const handleBuildAsset = async (request: Request): Promise<Response> => {
	const cache = await caches.open(ASSET_CACHE);

	const cached = await cache.match(request);

	if (nonNullishResponse(cached)) {
		return cached;
	}

	try {
		const res = await fetch(request);

		// Only persist a successful response; caching a transient 5xx/404 would pin
		// a broken asset even after the gateway recovers.
		if (res.ok) {
			await cache.put(request, res.clone());
		}

		return res;
	} catch (_err) {
		return Response.error();
	}
};

// Local guard: `@dfinity/utils` is a FE-only dependency, so the SW resolves
// nullishness inline to keep its dependency surface to SvelteKit's `$app` modules.
const nonNullishResponse = (value: Response | undefined): value is Response =>
	value instanceof Response;

self.addEventListener('fetch', (event) => {
	const { request } = event;

	if (request.method !== 'GET') {
		return;
	}

	const url = new URL(request.url);

	if (url.origin !== self.location.origin) {
		return;
	}

	if (request.mode === 'navigate') {
		event.respondWith(handleNavigation(request));

		return;
	}

	if (BUILD_ASSETS.has(url.pathname)) {
		event.respondWith(handleBuildAsset(request));
	}
});
