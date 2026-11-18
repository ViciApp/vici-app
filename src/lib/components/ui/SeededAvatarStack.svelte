<script lang="ts">
	/**
	 * Stack of overlapping circular avatars, each a deterministic
	 * generated character face derived from its seed string. Used as
	 * decorative social-proof on the FlowCard front face and the
	 * landing-page hero deck: both surfaces want a small cluster of
	 * faces that read as a crowd without exposing real user data.
	 *
	 * The default seed roster (`augustus / cassandra / nero / livia`)
	 * matches the canonical four the landing surface ships with, so
	 * tunnelling a deck card from landing into Flow keeps the same
	 * faces. Callers can override `seeds` for surfaces that want a
	 * different spread.
	 */

	import ViciAvatar from '#lib/components/ui/ViciAvatar.svelte';

	interface Props {
		/** Seed strings: one per avatar. Order is preserved. */
		seeds?: ReadonlyArray<string>;
		/** Outer diameter in pixels. Default 22: the compact size the
		 *  social-proof row reads cleanly at. */
		size?: number;
		/** Border colour drawn between adjacent avatars so the
		 *  overlap reads cleanly. Defaults to the elevated bg token. */
		borderColor?: string;
	}

	const DEFAULT_SEEDS = ['augustus', 'cassandra', 'nero', 'livia'] as const;

	const {
		seeds = DEFAULT_SEEDS,
		size = 22,
		borderColor = 'var(--bg-elevated, var(--bg-surface))'
	}: Props = $props();

	const overlap = $derived(Math.round(size * 0.36));

	// Paint order, not z-index, sets the stacking: the visually-leftmost
	// avatar must sit on top, so it has to be painted LAST → it goes last
	// in the DOM. We reverse the roster for the DOM and lay it back out
	// left-to-right with `row-reverse` (see the style block). Avoiding `z-index`
	// here is load-bearing: a flex item with `z-index` creates a stacking
	// context, and iOS/WebKit hoists such children out of an ancestor's
	// `backface-visibility: hidden` culling, which made this stack "flip
	// and stay" visible through the back of the FlowCard on iPhone while
	// Chrome/Android/desktop culled it correctly.
	const ordered = $derived([...seeds].reverse());
</script>

<div class="seeded-avatar-stack" aria-hidden="true">
	{#each ordered as s, i (s)}
		<span
			style:width="{size}px"
			style:height="{size}px"
			style:margin-right={i === 0 ? '0' : `-${overlap}px`}
			style:border={`1.5px solid ${borderColor}`}
			class="seeded-avatar"
		>
			<ViciAvatar seed={s} {size} />
		</span>
	{/each}
</div>

<style lang="postcss">
	.seeded-avatar-stack {
		display: inline-flex;
		/* `row-reverse` so the reversed DOM roster reads left-to-right in
		   the original order while the first-listed avatar (last in the
		   DOM) paints on top; overlap is driven by paint order, never
		   `z-index` (see the note in the script block). */
		flex-direction: row-reverse;
		align-items: center;
	}

	.seeded-avatar {
		display: inline-flex;
		border-radius: var(--r-pill);
		overflow: hidden;
	}

	/* The generated face fills the circular slot edge-to-edge. */
	.seeded-avatar :global(.vici-avatar) {
		width: 100%;
		height: 100%;
	}
</style>
