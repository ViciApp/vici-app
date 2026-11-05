<script lang="ts">
	import type { Snippet } from 'svelte';
	import type { HTMLButtonAttributes } from 'svelte/elements';
	import BaseButton from '#lib/components/ui/BaseButton.svelte';
	import type { ButtonStatus } from '#lib/types/components.ts';

	interface Props extends Omit<HTMLButtonAttributes, 'disabled' | 'aria-busy'> {
		status?: ButtonStatus;
		variant?: 'primary' | 'secondary' | 'outline' | 'ghost' | 'danger';
		size?: 'sm' | 'md' | 'lg';
		busyLabel?: Snippet;
		children: Snippet;
		onclick?: () => void;
		class?: string;
	}

	const {
		status,
		variant = 'primary',
		size = 'md',
		busyLabel = undefined,
		children,
		onclick = undefined,
		class: className = '',
		...rest
	}: Props = $props();

	const variants: Record<NonNullable<Props['variant']>, string> = {
		primary: 'bg-primary text-primary-foreground shadow-inset-hi hover:bg-laurel-deep',
		secondary:
			'border border-border bg-foreground/6 text-foreground shadow-inset-hi hover:border-border-strong hover:bg-foreground/10',
		outline:
			'border border-primary/45 bg-transparent text-primary hover:border-primary hover:bg-laurel-glow',
		ghost: 'bg-transparent text-foreground hover:bg-foreground/6',
		danger: 'bg-danger text-danger-foreground shadow-inset-hi hover:bg-danger-deep'
	};

	// Padding + type scale: default = `14px 20px / 14px text`, large =
	// `16px 22px / 16px text`, small scales down proportionally. Every
	// size shares the full pill radius (`rounded-full`) set on the
	// wrapper below — the shape is a pill across all variants and sizes.
	const sizes: Record<NonNullable<Props['size']>, string> = {
		sm: 'px-3 py-2 text-xs',
		md: 'px-5 py-3.5 text-sm',
		lg: 'px-[1.375rem] py-4 text-base'
	};
</script>

<BaseButton
	class="ease-vici duration-hover gap-2 rounded-full font-semibold tracking-[-0.005em] whitespace-nowrap transition-all active:scale-[0.97] {variants[
		variant
	]} {sizes[size]} {className}"
	{busyLabel}
	{onclick}
	{status}
	{...rest}
>
	{@render children()}
</BaseButton>
