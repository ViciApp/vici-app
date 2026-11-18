<script lang="ts">
	import { nonNullish } from '@dfinity/utils';
	import type { Snippet } from 'svelte';
	import type { HTMLAttributes } from 'svelte/elements';
	import BaseButton from '#lib/components/ui/BaseButton.svelte';
	import type { CardPadding } from '#lib/types/components.ts';

	interface Props extends Omit<HTMLAttributes<HTMLElement>, 'class' | 'role'> {
		children: Snippet;
		variant?: 'default' | 'glass' | 'outline';
		padding?: CardPadding;
		onclick?: (e: MouseEvent) => void;
		onkeydown?: (e: KeyboardEvent) => void;
		role?: 'button' | 'presentation' | 'none';
		class?: string;
	}

	const {
		children,
		variant = 'default',
		padding = 'md',
		onclick,
		onkeydown,
		role,
		class: className,
		...rest
	}: Props = $props();

	const commonClasses =
		'flex flex-col items-start justify-between rounded-2xl border transition-all duration-hover ease-vici';

	const variants: Record<NonNullable<Props['variant']>, string> = {
		default: 'border-border bg-card text-card-foreground shadow-card',
		glass:
			'border-border-strong/70 bg-popover/70 text-popover-foreground shadow-card backdrop-blur-xl',
		outline: 'border-border bg-card/35 text-card-foreground'
	};

	const paddings: Record<NonNullable<Props['padding']>, string> = {
		none: 'p-0',
		sm: 'p-4',
		md: 'p-6',
		lg: 'p-8'
	};

	const isInteractive = $derived(nonNullish(onclick) || nonNullish(onkeydown) || role === 'button');

	const interactiveClass = $derived(
		isInteractive ? 'hover:border-border-strong hover:bg-card/80 active:scale-[0.985]' : ''
	);
</script>

{#if isInteractive}
	<BaseButton
		class="{commonClasses} {variants[variant]} {paddings[padding]} {interactiveClass} {className}"
		{onclick}
		{onkeydown}
		{role}
		{...rest}
	>
		{@render children()}
	</BaseButton>
{:else}
	<div class="{commonClasses} {variants[variant]} {paddings[padding]} {className}" {role} {...rest}>
		{@render children()}
	</div>
{/if}
