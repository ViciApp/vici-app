<script generics="T" lang="ts">
	import { isNullish } from '@dfinity/utils';
	import { onMount } from 'svelte';
	import type { Writable } from 'svelte/store';
	import type { ClearingDid } from '#declarations';
	import IdentityAwareLoader from '#lib/components/loaders/IdentityAwareLoader.svelte';
	import { balanceDomain } from '#lib/derived/balance-domain.derived.ts';
	import { compareBalanceDomains } from '#lib/utils/balance-domain.utils.ts';

	interface Props {
		/**
		 * Writable to populate. Reset to `undefined` whenever the balance domain
		 * changes so consumers can distinguish "not yet loaded for this domain"
		 * from "loaded and currently empty".
		 */
		store: Writable<T | undefined>;
		/**
		 * Callback-style certified loader (`loadUserOrders` / `loadPositions` /
		 * `loadUserTradeHistory` shape): receives the current
		 * domain and an `onLoad` callback fired once for the fast uncertified
		 * query and once for the certified update.
		 */
		onLoad: (args: {
			domain: ClearingDid.BalanceDomain;
			onLoad: (options: { certified: boolean; response: T }) => void;
		}) => Promise<void>;
		/**
		 * Optional custom-event name on `document`. When fired (via the
		 * `refresh.utils.ts` helpers), triggers a refetch without resetting the
		 * cached value — i.e. stale-while-revalidate semantics.
		 */
		refreshEvent?: string;
	}

	const { store, onLoad, refreshEvent }: Props = $props();

	let prevDomain: ClearingDid.BalanceDomain | undefined = undefined;

	const refresh = async ({ resetStore = false } = {}): Promise<void> => {
		const domainToken = $balanceDomain;

		if (resetStore) {
			store.set(undefined);
		}

		await onLoad({
			domain: domainToken,
			onLoad: ({ response }) => {
				// Structural compare: `balanceDomain` is a derived store that emits
				// fresh `{ Settlement: null }`-style literals on every change, so a
				// referential `===` is unreliable even when the logical domain is
				// unchanged. The underlying `queryAndUpdate` already drops stale
				// query responses that land after the update has settled.
				if (compareBalanceDomains($balanceDomain, domainToken)) {
					store.set(response);
				}
			}
		});
	};

	$effect(() => {
		if ($balanceDomain && (!prevDomain || !compareBalanceDomains($balanceDomain, prevDomain))) {
			prevDomain = $balanceDomain;
			void refresh({ resetStore: true });
		}
	});

	onMount(() => {
		if (isNullish(refreshEvent)) {
			return;
		}

		const handler = () => void refresh();
		document.addEventListener(refreshEvent, handler);

		return () => document.removeEventListener(refreshEvent, handler);
	});
</script>

<IdentityAwareLoader onLoad={refresh} />
