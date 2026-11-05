<script generics="T" lang="ts">
	import { isNullish } from '@dfinity/utils';
	import { onMount } from 'svelte';
	import type { Writable } from 'svelte/store';
	import AtomicLoader from '#lib/components/loaders/AtomicLoader.svelte';
	import IdentityAwareLoader from '#lib/components/loaders/IdentityAwareLoader.svelte';

	interface Props {
		/**
		 * Writable to populate on every successful fetch. Initial `undefined`
		 * lets consumers distinguish "not yet loaded" from "loaded but empty".
		 */
		store: Writable<T | undefined>;
		/**
		 * Single-shot fetcher (no certified callback, no balance domain).
		 * Use this for Juno-backed reads (`leaderboard`, `categories`, `following`)
		 * where there's no fast-then-certified upgrade path.
		 */
		onLoad: () => Promise<T>;
		/**
		 * If `true` (default), the fetcher only runs when an identity is present
		 * and we stop polling fast once signed in. Set to `false` for public
		 * reads (e.g. the leaderboard, the category map) that should refresh
		 * regardless of session state.
		 */
		requireIdentity?: boolean;
		/**
		 * Optional custom-event name on `document`. When fired (via the
		 * `refresh.utils.ts` helpers), triggers a refetch without resetting
		 * the cached value — stale-while-revalidate semantics.
		 */
		refreshEvent?: string;
	}

	const { store, onLoad, requireIdentity = true, refreshEvent }: Props = $props();

	const refresh = async (): Promise<void> => {
		const value = await onLoad();
		store.set(value);
	};

	// eslint-disable-next-line require-await
	const alwaysSlow = async (): Promise<boolean> => true;

	onMount(() => {
		if (isNullish(refreshEvent)) {
			return;
		}

		const handler = () => void refresh();
		document.addEventListener(refreshEvent, handler);

		return () => document.removeEventListener(refreshEvent, handler);
	});
</script>

{#if requireIdentity}
	<IdentityAwareLoader onLoad={refresh} />
{:else}
	<AtomicLoader onLoad={refresh} onShouldUseSlowInterval={alwaysSlow} />
{/if}
