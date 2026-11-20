import type { BalanceStoreData } from '#lib/stores/balances.store.ts';
import type { CollateralStoreData } from '#lib/stores/collaterals.store.ts';
import { isNullish } from '@dfinity/utils';

/**
 * The clearing figures, only when they were loaded for the signed-in owner.
 * A load started for one account can land after the switch to the next, and
 * its figures must never be shown or persisted as the next account's.
 */
export const ownedCollaterals = ({
	collaterals,
	owner
}: {
	collaterals: CollateralStoreData | undefined;
	owner: string | undefined;
}): CollateralStoreData | undefined =>
	isNullish(owner) || collaterals?.owner !== owner ? undefined : collaterals;

/**
 * The owner whose holdings snapshot may be written now: the owner the clearing
 * figures were loaded for, once both source stores are loaded for the
 * signed-in owner. `undefined` when nothing may be written.
 */
export const holdingsSnapshotOwner = ({
	collaterals,
	balances,
	owner
}: {
	collaterals: CollateralStoreData | undefined;
	balances: BalanceStoreData | undefined;
	owner: string | undefined;
}): string | undefined => {
	const owned = ownedCollaterals({ collaterals, owner });

	if (isNullish(owned) || isNullish(balances)) {
		return;
	}

	return owned.owner;
};
