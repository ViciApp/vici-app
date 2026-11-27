<script lang="ts">
	import AtomicLoader from '#lib/components/loaders/AtomicLoader.svelte';
	import { isSignedIn } from '#lib/services/identity.services.ts';

	interface Props {
		onLoad: () => Promise<void>;
		fastInterval?: number;
		slowInterval?: number;
		runImmediately?: boolean;
	}

	const {
		onLoad,
		fastInterval = 1_000,
		slowInterval = 30_000,
		runImmediately = true
	}: Props = $props();

	// `isSignedIn` reads the cookie-session store. Gating on a local identity
	// would leave every loader permanently idle, since none ever exists.
	const onShouldUseSlowInterval = (): Promise<boolean> => isSignedIn();

	const safeOnLoad = async () => {
		if (await isSignedIn()) {
			await onLoad();
		}
	};
</script>

<AtomicLoader
	{fastInterval}
	onLoad={safeOnLoad}
	{onShouldUseSlowInterval}
	{runImmediately}
	{slowInterval}
/>
