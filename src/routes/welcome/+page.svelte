<script lang="ts">
	import { onMount } from 'svelte';
	import { PublicPath } from '#lib/constants/routes.constants.ts';
	import { goto } from '$app/navigation';
	import { resolve } from '$app/paths';

	// An earlier address of the marketing page, still linked from outside:
	// it leads to the landing page.
	onMount(() => {
		void goto(resolve(PublicPath.Landing), { replace: true });
	});
</script>
