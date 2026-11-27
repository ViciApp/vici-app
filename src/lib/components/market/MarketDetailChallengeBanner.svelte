<script lang="ts">
	import { isNullish, nonNullish } from '@dfinity/utils';
	import { onMount } from 'svelte';
	import Button from '#lib/components/ui/Button.svelte';
	import { AppPath } from '#lib/constants/routes.constants.ts';
	import { getChallenge, readChallengeContext } from '#lib/services/challenge.services.ts';
	import { localeStore } from '#lib/stores/locale.store.ts';
	import type { ChallengeReadView } from '#lib/types/challenge.ts';
	import { challengeLineText } from '#lib/utils/challenge.utils.ts';
	import { setPinnedFlowMarket } from '#lib/utils/flow-pin.utils.ts';
	import { t } from '#lib/utils/i18n.utils.ts';
	import { resolveAppPath } from '#lib/utils/nav.utils.ts';
	import { goto } from '$app/navigation';

	interface Props {
		/** The market on screen; the banner shows only for the challenge link kept for it. */
		seriesId: string;
	}

	const { seriesId }: Props = $props();

	let view = $state<ChallengeReadView>();

	// The kept link says which challenge to read; what the banner says comes
	// from the server's current read of it, and never shows for its challenger.
	onMount(() => {
		const context = readChallengeContext();

		if (isNullish(context) || context.seriesId !== seriesId) {
			return;
		}

		getChallenge(context.id)
			.then((read) => {
				view = nonNullish(read) && !read.isOwner && read.seriesId === seriesId ? read : undefined;
			})
			.catch(() => {
				// The banner is a courtesy: an unreachable API shows the plain detail.
			});
	});

	const predictInFlow = (): void => {
		setPinnedFlowMarket(seriesId);
		void goto(resolveAppPath(AppPath.Flow));
	};
</script>

{#if nonNullish(view)}
	<section
		class="border-primary/30 bg-laurel-glow mt-4 flex flex-col gap-3 rounded-2xl border p-4"
		aria-label={t({ locale: $localeStore, key: 'market.detail.challenge.region_aria' })}
	>
		<p class="text-foreground text-sm font-medium">
			{challengeLineText({ view, locale: $localeStore })}
		</p>
		{#if view.marketOpen}
			<Button class="self-start" onclick={predictInFlow} size="sm">
				{t({ locale: $localeStore, key: 'market.detail.challenge.predict_in_flow' })}
			</Button>
		{/if}
	</section>
{/if}
