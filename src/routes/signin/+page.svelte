<script lang="ts">
	import SignInScreen from '#lib/components/authn/SignInScreen.svelte';
	import { pageTitle } from '#lib/constants/brand.constants.ts';
	import { AppPath } from '#lib/constants/routes.constants.ts';
	import { userSignedIn } from '#lib/derived/user.derived.ts';
	import { localeStore } from '#lib/stores/locale.store.ts';
	import { t } from '#lib/utils/i18n.utils.ts';
	import { goto } from '$app/navigation';

	// If a returning user lands here while already authenticated,
	// route them straight into Flow mode: the canonical first surface
	// for every authenticated session. Single source of truth: the
	// reactive `$effect` covers both the cold-load-already-signed-in
	// case AND the post-signIn() success bounce. Avoid duplicating the
	// trigger on `<SignInScreen onSuccess>` since the two callbacks
	// could fire concurrently and cause a brief signin-flash before
	// `userStore` has finished hydrating the new principal.
	$effect(() => {
		if ($userSignedIn) {
			void goto(AppPath.Flow, { replace: true });
		}
	});
</script>

<svelte:head>
	<title>{pageTitle(t({ locale: $localeStore, key: 'nav.signin' }))}</title>
</svelte:head>

<SignInScreen mode="signin" />
