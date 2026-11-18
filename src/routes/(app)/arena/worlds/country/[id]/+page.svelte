<script lang="ts">
	import WorldsAffiliationDetailPage from '#lib/components/pages/WorldsAffiliationDetailPage.svelte';
	import { page } from '$app/state';

	const affiliationIdentifier = $derived(page.params.id ?? '');
</script>

<WorldsAffiliationDetailPage {affiliationIdentifier} kind="country" />
