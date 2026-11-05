<script lang="ts">
	import CachedLoader from '#lib/components/loaders/CachedLoader.svelte';
	import { getFollowing } from '#lib/services/relation-queries.services.ts';
	import { followingStore } from '#lib/stores/following.store.ts';

	const onLoad = () => getFollowing().catch(() => []);
</script>

<CachedLoader {onLoad} store={followingStore} />
