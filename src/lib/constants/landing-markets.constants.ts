/** The two ways the landing Markets view lays out: the front page (the default) or the table. */
export const LANDING_MARKETS_LAYOUTS = ['front', 'table'] as const;

export type LandingMarketsLayout = (typeof LANDING_MARKETS_LAYOUTS)[number];

export const LANDING_MARKETS_DEFAULT_LAYOUT: LandingMarketsLayout = 'front';

/** Per-viewer convenience: the layout last picked on a wide screen. Device-level, not identity-scoped. */
export const LANDING_MARKETS_LAYOUT_STORAGE_KEY = 'vici.landing.markets.layout';

/** Tiles in "Moving now". */
export const LANDING_MOVERS_LIMIT = 4;

/**
 * How many of the most traded markets have their day read for "Moving now":
 * one history read each, so the set stays bounded however large the catalog.
 */
export const LANDING_MOVERS_CANDIDATES = 12;

/** Query parameter naming the market a shared landing link opens (`/?m=<slug~id8>`). */
export const LANDING_MARKET_PARAM = 'm';

/** How long the share button's status label stays up: the confirmation, and the link to copy by hand. */
export const LANDING_SHARE_COPIED_MS = 2_000;
export const LANDING_SHARE_MANUAL_MS = 6_000;
