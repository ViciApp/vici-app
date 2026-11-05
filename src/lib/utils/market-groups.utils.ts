import type { Market, MarketId } from '#lib/types/market.ts';
import { nonNullish } from '@dfinity/utils';

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

/**
 * Picks the best "face" card when the root market of a lineage is missing
 * from the input. Preference: markets created by the current user, then the
 * most recently created fork.
 */
const pickPromotedRoot = ({
	forks,
	userPrincipal
}: {
	forks: Market[];
	userPrincipal: string | undefined;
}): Market => {
	const mine = userPrincipal ? forks.filter((m) => m.creator === userPrincipal) : [];
	const pool = mine.length > 0 ? mine : forks;

	return [...pool].sort((a, b) => Number(b.createdAt) - Number(a.createdAt))[0];
};

/**
 * Sorts forks for display inside a stack popover: user's own forks first,
 * then by most recently created.
 */
const sortForksForPopover = ({
	forks,
	userPrincipal
}: {
	forks: Market[];
	userPrincipal: string | undefined;
}): Market[] =>
	[...forks].sort((a, b) => {
		if (userPrincipal) {
			const aMine = a.creator === userPrincipal ? 0 : 1;
			const bMine = b.creator === userPrincipal ? 0 : 1;

			if (aMine !== bMine) {
				return aMine - bMine;
			}
		}

		return Number(b.createdAt) - Number(a.createdAt);
	});

/**
 * Collapses a flat list of markets into lineage groups, preserving the
 * ranking order of the input (the first time a lineage is seen, that slot
 * determines where the group appears in the output).
 *
 * @param markets - Input markets, already filtered and ranked.
 * @param userPrincipal - Caller principal text, used to prefer the user's own
 *   forks when promoting a root or sorting the popover list. Optional; when
 *   omitted we fall back to pure recency.
 */
export const groupMarketsByLineage = ({
	markets,
	userPrincipal
}: {
	markets: Market[];
	userPrincipal?: string;
}): MarketGroup[] => {
	const byId = new Map<MarketId, Market>();

	for (const m of markets) {
		byId.set(m.id, m);
	}

	const buckets = new Map<MarketId, Market[]>();
	const insertionOrder: MarketId[] = [];

	for (const m of markets) {
		const rootId = m.forkedFrom ?? m.id;
		const bucket = buckets.get(rootId);

		if (bucket) {
			bucket.push(m);
		} else {
			buckets.set(rootId, [m]);
			insertionOrder.push(rootId);
		}
	}

	return insertionOrder.map((rootId) => {
		const bucket = buckets.get(rootId) ?? [];
		const actualRoot = byId.get(rootId) ?? null;

		if (nonNullish(actualRoot) && bucket.some((m) => m.id === rootId)) {
			const forks = bucket.filter((m) => m.id !== rootId);

			return {
				rootId,
				root: actualRoot,
				rootIsPromoted: false,
				forks: sortForksForPopover({ forks, userPrincipal })
			};
		}

		// Root not visible to this viewer — promote the best available fork so
		// the stacked-card UI always shows a card per lineage.
		const promoted = pickPromotedRoot({ forks: bucket, userPrincipal });
		const forks = bucket.filter((m) => m.id !== promoted.id);

		return {
			rootId,
			root: promoted,
			rootIsPromoted: true,
			forks: sortForksForPopover({ forks, userPrincipal })
		};
	});
};
