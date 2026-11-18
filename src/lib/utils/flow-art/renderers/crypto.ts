import { deg } from '#lib/utils/flow-art/svg.ts';
import type { RenderArgs } from '#lib/utils/flow-art/types.ts';

export const renderCrypto = ({ rng, p, state, uid }: RenderArgs): string => {
	const shardCount = rng.int(3, 5);
	const cx = rng.range(40, 60);
	const cy = rng.range(40, 60);
	let s = '';
	s += `<defs>
      <linearGradient id="cgrad-${uid}" x1="0" x2="1" y1="0" y2="1">
        <stop offset="0%" stop-color="${p.base}" stop-opacity="0.85"/>
        <stop offset="100%" stop-color="${p.bg}" stop-opacity="0.4"/>
      </linearGradient>
    </defs>`;
	s += `<rect width="100" height="100" fill="url(#cgrad-${uid})"/>`;

	for (let i = 0; i < 12; i++) {
		const y = i * 10 + rng.range(-3, 3);
		s += `<line x1="-10" y1="${y}" x2="110" y2="${y - 20}" stroke="${p.ink}" stroke-width="0.3" opacity="0.18"/>`;
	}

	const shards: { pts: [number, number][]; hot: boolean }[] = [];

	for (let i = 0; i < shardCount; i++) {
		const angle0 = rng.range(0, 360);
		const r0 = rng.range(12, 28);
		const px = cx + r0 * Math.cos(deg(angle0));
		const py = cy + r0 * Math.sin(deg(angle0));
		const verts = rng.int(3, 5);
		const radius = rng.range(8, 22);
		const pts: [number, number][] = [];
		const angOff = rng.range(0, 360);

		for (let v = 0; v < verts; v++) {
			const a = angOff + (360 / verts) * v + rng.range(-25, 25);
			const r = radius * rng.range(0.6, 1.0);
			pts.push([px + r * Math.cos(deg(a)), py + r * Math.sin(deg(a))]);
		}

		shards.push({ pts, hot: i === 0 });
	}

	shards.forEach((sh) => {
		const fill = sh.hot ? p.ink : p.base;
		const stroke = sh.hot ? p.accent : p.ink;
		const op = sh.hot ? 0.95 : 0.78;
		const path = `M ${sh.pts.map(([x, y]) => `${x.toFixed(2)} ${y.toFixed(2)}`).join(' L ')} Z`;
		s += `<path d="${path}" fill="${fill}" opacity="${op}" stroke="${stroke}" stroke-width="${sh.hot ? 1.0 : 0.5}" stroke-linejoin="miter"/>`;
	});

	const seamAngle = rng.range(-30, 60);
	const seamLen = rng.range(28, 46);
	const sx1 = cx - (seamLen / 2) * Math.cos(deg(seamAngle));
	const sy1 = cy - (seamLen / 2) * Math.sin(deg(seamAngle));
	const sx2 = cx + (seamLen / 2) * Math.cos(deg(seamAngle));
	const sy2 = cy + (seamLen / 2) * Math.sin(deg(seamAngle));
	s += `<line x1="${sx1}" y1="${sy1}" x2="${sx2}" y2="${sy2}" stroke="${p.accent}" stroke-width="${state === 'won' ? 1.1 : 0.7}" opacity="${state === 'won' ? 1 : 0.92}" stroke-linecap="round"/>`;
	s += `<line x1="${sx1}" y1="${sy1}" x2="${sx2}" y2="${sy2}" stroke="${p.accent}" stroke-width="${state === 'won' ? 4 : 2.6}" opacity="0.18" stroke-linecap="round"/>`;
	s += `<circle cx="${sx2}" cy="${sy2}" r="${state === 'won' ? 1.7 : 1.2}" fill="${p.accent}"/>`;

	s += `<polygon points="${(cx + 30).toFixed(1)},${(cy - 22).toFixed(1)} ${(cx + 36).toFixed(1)},${(cy - 18).toFixed(1)} ${(cx + 33).toFixed(1)},${(cy - 12).toFixed(1)}" fill="${p.hot}" opacity="${state === 'won' ? 0.7 : 0.5}"/>`;

	if (state === 'lost') {
		for (let i = 0; i < 10; i++) {
			const x = rng.range(15, 85);
			const y = rng.range(15, 85);
			const a = rng.range(0, 360);
			const l = rng.range(4, 10);
			s += `<line x1="${x}" y1="${y}" x2="${x + l * Math.cos(deg(a))}" y2="${y + l * Math.sin(deg(a))}" stroke="${p.dim}" stroke-width="0.4" opacity="0.7"/>`;
		}

		s += `<rect width="100" height="100" fill="${p.bg}" opacity="0.35"/>`;
	}

	return s;
};
