<script lang="ts">
	import CachedLoader from '#lib/components/loaders/CachedLoader.svelte';
	import { VICI_EVENTS } from '#lib/constants/events.constants.ts';
	import { listMarketTagsBySeries } from '#lib/services/market-tags.services.ts';
	import { marketTagsStore } from '#lib/stores/market-tags.store.ts';

	const onLoad = () => listMarketTagsBySeries().catch(() => ({}));
</script>

<CachedLoader
	{onLoad}
	refreshEvent={VICI_EVENTS.REFRESH_MARKET_TAGS}
	requireIdentity={false}
	store={marketTagsStore}
/>
