<script lang="ts">
	import { nonNullish } from '@dfinity/utils';
	import ChallengeShareSheet from '#lib/components/market/ChallengeShareSheet.svelte';
	import { areChallengeLinksEnabled } from '#lib/services/challenge.services.ts';
	import { challengeShareRequest, closeChallengeShare } from '#lib/stores/challenge-share.store.ts';

	// Mounted once in the app shell: `ChallengeShareButton` sits on the back of a Flow card, whose
	// transform would trap a fixed sheet rendered inside it.
</script>

{#if areChallengeLinksEnabled() && nonNullish($challengeShareRequest)}
	<ChallengeShareSheet
		isOpen
		onClose={closeChallengeShare}
		seriesId={$challengeShareRequest.seriesId}
		title={$challengeShareRequest.title}
	/>
{/if}
