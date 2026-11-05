<script lang="ts">
	import { isMacroId } from '#lib/constants/market-taxonomy.constants.ts';
	import {
		MACRO_ART_BUCKET,
		type FlowArtBucket,
		type FlowArtCategory
	} from '#lib/utils/flow-art.utils.ts';
	import { prefersReducedMotion } from '#lib/utils/reduced-motion.utils.ts';

	/**
	 * Per-category animated motif — a small, self-animating SVG glyph that
	 * gives each prediction category its own visual signature (the rate
	 * dial for macro, the chained blocks for crypto, the scoreboard for
	 * sports, …). Unlike the full-bleed {@link MarketArtwork} this is a
	 * compact ~56 px mark suited to chips, list rows, and headers.
	 *
	 * The motion is driven by a single `requestAnimationFrame` clock
	 * (`elapsed`, in seconds) so the trigonometric phases stay smooth and
	 * frame-rate independent. The clock is paused when the viewer prefers
	 * reduced motion — the glyph then renders its t=0 resting frame, which
	 * is a valid static composition for every category.
	 */
	interface Props {
		// Visual language — a taxonomy macro (or the `wc` tentpole). Macros
		// fold onto one of the six bespoke motif languages via
		// `MACRO_ART_BUCKET`; the `wc` tentpole has no dedicated motif and
		// falls through to the pulsing dot fallback (its identity lives in
		// the editorial artwork band).
		category: FlowArtCategory | string;
		// Stroke / fill accent. Pass the resolved category colour.
		accent: string;
		// Square px size. Default 56 matches the source motif scale.
		size?: number;
	}

	const { category, accent, size = 56 }: Props = $props();

	// Fold the incoming macro onto its motif bucket so the six bespoke
	// glyph languages cover all seven macros; unknown ids and the `wc`
	// tentpole resolve to `undefined` → the pulsing-dot fallback.
	const motif = $derived<FlowArtBucket | undefined>(
		isMacroId(category) ? MACRO_ART_BUCKET[category] : undefined
	);

	const w = $derived(size);
	const h = $derived(size);

	// Animation clock in seconds. Stays at 0 under reduced motion so the
	// glyph renders a stable resting frame.
	let elapsed = $state(0);

	// Reactive: pause the clock under reduced motion and resume if the user
	// toggles the setting while the app is open (`prefersReducedMotion` is a
	// reactive MediaQuery). Held at 0 under reduced motion so the glyph shows
	// its stable resting frame.
	$effect(() => {
		if (prefersReducedMotion()) {
			elapsed = 0;

			return;
		}

		let raf = 0;
		const start = performance.now();

		const loop = (now: number) => {
			elapsed = (now - start) / 1000;
			raf = requestAnimationFrame(loop);
		};

		raf = requestAnimationFrame(loop);

		return () => cancelAnimationFrame(raf);
	});

	// Translucent accent — appends a 2-hex-digit alpha to the accent
	// colour. Assumes the accent is a `#rrggbb` string (the resolved
	// category colours all are); falls back to the raw accent otherwise.
	// Positional `(hex, alpha)` keeps the dozens of in-markup call sites
	// terse; an object form would bloat every fill / stroke attribute.
	// eslint-disable-next-line local-rules/prefer-object-params
	const withAlpha = (hex: string, alpha: string): string =>
		/^#[0-9a-f]{6}$/i.test(hex) ? `${hex}${alpha}` : hex;

	const DEG = Math.PI / 180;

	// ── macro — half-circle rate dial with a rocking needle ──────────
	const macro = $derived.by(() => {
		const angle = -90 + Math.sin(elapsed * 0.9) * 28;
		const cx = w / 2;
		const cy = h * 0.78;
		const r = w * 0.4;

		return {
			cx,
			cy,
			r,
			x2: cx + Math.cos(angle * DEG) * r,
			y2: cy + Math.sin(angle * DEG) * r
		};
	});

	// ── crypto — 4 chained blocks with a travelling pulse ────────────
	const cryptoPulse = $derived((Math.sin(elapsed * 1.6) + 1) / 2);
	const cryptoBlocks = [0, 1, 2, 3];

	// ── tech — chip silhouette with two travelling current pulses ────
	const techPulse = $derived((elapsed * 1.4) % 1);
	const techPins = [0, 1, 2, 3, 4, 5];

	// ── sports — 5×3 scoreboard dots lighting in a wave ──────────────
	const sportsDots = $derived.by(() => {
		const dots: { r: number; c: number; lit: boolean }[] = [];

		for (let row = 0; row < 3; row += 1) {
			for (let col = 0; col < 5; col += 1) {
				const seed = (row * 5 + col) * 0.7;
				const lit = (Math.sin(elapsed * 1.2 + seed) + 1) / 2 > 0.55;
				dots.push({ r: row, c: col, lit });
			}
		}

		return dots;
	});

	// ── politics — stacking vote bars ────────────────────────────────
	const politicsBars = $derived.by(() =>
		[0, 1, 2, 3, 4].map((i) => {
			const phase = (elapsed * 0.8 + i * 0.18) % 2;
			const target = 0.4 + ((i * 7) % 5) * 0.12;
			const fill = phase < 1 ? phase * target : target;

			return { i, bh: (h - 16) * fill };
		})
	);

	// ── culture — concentric pulse rings (sound wave) ────────────────
	const cultureRings = $derived.by(() =>
		[0, 1, 2].map((i) => {
			const phase = (elapsed * 0.55 + i * 0.33) % 1;

			return { i, r: 4 + phase * (w * 0.42), op: (1 - phase) * 0.6 };
		})
	);

	// ── fallback — pulsing dot ───────────────────────────────────────
	const fallbackPulse = $derived((Math.sin(elapsed * 1.4) + 1) / 2);
</script>

<svg
	aria-hidden="true"
	height={h}
	viewBox={`0 0 ${w} ${h}`}
	width={w}
	xmlns="http://www.w3.org/2000/svg"
>
	{#if motif === 'macro'}
		<path
			d={`M ${macro.cx - macro.r} ${macro.cy} A ${macro.r} ${macro.r} 0 0 1 ${macro.cx + macro.r} ${macro.cy}`}
			fill="none"
			stroke={withAlpha(accent, '33')}
			stroke-width="1"
		/>
		<path
			d={`M ${macro.cx - macro.r * 0.7} ${macro.cy - macro.r * 0.7} A ${macro.r * 0.99} ${macro.r * 0.99} 0 0 1 ${macro.cx + macro.r * 0.7} ${macro.cy - macro.r * 0.7}`}
			fill="none"
			stroke={withAlpha(accent, '66')}
			stroke-dasharray="2 3"
			stroke-width="1"
		/>
		<line
			stroke={accent}
			stroke-linecap="round"
			stroke-width="1.6"
			x1={macro.cx}
			x2={macro.x2}
			y1={macro.cy}
			y2={macro.y2}
		/>
		<circle cx={macro.cx} cy={macro.cy} fill={accent} r="2.2" />
	{:else if motif === 'crypto'}
		{#each cryptoBlocks as i (i)}
			{@const x = 6 + i * 12}
			{@const y = h / 2 - 5}
			{@const lit = Math.abs(cryptoPulse * 4 - i - 0.5) < 0.5}
			{#if i < 3}
				<line
					stroke={withAlpha(accent, '66')}
					stroke-width="1"
					x1={x + 10}
					x2={x + 12}
					y1={h / 2}
					y2={h / 2}
				/>
			{/if}
			<rect
				fill={lit ? withAlpha(accent, 'CC') : withAlpha(accent, '22')}
				height="10"
				rx="2"
				stroke={withAlpha(accent, '66')}
				stroke-width="0.8"
				width="10"
				{x}
				{y}
			/>
		{/each}
	{:else if motif === 'tech'}
		{@const cx = w / 2}
		{@const cy = h / 2}
		<rect
			fill="none"
			height="24"
			rx="3"
			stroke={withAlpha(accent, '88')}
			stroke-width="1"
			width="24"
			x={cx - 12}
			y={cy - 12}
		/>
		<rect
			fill={withAlpha(accent, '22')}
			height="12"
			rx="1"
			stroke={withAlpha(accent, '66')}
			stroke-width="0.8"
			width="12"
			x={cx - 6}
			y={cy - 6}
		/>
		{#each techPins as i (i)}
			{@const off = i * 4 - 10}
			<g stroke={withAlpha(accent, '66')} stroke-width="0.8">
				<line x1={cx + off} x2={cx + off} y1={cy - 12} y2={cy - 16} />
				<line x1={cx + off} x2={cx + off} y1={cy + 12} y2={cy + 16} />
				<line x1={cx - 12} x2={cx - 16} y1={cy + off} y2={cy + off} />
				<line x1={cx + 12} x2={cx + 16} y1={cy + off} y2={cy + off} />
			</g>
		{/each}
		<circle cx={cx - 12 + 24 * techPulse} cy={cy - 12} fill={accent} r="1.6" />
		<circle cx={cx + 12 - 24 * ((techPulse + 0.5) % 1)} cy={cy + 12} fill={accent} r="1.6" />
	{:else if motif === 'sports'}
		<rect
			fill="none"
			height="24"
			rx="3"
			stroke={withAlpha(accent, '33')}
			stroke-width="1"
			width={w - 12}
			x="6"
			y={h / 2 - 12}
		/>
		{#each sportsDots as dot, i (i)}
			<circle
				cx={11 + dot.c * 9}
				cy={h / 2 - 7 + dot.r * 7}
				fill={dot.lit ? accent : withAlpha(accent, '33')}
				r="1.7"
			/>
		{/each}
	{:else if motif === 'politics'}
		{#each politicsBars as bar (bar.i)}
			<rect
				fill={withAlpha(accent, '66')}
				height="2"
				rx="1"
				width="6"
				x={6 + bar.i * 9}
				y={h - 8}
			/>
			<rect
				fill={bar.i === 2 ? accent : withAlpha(accent, '88')}
				height={bar.bh}
				rx="1.2"
				width="6"
				x={6 + bar.i * 9}
				y={h - 8 - bar.bh}
			/>
		{/each}
	{:else if motif === 'culture'}
		{#each cultureRings as ring (ring.i)}
			<circle
				cx={w / 2}
				cy={h / 2}
				fill="none"
				opacity={ring.op}
				r={ring.r}
				stroke={accent}
				stroke-width="1"
			/>
		{/each}
		<circle cx={w / 2} cy={h / 2} fill={accent} r="2.6" />
	{:else}
		<circle
			cx={w / 2}
			cy={h / 2}
			fill={accent}
			opacity={0.8 - fallbackPulse * 0.4}
			r={6 + fallbackPulse * 3}
		/>
		<circle cx={w / 2} cy={h / 2} fill={accent} r="2" />
	{/if}
</svg>
