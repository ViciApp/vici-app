<script lang="ts">
	import { get } from 'svelte/store';
	import AtomicLoader from '#lib/components/loaders/AtomicLoader.svelte';
	import { balanceDomain } from '#lib/derived/balance-domain.derived.ts';
	import { loadMarketsProgressive } from '#lib/services/market.services.ts';
	import { marketsStore } from '#lib/stores/markets.store.ts';
	import { compareBalanceDomains } from '#lib/utils/balance-domain.utils.ts';
	import type { ClearingDid } from '$declarations';

	let prevDomain: ClearingDid.BalanceDomain | undefined = undefined;

	// Monotonic run token. A progressive load emits many updates over time, and
	// refresh() has several concurrent triggers (the AtomicLoader poll, the
	// `viciRefreshMarkets` event, a balance-domain switch). Without a token an
	// older run still batching could overwrite a newer run's data even within
	// the same domain. Every refresh claims the next token; a run only writes
	// (and only keeps fetching) while it's still the latest AND the domain it
	// captured is still current.
	let latestRun = 0;

	const refresh = async ({ resetStore = false } = {}) => {
		const domainToken = $balanceDomain;
		const run = ++latestRun;

		if (resetStore) {
			marketsStore.set(undefined);
		}

		// Carry prior prices forward on a same-domain refresh so rows don't flash
		// back to 0.5 before re-enrichment; on a domain switch the store was just
		// cleared, so there's nothing (correctly) to carry.
		const previous = resetStore ? undefined : get(marketsStore);

		// A run is current only while it's the latest claimed and its captured
		// domain still matches. Structural compare: `balanceDomain` is a derived
		// store that emits fresh `{ Settlement: null }`-style literals, so
		// referential `===` is unreliable even when the logical domain is unchanged.
		const isCurrent = () => run === latestRun && compareBalanceDomains($balanceDomain, domainToken);

		// Progressive load: the order-book-free lite set lands first (instant,
		// unblocking the shell's cold-load), then book-derived prices fill in
		// batch-by-batch in the background. Updates from a superseded run are
		// dropped, and `isStale` aborts its in-flight enrichment so it stops
		// fetching.
		await loadMarketsProgressive({
			domain: domainToken,
			previous,
			onUpdate: (markets) => {
				if (isCurrent()) {
					marketsStore.set(markets);
				}
			},
			isStale: () => !isCurrent()
		});
	};

	// Markets are public and effectively static between trades, so there's no
	// need to poll fast after sign-in: a single load plus the
	// `viciRefreshMarkets` event (fired on create / trade / resolve) keeps the
	// list current, with a slow background refresh as a backstop. Polling fast
	// here would re-run the catalog-wide book enrichment every second.
	// eslint-disable-next-line require-await
	const alwaysSlow = async (): Promise<boolean> => true;

	$effect(() => {
		if ($balanceDomain && (!prevDomain || !compareBalanceDomains($balanceDomain, prevDomain))) {
			prevDomain = $balanceDomain;
			refresh({ resetStore: true });
		}
	});
</script>

<svelte:document onviciRefreshMarkets={() => refresh()} />

<AtomicLoader onLoad={refresh} onShouldUseSlowInterval={alwaysSlow} />
