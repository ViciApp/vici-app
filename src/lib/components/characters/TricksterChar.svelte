<script lang="ts">
	import { CHAR_CREAM, CHAR_INK, CHAR_PALETTE } from '#lib/constants/characters.constants.ts';

	interface Props {
		size?: number;
		animate?: boolean;
		lightning?: boolean;
	}

	let { size = 48, animate = true, lightning = false }: Props = $props();

	const { fill: FILL } = CHAR_PALETTE.trickster;
</script>

<svg aria-hidden="true" height={size} viewBox="0 0 80 80" width={size}>
	<ellipse cx="40" cy="74" fill="#000" opacity="0.3" rx="22" ry="3" />

	<path
		style="transform-origin: 55px 55px"
		class={animate ? 'char-tail' : ''}
		d="M55 50 Q72 60 70 70 Q60 64 55 60 Z"
		fill={FILL}
		opacity="0.8"
	/>

	<ellipse cx="42" cy="50" fill={FILL} rx="18" ry="14" />

	<g style="transform-origin: 30px 32px" class={animate ? 'char-ear' : ''}>
		<path d="M28 32 L24 18 L36 26 Z" fill={FILL} />
		<path d="M30 30 L28 24 L33 28 Z" fill={CHAR_CREAM} opacity="0.4" />
	</g>

	<path d="M52 32 L60 22 L56 34 Z" fill={FILL} />
	<path d="M55 30 L57 24 L52 28 Z" fill={CHAR_CREAM} opacity="0.4" />

	<path
		d="M34 46 q2 -2 3 0"
		fill="none"
		stroke={CHAR_INK}
		stroke-linecap="round"
		stroke-width="1.4"
	/>
	<path
		d="M48 46 q2 -2 3 0"
		fill="none"
		stroke={CHAR_INK}
		stroke-linecap="round"
		stroke-width="1.4"
	/>
	<path
		d="M40 52 q2 1.5 4 0"
		fill="none"
		stroke={CHAR_INK}
		stroke-linecap="round"
		stroke-width="1.4"
	/>
	<path d="M40 50 L40 56" stroke={CHAR_INK} stroke-linecap="round" stroke-width="1.4" />

	{#if lightning}
		<path class={animate ? 'char-bolt' : ''} d="M66 36 l-3 -3 l5 -1 l-2 5" fill="#FF6B6B" />
		<path class={animate ? 'char-bolt' : ''} d="M14 38 l3 -3 l-5 -1 l2 5" fill="#FF6B6B" />
	{/if}
</svg>
