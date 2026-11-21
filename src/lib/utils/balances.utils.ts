import type { LedgerBalancesRead } from '#lib/types/wallet.ts';
import { isNullish } from '@dfinity/utils';

/**
 * Lays a fresh ledger read over the last known balances of the same account.
 * A token missing from `read` could not be read, so it keeps its previous
 * value instead of turning into a zero. Previous balances of another account
 * are never carried over, and with nobody signed in nothing is known. With
 * nothing known and nothing read the result stays unknown (`undefined`): an
 * empty map would render as zero everywhere.
 */
export const mergeReadBalances = ({
	previous,
	read
}: {
	previous: LedgerBalancesRead | undefined;
	read: LedgerBalancesRead;
}): LedgerBalancesRead | undefined => {
	const { owner, balances } = read;

	if (isNullish(owner)) {
		return;
	}

	const known = previous?.owner === owner ? previous.balances : undefined;

	if (isNullish(known) && Reflect.ownKeys(balances).length === 0) {
		return;
	}

	return { owner, balances: { ...known, ...balances } };
};
