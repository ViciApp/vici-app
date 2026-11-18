<script lang="ts">
	import { onMount } from 'svelte';
	import { startPolling } from '#lib/utils/async.utils.ts';

	interface Props {
		onLoad: () => Promise<void>;
		onShouldUseSlowInterval: () => Promise<boolean>;
		fastInterval?: number;
		slowInterval?: number;
		runImmediately?: boolean;
	}

	const {
		onLoad,
		onShouldUseSlowInterval,
		fastInterval = 1_000,
		slowInterval = 30_000,
		runImmediately = true
	}: Props = $props();

	onMount(() =>
		startPolling({
			onLoad,
			onShouldUseSlowInterval,
			fastIntervalMs: fastInterval,
			slowIntervalMs: slowInterval,
			runImmediately
		})
	);
</script>
