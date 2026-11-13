// Worlds surface: affiliation slots (with the 90-day lock), rosters and
// member counts, the recomputed standings windows, the frozen monthly
// rankings with champion history, and the podium prize claim.

import { isNullish, nonNullish } from '@dfinity/utils';
import { Elysia, t } from 'elysia';
import { requireUser, unauthenticated } from '../auth/guard';
import { badRequest } from '../lib/http';
import { MONTH_ANCHOR_RE } from '../lib/time';
import {
	AffiliationStatsError,
	getAffiliationStats,
	listAffiliationChampionships,
	listAffiliationStats,
	listAffiliationStatsForMonth
} from '../worlds/affiliation-stats';
import {
	AffiliationError,
	isAffiliationKind,
	listMyAffiliations,
	listWorldsMemberCounts,
	listWorldsRoster,
	removeAffiliation,
	setAffiliation
} from '../worlds/affiliations';
import { claimWorldsPodiumPrize } from '../worlds/podium';

const KIND_SCHEMA = t.Union([t.Literal('university'), t.Literal('country')]);

export const worldsRoutes = new Elysia({ prefix: '/api/v1/worlds' })
	.get('/affiliations/mine', async ({ request, set }) => {
		const user = await requireUser(request);

		if (isNullish(user)) {
			return unauthenticated(set);
		}

		return await listMyAffiliations(user.id);
	})
	.post(
		'/affiliations',
		async ({ request, set, body }) => {
			const user = await requireUser(request);

			if (isNullish(user)) {
				return unauthenticated(set);
			}

			try {
				return {
					affiliation: await setAffiliation({
						userId: user.id,
						kind: body.kind,
						affiliationIdentifier: body.affiliationIdentifier
					})
				};
			} catch (err) {
				if (err instanceof AffiliationError) {
					return badRequest(set, err.message);
				}

				throw err;
			}
		},
		{
			body: t.Object({
				kind: KIND_SCHEMA,
				affiliationIdentifier: t.String({ minLength: 1, maxLength: 128 })
			})
		}
	)
	.delete('/affiliations/:kind/:affiliationIdentifier', async ({ request, set, params }) => {
		const user = await requireUser(request);

		if (isNullish(user)) {
			return unauthenticated(set);
		}

		if (!isAffiliationKind(params.kind)) {
			return badRequest(set, 'unknown_affiliation_kind');
		}

		try {
			return await removeAffiliation({
				userId: user.id,
				kind: params.kind,
				affiliationIdentifier: params.affiliationIdentifier
			});
		} catch (err) {
			if (err instanceof AffiliationError) {
				return badRequest(set, err.message);
			}

			throw err;
		}
	})
	.get(
		'/roster',
		async ({ request, set, query: params }) => {
			const user = await requireUser(request);

			if (isNullish(user)) {
				return unauthenticated(set);
			}

			return {
				items: await listWorldsRoster({
					kind: params.kind,
					affiliationIdentifier: params.affiliationIdentifier
				})
			};
		},
		{ query: t.Object({ kind: KIND_SCHEMA, affiliationIdentifier: t.String() }) }
	)
	.get(
		'/member-counts',
		async ({ request, set, query: params }) => {
			const user = await requireUser(request);

			if (isNullish(user)) {
				return unauthenticated(set);
			}

			return { items: await listWorldsMemberCounts(params.kind) };
		},
		{ query: t.Object({ kind: KIND_SCHEMA }) }
	)
	.get(
		'/stats',
		async ({ request, set, query: params }) => {
			const user = await requireUser(request);

			if (isNullish(user)) {
				return unauthenticated(set);
			}

			return {
				stats: await getAffiliationStats({
					kind: params.kind,
					affiliationIdentifier: params.affiliationIdentifier
				})
			};
		},
		{ query: t.Object({ kind: KIND_SCHEMA, affiliationIdentifier: t.String() }) }
	)
	.get(
		'/leaderboard',
		async ({ request, set, query: params }) => {
			const user = await requireUser(request);

			if (isNullish(user)) {
				return unauthenticated(set);
			}

			const limit = nonNullish(params.limit) ? Number(params.limit) : undefined;

			return {
				items: await listAffiliationStats({
					kind: params.kind,
					limit: nonNullish(limit) && Number.isInteger(limit) && limit > 0 ? limit : undefined
				})
			};
		},
		{ query: t.Object({ kind: KIND_SCHEMA, limit: t.Optional(t.String()) }) }
	)
	.get(
		'/leaderboard/month',
		async ({ request, set, query: params }) => {
			const user = await requireUser(request);

			if (isNullish(user)) {
				return unauthenticated(set);
			}

			if (!MONTH_ANCHOR_RE.test(params.monthAnchor)) {
				return badRequest(set, 'invalid_month_anchor');
			}

			return {
				items: await listAffiliationStatsForMonth({
					kind: params.kind,
					monthAnchor: params.monthAnchor
				})
			};
		},
		{ query: t.Object({ kind: KIND_SCHEMA, monthAnchor: t.String() }) }
	)
	.get(
		'/championships',
		async ({ request, set, query: params }) => {
			const user = await requireUser(request);

			if (isNullish(user)) {
				return unauthenticated(set);
			}

			return {
				items: await listAffiliationChampionships({
					kind: params.kind,
					affiliationIdentifier: params.affiliationIdentifier
				})
			};
		},
		{ query: t.Object({ kind: KIND_SCHEMA, affiliationIdentifier: t.String() }) }
	)
	.post(
		'/podium/claim',
		async ({ request, set, body }) => {
			const user = await requireUser(request);

			if (isNullish(user)) {
				return unauthenticated(set);
			}

			try {
				return await claimWorldsPodiumPrize({ userId: user.id, monthAnchor: body.monthAnchor });
			} catch (err) {
				if (err instanceof AffiliationStatsError) {
					return badRequest(set, err.message);
				}

				throw err;
			}
		},
		{ body: t.Object({ monthAnchor: t.String() }) }
	);
