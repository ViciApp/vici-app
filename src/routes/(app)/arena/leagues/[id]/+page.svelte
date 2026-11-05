<script lang="ts">
	import LeagueDetailPage from '#lib/components/pages/LeagueDetailPage.svelte';
	import { page } from '$app/state';

	const leagueId = $derived(page.params.id ?? '');
</script>

<LeagueDetailPage {leagueId} />
