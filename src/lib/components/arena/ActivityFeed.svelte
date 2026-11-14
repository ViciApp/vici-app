<script lang="ts">
	import ActivityItem from '#lib/components/arena/ActivityItem.svelte';
	import BaseButton from '#lib/components/ui/BaseButton.svelte';
	import Card from '#lib/components/ui/Card.svelte';
	import LoadingSpinner from '#lib/components/ui/LoadingSpinner.svelte';
	import {
		globalActivities,
		globalActivitiesNotInitialized
	} from '#lib/derived/activities.derived.ts';
	import { following } from '#lib/derived/following.derived.ts';
	import { profilesStore } from '#lib/stores/profiles.store.ts';
	import { refreshGlobalActivities } from '#lib/utils/refresh.utils.ts';

	interface Props {
		userPrincipal?: string;
		mode?: 'global' | 'friends' | 'user';
	}

	const { userPrincipal, mode = 'global' }: Props = $props();

	// Cold-load spinner only while the global feed has never been
	// populated. After the first load every subsequent visit renders the
	// cached activities while the loader polls in the background.
	const loading = $derived($globalActivitiesNotInitialized);

	const activities = $derived.by(() => {
		if (mode === 'friends' && userPrincipal) {
			const friendSet = new Set($following);

			return $globalActivities.filter((a) => friendSet.has(a.user));
		}

		if (mode === 'user' && userPrincipal) {
			return $globalActivities.filter((a) => a.user === userPrincipal);
		}

		return $globalActivities;
	});

	// `refreshGlobalActivities` is fire-and-forget: the actual fetch
	// happens inside `LoaderGlobalActivities`. We don't surface a
	// `refreshing` state because the cached list keeps rendering during
	// the background refetch (stale-while-revalidate).
	const handleRefresh = () => refreshGlobalActivities();
</script>

<Card padding="lg" variant="glass">
	<div class="flex w-full flex-col gap-4">
		<div class="flex w-full items-center justify-between">
			<h3 class="text-primary text-xl font-bold">
				{mode === 'friends' ? 'Friend Activity' : 'Recent Activity'}
			</h3>
			<BaseButton
				class="text-primary hover:text-primary/80 text-xs font-medium transition-colors"
				onclick={handleRefresh}
			>
				Refresh
			</BaseButton>
		</div>

		<div class="custom-scrollbar flex max-h-120 flex-col gap-4 overflow-y-auto pr-2">
			{#if loading}
				<div class="flex justify-center py-8">
					<LoadingSpinner inlinePad />
				</div>
			{:else if activities.length === 0}
				<p class="text-muted-foreground py-12 text-center text-sm italic opacity-50">
					No activity found.
				</p>
			{:else}
				{#each activities as activity (activity.timestamp + activity.user)}
					{@const profile = $profilesStore.get(activity.user)}

					<ActivityItem {activity} {profile} />
				{/each}
			{/if}
		</div>
	</div>
</Card>

<style lang="postcss">
	.custom-scrollbar::-webkit-scrollbar {
		width: 4px;
	}
	.custom-scrollbar::-webkit-scrollbar-thumb {
		background: color-mix(in srgb, var(--color-primary) 20%, transparent);
		border-radius: 10px;
	}
</style>
