import { initStorageStore } from '#lib/stores/storage.store.ts';
import type { BalanceDomainKey } from '#lib/types/balance-domain.ts';

export const BALANCE_DOMAIN_STORE_KEY = 'vici-balance-domain';

export interface BalanceDomainData {
	value: BalanceDomainKey;
}

export const balanceDomainStore = initStorageStore<BalanceDomainData>({
	key: BALANCE_DOMAIN_STORE_KEY,
	defaultValue: { value: 'playground' }
});
