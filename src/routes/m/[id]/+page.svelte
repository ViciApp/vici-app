<script lang="ts">
	import { isNullish, nonNullish, notEmptyString } from '@dfinity/utils';
	import LoadingSpinner from '#lib/components/ui/LoadingSpinner.svelte';
	import { AppPath } from '#lib/constants/routes.constants.ts';
	import { authBusy, userSignedIn } from '#lib/derived/user.derived.ts';
	import { resolveMarketShareSeriesId } from '#lib/services/market-share.services.ts';
	import { setPinnedFlowMarket } from '#lib/utils/flow-pin.utils.ts';
	import { marketShareIdPrefix } from '#lib/utils/market-slug.utils.ts';
	import { landingHref, resolveAppPath } from '#lib/utils/nav.utils.ts';
	import { browser } from '$app/env';
	import { goto } from '$app/navigation';
	import { page } from '$app/state';

	// The one share link of a market (`/m/{slug~id8}?ref=…`, built by
	// `marketShareUrl`), from every surface. Where it leads depends on who
	// opens it, so it waits for the auth handshake:
	//
	//  - Signed out: the landing, with this market as the deck's lead card
	//    (`/?m=…`). The landing resolves the param itself and opens Markets
	//    when it names nothing, so this hop reads no catalog. The query string
	//    rides along, so the `?ref=` capture in the root layout gets its chance.
	//  - Signed in: resolve the param to a series id and open its detail page
	//    (`/markets/{id}`), carrying the query string through; an unresolvable
	//    link lands on the markets board.
	const param = $derived(page.params.id ?? '');

	// The link already handled, so a re-render never routes it twice. Keyed
	// by the link rather than a flag: SvelteKit reuses this page for a
	// client-side hop from one `/m/` link to another (or back / forward),
	// and each new link must be routed.
	let routedFor: string | undefined;

	// Resolution order:
	//  1. The id embedded by the deploy-time SEO page (`window.__viciSeriesId`,
	//     see `scripts/build/generate-seo-assets.ts`), but only when it is
	//     consistent with the param: a client-side navigation can reach this
	//     route with a stale embedded id from whichever prerendered page the
	//     session entered on.
	//  2. The id prefix the param carries, matched against the catalog
	//     (a market newer than the last deploy, or a bare-id link).
	const resolveSeriesId = async (): Promise<string | undefined> => {
		const prefix = marketShareIdPrefix(param);
		const { __viciSeriesId: embedded } = window as Window & { __viciSeriesId?: string };

		if (notEmptyString(embedded) && nonNullish(prefix) && embedded.startsWith(prefix)) {
			return embedded;
		}

		return await resolveMarketShareSeriesId(param);
	};

	const openSignedIn = async (): Promise<void> => {
		const seriesId = await resolveSeriesId();
		const { search } = page.url;

		if (isNullish(seriesId)) {
			await goto(`${resolveAppPath(AppPath.Markets)}${search}`, { replace: true });

			return;
		}

		// Park the market for the next Flow entry to surface as the first
		// card, surviving the detail page. Dropped downstream if the viewer
		// already called it.
		setPinnedFlowMarket(seriesId);

		await goto(`${resolveAppPath(`${AppPath.Markets}/${seriesId}`)}${search}`, {
			replace: true
		});
	};

	$effect(() => {
		const link = `${param}${page.url.search}`;

		if (!browser || $authBusy || routedFor === link) {
			return;
		}

		routedFor = link;

		if ($userSignedIn) {
			void openSignedIn();

			return;
		}

		void goto(landingHref({ market: param, search: page.url.search }), { replace: true });
	});
</script>

<div class="flex min-h-screen w-full items-center justify-center p-6" aria-hidden="true">
	<LoadingSpinner inlinePad size="md" />
</div>
