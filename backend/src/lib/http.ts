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

/** Standard 400 body; `set.status` is mutated as a side effect. */
export const badRequest = (set: StatusContext, error: string): { error: string } => {
	set.status = 400;

	return { error };
};
