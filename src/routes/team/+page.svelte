<script lang="ts">
	import SignInScreen from '#lib/components/authn/SignInScreen.svelte';
	import { pageTitle } from '#lib/constants/brand.constants.ts';
	import { AppPath } from '#lib/constants/routes.constants.ts';
	import { userSignedIn } from '#lib/derived/user.derived.ts';
	import { localeStore } from '#lib/stores/locale.store.ts';
	import { t } from '#lib/utils/i18n.utils.ts';
	import { resolveAppPath } from '#lib/utils/nav.utils.ts';
	import { goto } from '$app/navigation';

	// The team's way in while sign-in is team-only: no page links here and it
	// stays out of search, but nothing about the path is secret; the API turns
	// away every address outside the team. One effect covers both a cold load
	// with a live session and the bounce after a successful sign-in, as on
	// `/signin`.
	$effect(() => {
		if ($userSignedIn) {
			void goto(resolveAppPath(AppPath.Flow), { replace: true });
		}
	});
</script>

<svelte:head>
	<title>{pageTitle(t({ locale: $localeStore, key: 'nav.signin' }))}</title>
	<meta name="robots" content="noindex, nofollow" />
</svelte:head>

<SignInScreen canSwitch={false} mode="signin" />
