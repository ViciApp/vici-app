<script lang="ts">
	// A pulsing squircle placeholder that mirrors {@link MenagerieBadge}'s frame
	// (same size + corner radius), shown while the trophy layer's live signals
	// (global rank, referrals) are still loading, so a not-yet-resolved tier
	// never flashes as a grey "locked" badge.
	interface Props {
		/** Square edge length in px: match the real badge it stands in for. */
		size?: number;
	}

	const { size = 120 }: Props = $props();
</script>

<div style:--mb-size="{size}px" class="mbadge-skeleton animate-pulse" aria-hidden="true"></div>

<style lang="postcss">
	.mbadge-skeleton {
		flex: none;
		width: var(--mb-size, 120px);
		height: var(--mb-size, 120px);
		/* Matches MenagerieBadge's `.mb-frame` corner radius (`size * 0.25`). */
		border-radius: calc(var(--mb-size, 120px) * 0.25);
		border: 1px solid var(--border-base);
		background: color-mix(in srgb, var(--text-base) 8%, transparent);
	}
</style>
