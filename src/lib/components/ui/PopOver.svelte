<script lang="ts">
	import type { Snippet } from 'svelte';
	import { fly } from 'svelte/transition';
	import { clickOutside } from '#lib/actions/click-outside.ts';
	import { prefersReducedMotion } from '#lib/utils/reduced-motion.utils.ts';

	interface Props {
		open: boolean;
		onClose?: () => void;
		trigger: Snippet;
		content: Snippet;
		align?: 'left' | 'right';
	}

	let { open = $bindable(), onClose, trigger, content, align = 'right' }: Props = $props();

	const toggle = () => {
		open = !open;
	};

	const handleClose = () => {
		if (open) {
			open = false;
			onClose?.();
		}
	};
</script>

<div class="relative inline-block text-left" use:clickOutside={handleClose}>
	<div onclick={toggle} onkeydown={(e) => e.key === 'Enter' && toggle()} role="button" tabindex="0">
		{@render trigger()}
	</div>

	{#if open}
		<div
			class="absolute {align === 'right'
				? 'right-0'
				: 'left-0'} bg-popover border-border-strong shadow-modal z-50 mt-2 min-w-48 origin-top-right rounded-[8px] border p-2 backdrop-blur-md focus:outline-none"
			transition:fly={prefersReducedMotion() ? { duration: 0 } : { y: 8, duration: 200 }}
		>
			{@render content()}
		</div>
	{/if}
</div>
