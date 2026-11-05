<script lang="ts">
	import { nonNullish } from '@dfinity/utils';
	import { stageForStreak, type FlameStage } from '#lib/utils/streak.utils.ts';

	/**
	 * Tiny inline streak-flame icon — a 16-px SVG flame filled with a
	 * stage-keyed vertical linear gradient (`spark` → `inferno` shift
	 * the palette from cool orange to laurel-yellow). Used in stat
	 * rows where the full-character {@link FlameChar} would be too
	 * heavy: Profile identity, Flow top bar, Dash header, etc.
	 *
	 * Pass either `count` (we derive the stage via
	 * {@link stageForStreak}) or an explicit `stage`.
	 */
	interface Props {
		count?: number;
		stage?: FlameStage;
		size?: number;
	}

	const { count, stage: stageProp, size = 16 }: Props = $props();

	const stage = $derived<FlameStage>(
		stageProp ?? (nonNullish(count) ? stageForStreak(count) : 'spark')
	);

	// Stage palettes — `[top, bottom]`. Top stop is the cooler hue, bottom
	// the hotter one; gradient runs top → bottom so the base of the flame
	// reads as the hot core.
	const COLORS: Record<FlameStage, [string, string]> = {
		spark: ['#FFB066', '#FF8A4C'],
		ember: ['#FF8A4C', '#FF6B3A'],
		flame: ['#FF6B3A', '#FF3F1F'],
		blaze: ['#FF3F1F', '#E2B842'],
		inferno: ['#E2B842', '#FFE66B']
	};

	const [top, bottom] = $derived(COLORS[stage]);
	const gradientId = $derived(`streak-flame-${stage}`);
</script>

<svg aria-hidden="true" fill="url(#{gradientId})" height={size} viewBox="0 0 24 24" width={size}>
	<defs>
		<linearGradient id={gradientId} x1="0" x2="0" y1="1" y2="0">
			<stop offset="0%" stop-color={bottom} />
			<stop offset="100%" stop-color={top} />
		</linearGradient>
	</defs>
	<path
		d="M12 2s4 4 4 8a4 4 0 0 1-8 0c0-1 .5-2 1-2.5 0 2 1 3 2 3 0-3-1-5 1-8.5z M5 14a7 7 0 1 0 14 0c0-3-2-5-4-7 0 3-1 4-2 4-2 0-3-2-3-4-3 2-5 4-5 7z"
	/>
</svg>
