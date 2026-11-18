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

	// `isSignedIn` is backend-agnostic: the Juno identity check on the default
	// on-chain backend, the cookie-session store in web2 mode. Gating on the
	// identity directly would leave every loader permanently idle in web2 mode,
	// where no local identity ever exists.
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
