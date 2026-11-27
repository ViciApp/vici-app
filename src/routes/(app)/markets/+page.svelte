<script lang="ts">
	import { untrack } from 'svelte';
	import LoadingSpinner from '#lib/components/ui/LoadingSpinner.svelte';
	import { AppPath } from '#lib/constants/routes.constants.ts';
	import { authBusy, userSignedIn } from '#lib/derived/user.derived.ts';
	import { resolveAppPath, signedOutMarketsHref } from '#lib/utils/nav.utils.ts';
	import { goto } from '$app/navigation';
	import { page } from '$app/state';

	// Redirect alias. A bare `/markets` lands on the markets of whoever opens
	// it: a signed-in session on the app's board (`/app`, which renders
	// `MarketsPage`), a signed-out visitor on the landing's Markets view (the
	// public markets showcase). It waits for the auth handshake to tell the
	// two apart. This `+page.svelte` matches the exact `/markets` path: the
	// `/markets/[id]` detail child route resolves on its own. The incoming
	// query string (and hash, in the app) rides along so `?ref=` /
	// `?utm_source=…` survive the hop.
	let routed = false;

	$effect(() => {
		if ($authBusy || untrack(() => routed)) {
			return;
		}

		routed = true;

		const { search, hash } = page.url;

		void goto(
			$userSignedIn
				? `${resolveAppPath(AppPath.Home)}${search}${hash}`
				: signedOutMarketsHref(search),
			{ replace: true }
		);
	});
</script>

<div class="flex min-h-screen w-full items-center justify-center p-6" aria-hidden="true">
	<LoadingSpinner inlinePad size="md" />
</div>
