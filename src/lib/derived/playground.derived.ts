import { balanceDomainStore } from '#lib/stores/balance-domain.store.ts';
import { flowTradeDenominationLabel } from '#lib/utils/playground-display.utils.ts';
import { derived, type Readable } from 'svelte/store';

/**
 * App "Playground" tab: on-chain `ViciXp`; clearing margin shown as VXP 1:1 (no USD framing).
 */
export const playgroundVxpUnitMode: Readable<boolean> = derived(
	balanceDomainStore,
	($s) => $s.value !== 'settlement'
);

export const playgroundFlowTradeUnitLabel: Readable<'VXP' | 'USD'> = derived(
	playgroundVxpUnitMode,
	(playground) => flowTradeDenominationLabel(playground)
);
