// Product-analytics surface. The ingest is public (anonymous visitors track
// before sign-in; a valid session adds the pseudonymous user link); the
// summary, exports and drain are admin-only warehouse endpoints.

import { isNullish } from '@dfinity/utils';
import { Elysia, t } from 'elysia';
import { AnalyticsValidationError, trackEvents } from '../analytics/events';
import {
	deleteAnalyticsEvents,
	getAnalyticsEvents,
	getAnalyticsProfileCreated,
	getAnalyticsSummary,
	getAnalyticsUserStats
} from '../analytics/export';
import { forbidden, requireAdmin, requireUser, unauthenticated } from '../auth/guard';
import { badRequest } from '../lib/http';

export const eventsRoutes = new Elysia({ prefix: '/api/v1/events' })
	.post(
		'/',
		async ({ request, set, body }) => {
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
		{ body: t.Object({ events: t.Array(t.Any()) }) }
	)
	.get(
		'/summary',
		async ({ request, set, query: params }) => {
			const user = await requireUser(request);

			if (isNullish(user)) {
				return unauthenticated(set);
			}

			const admin = await requireAdmin(request);

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

		const admin = await requireAdmin(request);

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

			const admin = await requireAdmin(request);

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

			const admin = await requireAdmin(request);

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

			const admin = await requireAdmin(request);

			if (isNullish(admin)) {
				return forbidden(set);
			}

			return await deleteAnalyticsEvents({ keys: body.keys });
		},
		{ body: t.Object({ keys: t.Array(t.String()) }) }
	);
