import { localeFallbackChain, type AppLocale } from '#lib/constants/locale.constants.ts';
import { enMessages } from '#lib/constants/messages/en.ts';
import { nonNullish } from '@dfinity/utils';

type Catalog = Record<string, string>;

/**
 * Catalogs we ship today. A `soon` locale may be absent here (no catalog
 * at all), present with a *partial* catalog that defines only the keys
 * where it diverges from its fallback (e.g. the `es-419` landing deltas),
 * or present with a *full* catalog (e.g. `pt-BR`, which today mirrors the
 * Brazilian-voiced `pt` strings verbatim). In every case `t()` resolves any
 * missing key through the locale's fallback chain to a populated locale,
 * ending at `en`.
 *
 * Only `en` is bundled statically: it terminates every fallback chain (so
 * `t()` always has copy to render) and is the `MessageKey` type source.
 * Every other catalog loads on demand via {@link ensureLocaleCatalogs}:
 * bundling them all put a catalog chunk the size of the rest of the app
 * combined on the critical path of every first visit.
 */
const catalogs: Partial<Record<AppLocale, Catalog>> = {
	en: enMessages
};

const catalogLoaders: Partial<Record<AppLocale, () => Promise<Catalog>>> = {
	it: async () => (await import('#lib/constants/messages/it.ts')).itMessages,
	es: async () => (await import('#lib/constants/messages/es.ts')).esMessages,
	'es-419': async () => (await import('#lib/constants/messages/es-419.ts')).es419Messages,
	'es-MX': async () => (await import('#lib/constants/messages/es-MX.ts')).esMxMessages,
	'es-AR': async () => (await import('#lib/constants/messages/es-AR.ts')).esArMessages,
	de: async () => (await import('#lib/constants/messages/de.ts')).deMessages,
	fr: async () => (await import('#lib/constants/messages/fr.ts')).frMessages,
	ja: async () => (await import('#lib/constants/messages/ja.ts')).jaMessages,
	pt: async () => (await import('#lib/constants/messages/pt.ts')).ptMessages,
	'pt-BR': async () => (await import('#lib/constants/messages/pt-BR.ts')).ptBRMessages,
	'zh-Hans': async () => (await import('#lib/constants/messages/zh-Hans.ts')).zhHansMessages
};

const catalogLoads = new Map<AppLocale, Promise<void>>();

const loadCatalog = (locale: AppLocale): Promise<void> => {
	if (nonNullish(catalogs[locale]) || !nonNullish(catalogLoaders[locale])) {
		return Promise.resolve();
	}

	const inFlight = catalogLoads.get(locale);

	if (nonNullish(inFlight)) {
		return inFlight;
	}

	const load = catalogLoaders[locale]()
		.then((catalog) => {
			catalogs[locale] = catalog;
		})
		.catch((err: unknown) => {
			// A failed chunk fetch (offline, mid-deploy asset swap) must not
			// wedge the caller: `t()` falls back through the chain to the
			// bundled `en`, and dropping the memoized promise lets a later
			// call retry the fetch.
			catalogLoads.delete(locale);
			console.warn(`Locale catalog failed to load: ${locale}`, err);
		});

	catalogLoads.set(locale, load);

	return load;
};

/**
 * Load the catalogs `t()` needs to render `locale`: the locale itself plus
 * its whole fallback chain, since a partial catalog (e.g. `es-MX`) resolves
 * most keys through its ancestors. Idempotent and memoized; never rejects.
 * Resolution means every reachable catalog either landed in memory or had
 * its fetch fail (see `loadCatalog`): in the failure case `t()` keeps
 * rendering the bundled `en` copy and the next call retries the fetch, so
 * callers gating a locale switch on this can't deadlock on a flaky network.
 */
export const ensureLocaleCatalogs = async (locale: AppLocale): Promise<void> => {
	await Promise.all(localeFallbackChain(locale).map(loadCatalog));
};

export type MessageKey = keyof typeof enMessages;

const interpolate = ({
	template,
	params
}: {
	template: string;
	params?: Record<string, string | number>;
}): string => {
	if (!params) {
		return template;
	}

	return Object.entries(params).reduce(
		(value, [key, param]) => value.replaceAll(`{${key}}`, String(param)),
		template
	);
};

export const t = ({
	locale,
	key,
	params
}: {
	locale: AppLocale;
	key: MessageKey;
	params?: Record<string, string | number>;
}): string => {
	// Walk the locale's fallback chain (itself → registered fallbacks → en)
	// and take the first catalog that actually carries the key. A `soon`
	// locale with no catalog, or a partial one missing this key, renders the
	// first populated ancestor's copy: never the raw key.
	for (const candidate of localeFallbackChain(locale)) {
		const template = catalogs[candidate]?.[key];

		if (nonNullish(template)) {
			return interpolate({ template, params });
		}
	}

	return interpolate({ template: enMessages[key] ?? key, params });
};
