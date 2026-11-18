// Per-locale market translation overlays. The original on-chain text remains
// the canonical source; an overlay is rendered when the reader's locale has a
// matching row. Reads are public; the upsert goes through the curator gate.

import { isNullish } from '@dfinity/utils';
import type { AuthedUser } from '../auth/guard';
import { query } from '../db/client';
import { assertCreatorOrAdmin, MarketValidationError } from './curator';
import { isRegisteredLocale, type AppLocale } from './locales';

/**
 * Upper bound on the number of series ids accepted by the bulk read, so a
 * large deck (or a malformed caller) cannot fan one query into an unbounded
 * sweep. The markets surfaces that drive this (the list board and the Flow
 * deck) sit comfortably below this ceiling; anything larger is truncated
 * rather than refused, so the visible head still renders translated.
 */
const MAX_BULK_SERIES_IDS = 200;

export interface OutcomeTranslation {
	id: string;
	title: string;
}

export interface MarketTranslation {
	seriesId: string;
	locale: AppLocale;
	title: string;
	description: string;
	resolution: string;
	outcomes: OutcomeTranslation[];
	updatedAt: number;
	updatedBy: string;
}

const assertRegisteredLocale = (locale: string): AppLocale => {
	if (!isRegisteredLocale(locale)) {
		throw new MarketValidationError(`Unsupported locale: ${locale}`);
	}

	return locale;
};

interface TranslationRow {
	series_id: string;
	locale: string;
	title: string;
	description: string;
	resolution: string;
	outcomes: unknown;
	updated_at_ms: string | number;
	updated_by: string | null;
}

const shapeTranslation = (row: TranslationRow): MarketTranslation => ({
	seriesId: row.series_id,
	locale: row.locale as AppLocale,
	title: row.title,
	description: row.description,
	resolution: row.resolution,
	outcomes: Array.isArray(row.outcomes) ? (row.outcomes as OutcomeTranslation[]) : [],
	updatedAt: Number(row.updated_at_ms),
	updatedBy: row.updated_by ?? ''
});

export const getMarketTranslation = async ({
	seriesId,
	locale
}: {
	seriesId: string;
	locale: string;
}): Promise<MarketTranslation | undefined> => {
	const validated = assertRegisteredLocale(locale);
	const rows = await query<TranslationRow>(
		`select * from market_translations where series_id = $1 and locale = $2`,
		[seriesId, validated]
	);

	return isNullish(rows[0]) ? undefined : shapeTranslation(rows[0]);
};

export const listMarketTranslations = async ({
	seriesId
}: {
	seriesId: string;
}): Promise<MarketTranslation[]> => {
	const rows = await query<TranslationRow>(
		`select * from market_translations where series_id = $1 order by locale`,
		[seriesId]
	);

	return rows.map(shapeTranslation);
};

/**
 * Bulk overlay read for the markets surfaces (list board, Flow deck). Returns
 * every stored translation row whose (seriesId, locale) lies in the cartesian
 * product of the requested ids and candidate locales, the reader's locale
 * fallback chain. The server is a dumb filter: it returns the raw matching
 * rows and the client resolves best-per-series, so the fallback policy lives
 * in exactly one place. seriesIds is capped at MAX_BULK_SERIES_IDS;
 * unsupported locales are dropped up front.
 */
export const listMarketTranslationsForLocales = async ({
	seriesIds,
	locales
}: {
	seriesIds: string[];
	locales: string[];
}): Promise<MarketTranslation[]> => {
	const boundedSeriesIds =
		seriesIds.length > MAX_BULK_SERIES_IDS ? seriesIds.slice(0, MAX_BULK_SERIES_IDS) : seriesIds;
	const validLocales = locales.filter(isRegisteredLocale);

	if (boundedSeriesIds.length === 0 || validLocales.length === 0) {
		return [];
	}

	const rows = await query<TranslationRow>(
		`select * from market_translations
		 where series_id = any($1) and locale = any($2)
		 order by series_id, locale`,
		[boundedSeriesIds, validLocales]
	);

	return rows.map(shapeTranslation);
};

const parseOutcomes = (value: unknown): OutcomeTranslation[] => {
	if (isNullish(value)) {
		return [];
	}

	if (!Array.isArray(value)) {
		throw new MarketValidationError('outcomes must be an array.');
	}

	return value.map((entry) => {
		const { id, title } = entry as { id?: unknown; title?: unknown };

		if (typeof id !== 'string' || typeof title !== 'string') {
			throw new MarketValidationError('outcomes entries must carry id and title.');
		}

		return { id, title };
	});
};

export const upsertMarketTranslation = async ({
	user,
	seriesId,
	locale,
	body
}: {
	user: AuthedUser;
	seriesId: string;
	locale: string;
	body: Record<string, unknown>;
}): Promise<MarketTranslation> => {
	await assertCreatorOrAdmin({ user, seriesId, surface: 'market translations' });

	const validated = assertRegisteredLocale(locale);
	const { title, description, resolution } = body;

	if (
		typeof title !== 'string' ||
		typeof description !== 'string' ||
		typeof resolution !== 'string'
	) {
		throw new MarketValidationError('title, description and resolution must be strings.');
	}

	const outcomes = parseOutcomes(body.outcomes);

	const rows = await query<TranslationRow>(
		`insert into market_translations
		   (series_id, locale, title, description, resolution, outcomes, updated_at_ms, updated_by)
		 values ($1, $2, $3, $4, $5, $6, $7, $8)
		 on conflict (series_id, locale) do update set
		   title = excluded.title,
		   description = excluded.description,
		   resolution = excluded.resolution,
		   outcomes = excluded.outcomes,
		   updated_at_ms = excluded.updated_at_ms,
		   updated_by = excluded.updated_by
		 returning *`,
		[
			seriesId,
			validated,
			title,
			description,
			resolution,
			JSON.stringify(outcomes),
			Date.now(),
			user.id
		]
	);

	if (isNullish(rows[0])) {
		throw new Error('market translation upsert returned no row');
	}

	return shapeTranslation(rows[0]);
};
