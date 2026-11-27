// Fixed-window per-key rate limiters for the unauthenticated auth surface.
// `enforceLimit` is in-memory and therefore per-instance: right for a limit on
// the caller (an IP, an account), where losing state on restart only resets
// windows. `enforceSharedLimit` keeps its windows in Postgres, so every API
// machine counts against one budget: for a limit that protects someone other
// than the caller, which a per-machine count would multiply.

import { isNullish } from '@dfinity/utils';
import { query } from '../db/client';
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

/** The 429 + Retry-After answer for an exhausted limit, or nothing when it
 * allows the call: for a limit a domain checks itself (`sharedRateLimit`). */
export const limitedAnswer = ({
	set,
	result
}: {
	set: LimitContext;
	result: RateLimitResult;
}): { error: string } | undefined => {
	if (result.ok) {
		return;
	}

	set.status = 429;
	set.headers['retry-after'] = result.retryAfterSec;

	return { error: 'rate_limited' };
};

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

	return limitedAnswer({ set, result });
};

let lastSharedPrune = 0;

/** `rateLimit` over the `rate_limit_windows` table: one atomic upsert per hit,
 * so concurrent hits on any machine cannot all slip under the limit. The
 * stored count stops at `limit + 1`, enough to say "over". */
export const sharedRateLimit = async (
	key: string,
	limit: number,
	windowMs: number
): Promise<RateLimitResult> => {
	const now = Date.now();

	if (now - lastSharedPrune >= MINUTE_IN_MS) {
		lastSharedPrune = now;
		await query(`delete from rate_limit_windows where reset_at <= now()`);
	}

	const [row] = await query<{ count: number; retry_after_ms: number }>(
		`insert into rate_limit_windows as w (key, count, reset_at)
		 values ($1, 1, now() + make_interval(secs => $2::double precision / 1000))
		 on conflict (key) do update set
		   count = case when w.reset_at <= now() then 1 else least(w.count + 1, $3 + 1) end,
		   reset_at = case when w.reset_at <= now() then excluded.reset_at else w.reset_at end
		 returning count, (extract(epoch from (reset_at - now())) * 1000)::double precision as retry_after_ms`,
		[key, windowMs, limit]
	);

	if (isNullish(row) || row.count <= limit) {
		return { ok: true, retryAfterSec: 0 };
	}

	return { ok: false, retryAfterSec: Math.max(1, Math.ceil(row.retry_after_ms / 1000)) };
};

/** `enforceLimit` with its windows in Postgres, shared by every API machine
 * (`sharedRateLimit`). Same 429 + Retry-After answer. */
export const enforceSharedLimit = async ({
	set,
	name,
	key,
	limit,
	windowMs
}: {
	set: LimitContext;
	name: string;
	key: string;
	limit: number;
	windowMs: number;
}): Promise<{ error: string } | undefined> => {
	const result = await sharedRateLimit(`${name}:${key}`, limit, windowMs);

	return limitedAnswer({ set, result });
};

/** Test hook: forget every window so suites cannot trip each other's limits. */
export const resetRateLimits = (): void => {
	windows.clear();
	lastSweep = 0;
};

/** E2E hook: forget every shared window too. Wipes the whole table, so only a
 * disposable stack may call it (`POST /__e2e/reset-rate-limits`). */
export const resetSharedRateLimits = async (): Promise<void> => {
	await query(`delete from rate_limit_windows`);
	lastSharedPrune = 0;
};
