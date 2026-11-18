<script lang="ts">
	import { Lock } from '@lucide/svelte';
	import { fade, fly } from 'svelte/transition';
	import SignInActions from '#lib/components/authn/SignInActions.svelte';
	import Card from '#lib/components/ui/Card.svelte';
	import { prefersReducedMotion } from '#lib/utils/reduced-motion.utils.ts';

	interface Props {
		title?: string;
		message?: string;
	}

	const {
		title = 'Sign In Required',
		message = 'Please sign in to access the Flow feature and start trading.'
	}: Props = $props();
</script>

<div class="flex min-h-[calc(100vh-10rem)] items-center justify-center px-4" in:fade>
	<Card class="w-full max-w-md text-center" padding="lg" variant="glass">
		<div in:fly={prefersReducedMotion() ? { duration: 0 } : { y: 20, delay: 100 }}>
			<div
				class="bg-primary/10 text-primary mx-auto mb-6 flex h-20 w-20 items-center justify-center rounded-full"
			>
				<Lock size={40} strokeWidth={2.5} />
			</div>

			<h2 class="text-foreground mb-4 text-3xl font-black">
				{title}
			</h2>

			<p class="text-muted-foreground mb-10">
				{message}
			</p>

			<div class="flex justify-center">
				<SignInActions />
			</div>
		</div>
	</Card>
</div>
