<script lang="ts">
	import CachedLoader from '#lib/components/loaders/CachedLoader.svelte';
	import { VICI_EVENTS } from '#lib/constants/events.constants.ts';
	import {
		getActivityReactionCounts,
		getActivityReactions
	} from '#lib/services/activity-reaction.services.ts';
	import { getGlobalActivities } from '#lib/services/activity.services.ts';
	import { loadProfilesByPrincipals } from '#lib/services/profile.services.ts';
	import { globalActivitiesStore } from '#lib/stores/activities.store.ts';
	import {
		activityReactionCountsStore,
		activityReactionsStore
	} from '#lib/stores/activity-reactions.store.ts';

	const GLOBAL_ACTIVITIES_LIMIT = 50;

	// Hydrate the shared `profilesStore`, the friend-feed reactions, and the
	// per-activity like-count rollup as side-effects so consumers
	// (ActivityFeed, MarketRecentTrades, FriendsTab) render
	// names/avatars/like-counts without each running their own fetch loop.
	// The reaction page feeds the viewer's own-like state (derived reactively
	// at the consumer, so it survives a signed-out load); the like *count*
	// comes from the server-maintained rollup, O(1) per activity.
	const onLoad = async () => {
		const [activities, reactions, reactionCounts] = await Promise.all([
			getGlobalActivities({ limit: GLOBAL_ACTIVITIES_LIMIT }),
			getActivityReactions(),
			getActivityReactionCounts()
		]);

		activityReactionsStore.set(reactions);
		activityReactionCountsStore.set(reactionCounts);

		const principals = activities.flatMap((a) =>
			[a.user, a.targetUser].filter((p): p is string => typeof p === 'string' && p.length > 0)
		);

		await loadProfilesByPrincipals({ principals });

		return activities;
	};
</script>

<CachedLoader
	{onLoad}
	refreshEvent={VICI_EVENTS.REFRESH_GLOBAL_ACTIVITIES}
	requireIdentity={false}
	store={globalActivitiesStore}
/>
