import { deg } from '#lib/utils/flow-art/svg.ts';
import type { RenderArgs } from '#lib/utils/flow-art/types.ts';

export const renderCulture = ({ rng, p, state, uid }: RenderArgs): string => {
	let s = '';
	s += `<defs>
      <radialGradient id="cugrad-${uid}" cx="50%" cy="40%" r="70%">
        <stop offset="0%" stop-color="${p.base}" stop-opacity="0.85"/>
        <stop offset="100%" stop-color="${p.bg}" stop-opacity="1"/>
      </radialGradient>
    </defs>`;
	s += `<rect width="100" height="100" fill="url(#cugrad-${uid})"/>`;

	for (let i = 0; i < 60; i++) {
		const x = rng.range(0, 100);
		const y = rng.range(0, 100);
		s += `<circle cx="${x}" cy="${y}" r="${rng.range(0.15, 0.45)}" fill="${p.ink}" opacity="${rng.range(0.1, 0.25)}"/>`;
	}

	// Culture is the only category that requires the extended six-colour
	// ink set; fall back to accent if it's missing (defensive: shouldn't
	// happen for `culture` per PAL definition above).
	const inks = p.inks ?? [p.accent];
	const blobCount = rng.int(1, 2);
	const colorA = inks[rng.int(0, inks.length - 1)];
	const colorB = inks[rng.int(0, inks.length - 1)];
	const colors = [colorA, colorB];

	for (let b = 0; b < blobCount; b++) {
		const cx = rng.range(28, 72);
		const cy = rng.range(30, 65);
		const baseR = rng.range(18, 28);
		const wobble = rng.range(0.18, 0.4);
		const verts = rng.int(12, 18);
		const startA = rng.range(0, 360);
		const pts: [number, number][] = [];

		for (let v = 0; v < verts; v++) {
			const a = startA + (360 / verts) * v;
			const r = baseR * (1 - wobble + 2 * wobble * rng.r());
			pts.push([cx + r * Math.cos(deg(a)), cy + r * Math.sin(deg(a))]);
		}

		let path = `M ${pts[0][0].toFixed(2)} ${pts[0][1].toFixed(2)}`;

		for (let i = 0; i < pts.length; i++) {
			const next = pts[(i + 1) % pts.length];
			const mid: [number, number] = [(pts[i][0] + next[0]) / 2, (pts[i][1] + next[1]) / 2];
			path += ` Q ${pts[i][0].toFixed(2)} ${pts[i][1].toFixed(2)} ${mid[0].toFixed(2)} ${mid[1].toFixed(2)}`;
		}

		path += ' Z';
		const fillCol = colors[b % colors.length];
		const op = state === 'won' ? 0.9 : 0.78;
		s += `<path d="${path}" fill="${fillCol}" opacity="${op}"/>`;
		s += `<path d="${path}" fill="none" stroke="${p.ink}" stroke-width="0.5" opacity="0.45"/>`;
	}

	const markCount = rng.int(6, 14);

	for (let i = 0; i < markCount; i++) {
		const x = rng.range(8, 92);
		const y = rng.range(8, 92);
		const r = rng.range(0.6, 1.8);
		const col = colors[rng.int(0, 1)];
		s += `<circle cx="${x}" cy="${y}" r="${r}" fill="${col}" opacity="${rng.range(0.55, 0.85)}"/>`;
	}

	const sx = rng.range(15, 35);
	const sy = rng.range(72, 86);
	const ex = sx + rng.range(20, 40);
	const ey = sy + rng.range(-12, 8);
	const cxp = (sx + ex) / 2 + rng.range(-12, 12);
	const cyp = (sy + ey) / 2 + rng.range(-12, 12);
	s += `<path d="M ${sx} ${sy} Q ${cxp} ${cyp} ${ex} ${ey}" fill="none" stroke="${p.fg}" stroke-width="${rng.range(0.8, 1.6)}" opacity="0.78" stroke-linecap="round"/>`;

	if (state === 'won') {
		const haloX = rng.range(38, 62);
		const haloY = rng.range(38, 58);
		s += `<circle cx="${haloX}" cy="${haloY}" r="34" fill="${p.accent}" opacity="0.10"/>`;
		s += `<circle cx="${haloX}" cy="${haloY}" r="18" fill="${p.accent}" opacity="0.12"/>`;
	} else if (state === 'lost') {
		for (let i = 0; i < 8; i++) {
			const x = rng.range(20, 80);
			s += `<line x1="${x}" y1="${rng.range(20, 50)}" x2="${x}" y2="${rng.range(55, 85)}" stroke="${p.bg}" stroke-width="0.6" opacity="0.8"/>`;
		}

		s += `<rect width="100" height="100" fill="${p.bg}" opacity="0.34"/>`;
	}

	return s;
};
