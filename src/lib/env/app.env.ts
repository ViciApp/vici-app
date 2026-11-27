/** The Vite build env, or `undefined` where `import.meta.env` does not exist
 * (plain Node, e.g. the spec runner). */
export const viteEnv = (): ImportMetaEnv | undefined =>
	typeof import.meta !== 'undefined'
		? (import.meta as ImportMeta & { env?: ImportMetaEnv }).env
		: undefined;

export const isDev = (): boolean => viteEnv()?.DEV === true;

export const isProd = (): boolean => viteEnv()?.PROD === true;

/** The public Cloudflare Turnstile site key (`VITE_TURNSTILE_SITE_KEY`), or
 * `undefined` when the build carries none. */
export const turnstileSiteKey = (): string | undefined => {
	const raw: unknown = viteEnv()?.VITE_TURNSTILE_SITE_KEY;

	return typeof raw === 'string' && raw !== '' ? raw : undefined;
};

/**
 * Origin of the HTTP API (`VITE_WEB2_API_URL`), without a trailing slash.
 * Empty when unset, which makes client paths same-origin relative (the
 * reverse-proxy deployment shape).
 */
export const web2ApiBaseUrl = (): string => {
	const raw: unknown = viteEnv()?.VITE_WEB2_API_URL;

	return typeof raw === 'string' ? raw.replace(/\/+$/, '') : '';
};
