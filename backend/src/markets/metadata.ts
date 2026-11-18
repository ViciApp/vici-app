// Per-series editorial metadata (why-now context, event markers, taxonomy
// tags, the suggested flag and the Flow subtitle). Reads are public; writes
// go through the curator gate and keep the tag reverse index in step inside
// the same transaction.

import { isNullish, nonNullish } from '@dfinity/utils';
import type { AuthedUser } from '../auth/guard';
import { query, tx } from '../db/client';
import { assertCreatorOrAdmin, MarketValidationError } from './curator';
import { updateMarketTagIndex } from './tag-index';
import { normalizeStoredTags } from './taxonomy';

const WHY_NOW_KINDS = ['closing', 'trending', 'new', 'topical', 'social'] as const;
const EVENT_DIRECTIONS = ['up', 'down'] as const;

export interface MarketWhyNow {
	kind: (typeof WHY_NOW_KINDS)[number];
	text: string;
}

export interface MarketEvent {
	day: number;
	label: string;
	dir: (typeof EVENT_DIRECTIONS)[number];
}

export interface MarketMetadata {
	seriesId: string;
	whyNow?: MarketWhyNow;
	events: MarketEvent[];
	tags: string[];
	suggested: boolean;
	subtitle?: string;
	updatedAt: number;
	updatedBy: string;
}

export interface MarketMetadataInput {
	whyNow?: MarketWhyNow;
	events?: MarketEvent[];
	tags?: string[];
	suggested?: boolean;
	subtitle?: string;
}

const parseWhyNow = (value: unknown): MarketWhyNow | undefined => {
	if (isNullish(value)) {
		return;
	}

	const { kind, text } = value as { kind?: unknown; text?: unknown };

	if (
		typeof kind !== 'string' ||
		!(WHY_NOW_KINDS as readonly string[]).includes(kind) ||
		typeof text !== 'string'
	) {
		throw new MarketValidationError('whyNow must carry a known kind and a text.');
	}

	return { kind: kind as MarketWhyNow['kind'], text };
};

const parseEvents = (value: unknown): MarketEvent[] => {
	if (isNullish(value)) {
		return [];
	}

	if (!Array.isArray(value)) {
		throw new MarketValidationError('events must be an array.');
	}

	return value.map((entry) => {
		const { day, label, dir } = entry as { day?: unknown; label?: unknown; dir?: unknown };

		if (
			typeof day !== 'number' ||
			!Number.isFinite(day) ||
			typeof label !== 'string' ||
			typeof dir !== 'string' ||
			!(EVENT_DIRECTIONS as readonly string[]).includes(dir)
		) {
			throw new MarketValidationError('events entries must carry day, label and dir.');
		}

		return { day, label, dir: dir as MarketEvent['dir'] };
	});
};

const parseTags = (value: unknown): string[] => {
	if (isNullish(value)) {
		return [];
	}

	if (!Array.isArray(value) || value.some((tag) => typeof tag !== 'string')) {
		throw new MarketValidationError('tags must be an array of strings.');
	}

	return value as string[];
};

interface MetadataRow {
	series_id: string;
	why_now: unknown;
	events: unknown;
	tags: unknown;
	suggested: boolean;
	subtitle: string | null;
	updated_at_ms: string | number;
	updated_by: string | null;
}

const shapeMetadata = (row: MetadataRow): MarketMetadata => ({
	seriesId: row.series_id,
	...(isNullish(row.why_now) ? {} : { whyNow: row.why_now as MarketWhyNow }),
	events: Array.isArray(row.events) ? (row.events as MarketEvent[]) : [],
	tags: Array.isArray(row.tags) ? (row.tags as string[]) : [],
	suggested: row.suggested,
	...(isNullish(row.subtitle) ? {} : { subtitle: row.subtitle }),
	updatedAt: Number(row.updated_at_ms),
	updatedBy: row.updated_by ?? ''
});

export const getMarketMetadata = async ({
	seriesId
}: {
	seriesId: string;
}): Promise<MarketMetadata | undefined> => {
	const rows = await query<MetadataRow>(`select * from market_metadata where series_id = $1`, [
		seriesId
	]);

	return isNullish(rows[0]) ? undefined : shapeMetadata(rows[0]);
};

export const upsertMarketMetadata = async ({
	user,
	seriesId,
	body
}: {
	user: AuthedUser;
	seriesId: string;
	body: Record<string, unknown>;
}): Promise<MarketMetadata> => {
	const whyNow = parseWhyNow(body.whyNow);
	const events = parseEvents(body.events);
	const tags = normalizeStoredTags(parseTags(body.tags));
	const subtitle = isNullish(body.subtitle) ? undefined : body.subtitle;

	if (nonNullish(subtitle) && typeof subtitle !== 'string') {
		throw new MarketValidationError('subtitle must be a string.');
	}

	if (events.length > 2) {
		throw new MarketValidationError('Market metadata supports at most two events.');
	}

	await assertCreatorOrAdmin({ user, seriesId, surface: 'market metadata' });

	const callerIsAdmin = user.role === 'admin';
	const updatedAt = Date.now();

	return await tx(async (q) => {
		const current = await q<MetadataRow>(
			`select * from market_metadata where series_id = $1 for update`,
			[seriesId]
		);
		const [currentRow] = current;

		// `suggested` is admin-only: creators can edit whyNow/events but cannot
		// flip the suggested flag. Non-admin writers always keep the stored value.
		const suggested = callerIsAdmin
			? Boolean(body.suggested ?? false)
			: (currentRow?.suggested ?? false);

		const oldTags = Array.isArray(currentRow?.tags) ? (currentRow.tags as string[]) : [];

		const rows = await q<MetadataRow>(
			`insert into market_metadata
			   (series_id, why_now, events, tags, suggested, subtitle, updated_at_ms, updated_by)
			 values ($1, $2, $3, $4, $5, $6, $7, $8)
			 on conflict (series_id) do update set
			   why_now = excluded.why_now,
			   events = excluded.events,
			   tags = excluded.tags,
			   suggested = excluded.suggested,
			   subtitle = excluded.subtitle,
			   updated_at_ms = excluded.updated_at_ms,
			   updated_by = excluded.updated_by
			 returning *`,
			[
				seriesId,
				isNullish(whyNow) ? null : JSON.stringify(whyNow),
				JSON.stringify(events),
				JSON.stringify(tags),
				suggested,
				subtitle ?? null,
				updatedAt,
				user.id
			]
		);

		await updateMarketTagIndex({ q, seriesId, oldTags, newTags: tags });

		if (isNullish(rows[0])) {
			throw new Error('market metadata upsert returned no row');
		}

		return shapeMetadata(rows[0]);
	});
};
