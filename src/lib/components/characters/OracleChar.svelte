<script lang="ts">
	import { CHAR_INK, CHAR_CREAM, CHAR_PALETTE } from '#lib/constants/characters.constants.ts';

	interface Props {
		size?: number;
		animate?: boolean;
	}

	let { size = 48, animate = true }: Props = $props();

	const { fill: FILL } = CHAR_PALETTE.oracle;
</script>

<svg aria-hidden="true" height={size} viewBox="0 0 80 80" width={size}>
	<ellipse cx="40" cy="74" fill="#000" opacity="0.3" rx="20" ry="3" />
	<path d="M22 70 L24 30 Q40 8 56 30 L58 70 Z" fill={CHAR_CREAM} opacity="0.92" />
	<path d="M30 38 Q40 18 50 38 L50 50 Q40 42 30 50 Z" fill={FILL} />
	<path d="M36 40 Q40 32 44 40 L44 50 Q40 46 36 50 Z" fill={CHAR_INK} />
	<circle class={animate ? 'char-pulse' : ''} cx="40" cy="44" fill={FILL} r="2.4" />
	<path
		class={animate ? 'char-twinkle char-twinkle-a' : ''}
		d="M62 22 l1 4 l4 1 l-4 1 l-1 4 l-1 -4 l-4 -1 l4 -1 z"
		fill={FILL}
	/>
	<path
		class={animate ? 'char-twinkle char-twinkle-b' : ''}
		d="M16 40 l0.6 2.4 l2.4 0.6 l-2.4 0.6 l-0.6 2.4 l-0.6 -2.4 l-2.4 -0.6 l2.4 -0.6 z"
		fill={FILL}
	/>
</svg>
