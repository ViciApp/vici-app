/**
 * Backend seam: which backend the app talks to, decided at build time.
 *
 * `VITE_BACKEND` selects the mode: unset (or `web3`) keeps every domain on
 * the current stack, `web2` routes the domains that have a dual-mode path
 * to the HTTP API at `VITE_WEB2_API_URL`. The default is `web3` so a build
 * without the flag behaves exactly as today.
 *
 * See `docs/ai/frontend/web2-backend-mode.md` for the per-domain swap
 * pattern and the rules around this seam.
 */

import { viteEnv } from '#lib/env/app.env.ts';

export type BackendMode = 'web2' | 'web3';

export const backendMode = (): BackendMode =>
	viteEnv()?.VITE_BACKEND === 'web2' ? 'web2' : 'web3';

export const isWeb2Backend = (): boolean => backendMode() === 'web2';

/**
 * Origin of the HTTP API, without a trailing slash. Empty when
 * `VITE_WEB2_API_URL` is unset, which makes client paths same-origin
 * relative (the reverse-proxy deployment shape).
 */
export const web2ApiBaseUrl = (): string => {
	const raw: unknown = viteEnv()?.VITE_WEB2_API_URL;

	return typeof raw === 'string' ? raw.replace(/\/+$/, '') : '';
};
