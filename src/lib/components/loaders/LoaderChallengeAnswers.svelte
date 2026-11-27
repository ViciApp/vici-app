<script lang="ts">
	import CachedLoader from '#lib/components/loaders/CachedLoader.svelte';
	import { listChallengeAnswers } from '#lib/services/challenge.services.ts';
	import { challengeAnswersStore } from '#lib/stores/challenge-answers.store.ts';
	import type { ChallengeAnswerItem } from '#lib/types/challenge.ts';

	// Errors settle to `[]`: the inbox toast gate waits for this store to leave `undefined`, so a
	// failed read must not wedge it. The next refresh tick retries.
	const onLoad = async (): Promise<ChallengeAnswerItem[]> =>
		await listChallengeAnswers().catch((err: unknown) => {
			console.error('LoaderChallengeAnswers: answers read failed', err);

			return [];
		});
</script>

<CachedLoader {onLoad} store={challengeAnswersStore} />
