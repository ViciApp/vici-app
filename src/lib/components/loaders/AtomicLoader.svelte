<script lang="ts">
	import { onMount } from 'svelte';
	import { reportMaintenanceCandidate } from '#lib/services/maintenance.services.ts';
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
			// A polled read is where a satellite deploy first shows up (the
			// canister is stopped), so a failed run still reaches the
			// maintenance watch even though the loop now keeps going.
			onError: (err) => {
				console.error('Polled load failed; retrying on the next interval', err);
				void reportMaintenanceCandidate(err);
			},
			onShouldUseSlowInterval,
			fastIntervalMs: fastInterval,
			slowIntervalMs: slowInterval,
			runImmediately
		})
	);
</script>
