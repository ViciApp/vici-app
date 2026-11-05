<script lang="ts">
	import SignInProviderStack from '#lib/components/authn/SignInProviderStack.svelte';

	interface Props {
		onSuccess?: () => void;
	}

	const { onSuccess }: Props = $props();
</script>

<div class="signin-actions">
	<SignInProviderStack {onSuccess} />
</div>

<style lang="postcss">
	.signin-actions {
		display: flex;
		width: 100%;
		flex-direction: column;
	}

	/* The provider stack carries a trailing margin tuned for the full
	   sign-in screen's vertical rhythm. Inside the compact modal and
	   gated surfaces that host these actions, that bottom gap isn't
	   wanted — the surrounding surface owns the spacing. */
	.signin-actions :global(.signin-providers) {
		margin-bottom: 0;
	}
</style>
