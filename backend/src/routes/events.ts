// Product-analytics surface. The ingest is public (anonymous visitors track
// before sign-in; a valid session adds the pseudonymous user link); the
// summary, exports and drain are admin-only warehouse endpoints.

import { isNullish } from '@dfinity/utils';
import { Elysia, t } from 'elysia';
import { AnalyticsValidationError, MAX_EVENTS_PER_BATCH, trackEvents } from '../analytics/events';
import {
	deleteAnalyticsEvents,
	getAnalyticsEvents,
	getAnalyticsProfileCreated,
	getAnalyticsSummary,
	getAnalyticsUserStats
} from '../analytics/export';
import { forbidden, requireAdmin, requireUser, unauthenticated } from '../auth/guard';
import { badRequest, clientIp } from '../lib/http';
import { enforceLimit } from '../lib/rate-limit';
import { MINUTE_IN_MS } from '../lib/time';

/** Per-IP ingest ceiling. The app flushes its event buffer on a short
 * debounce or when the buffer fills (src/lib/services/analytics.services.ts),
 * so one tab sends a handful of batches a minute; this leaves room for a full
 * classroom behind one school NAT. */
const INGEST_LIMIT_PER_MINUTE = 600;

export const eventsRoutes = new Elysia({ prefix: '/api/v1/events' })
	.post(
		'/',
		async ({ request, set, body }) => {
			const limited = enforceLimit({
				set,
				name: 'analytics_ingest',
				ip: clientIp(request),
				limit: INGEST_LIMIT_PER_MINUTE,
				windowMs: MINUTE_IN_MS
			});

			if (limited) {
				return limited;
			}

			// Anonymous ingest is deliberate: pre-sign-in sessions track too. A
			// valid session cookie links the batch to its user pseudonymously.
			const user = await requireUser(request);

			try {
				return await trackEvents({ events: body.events, userId: user?.id });
			} catch (err) {
				if (err instanceof AnalyticsValidationError) {
					return badRequest(set, err.message);
				}

				throw err;
			}
		},
		{ body: t.Object({ events: t.Array(t.Any(), { maxItems: MAX_EVENTS_PER_BATCH }) }) }
	)
	.get(
		'/summary',
		async ({ request, set, query: params }) => {
			const user = await requireUser(request);

			if (isNullish(user)) {
				return unauthenticated(set);
			}

			const admin = requireAdmin(user);

			if (isNullish(admin)) {
				return forbidden(set);
			}

			return await getAnalyticsSummary({ days: params.days });
		},
		{ query: t.Object({ days: t.Numeric() }) }
	)
	.get('/user-stats', async ({ request, set }) => {
		const user = await requireUser(request);

		if (isNullish(user)) {
			return unauthenticated(set);
		}

		const admin = requireAdmin(user);

		if (isNullish(admin)) {
			return forbidden(set);
		}

		return await getAnalyticsUserStats();
	})
	.get(
		'/export',
		async ({ request, set, query: params }) => {
			const user = await requireUser(request);

			if (isNullish(user)) {
				return unauthenticated(set);
			}

			const admin = requireAdmin(user);

			if (isNullish(admin)) {
				return forbidden(set);
			}

			try {
				return await getAnalyticsEvents({
					afterUpdatedAtNs: params.afterUpdatedAtNs,
					afterKey: params.afterKey,
					limit: params.limit ?? Number.NaN
				});
			} catch (err) {
				if (err instanceof AnalyticsValidationError) {
					return badRequest(set, err.message);
				}

				throw err;
			}
		},
		{
			query: t.Object({
				afterUpdatedAtNs: t.Optional(t.String()),
				afterKey: t.Optional(t.String()),
				limit: t.Optional(t.Numeric())
			})
		}
	)
	.get(
		'/profile-created',
		async ({ request, set, query: params }) => {
			const user = await requireUser(request);

			if (isNullish(user)) {
				return unauthenticated(set);
			}

			const admin = requireAdmin(user);

			if (isNullish(admin)) {
				return forbidden(set);
			}

			return await getAnalyticsProfileCreated({
				afterKey: params.afterKey,
				limit: params.limit ?? Number.NaN
			});
		},
		{
			query: t.Object({
				afterKey: t.Optional(t.String()),
				limit: t.Optional(t.Numeric())
			})
		}
	)
	.post(
		'/delete',
		async ({ request, set, body }) => {
			const user = await requireUser(request);

			if (isNullish(user)) {
				return unauthenticated(set);
			}

			const admin = requireAdmin(user);

			if (isNullish(admin)) {
				return forbidden(set);
			}

			return await deleteAnalyticsEvents({ keys: body.keys });
		},
		{ body: t.Object({ keys: t.Array(t.String()) }) }
	);
