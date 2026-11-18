import type { ClearingDid } from '#declarations';
import type { TokenId } from '#lib/types/token.ts';
import { writable } from 'svelte/store';

export interface CollateralStoreData {
	balances: Record<TokenId, bigint>;
	accountState: ClearingDid.AccountStateResponse | undefined;
	assetsConfig: Record<string, ClearingDid.CollateralAssetInfo>;
}

export const collateralsStore = writable<CollateralStoreData | undefined>(undefined);
