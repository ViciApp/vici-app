// Market curation surface: editorial metadata, per-locale translation
// overlays, and the taxonomy tag index. Reads back public surfaces (market
// detail, list board, Flow deck) and stay public; writes go through the
// curator gate (admin or series creator); the index corrective and the
// bucket dump are admin-only.

import { isNullish } from '@dfinity/utils';
import { Elysia, t } from 'elysia';
import { forbidden, requireAdmin, requireUser, unauthenticated } from '../auth/guard';
import { CuratorForbiddenError, MarketValidationError } from '../markets/curator';
import { getMarketMetadata, upsertMarketMetadata } from '../markets/metadata';
import { getMarketTags, rebuildMarketTagIndex } from '../markets/tag-index';
import {
	getMarketTranslation,
	listMarketTranslations,
	listMarketTranslationsForLocales,
	upsertMarketTranslation
} from '../markets/translations';

interface StatusContext {
	status?: number | string;
}

const mapCuratorError = (set: StatusContext, err: unknown): { error: string } => {
	if (err instanceof CuratorForbiddenError) {
		set.status = 403;

		return { error: err.message };
	}

	if (err instanceof MarketValidationError) {
		set.status = 400;

		return { error: err.message };
	}

	throw err;
};

export const marketsRoutes = new Elysia({ prefix: '/api/v1/markets' })
	// Tag index. Registered before the parameterized series routes so the
	// static /tags segment cannot be captured as a series id.
	.get('/tags', async ({ request, set }) => {
		const user = await requireUser(request);

		if (isNullish(user)) {
			return unauthenticated(set);
		}

		const admin = requireAdmin(user);

		if (isNullish(admin)) {
			return forbidden(set);
		}

		return await getMarketTags();
	})
	.post('/tags/rebuild', async ({ request, set }) => {
		const user = await requireUser(request);

		if (isNullish(user)) {
			return unauthenticated(set);
		}

		const admin = requireAdmin(user);

		if (isNullish(admin)) {
			return forbidden(set);
		}

		return await rebuildMarketTagIndex();
	})
	// Bulk overlay read for the markets surfaces: one call returns every
	// stored translation across the visible series ids x the reader's
	// candidate locales; the client resolves best-per-series.
	.post(
		'/translations/query',
		async ({ body }) => ({
			items: await listMarketTranslationsForLocales({
				seriesIds: body.seriesIds,
				locales: body.locales
			})
		}),
		{
			body: t.Object({
				seriesIds: t.Array(t.String()),
				locales: t.Array(t.String())
			})
		}
	)
	// Metadata
	.get('/:seriesId/metadata', async ({ params }) => ({
		metadata: (await getMarketMetadata({ seriesId: params.seriesId })) ?? null
	}))
	.put('/:seriesId/metadata', async ({ request, set, params, body }) => {
		const user = await requireUser(request);

		if (isNullish(user)) {
			return unauthenticated(set);
		}

		try {
			return {
				metadata: await upsertMarketMetadata({
					user,
					seriesId: params.seriesId,
					body: (body ?? {}) as Record<string, unknown>
				})
			};
		} catch (err) {
			return mapCuratorError(set, err);
		}
	})
	// Translations
	.get('/:seriesId/translations', async ({ params }) => ({
		items: await listMarketTranslations({ seriesId: params.seriesId })
	}))
	.get('/:seriesId/translations/:locale', async ({ set, params }) => {
		try {
			return {
				translation:
					(await getMarketTranslation({ seriesId: params.seriesId, locale: params.locale })) ?? null
			};
		} catch (err) {
			return mapCuratorError(set, err);
		}
	})
	.put('/:seriesId/translations/:locale', async ({ request, set, params, body }) => {
		const user = await requireUser(request);

		if (isNullish(user)) {
			return unauthenticated(set);
		}

		try {
			return {
				translation: await upsertMarketTranslation({
					user,
					seriesId: params.seriesId,
					locale: params.locale,
					body: (body ?? {}) as Record<string, unknown>
				})
			};
		} catch (err) {
			return mapCuratorError(set, err);
		}
	});
