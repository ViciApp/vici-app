import type { ClearingDid } from '#declarations';
import type { TokenId } from '#lib/types/token.ts';
import { writable } from 'svelte/store';

export interface CollateralStoreData {
	/**
	 * Signed-in owner the figures were loaded for (the session account id). A
	 * load can land after an account switch, so readers
	 * compare it with the current owner instead of trusting the store.
	 */
	owner: string;
	balances: Record<TokenId, bigint>;
	accountState: ClearingDid.AccountStateResponse | undefined;
	assetsConfig: Record<string, ClearingDid.CollateralAssetInfo>;
}

export const collateralsStore = writable<CollateralStoreData | undefined>(undefined);
