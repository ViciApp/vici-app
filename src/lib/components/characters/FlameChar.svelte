<script lang="ts">
	import { CHAR_INK, FLAME_STAGES } from '#lib/constants/characters.constants.ts';
	import type { FlameStage } from '#lib/utils/streak.utils.ts';

	interface Props {
		size?: number;
		animate?: boolean;
		stage?: FlameStage;
	}

	let { size = 48, animate = true, stage = 'flame' }: Props = $props();

	let s = $derived(FLAME_STAGES[stage]);
</script>

<svg aria-hidden="true" height={size} viewBox="0 0 80 80" width={size}>
	<ellipse cx="40" cy="74" fill="#000" opacity="0.3" rx="20" ry="3" />
	<g
		style="transform-origin: 40px 50px; transform: scale({s.scale})"
		class={animate ? 'char-flicker' : ''}
	>
		<path
			d="M40 12 Q36 28 44 32 Q56 22 50 38 Q66 32 58 50 Q68 56 56 64 Q50 72 40 72 Q30 72 24 64 Q12 56 22 50 Q14 32 30 38 Q24 22 36 32 Q44 28 40 12 Z"
			fill={s.core}
		/>
		<path
			d="M40 30 Q38 42 44 46 Q52 42 50 52 Q56 50 52 60 Q46 68 40 68 Q34 68 28 60 Q24 50 30 52 Q28 42 36 46 Q42 42 40 30 Z"
			fill={s.tip}
			opacity="0.85"
		/>
		{#if stage !== 'spark'}
			<circle cx="36" cy="56" fill={CHAR_INK} r="1.6" />
			<circle cx="46" cy="56" fill={CHAR_INK} r="1.6" />
			<path
				d="M38 62 q2 1.5 4 0"
				fill="none"
				stroke={CHAR_INK}
				stroke-linecap="round"
				stroke-width="1.2"
			/>
		{/if}
	</g>
</svg>
