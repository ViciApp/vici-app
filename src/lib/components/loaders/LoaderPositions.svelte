<script lang="ts">
	import DomainCachedLoader from '#lib/components/loaders/DomainCachedLoader.svelte';
	import { VICI_EVENTS } from '#lib/constants/events.constants.ts';
	import { loadPositions } from '#lib/services/position.services.ts';
	import { positionsStore } from '#lib/stores/positions.store.ts';
</script>

<DomainCachedLoader
	onLoad={loadPositions}
	refreshEvent={VICI_EVENTS.REFRESH_POSITIONS}
	store={positionsStore}
/>
