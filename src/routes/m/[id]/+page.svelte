<script lang="ts">
	import { isNullish, nonNullish, notEmptyString } from '@dfinity/utils';
	import { AnonymousIdentity } from '@icp-sdk/core/agent';
	import { onMount } from 'svelte';
	import { listSeries } from '#lib/api/registry.api.ts';
	import LoadingSpinner from '#lib/components/ui/LoadingSpinner.svelte';
	import { AppPath } from '#lib/constants/routes.constants.ts';
	import { setPinnedFlowMarket } from '#lib/utils/flow-pin.utils.ts';
	import { parseMarketShareParam } from '#lib/utils/market-slug.utils.ts';
	import { resolveAppPath } from '#lib/utils/nav.utils.ts';
	import { goto } from '$app/navigation';
	import { page } from '$app/state';

	// Short share-link alias. The share sheet hands out `/m/{slug~id8}?ref=…`
	// (keyword-carrying yet compact: see `#lib/utils/market-slug.utils.ts`),
	// while `/markets/{id}` is the canonical detail route. Resolve the param
	// to a series id, then bounce, carrying the query string through so
	// referral attribution survives the hop. A bare alias kept this thin:
	// no auth branching here; the (app) gate on the destination owns the
	// signed-out path.
	const param = $derived(page.params.id ?? '');

	// Resolution order:
	//  1. The id embedded by the deploy-time SEO page (`window.__viciSeriesId`,
	//     see `scripts/build/generate-seo-assets.ts`), but only when it is
	//     consistent with the param: a client-side navigation can reach this
	//     route with a stale embedded id from whichever prerendered page the
	//     session entered on.
	//  2. A param without the slug separator is a bare series id (legacy
	//     share links).
	//  3. A slugged param served by the SPA fallback (market newer than the
	//     last deploy): match the short-id suffix against the catalog.
	const resolveSeriesId = async (): Promise<string | undefined> => {
		const suffix = parseMarketShareParam(param);

		const { __viciSeriesId: embedded } = window as Window & { __viciSeriesId?: string };

		if (
			notEmptyString(embedded) &&
			(embedded === param || (nonNullish(suffix) && embedded.startsWith(suffix)))
		) {
			return embedded;
		}

		if (isNullish(suffix)) {
			return notEmptyString(param) ? param : undefined;
		}

		try {
			const series = await listSeries({ identity: new AnonymousIdentity() });

			// Exactly one match or nothing: a colliding suffix must degrade to
			// the markets board, never redirect to whichever market sorts
			// first. Short-circuits on the second hit.
			let match: string | undefined = undefined;

			for (const { series_id } of series) {
				if (series_id.startsWith(suffix)) {
					if (nonNullish(match)) {
						match = undefined;
						break;
					}

					match = series_id;
				}
			}

			if (nonNullish(match)) {
				return match;
			}
		} catch {
			// Registry unreachable: fall through to "unresolvable"; the
			// caller lands on the markets board instead of a dead page.
		}
	};

	onMount(async () => {
		const seriesId = await resolveSeriesId();
		const { search } = page.url;

		if (isNullish(seriesId)) {
			// Unresolvable link (deleted market, malformed slug): land on the
			// markets board rather than a dead detail page. The query string
			// rides along so the referral capture in the (app) layout still
			// gets its chance.
			await goto(`${resolveAppPath(AppPath.Markets)}${search}`, { replace: true });

			return;
		}

		// This route is only ever reached from a shared link, so park the
		// market for the next Flow entry to surface as the first card,
		// surviving the detail page, sign-in, and (for a new user)
		// onboarding. Dropped downstream if the viewer already called it.
		setPinnedFlowMarket(seriesId);

		await goto(`${resolveAppPath(`${AppPath.Markets}/${seriesId}`)}${search}`, {
			replace: true
		});
	});
</script>

<div class="flex min-h-screen w-full items-center justify-center p-6" aria-hidden="true">
	<LoadingSpinner inlinePad size="md" />
</div>
