<script lang="ts">
	import type { Snippet } from 'svelte';

	/**
	 * The table layout's side panel: the selected market's detail, floating
	 * as glass beside the list. The table exists only on wide screens.
	 */
	interface Props {
		id: string;
		titleId: string;
		children: Snippet;
	}

	const { id, titleId, children }: Props = $props();
</script>

<section {id} class="lmp" aria-labelledby={titleId}>
	{@render children()}
</section>

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
		-webkit-backdrop-filter: blur(30px) saturate(170%);
		backdrop-filter: blur(30px) saturate(170%);
	}

	@supports not ((backdrop-filter: blur(1px)) or (-webkit-backdrop-filter: blur(1px))) {
		.lmp {
			background: color-mix(in srgb, var(--ink-raised) 96%, transparent);
		}
	}

	@media (prefers-reduced-transparency: reduce) {
		.lmp {
			background: var(--ink-elevated);
			-webkit-backdrop-filter: none;
			backdrop-filter: none;
		}
	}

	@media (prefers-contrast: more) {
		.lmp {
			background: var(--ink-elevated);
		}
	}
</style>
