<script lang="ts">
	import TricksterChar from '#lib/components/characters/TricksterChar.svelte';

	/**
	 * Trickster: contrarian-call pill character. Thin wrapper around the
	 * shared `TricksterChar` SVG so Flow-surface callers (FlowCard front
	 * header, WelcomeHeroFlowCard) can drop in `<Trickster size lightning />`.
	 * The SVG mass lives in the shared character component so we don't
	 * fork the path data across surfaces.
	 */
	interface Props {
		size?: number;
		animate?: boolean;
		lightning?: boolean;
	}

	const { size = 48, animate = true, lightning = false }: Props = $props();
</script>

<TricksterChar {animate} {lightning} {size} />
