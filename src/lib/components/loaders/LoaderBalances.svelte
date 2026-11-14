<script lang="ts">
	import type { ClearingDid } from '#declarations';
	import IdentityAwareLoader from '#lib/components/loaders/IdentityAwareLoader.svelte';
	import { balanceDomain } from '#lib/derived/balance-domain.derived.ts';
	import { getLedgerBalances } from '#lib/services/wallet.services.ts';
	import { balancesStore } from '#lib/stores/balances.store.ts';
	import { compareBalanceDomains } from '#lib/utils/balance-domain.utils.ts';

	let prevDomain: ClearingDid.BalanceDomain | undefined = undefined;

	const refresh = async ({ resetStore = false } = {}) => {
		const domainToken = $balanceDomain;

		if (resetStore) {
			balancesStore.set(undefined);
		}

		const balances = await getLedgerBalances();

		if ($balanceDomain === domainToken) {
			balancesStore.set(balances);
		}
	};

	$effect(() => {
		if ($balanceDomain && (!prevDomain || !compareBalanceDomains($balanceDomain, prevDomain))) {
			prevDomain = $balanceDomain;
			refresh({ resetStore: true });
		}
	});
</script>

<svelte:window onviciRefreshBalances={() => refresh()} />

<IdentityAwareLoader onLoad={refresh} />
