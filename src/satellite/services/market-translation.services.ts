import { Collection } from '#lib/constants/collections.constants.ts';
import { REGISTERED_LOCALE_IDS, type AppLocale } from '#lib/constants/locale.constants.ts';
import type { MarketTranslation, MarketTranslationInput } from '#lib/types/market-translation.ts';
import { isCreatorOrAdmin } from '$satellite/services/_authz';
import { logInfo } from '$satellite/utils/logger.utils';
import { isNullish, nonNullish } from '@dfinity/utils';
import { msgCaller, time } from '@junobuild/functions/ic-cdk';
import { decodeDocData, encodeDocData, getDocStore, setDocStore } from '@junobuild/functions/sdk';

const callerText = (): string => msgCaller().toText();

// Market overlays are allowed for any REGISTERED locale, not just the `live`
// tier in `SUPPORTED_LOCALES`. A translation doc is independent of the FE
// string catalog's completeness, so a `soon` locale (e.g. `pt-BR`) can carry
// market translations before its UI catalog is fully aligned — which is the
// whole point of seeding them ahead of promoting the locale to `live`.
const REGISTERED_LOCALE_ID_SET: ReadonlySet<string> = new Set(REGISTERED_LOCALE_IDS);

/**
 * Upper bound on the number of series ids accepted by the bulk read, so a
 * large deck (or a malformed caller) can't fan one query into an unbounded
 * sweep of per-key reads. The markets surfaces that drive this — the list
 * board and the Flow deck — sit comfortably below this ceiling; anything
 * larger is truncated (with a `log`) rather than refused, so the visible
 * head still renders translated.
 */
const MAX_BULK_SERIES_IDS = 200;

/** Type guard: is this string one of the registered locale ids (live + soon)? */
const isRegisteredLocale = (locale: string): locale is AppLocale =>
	REGISTERED_LOCALE_ID_SET.has(locale);

/**
 * Schema-side `locale` is `j.string()` (see the schema for why), so validate
 * the value here against the registered locale ids before we persist or read.
 */
const assertRegisteredLocale = (locale: string): AppLocale => {
	if (!isRegisteredLocale(locale)) {
		throw new Error(`Unsupported locale: ${locale}`);
	}

	return locale;
};

/**
 * Per-locale translation overlay key. The original on-chain text remains the
 * canonical source; this overlay is rendered when the user's locale has a
 * matching translation doc.
 */
const translationKey = ({ seriesId, locale }: { seriesId: string; locale: AppLocale }): string =>
	`${seriesId}__${locale}`;

const assertCanWriteMarketTranslation = async ({
	seriesId
}: {
	seriesId: string;
}): Promise<void> => {
	if (!(await isCreatorOrAdmin({ caller: msgCaller(), seriesId }))) {
		throw new Error('Only the market creator or an admin can edit market translations.');
	}
};

export const getMarketTranslation = ({
	seriesId,
	locale
}: {
	seriesId: string;
	locale: string;
}): MarketTranslation | undefined => {
	const validated = assertRegisteredLocale(locale);
	const doc = getDocStore({
		collection: Collection.MARKET_TRANSLATIONS,
		key: translationKey({ seriesId, locale: validated }),
		caller: msgCaller()
	});

	return isNullish(doc) ? undefined : decodeDocData<MarketTranslation>(doc.data);
};

export const listMarketTranslations = ({ seriesId }: { seriesId: string }): MarketTranslation[] => {
	const caller = msgCaller();

	// Point-lookup each registered locale by its deterministic key rather than
	// scanning the collection. `listDocsStore` iterates every doc in the
	// collection (a matcher filters the *result*, not the work), so once the
	// collection grew the query blew the 5B-instruction single-message limit and
	// trapped (IC0522) — which surfaced as the detail page silently losing all
	// translations. A bounded set of exact-key reads is O(locales) and
	// scale-stable, mirroring `listMarketTranslationsForLocales`.
	return REGISTERED_LOCALE_IDS.map((id) =>
		getDocStore({
			collection: Collection.MARKET_TRANSLATIONS,
			key: translationKey({ seriesId, locale: id }),
			caller
		})
	)
		.filter(nonNullish)
		.map((doc) => decodeDocData<MarketTranslation>(doc.data));
};

/**
 * Bulk overlay read for the markets surfaces (list board, Flow deck). Returns
 * every stored translation doc whose `(seriesId, locale)` lies in the
 * cartesian product of the requested ids and candidate locales — the reader's
 * locale fallback chain. The server is a dumb filter: it returns the raw
 * matching docs and the caller resolves best-per-series via the shared
 * `resolveMarketTranslation`, so the fallback policy lives in exactly one
 * place (shared with the detail page).
 *
 * Each doc is fetched by exact key (`${seriesId}__${locale}`), so a missing
 * `(seriesId, locale)` pair simply contributes nothing — there is no list
 * scan. `seriesIds` is capped at {@link MAX_BULK_SERIES_IDS} so a single call
 * can't issue an unbounded number of per-key reads; unsupported locales are
 * dropped up front.
 */
export const listMarketTranslationsForLocales = ({
	seriesIds,
	locales
}: {
	seriesIds: string[];
	locales: string[];
}): MarketTranslation[] => {
	const boundedSeriesIds =
		seriesIds.length > MAX_BULK_SERIES_IDS ? seriesIds.slice(0, MAX_BULK_SERIES_IDS) : seriesIds;

	if (seriesIds.length > MAX_BULK_SERIES_IDS) {
		logInfo({
			message: 'market translations bulk read capped',
			detail: { requested: seriesIds.length, cap: MAX_BULK_SERIES_IDS }
		});
	}

	const validLocales = locales.filter(isRegisteredLocale);
	const caller = msgCaller();
	const translations: MarketTranslation[] = [];

	for (const seriesId of boundedSeriesIds) {
		for (const locale of validLocales) {
			const doc = getDocStore({
				collection: Collection.MARKET_TRANSLATIONS,
				key: translationKey({ seriesId, locale }),
				caller
			});

			if (nonNullish(doc)) {
				translations.push(decodeDocData<MarketTranslation>(doc.data));
			}
		}
	}

	return translations;
};

export const upsertMarketTranslation = async ({
	seriesId,
	locale,
	data
}: {
	seriesId: string;
	locale: string;
	data: MarketTranslationInput;
}): Promise<MarketTranslation> => {
	await assertCanWriteMarketTranslation({ seriesId });

	const validated = assertRegisteredLocale(locale);
	const caller = msgCaller();
	const key = translationKey({ seriesId, locale: validated });
	const current = getDocStore({
		collection: Collection.MARKET_TRANSLATIONS,
		key,
		caller
	});

	const translation: MarketTranslation = {
		seriesId,
		locale: validated,
		title: data.title,
		description: data.description,
		resolution: data.resolution,
		outcomes: data.outcomes ?? [],
		updatedAt: Number(time() / 1_000_000n),
		updatedBy: callerText()
	};

	setDocStore({
		collection: Collection.MARKET_TRANSLATIONS,
		key,
		doc: {
			version: current?.version,
			description: seriesId,
			data: encodeDocData(translation)
		},
		caller
	});

	return translation;
};
