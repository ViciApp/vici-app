<script lang="ts">
	import { isNullish, nonNullish } from '@dfinity/utils';
	import { onMount, untrack } from 'svelte';
	import LandingPage from '#lib/components/pages/LandingPage.svelte';
	import LoadingSpinner from '#lib/components/ui/LoadingSpinner.svelte';
	import { NEW_APP_ORIGIN } from '#lib/constants/claim.constants.ts';
	import { AppPath } from '#lib/constants/routes.constants.ts';
	import { userSignedIn, userSignedOutResolved } from '#lib/derived/user.derived.ts';
	import { track } from '#lib/services/analytics.services.ts';
	import {
		areChallengeLinksEnabled,
		getChallenge,
		keepChallengeContext
	} from '#lib/services/challenge.services.ts';
	import { localeStore } from '#lib/stores/locale.store.ts';
	import type { ChallengeReadView } from '#lib/types/challenge.ts';
	import type { LandingOpening } from '#lib/types/landing.ts';
	import { challengeLineLabel, parseChallengeId } from '#lib/utils/challenge.utils.ts';
	import { t } from '#lib/utils/i18n.utils.ts';
	import { resolveAppPath } from '#lib/utils/nav.utils.ts';
	import { newAppPageUrl } from '#lib/utils/new-app.utils.ts';
	import { stashInviterForSignup } from '#lib/utils/pending-onboarding.utils.ts';
	import { goto } from '$app/navigation';
	import { page } from '$app/state';

	// The receiving page of a challenge link. The id is the only thing read
	// from the URL: what the page says comes from the server's read of the
	// link, so no query parameter can change it. Signed out, the landing opens
	// on the challenged market with the line; signed in, the market detail
	// shows it as a banner. A link that cannot be read opens the standard
	// landing, never an error screen.

	const rawId = $derived(page.params.id ?? '');
	// A view only comes back for a well-formed id, so it is set whenever one is.
	const challengeId = $derived(parseChallengeId(rawId) ?? '');

	// Set once the read settled; its `view` is `undefined` when it found nothing.
	let result = $state<{ view: ChallengeReadView | undefined }>();
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

		getChallenge(untrack(() => rawId))
			.then((view) => (result = { view }))
			.catch(() => (result = { view: undefined }));
	});

	const trackOpened = ({
		read,
		source
	}: {
		read: ChallengeReadView | undefined;
		source: 'signed_out' | 'signed_in';
	}): void =>
		track({
			name: 'challenge_opened',
			source,
			...(isNullish(read)
				? { label: 'not_found', ok: false }
				: {
						marketId: read.seriesId,
						label: challengeLineLabel(read),
						ok: nonNullish(read.challenger)
					})
		});

	const enterSignedIn = (read: ChallengeReadView | undefined): void => {
		trackOpened({ read, source: 'signed_in' });

		if (isNullish(read)) {
			void goto(resolveAppPath(AppPath.Flow), { replace: true });

			return;
		}

		// The challenger's own link opens the plain market detail.
		if (!read.isOwner) {
			keepChallengeContext({ id: challengeId, seriesId: read.seriesId });
		}

		void goto(resolveAppPath(`${AppPath.Markets}/${read.seriesId}`), { replace: true });
	};

	const enterSignedOut = (read: ChallengeReadView | undefined): void => {
		trackOpened({ read, source: 'signed_out' });

		if (isNullish(read)) {
			opening = {};

			return;
		}

		stashInviterForSignup({ inviter: { challengeId } });
		keepChallengeContext({ id: challengeId, seriesId: read.seriesId });

		// A market closed for predictions is not a card: the standard deck, with the line.
		opening = { leadSeriesId: read.marketOpen ? read.seriesId : undefined, challenge: read };
	};

	$effect(() => {
		const settled = result;
		const signedIn = $userSignedIn;
		const signedOut = $userSignedOutResolved;

		if (isNullish(settled) || (!signedIn && !signedOut) || decided) {
			return;
		}

		decided = true;
		untrack(() => (signedIn ? enterSignedIn(settled.view) : enterSignedOut(settled.view)));
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
