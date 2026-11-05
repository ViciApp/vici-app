import { balanceDomainStore } from '#lib/stores/balance-domain.store.ts';
import type { ClearingDid } from '$declarations';
import { derived, type Readable } from 'svelte/store';

export const balanceDomain: Readable<ClearingDid.BalanceDomain> = derived(
	balanceDomainStore,
	($balanceDomainStore) => {
		switch ($balanceDomainStore.value) {
			case 'settlement':
				return { Settlement: null };
			case 'social':
			case 'playground':
			default:
				return { ViciXp: null };
		}
	}
);
