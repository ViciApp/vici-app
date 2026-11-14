<script lang="ts">
	import { onMount } from 'svelte';
	import SignInScreen from '#lib/components/authn/SignInScreen.svelte';
	import { AppPath } from '#lib/constants/routes.constants.ts';
	import { userSignedIn } from '#lib/derived/user.derived.ts';
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

	onMount(() => {
		document.title = 'Sign in · VICI';
	});
</script>

<SignInScreen mode="signin" />
