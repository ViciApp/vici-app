<script lang="ts">
	import BattleDetailPage from '#lib/components/pages/BattleDetailPage.svelte';
	import { page } from '$app/state';

	const battleId = $derived(page.params.id ?? '');
</script>

<BattleDetailPage {battleId} />
