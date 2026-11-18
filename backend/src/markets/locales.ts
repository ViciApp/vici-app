// Registered app locale ids, mirrored from the app's locale registry. Market
// translation overlays are allowed for any REGISTERED locale, not just the
// live tier: a translation row is independent of the UI string catalog's
// completeness, so a not-yet-live locale can carry market translations before
// its catalog is promoted.

export const REGISTERED_LOCALE_IDS = [
	'en',
	'es',
	'es-419',
	'es-ES',
	'es-MX',
	'es-AR',
	'es-CO',
	'pt',
	'pt-BR',
	'it',
	'fr',
	'de',
	'nl',
	'pl',
	'cs',
	'sk',
	'ru',
	'zh-Hans',
	'ja',
	'ko',
	'hi',
	'vi'
] as const;

export type AppLocale = (typeof REGISTERED_LOCALE_IDS)[number];

const REGISTERED_LOCALE_ID_SET: ReadonlySet<string> = new Set(REGISTERED_LOCALE_IDS);

export const isRegisteredLocale = (locale: string): locale is AppLocale =>
	REGISTERED_LOCALE_ID_SET.has(locale);
