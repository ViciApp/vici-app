<script lang="ts">
	import { CHAR_CREAM, CHAR_INK, CHAR_PALETTE } from '#lib/constants/characters.constants.ts';

	interface Props {
		size?: number;
		animate?: boolean;
		withChart?: boolean;
	}

	let { size = 48, animate = true, withChart = false }: Props = $props();

	const { fill: FILL } = CHAR_PALETTE.archivist;
</script>

<svg aria-hidden="true" height={size} viewBox="0 0 80 80" width={size}>
	<ellipse cx="40" cy="74" fill="#000" opacity="0.3" rx="22" ry="3" />
	<ellipse cx="40" cy="50" fill={FILL} rx="22" ry="20" />
	<circle cx="32" cy="46" fill={CHAR_CREAM} r="7" />
	<circle cx="48" cy="46" fill={CHAR_CREAM} r="7" />
	<circle cx="32" cy="46" fill={CHAR_INK} r="3.5" />
	<circle cx="48" cy="46" fill={CHAR_INK} r="3.5" />
	<path
		d="M25 46 L39 46 M41 46 L55 46"
		fill="none"
		stroke={CHAR_INK}
		stroke-linecap="round"
		stroke-width="1.4"
	/>
	<path
		d="M37 56 q3 2 6 0"
		fill="none"
		stroke={CHAR_INK}
		stroke-linecap="round"
		stroke-width="1.4"
	/>
	{#if withChart}
		<rect fill={CHAR_CREAM} height="14" opacity="0.92" rx="2" width="22" x="50" y="56" />
		<path
			class={animate ? 'char-chart' : ''}
			d="M53 66 L57 60 L61 64 L67 56"
			fill="none"
			stroke={FILL}
			stroke-linecap="round"
			stroke-linejoin="round"
			stroke-width="1.6"
		/>
	{/if}
</svg>
