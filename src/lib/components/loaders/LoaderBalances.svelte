<script lang="ts">
	import type { ClearingDid } from '#declarations';
	import IdentityAwareLoader from '#lib/components/loaders/IdentityAwareLoader.svelte';
	import { balanceDomain } from '#lib/derived/balance-domain.derived.ts';
	import { getLedgerBalances } from '#lib/services/wallet.services.ts';
	import { balancesStore } from '#lib/stores/balances.store.ts';
	import type { LedgerBalancesRead } from '#lib/types/wallet.ts';
	import { compareBalanceDomains } from '#lib/utils/balance-domain.utils.ts';
	import { mergeReadBalances } from '#lib/utils/balances.utils.ts';

	let prevDomain: ClearingDid.BalanceDomain | undefined = undefined;
	// The account `balancesStore` was last filled for: a failed read may only
	// fall back on balances of that same account.
	let lastRead: LedgerBalancesRead | undefined = undefined;

	const refresh = async ({ resetStore = false } = {}) => {
		const domainToken = $balanceDomain;

		if (resetStore) {
			lastRead = undefined;
			balancesStore.set(undefined);
		}

		const read = await getLedgerBalances();

		if ($balanceDomain === domainToken) {
			lastRead = mergeReadBalances({ previous: lastRead, read });
			balancesStore.set(lastRead?.balances);
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
