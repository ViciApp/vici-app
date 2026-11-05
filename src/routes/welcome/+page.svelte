<script lang="ts">
	import { onMount } from 'svelte';
	import { PublicPath } from '#lib/constants/routes.constants.ts';
	import { goto } from '$app/navigation';
	import { resolve } from '$app/paths';

	// Backward-compat alias. `/welcome` is the legacy marketing URL;
	// `/about` is the canonical share-able destination.
	onMount(() => {
		void goto(resolve(PublicPath.About), { replace: true });
	});
</script>
