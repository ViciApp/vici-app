<script lang="ts">
	import { onMount } from 'svelte';
	import LoadingSpinner from '#lib/components/ui/LoadingSpinner.svelte';
	import { AppPath } from '#lib/constants/routes.constants.ts';
	import { resolveAppPath } from '#lib/utils/nav.utils.ts';
	import { goto } from '$app/navigation';
	import { page } from '$app/state';

	// Redirect alias. The markets list now lives on the canonical home
	// surface (`/app`, which renders `MarketsPage`); the Markets nav tab
	// targets it directly. A bare `/markets` is kept only as a redirect so
	// older links land on the canonical list. This `+page.svelte` matches
	// the exact `/markets` path — the `/markets/[id]` detail child route is
	// untouched and still resolves on its own. Carry the incoming query
	// string and hash through so `?utm_source=…` / `#section` survive the
	// hop, mirroring the `/m/[id]` share-link alias.
	onMount(() => {
		const { search, hash } = page.url;
		void goto(`${resolveAppPath(AppPath.Home)}${search}${hash}`, { replace: true });
	});
</script>

<div class="flex min-h-screen w-full items-center justify-center p-6" aria-hidden="true">
	<LoadingSpinner inlinePad size="md" />
</div>
