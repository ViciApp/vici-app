import { deg, lerp } from '#lib/utils/flow-art/svg.ts';
import type { RenderArgs } from '#lib/utils/flow-art/types.ts';

export const renderMacro = ({ rng, p, state, uid }: RenderArgs): string => {
	const focals: ReadonlyArray<readonly [number, number]> = [
		[33, 38],
		[66, 38],
		[33, 66],
		[66, 66]
	];
	const [fx, fy] = focals[rng.int(0, focals.length - 1)];
	const ringCount = rng.int(3, 6);
	const maxR = rng.range(38, 52);
	const minR = rng.range(6, 11);

	const planeCount = rng.int(2, 3);
	const planes: { y: number; op: number; skew: number }[] = [];

	for (let i = 0; i < planeCount; i++) {
		const y = rng.range(15, 90);
		const op = rng.range(0.08, 0.18);
		const skew = rng.range(-3, 3);
		planes.push({ y, op, skew });
	}

	let s = '';
	s += `<defs>
      <radialGradient id="mwash-${uid}" cx="${fx}%" cy="${fy - 8}%" r="80%">
        <stop offset="0%" stop-color="${p.base}" stop-opacity="0.8"/>
        <stop offset="100%" stop-color="${p.bg}" stop-opacity="0"/>
      </radialGradient>
      <radialGradient id="mglow-${uid}" cx="50%" cy="50%" r="55%">
        <stop offset="0%" stop-color="${p.accent}" stop-opacity="${state === 'won' ? 0.65 : 0.35}"/>
        <stop offset="55%" stop-color="${p.accent}" stop-opacity="0.05"/>
        <stop offset="100%" stop-color="${p.accent}" stop-opacity="0"/>
      </radialGradient>
    </defs>`;
	s += `<rect width="100" height="100" fill="url(#mwash-${uid})"/>`;

	planes.forEach((pl) => {
		s += `<rect x="-5" y="${pl.y}" width="110" height="0.9" fill="${p.ink}" opacity="${pl.op}" transform="rotate(${pl.skew} 50 ${pl.y})"/>`;
	});

	for (let i = 0; i < ringCount; i++) {
		const r = lerp(minR, maxR, i / Math.max(1, ringCount - 1));
		const startA = rng.range(-30, 30);
		const sweepA = rng.range(140, 320);
		const x1 = fx + r * Math.cos(deg(startA));
		const y1 = fy + r * Math.sin(deg(startA));
		const x2 = fx + r * Math.cos(deg(startA + sweepA));
		const y2 = fy + r * Math.sin(deg(startA + sweepA));
		const largeArc = sweepA > 180 ? 1 : 0;
		const sw = i === ringCount - 1 ? 0.7 : 0.4;
		const stroke = i === ringCount - 1 ? p.hot : p.ink;
		const op = lerp(0.85, 0.3, i / ringCount);
		s += `<path d="M ${x1.toFixed(2)} ${y1.toFixed(2)} A ${r} ${r} 0 ${largeArc} 1 ${x2.toFixed(2)} ${y2.toFixed(2)}" stroke="${stroke}" stroke-width="${sw}" fill="none" opacity="${op}"/>`;
	}

	const fr = rng.range(14, 22);
	s += `<circle cx="${fx}" cy="${fy}" r="${fr}" fill="url(#mglow-${uid})"/>`;
	s += `<circle cx="${fx}" cy="${fy}" r="${fr}" fill="none" stroke="${p.accent}" stroke-width="${state === 'won' ? 1.0 : 0.7}" opacity="${state === 'won' ? 0.95 : 0.85}"/>`;
	s += `<circle cx="${fx}" cy="${fy}" r="${state === 'won' ? 2.6 : 1.6}" fill="${p.accent}" opacity="${state === 'won' ? 1 : 0.9}"/>`;

	if (state === 'lost') {
		s += `<line x1="${fx - fr - 4}" y1="${fy + fr / 2}" x2="${fx + fr + 4}" y2="${fy - fr / 2}" stroke="${p.bg}" stroke-width="2.4" opacity="0.85"/>`;
		s += `<rect width="100" height="100" fill="${p.bg}" opacity="0.32"/>`;
	} else if (state === 'won') {
		s += `<line x1="0" y1="${fy + 18}" x2="100" y2="${fy - 18}" stroke="${p.accent}" stroke-width="0.4" opacity="0.55"/>`;
	}

	return s;
};
