<script lang="ts">
	import { onMount } from 'svelte';
	import LoaderBalances from '#lib/components/loaders/LoaderBalances.svelte';
	import LoaderCollaterals from '#lib/components/loaders/LoaderCollaterals.svelte';
	import LoaderFollowing from '#lib/components/loaders/LoaderFollowing.svelte';
	import LoaderGlobalActivities from '#lib/components/loaders/LoaderGlobalActivities.svelte';
	import LoaderLeaderboard from '#lib/components/loaders/LoaderLeaderboard.svelte';
	import LoaderMarketMetadata from '#lib/components/loaders/LoaderMarketMetadata.svelte';
	import LoaderMarketTags from '#lib/components/loaders/LoaderMarketTags.svelte';
	import LoaderMarkets from '#lib/components/loaders/LoaderMarkets.svelte';
	import LoaderOrders from '#lib/components/loaders/LoaderOrders.svelte';
	import LoaderPositions from '#lib/components/loaders/LoaderPositions.svelte';
	import LoaderReceivedReactions from '#lib/components/loaders/LoaderReceivedReactions.svelte';
	import LoaderTradeHistory from '#lib/components/loaders/LoaderTradeHistory.svelte';
	import PlaygroundVxpAutoDeposit from '#lib/components/wallet/PlaygroundVxpAutoDeposit.svelte';

	// Every loader here mounts the moment the authenticated shell does, so the
	// first page of a session fires all of them at once. To keep the cold-load
	// burst from saturating the browser's per-host connection pool, split them:
	// the loaders feeding the first authenticated surfaces (markets / dash /
	// profile / portfolio) mount immediately, and the social / discovery loaders
	// — leaderboard, following graph, global activity — mount just after first
	// paint. Those feed Arena and activity overlays that aren't on the initial
	// surface, and every store is stale-while-revalidate, so the short defer is
	// invisible there while giving the critical fetches an uncontended head
	// start.
	const DEFER_MS = 400;

	let deferredReady = $state(false);

	onMount(() => {
		const handle = setTimeout(() => {
			deferredReady = true;
		}, DEFER_MS);

		return () => clearTimeout(handle);
	});
</script>

<PlaygroundVxpAutoDeposit />

<LoaderBalances />

<LoaderCollaterals />

<LoaderOrders />

<LoaderMarkets />

<LoaderPositions />

<LoaderTradeHistory />

<LoaderMarketTags />

<LoaderMarketMetadata />

{#if deferredReady}
	<LoaderLeaderboard />

	<LoaderFollowing />

	<LoaderGlobalActivities />

	<LoaderReceivedReactions />
{/if}
