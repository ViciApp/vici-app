<script lang="ts">
	import { isNullish } from '@dfinity/utils';
	import CachedLoader from '#lib/components/loaders/CachedLoader.svelte';
	import { getReceivedActivityReactions } from '#lib/services/activity-reaction.services.ts';
	import { getSignedInOwner } from '#lib/services/identity.services.ts';
	import { loadProfilesByPrincipals } from '#lib/services/profile.services.ts';
	import { receivedReactionsStore } from '#lib/stores/activity-reactions.store.ts';
	import type { ActivityReaction } from '#lib/types/social.ts';

	// Likes other users left on the viewer's own calls, for the like-received
	// inbox card. The signed-in check reads the same source the identity-aware
	// loader gates on (`getSignedInOwner`, the session account id): NOT the FE
	// `authPrincipal` store, which can lag behind a resolved session and would
	// otherwise cache an empty result before the owner hydrates. Errors are swallowed to `[]` (the store must
	// always settle: the inbox toast gate keys off it becoming non-undefined,
	// so a thrown fetch can't be allowed to wedge it).
	const onLoad = async (): Promise<ActivityReaction[]> => {
		if (isNullish(await getSignedInOwner())) {
			return [];
		}

		const reactions = await getReceivedActivityReactions().catch(() => []);

		// Profile hydration is best-effort: the card falls back to the liker's
		// shortened principal, so a failure here must not drop the reactions.
		await loadProfilesByPrincipals({ principals: reactions.map(({ liker }) => liker) }).catch(
			() => undefined
		);

		return reactions;
	};
</script>

<CachedLoader {onLoad} store={receivedReactionsStore} />
