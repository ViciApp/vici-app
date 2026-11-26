<script lang="ts">
	import type { Snippet } from 'svelte';

	/**
	 * Host of the Markets detail: a floating glass panel beside the list on
	 * wide screens, a bottom sheet over a scrim on phones (`sheet`). The
	 * sheet is a modal dialog while open and inert while closed; it keeps its
	 * last content while it slides away.
	 */
	interface Props {
		id: string;
		titleId: string;
		sheet: boolean;
		/** Sheet only: whether it is up. */
		open: boolean;
		onclose: () => void;
		children: Snippet;
	}

	const { id, titleId, sheet, open, onclose, children }: Props = $props();

	let panel = $state<HTMLElement | undefined>(undefined);

	// Move focus into the sheet as it opens, so keyboard and screen-reader
	// users land on the detail they asked for.
	$effect(() => {
		if (sheet && open) {
			panel?.focus({ preventScroll: true });
		}
	});
</script>

{#if sheet}
	<button
		class="lmp-scrim"
		class:is-on={open}
		aria-hidden="true"
		onclick={onclose}
		tabindex="-1"
		type="button"
	></button>
	<div
		bind:this={panel}
		{id}
		class="lmp is-sheet"
		class:is-on={open}
		aria-labelledby={titleId}
		aria-modal="true"
		inert={!open}
		role="dialog"
		tabindex="-1"
	>
		{@render children()}
	</div>
{:else}
	<section bind:this={panel} {id} class="lmp" aria-labelledby={titleId}>
		{@render children()}
	</section>
{/if}

<style lang="postcss">
	.lmp {
		position: relative;
		display: flex;
		flex-direction: column;
		min-height: 0;
		margin: calc(var(--lm-top) + 10px) var(--lm-pad) calc(16px + var(--docked-footer-inset)) 4px;
		overflow: hidden;
		border-radius: 28px;
		background: var(--lm-pane-a);
		box-shadow:
			var(--lm-ring),
			0 40px 80px -50px color-mix(in srgb, var(--ink-deep) 90%, transparent);
		outline: none;
		-webkit-backdrop-filter: blur(30px) saturate(170%);
		backdrop-filter: blur(30px) saturate(170%);
	}

	.lmp.is-sheet {
		position: absolute;
		right: 0;
		bottom: 0;
		left: 0;
		z-index: 5;
		max-height: 85dvh;
		margin: 0;
		border-radius: 30px 30px 0 0;
		background: color-mix(in srgb, var(--ink-raised) 66%, transparent);
		box-shadow:
			inset 0 1px 0 color-mix(in srgb, var(--parchment) 26%, transparent),
			0 -30px 70px -30px color-mix(in srgb, var(--ink-deep) 80%, transparent);
		transform: translate3d(0, 103%, 0);
		transition: transform 240ms var(--ease-vici);
		-webkit-backdrop-filter: blur(34px) saturate(170%);
		backdrop-filter: blur(34px) saturate(170%);
	}

	.lmp.is-sheet.is-on {
		transform: none;
		transition: transform 380ms cubic-bezier(0.32, 0.72, 0, 1);
	}

	.lmp-scrim {
		position: absolute;
		inset: 0;
		z-index: 4;
		padding: 0;
		border: 0;
		background: color-mix(in srgb, var(--ink-deep) 50%, transparent);
		opacity: 0;
		pointer-events: none;
		transition: opacity 220ms var(--ease-vici);
	}

	.lmp-scrim.is-on {
		opacity: 1;
		pointer-events: auto;
	}

	@supports not ((backdrop-filter: blur(1px)) or (-webkit-backdrop-filter: blur(1px))) {
		.lmp,
		.lmp.is-sheet {
			background: color-mix(in srgb, var(--ink-raised) 96%, transparent);
		}
	}

	@media (prefers-reduced-transparency: reduce) {
		.lmp,
		.lmp.is-sheet {
			background: var(--ink-elevated);
			-webkit-backdrop-filter: none;
			backdrop-filter: none;
		}
	}

	@media (prefers-contrast: more) {
		.lmp,
		.lmp.is-sheet {
			background: var(--ink-elevated);
		}
	}

	@media (prefers-reduced-motion: reduce) {
		.lmp.is-sheet,
		.lmp.is-sheet.is-on {
			transition: none;
		}

		.lmp-scrim {
			transition: opacity 160ms ease;
		}
	}
</style>
