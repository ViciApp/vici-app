<script lang="ts">
	import { CHAR_CREAM, CHAR_INK, CHAR_PALETTE } from '#lib/constants/characters.constants.ts';

	type ViciMood = 'happy' | 'encouraging' | 'thinking' | 'surprised';

	interface Props {
		size?: number;
		animate?: boolean;
		mood?: ViciMood;
	}

	let { size = 48, animate = true, mood = 'happy' }: Props = $props();

	const { fill: FILL, deep: DEEP } = CHAR_PALETTE.vici;

	const eyes: Record<ViciMood, string> = {
		happy: 'M34 39 q1 -2 2 0 M44 39 q1 -2 2 0',
		encouraging: 'M34 39 q1 -2 2 0 M44 39 q1 -2 2 0',
		thinking: 'M33 39 L37 39 M43 39 L47 39',
		surprised: 'M35 39 a1.4 1.4 0 1 0 0.1 0 M45 39 a1.4 1.4 0 1 0 0.1 0'
	};

	const mouths: Record<ViciMood, string> = {
		happy: 'M37 44 q3 2.5 6 0',
		encouraging: 'M36 43 q4 4 8 0',
		thinking: 'M37 45 L43 45',
		surprised: 'M39 44 q1.5 2 3 0 q1.5 -2 3 0'
	};
</script>

<svg
	class={animate ? 'char-bob' : ''}
	aria-hidden="true"
	height={size}
	viewBox="0 0 80 80"
	width={size}
>
	<ellipse cx="40" cy="74" fill="#000" opacity="0.3" rx="22" ry="3" />
	<path d="M40 20 L36 14 L44 14 Z" fill={DEEP} />
	<circle cx="40" cy="42" fill={FILL} r="22" />
	<circle cx="40" cy="38" fill={CHAR_INK} r="14" />
	<g class={animate ? 'char-blink' : ''}>
		<path
			d={eyes[mood]}
			fill="none"
			stroke={CHAR_CREAM}
			stroke-linecap="round"
			stroke-width="1.4"
		/>
	</g>
	<path
		d={mouths[mood]}
		fill="none"
		stroke={CHAR_CREAM}
		stroke-linecap="round"
		stroke-width="1.4"
	/>
	<path d="M34 56 L40 64 L46 56 Z" fill={DEEP} opacity="0.6" />
</svg>
