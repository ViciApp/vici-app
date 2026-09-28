<script lang="ts">
	import type { LucideIcon } from '@lucide/svelte';

	interface Props {
		label: string;
		sub?: string;
		icon?: LucideIcon;
		checked: boolean;
		onchange: (value: boolean) => void;
		disabled?: boolean;
	}

	const {
		label,
		sub = undefined,
		icon: IconComponent = undefined,
		checked,
		onchange,
		disabled = false
	}: Props = $props();

	const toggle = () => {
		if (disabled) {
			return;
		}

		onchange(!checked);
	};
</script>

<div class="set-toggle" class:is-disabled={disabled}>
	{#if IconComponent}
		<span class="set-toggle-icon" aria-hidden="true">
			<IconComponent size={18} strokeWidth={1.6} />
		</span>
	{/if}
	<div class="set-toggle-copy">
		<span class="set-toggle-label">{label}</span>
		{#if sub}
			<span class="set-toggle-sub">{sub}</span>
		{/if}
	</div>
	<button
		class="set-switch"
		class:is-on={checked}
		aria-checked={checked}
		aria-disabled={disabled}
		aria-label={label}
		{disabled}
		onclick={toggle}
		role="switch"
		type="button"
	>
		<span class="set-switch-thumb" aria-hidden="true"></span>
	</button>
</div>

<style lang="postcss">
	.set-toggle {
		display: flex;
		align-items: center;
		gap: 0.75rem;
		padding: 0.875rem;
		background: var(--bg-surface);
	}

	/* Bare inline glyph, tinted to the dim foreground tier — matches the
	   settings-row icon treatment (no tinted tile). */
	.set-toggle-icon {
		display: flex;
		flex-shrink: 0;
		align-items: center;
		justify-content: center;
		color: var(--fg-dim);
	}

	.set-toggle-copy {
		display: flex;
		flex: 1 1 auto;
		flex-direction: column;
		gap: 0.125rem;
		min-width: 0;
	}

	.set-toggle-label {
		font-size: var(--t-14);
		font-weight: 500;
		letter-spacing: -0.005em;
		color: var(--text-base);
	}

	.set-toggle-sub {
		font-size: var(--t-11);
		line-height: 1.4;
		color: var(--text-muted);
		text-wrap: pretty;
	}

	.set-switch {
		position: relative;
		flex-shrink: 0;
		width: 2.75rem;
		height: 1.625rem;
		border: none;
		border-radius: var(--r-pill);
		background: color-mix(in srgb, var(--text-base) 14%, transparent);
		cursor: pointer;
		transition: background-color var(--d-hover) var(--ease-vici);
	}

	.set-switch.is-on {
		background: var(--color-primary);
	}

	.set-switch-thumb {
		position: absolute;
		top: 3px;
		left: 3px;
		width: 1.25rem;
		height: 1.25rem;
		border-radius: 50%;
		background: var(--parchment);
		box-shadow: 0 1px 3px rgba(0, 0, 0, 0.25);
		transition: transform var(--d-hover) var(--ease-vici);
	}

	/* Light / peach themes render the thumb pure white against the
	   accent-filled track, matching the dark theme's parchment thumb. */
	:global([data-theme='light']) .set-switch-thumb,
	:global([data-theme='peach']) .set-switch-thumb {
		background: #ffffff;
	}

	.set-switch.is-on .set-switch-thumb {
		transform: translateX(1.125rem);
	}

	.set-toggle.is-disabled .set-switch,
	.set-toggle.is-disabled .set-toggle-icon {
		opacity: 0.55;
		cursor: not-allowed;
	}

	.set-toggle.is-disabled .set-toggle-label {
		color: var(--text-muted);
	}
</style>
