// Request metadata and response status helpers.

/** The client IP behind the hosting proxy, or null when no forwarding header
 * is present (direct local requests, tests). */
export const clientIp = (request: Request): string | null =>
	request.headers.get('fly-client-ip') ??
	request.headers.get('x-forwarded-for')?.split(',')[0]?.trim() ??
	null;

/** The part of Elysia's `set` that the status helpers write. */
export interface StatusContext {
	status?: number | string;
}

/** The part of Elysia's `set` that carries response headers. */
export interface HeadersContext {
	headers: Record<string, string | number>;
}

/** Adds `name` to the response's `Vary` header unless it is already there,
 * keeping what a plugin or an earlier hook put in it. */
export const addVary = (set: HeadersContext, name: string): void => {
	const vary = String(set.headers['vary'] ?? '');
	const present = vary
		.toLowerCase()
		.split(',')
		.map((token) => token.trim())
		.includes(name.toLowerCase());

	if (!present) {
		set.headers['vary'] = vary === '' ? name : `${vary}, ${name}`;
	}
};

/** Standard 400 body; `set.status` is mutated as a side effect. */
export const badRequest = (set: StatusContext, error: string): { error: string } => {
	set.status = 400;

	return { error };
};

/** Standard 503 body for a dependency that is not configured or not reachable;
 * `set.status` is mutated as a side effect. */
export const serviceUnavailable = (set: StatusContext, error: string): { error: string } => {
	set.status = 503;

	return { error };
};
