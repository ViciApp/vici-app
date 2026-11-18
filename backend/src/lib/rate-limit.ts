// Fixed-window per-key rate limiter for the unauthenticated auth surface.
// In-memory and therefore per-instance; move to a shared store before scaling
// past one instance. State is transient: losing it on restart only resets
// windows, which is safe.

import { isNullish } from '@dfinity/utils';
import type { StatusContext } from './http';
import { MINUTE_IN_MS } from './time';

interface Window {
	count: number;
	resetAt: number;
}

const windows = new Map<string, Window>();
let lastSweep = 0;

// Drop expired windows occasionally so the map cannot grow unbounded.
const sweep = (now: number): void => {
	if (now - lastSweep < MINUTE_IN_MS) {
		return;
	}

	lastSweep = now;

	for (const [key, window] of windows) {
		if (now >= window.resetAt) {
			windows.delete(key);
		}
	}
};

export interface RateLimitResult {
	ok: boolean;
	retryAfterSec: number;
}

/** Allow up to `limit` hits per `windowMs` for `key`. */
export const rateLimit = (key: string, limit: number, windowMs: number): RateLimitResult => {
	const now = Date.now();

	sweep(now);

	const window = windows.get(key);

	if (isNullish(window) || now >= window.resetAt) {
		windows.set(key, { count: 1, resetAt: now + windowMs });

		return { ok: true, retryAfterSec: 0 };
	}

	if (window.count >= limit) {
		return { ok: false, retryAfterSec: Math.max(1, Math.ceil((window.resetAt - now) / 1000)) };
	}

	window.count += 1;

	return { ok: true, retryAfterSec: 0 };
};

interface LimitContext extends StatusContext {
	headers: Record<string, string | number>;
}

/** Route guard: enforce a limit and, when exhausted, set 429 + Retry-After and
 * return the body to short-circuit. Returns undefined to continue. */
export const enforceLimit = ({
	set,
	name,
	ip,
	limit,
	windowMs
}: {
	set: LimitContext;
	name: string;
	ip: string | null;
	limit: number;
	windowMs: number;
}): { error: string } | undefined => {
	const result = rateLimit(`${name}:${ip ?? 'unknown'}`, limit, windowMs);

	if (result.ok) {
		return;
	}

	set.status = 429;
	set.headers['retry-after'] = result.retryAfterSec;

	return { error: 'rate_limited' };
};

/** Test hook: forget every window so suites cannot trip each other's limits. */
export const resetRateLimits = (): void => {
	windows.clear();
	lastSweep = 0;
};
