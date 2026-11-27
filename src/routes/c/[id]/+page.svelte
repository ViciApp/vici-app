<script lang="ts">
	import { isNullish, nonNullish } from '@dfinity/utils';
	import { onMount, untrack } from 'svelte';
	import LandingPage from '#lib/components/pages/LandingPage.svelte';
	import LoadingSpinner from '#lib/components/ui/LoadingSpinner.svelte';
	import { NEW_APP_ORIGIN } from '#lib/constants/claim.constants.ts';
	import { AppPath } from '#lib/constants/routes.constants.ts';
	import { userSignedIn, userSignedOutResolved } from '#lib/derived/user.derived.ts';
	import { track } from '#lib/services/analytics.services.ts';
	import { areChallengeLinksEnabled, getChallenge } from '#lib/services/challenge.services.ts';
	import { localeStore } from '#lib/stores/locale.store.ts';
	import type { ChallengeView } from '#lib/types/challenge.ts';
	import type { LandingOpening } from '#lib/types/landing.ts';
	import { challengeLineLabel } from '#lib/utils/challenge.utils.ts';
	import { t } from '#lib/utils/i18n.utils.ts';
	import { resolveAppPath } from '#lib/utils/nav.utils.ts';
	import { newAppPageUrl } from '#lib/utils/new-app.utils.ts';
	import { goto } from '$app/navigation';
	import { page } from '$app/state';

	// The receiving page of a challenge link, for a signed-out visitor. The id
	// is the only thing read from the URL: what the page says comes from the
	// server's read of the link, so no query parameter can change it. The
	// landing opens on the challenged market with the challenger's line, and
	// a call on it goes to the handle claim like every landing call. A link
	// that cannot be read opens the standard landing, never an error screen.
	// A signed-in session is sent on to Flow, as from `/`.

	// Set once the read settled; its `view` is `undefined` when it found nothing.
	let result = $state<{ view: ChallengeView | undefined }>();
	let opening = $state<LandingOpening>();
	let decided = false;

	onMount(() => {
		if (!areChallengeLinksEnabled()) {
			window.location.replace(
				newAppPageUrl({
					origin: NEW_APP_ORIGIN,
					pathname: page.url.pathname,
					search: '',
					hash: ''
				})
			);

			return;
		}

		getChallenge(untrack(() => page.params.id ?? ''))
			.then((view) => (result = { view }))
			.catch(() => (result = { view: undefined }));
	});

	const trackOpened = ({
		view,
		source
	}: {
		view: ChallengeView | undefined;
		source: 'signed_out' | 'signed_in';
	}): void =>
		track({
			name: 'challenge_opened',
			source,
			...(isNullish(view)
				? { label: 'not_found', ok: false }
				: {
						marketId: view.seriesId,
						label: challengeLineLabel(view),
						ok: nonNullish(view.challenger)
					})
		});

	const enter = ({ view, signedIn }: { view: ChallengeView | undefined; signedIn: boolean }) => {
		trackOpened({ view, source: signedIn ? 'signed_in' : 'signed_out' });

		if (signedIn) {
			void goto(resolveAppPath(AppPath.Flow), { replace: true });

			return;
		}

		// A market closed for predictions is not a card: the standard deck, with the line.
		opening = isNullish(view)
			? {}
			: { leadSeriesId: view.marketOpen ? view.seriesId : undefined, challenge: view };
	};

	$effect(() => {
		const settled = result;
		const signedIn = $userSignedIn;
		const signedOut = $userSignedOutResolved;

		if (isNullish(settled) || (!signedIn && !signedOut) || decided) {
			return;
		}

		decided = true;
		untrack(() => enter({ view: settled.view, signedIn }));
	});
</script>

<svelte:head>
	<title>{t({ locale: $localeStore, key: 'seo.landing.title' })}</title>
	<meta name="description" content={t({ locale: $localeStore, key: 'seo.landing.description' })} />
</svelte:head>

{#if nonNullish(opening)}
	<LandingPage {opening} />
{:else}
	<div class="bg-background flex min-h-dvh items-center justify-center" aria-hidden="true">
		<LoadingSpinner size="lg" />
	</div>
{/if}
