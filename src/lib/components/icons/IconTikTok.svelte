<script lang="ts">
	// Minimal TikTok glyph: a single quaver-note silhouette traced as
	// two strokes. There is no Lucide brand icon for TikTok, so this
	// bespoke mark keeps the share tiles consistent with the other
	// channel icons (24px box, currentColor stroke).
	interface Props {
		size?: number;
	}

	const { size = 20 }: Props = $props();
</script>

<svg
	aria-hidden="true"
	fill="none"
	height={size}
	stroke="currentColor"
	stroke-linecap="round"
	stroke-linejoin="round"
	stroke-width="2"
	viewBox="0 0 24 24"
	width={size}
	xmlns="http://www.w3.org/2000/svg"
>
	<path d="M14 4v8.5a4 4 0 1 1-3.3-3.94" />
	<path d="M14 4a5.5 5.5 0 0 0 5.5 5.2" />
</svg>
