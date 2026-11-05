<script lang="ts">
	import DomainCachedLoader from '#lib/components/loaders/DomainCachedLoader.svelte';
	import { VICI_EVENTS } from '#lib/constants/events.constants.ts';
	import { loadUserTradeHistory } from '#lib/services/trade.services.ts';
	import { tradeHistoryStore } from '#lib/stores/trade-history.store.ts';
</script>

<DomainCachedLoader
	onLoad={loadUserTradeHistory}
	refreshEvent={VICI_EVENTS.REFRESH_TRADE_HISTORY}
	store={tradeHistoryStore}
/>
