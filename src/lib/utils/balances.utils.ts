import type { TokenId } from '#lib/types/token.ts';
import { isNullish } from '@dfinity/utils';

type Balances = Record<TokenId, bigint>;

/**
 * Lays a fresh ledger read over the last known balances. A token missing
 * from `read` could not be read, so it keeps its previous value instead of
 * turning into a zero. With nothing known and nothing read the result stays
 * unknown (`undefined`): an empty map would render as zero everywhere.
 */
export const mergeReadBalances = ({
	previous,
	read
}: {
	previous: Balances | undefined;
	read: Balances;
}): Balances | undefined => {
	if (isNullish(previous) && Reflect.ownKeys(read).length === 0) {
		return;
	}

	return { ...previous, ...read };
};
