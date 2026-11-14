<script lang="ts">
	import { isNullish } from '@dfinity/utils';
	import CachedLoader from '#lib/components/loaders/CachedLoader.svelte';
	import { getReceivedActivityReactions } from '#lib/services/activity-reaction.services.ts';
	import { getIdentity } from '#lib/services/identity.services.ts';
	import { loadProfilesByPrincipals } from '#lib/services/profile.services.ts';
	import { receivedReactionsStore } from '#lib/stores/activity-reactions.store.ts';
	import type { ActivityReaction } from '#lib/types/social.ts';

	// Likes other users left on the viewer's own calls, for the like-received
	// inbox card. The principal comes from the same `getIdentity()` the
	// identity-aware loader gates on: NOT the FE `authPrincipal` store, which
	// can lag behind a resolved identity and would otherwise cache an empty
	// result before the principal hydrates. Errors are swallowed to `[]` (the
	// store must always settle: the inbox toast gate keys off it becoming
	// non-undefined, so a thrown fetch can't be allowed to wedge it).
	const onLoad = async (): Promise<ActivityReaction[]> => {
		const identity = await getIdentity();

		if (isNullish(identity)) {
			return [];
		}

		const author = identity.getPrincipal().toText();

		const reactions = await getReceivedActivityReactions({ author }).catch(() => []);

		// Profile hydration is best-effort: the card falls back to the liker's
		// shortened principal, so a failure here must not drop the reactions.
		await loadProfilesByPrincipals({ principals: reactions.map(({ liker }) => liker) }).catch(
			() => undefined
		);

		return reactions;
	};
</script>

<CachedLoader {onLoad} store={receivedReactionsStore} />
