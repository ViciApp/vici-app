<script lang="ts">
	import CachedLoader from '#lib/components/loaders/CachedLoader.svelte';
	import { getLeaderboard } from '#lib/services/leaderboard.services.ts';
	import { leaderboardStore } from '#lib/stores/leaderboard.store.ts';

	const onLoad = () => getLeaderboard();
</script>

<CachedLoader {onLoad} requireIdentity={false} store={leaderboardStore} />
