import type { MacroId, MicroId } from '#lib/constants/market-taxonomy.constants.ts';
import type { Market } from '#lib/types/market.ts';
import type { MarketPriceSeries } from '#lib/utils/market-price-history.utils.ts';

/** The side a landing visitor calls: lower-case, as the landing callbacks carry it. */
export type LandingDeckSide = 'yes' | 'no';

/** Which footage set a deck card plays; keys of `LANDING_DECK_MEDIA`. */
export type LandingDeckMediaKey = 'gta' | 'btc' | 'barca';

export type LandingDeckOrientation = 'tall' | 'wide';

/** One cut of a card's footage: the still that paints first and the looping clip over it. */
export interface LandingDeckMediaCut {
	stillJpg: string;
	stillWebp: string;
	clipMp4: string;
	clipWebm: string;
	/** Width / height of the cut, to place overlays on the footage at any window size. */
	aspectRatio: number;
}

export interface LandingDeckMedia {
	tall: LandingDeckMediaCut;
	wide: LandingDeckMediaCut;
}

/**
 * One card of the landing deck. The curated cards carry footage and a
 * category; a series the page leads with that is not one of them carries
 * neither, and shows the market's own artwork instead.
 */
export interface LandingDeckSeries {
	seriesId: string;
	media?: LandingDeckMediaKey;
	/** Editorial category shown above the question. */
	category?: MacroId | MicroId;
	/** `object-position` of the wide cut; the tall cut is always centred. */
	wideFocus?: string;
	/**
	 * Fraction down the frame (0 to 1) of a hard dark edge in the footage. When
	 * set, a feathered shade ends exactly on that edge so the text below it
	 * sits on an even ground.
	 */
	seam?: number;
}

/** A deck entry that has footage. */
export type LandingDeckFilm = LandingDeckSeries & { media: LandingDeckMediaKey };

/** A deck card whose series loaded with a live price: everything the card renders. */
export interface LandingDeckCard {
	entry: LandingDeckSeries;
	market: Market;
	/** Crowd price of YES, whole percent. */
	yesPercent: number;
	/** VXP a right call of the default size earns, per side. */
	yesEarns: number;
	noEarns: number;
	/**
	 * YES prices over the last 24 hours (whole percent, oldest first, placed
	 * on that window by `xs`); absent until the history loads.
	 */
	history?: Pick<MarketPriceSeries, 'yes' | 'xs'>;
}

/** A call made on the landing deck, handed to the page that mounts it. */
export interface LandingDeckCall {
	seriesId: string;
	side: LandingDeckSide;
	/** Price of the called side when the visitor called it, whole percent. */
	pricePercent: number;
	atMs: number;
}
