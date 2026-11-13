import type { Market, MarketId } from '#lib/types/market.ts';

/**
 * A lineage group: the "root" public market plus every visible fork sharing
 * the same lineage. Used by the markets feed to render stacked cards — one
 * card per lineage — instead of a flat list where the same prediction shows
 * up once per circle.
 *
 * If the actual root market is not in the input (e.g. it was resolved,
 * filtered out, or the caller no longer has visibility on it), the most
 * relevant fork is promoted into `root` and the others become `forks`.
 */
export interface MarketGroup {
	/** Stable grouping key: the id of the original root market. */
	rootId: MarketId;
	/** The market rendered as the "face" of the stack. */
	root: Market;
	/**
	 * True when `root` is an actual fork that was promoted to the face
	 * because the original root market is not present in the input.
	 */
	rootIsPromoted: boolean;
	/** The other visible markets in this lineage, excluding `root`. */
	forks: Market[];
}
