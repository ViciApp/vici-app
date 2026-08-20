// VICI app backend entry: Bun + Elysia + Postgres. The SPA talks only to this;
// sessions and integrations are all server-side. Route modules land under
// src/routes/ and register here as the domains are ported.

import { isNullish, nonNullish } from '@dfinity/utils';
import { cors } from '@elysiajs/cors';
import { Elysia } from 'elysia';
import { applyAssetAllowlist } from './custody/assets';
import { isDbUnavailable, query } from './db/client';
import { env } from './env';
import { logger } from './lib/logger';
import { accountRoutes } from './routes/account';
import { adminRoutes } from './routes/admin';
import { authRoutes } from './routes/auth';
import { battlesRoutes } from './routes/battles';
import { claimRoutes } from './routes/claim';
import { engineRoutes } from './routes/engine';
import { eventsRoutes } from './routes/events';
import { leaderboardRoutes } from './routes/leaderboard';
import { leaguesRoutes } from './routes/leagues';
import { marketsRoutes } from './routes/markets';
import { profilesRoutes } from './routes/profiles';
import { referralsRoutes } from './routes/referrals';
import { schoolRoutes } from './routes/school';
import { socialRoutes } from './routes/social';
import { tournamentsRoutes } from './routes/tournaments';
import { vxpRoutes } from './routes/vxp';
import { walletRoutes } from './routes/wallet';
import { worldsRoutes } from './routes/worlds';

// Baseline hardening headers on every response. The API serves JSON only, so a
// deny-all framing posture is safe.
const securityHeaders = (set: { headers: Record<string, string | number> }): void => {
	set.headers['x-content-type-options'] = 'nosniff';
	set.headers['x-frame-options'] = 'DENY';
	set.headers['referrer-policy'] = 'no-referrer';
	set.headers['strict-transport-security'] = 'max-age=63072000; includeSubDomains';
};

/** The health probe must resolve or fail well inside the checker's 8s timeout
 * (fly.toml): a pool handing out a dead socket otherwise hangs the probe past
 * the deadline and the checker sees a timeout instead of an honest 503. */
const HEALTH_PROBE_TIMEOUT_MS = 2_500;

/** Consecutive bounded-probe failures before the process exits for a
 * supervised restart (fresh pool). */
const HEALTH_EXIT_THRESHOLD = 3;

let healthFailStreak = 0;
let healthExitTimer: ReturnType<typeof setTimeout> | undefined;

// The self-exit only makes sense under a supervisor (Fly restarts the
// machine); armed when this module actually serves, so importing the app in
// tests can never kill the test runner.
let selfExitArmed = false;

const withHealthProbeDeadline = <T>(probe: Promise<T>): Promise<T> => {
	let timer: ReturnType<typeof setTimeout> | undefined;

	return Promise.race([
		probe.finally(() => clearTimeout(timer)),
		new Promise<never>((_, reject) => {
			timer = setTimeout(() => reject(new Error('health probe timeout')), HEALTH_PROBE_TIMEOUT_MS);
		})
	]);
};

/** SPA origins allowed for credentialed CORS: the configured app URL plus its
 * www./apex twin, so the site works on both hostnames without extra config. */
const allowedOrigins = (() => {
	const origins = new Set<string>([env.publicAppUrl]);

	try {
		const url = new URL(env.publicAppUrl);

		url.hostname = url.hostname.startsWith('www.')
			? url.hostname.slice('www.'.length)
			: `www.${url.hostname}`;
		origins.add(url.origin);
	} catch {
		// non-URL publicAppUrl (dev): keep as-is
	}

	return [...origins];
})();

export const app = new Elysia()
	.onRequest(({ set }) => {
		securityHeaders(set);
	})
	// A THROWN error (e.g. a DB timeout mid-handler) must still answer with the
	// CORS headers: without them the browser masks the real status as a CORS
	// violation. The cors plugin's hooks don't cover every error path, so set
	// the pair here (idempotent, same values the plugin would set) and return a
	// clean JSON body instead of a stack.
	.onError(({ code, error, set, request }) => {
		// Echo the request's origin only when it's on the allowlist: a fixed
		// value would break the www variant, a blind echo would break the scoping.
		const origin = request.headers.get('origin') ?? '';

		set.headers['access-control-allow-origin'] = allowedOrigins.includes(origin)
			? origin
			: env.publicAppUrl;
		set.headers['access-control-allow-credentials'] = 'true';

		const vary = String(set.headers['vary'] ?? '');

		if (
			!vary
				.toLowerCase()
				.split(',')
				.map((t) => t.trim())
				.includes('origin')
		) {
			set.headers['vary'] = vary === '' ? 'Origin' : `${vary}, Origin`;
		}

		if (code === 'NOT_FOUND') {
			set.status = 404;

			return { error: 'not found' };
		}

		if (code === 'VALIDATION' || code === 'PARSE') {
			set.status = 400;

			return { error: 'bad request' };
		}

		const path = new URL(request.url).pathname;

		// A momentary dependency blip (DB failover / restart / dropped socket) is
		// NOT a bad request: answer 503, which clients can retry, instead of a
		// 500. Only genuine faults collapse to 500.
		if (isDbUnavailable(error)) {
			logger.error(`transient dependency error on ${path}, 503 (client retries):`, error);
			set.status = 503;

			return { error: 'unavailable' };
		}

		logger.error(`unhandled error on ${path}:`, error);
		set.status = 500;

		return { error: 'internal' };
	})
	// Credentialed CORS scoped to the SPA origins so the session cookie rides along.
	.use(cors({ origin: allowedOrigins, credentials: true }))
	.use(authRoutes)
	.use(claimRoutes)
	.use(walletRoutes)
	.use(engineRoutes)
	.use(profilesRoutes)
	.use(leaderboardRoutes)
	.use(socialRoutes)
	.use(marketsRoutes)
	.use(eventsRoutes)
	.use(vxpRoutes)
	.use(leaguesRoutes)
	.use(battlesRoutes)
	.use(worldsRoutes)
	.use(tournamentsRoutes)
	.use(accountRoutes)
	.use(referralsRoutes)
	.use(schoolRoutes)
	.use(adminRoutes)
	// Liveness + DB connectivity. Bounded probe; three consecutive failures exit
	// the process for a supervised restart with a fresh pool.
	.get('/health', async ({ set }) => {
		try {
			await withHealthProbeDeadline(query('select 1'));
			healthFailStreak = 0;

			if (nonNullish(healthExitTimer)) {
				clearTimeout(healthExitTimer);
				healthExitTimer = undefined;
			}

			return { ok: true, db: 'connected' };
		} catch (err) {
			healthFailStreak++;
			set.status = 503;

			if (
				selfExitArmed &&
				healthFailStreak >= HEALTH_EXIT_THRESHOLD &&
				isNullish(healthExitTimer)
			) {
				logger.error(
					`health: db probe failed ${healthFailStreak}x consecutively (${err instanceof Error ? err.message : String(err)}), exiting for a supervised restart (fresh pool)`
				);
				healthExitTimer = setTimeout(() => process.exit(1), 250);
			}

			return { ok: false, db: 'unreachable' };
		}
	});

if (import.meta.main) {
	selfExitArmed = true;
	app.listen(env.port);
	logger.info(`vici backend listening on :${env.port}`);

	// Env is the source of truth for which custody assets are live; re-applied
	// at boot so a config change lands with the deploy. Non-fatal on failure
	// (the DB may still be coming up; /health covers that path).
	applyAssetAllowlist().catch((err) => {
		logger.error('custody asset allowlist sync failed at boot:', err);
	});
}

export type App = typeof app;
