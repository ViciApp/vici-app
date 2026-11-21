import { isNullish, nonNullish } from '@dfinity/utils';
import type { Doc, ListParams, ListResults } from '@junobuild/functions';

/**
 * Juno's page of the listed docs: key order (its datastore is a B-tree on the key), the docs
 * after `start_after`, at most `limit` of them. A `start_after` naming no listed key answers an
 * empty page with no `items_page`, as Juno does.
 */
export const paginated = ({
	matches,
	params
}: {
	matches: [string, Doc][];
	params: ListParams;
}): ListResults<Doc> => {
	const matchesLength = BigInt(matches.length);
	const { paginate } = params;

	if (isNullish(paginate)) {
		return { items: matches, items_length: matchesLength, matches_length: matchesLength };
	}

	const ordered = [...matches].sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
	const startAfter = paginate.start_after;
	const afterIndex = isNullish(startAfter) ? -1 : ordered.findIndex(([key]) => key === startAfter);

	if (nonNullish(startAfter) && afterIndex < 0) {
		return { items: [], items_length: BigInt(0), matches_length: matchesLength };
	}

	const start = afterIndex + 1;
	const limit = isNullish(paginate.limit) ? undefined : Number(paginate.limit);
	const items = ordered.slice(start, isNullish(limit) ? undefined : start + limit);

	return {
		items,
		items_length: BigInt(items.length),
		items_page: isNullish(limit) || limit === 0 ? undefined : BigInt(Math.floor(start / limit)),
		matches_length: matchesLength
	};
};
