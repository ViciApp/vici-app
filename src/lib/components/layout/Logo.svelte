<script lang="ts">
	import BaseButton from '#lib/components/ui/BaseButton.svelte';
	import { AppPath } from '#lib/constants/routes.constants.ts';
	import { goto } from '$app/navigation';

	interface Props {
		/** When set, render a link (for public landing) instead of the in-app home button. */
		href?: string;
	}

	const { href }: Props = $props();

	const handleNav = (path: AppPath) => {
		goto(path);
	};

	// Type-set live in product per the brand book: Hanken Grotesk Bold,
	// ALL CAPS, 0.18em tracking. Colour resolves to parchment on dark
	// surfaces and ink on light via `text-foreground`; laurel gold is
	// reserved for the app-icon tile and must not appear on the mark.
	// No drop-shadow / glow / gradient hover effects on the mark itself.
	const wordmarkClass =
		'text-foreground inline-block font-bold uppercase leading-none text-2xl tracking-[0.18em] transition-opacity duration-200 group-hover:opacity-80';
</script>

{#snippet wordmark()}
	<span style="font-family: var(--font-display);" class={wordmarkClass} aria-hidden="true">
		VICI
	</span>
{/snippet}

{#if href}
	<a class="group inline-flex items-center" aria-label="VICI" {href}>
		{@render wordmark()}
	</a>
{:else}
	<BaseButton
		class="group flex items-center"
		aria-label="VICI — go to home"
		onclick={() => handleNav(AppPath.Home)}
	>
		{@render wordmark()}
	</BaseButton>
{/if}
