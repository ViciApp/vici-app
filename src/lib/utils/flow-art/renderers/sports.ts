import type { RenderArgs } from '#lib/utils/flow-art/types.ts';

export const renderSports = ({ rng, p, state, uid }: RenderArgs): string => {
	let s = '';
	s += `<defs>
      <linearGradient id="swash-${uid}" x1="0" x2="1" y1="0.5" y2="0.5">
        <stop offset="0%" stop-color="${p.bg}" stop-opacity="1"/>
        <stop offset="100%" stop-color="${p.base}" stop-opacity="1"/>
      </linearGradient>
    </defs>`;
	s += `<rect width="100" height="100" fill="url(#swash-${uid})"/>`;

	const strokeAngle = rng.range(-25, 5);

	for (let i = 0; i < 8; i++) {
		const y = i * 14 + rng.range(-4, 4);
		const len = rng.range(35, 75);
		const x = rng.range(-10, 30);
		s += `<rect x="${x}" y="${y}" width="${len}" height="1" fill="${p.hot}" opacity="${rng.range(0.1, 0.22)}" transform="rotate(${strokeAngle} ${x + len / 2} ${y})"/>`;
	}

	const dir = rng.pick<{ p1: [number, number]; p2: [number, number]; p3: [number, number] }>([
		{ p1: [12, 80], p2: [50, 22], p3: [88, 80] },
		{ p1: [12, 22], p2: [50, 78], p3: [88, 22] },
		{ p1: [82, 12], p2: [22, 50], p3: [82, 88] },
		{ p1: [18, 12], p2: [78, 50], p3: [18, 88] }
	]);

	const offset = rng.range(8, 14);

	for (let t = 2; t >= 1; t--) {
		const o = t * offset;
		const trailDir = dir.p1[0] < dir.p2[0] ? -1 : 1;
		const sx = trailDir * (dir.p1[0] === dir.p3[0] ? 0 : o);
		const sy = dir.p1[1] === dir.p3[1] ? -o : 0;
		const op = 0.18 / t;
		const sw = 1.3 / t;
		s += `<path d="M ${dir.p1[0] + sx} ${dir.p1[1] + sy} L ${dir.p2[0] + sx} ${dir.p2[1] + sy} L ${dir.p3[0] + sx} ${dir.p3[1] + sy}" stroke="${p.accent}" stroke-width="${sw}" fill="none" opacity="${op}" stroke-linecap="round" stroke-linejoin="round"/>`;
	}

	s += `<path d="M ${dir.p1[0]} ${dir.p1[1]} L ${dir.p2[0]} ${dir.p2[1]} L ${dir.p3[0]} ${dir.p3[1]}" stroke="${p.accent}" stroke-width="${state === 'won' ? 3.2 : 2.4}" fill="none" opacity="${state === 'won' ? 1 : 0.95}" stroke-linecap="round" stroke-linejoin="round"/>`;
	s += `<circle cx="${dir.p2[0]}" cy="${dir.p2[1]}" r="${state === 'won' ? 2.6 : 1.8}" fill="${p.fg}" opacity="${state === 'won' ? 1 : 0.85}"/>`;

	if (state === 'won') {
		for (let i = 0; i < 14; i++) {
			const x = rng.range(0, 100);
			const y = rng.range(0, 100);
			s += `<circle cx="${x}" cy="${y}" r="${rng.range(0.3, 0.8)}" fill="${p.hot}" opacity="${rng.range(0.3, 0.55)}"/>`;
		}
	} else if (state === 'lost') {
		s += `<line x1="${dir.p2[0] - 4}" y1="${dir.p2[1] - 1}" x2="${dir.p2[0] + 4}" y2="${dir.p2[1] + 1}" stroke="${p.bg}" stroke-width="1.6" opacity="1"/>`;
		s += `<rect width="100" height="100" fill="${p.bg}" opacity="0.30"/>`;
	}

	return s;
};
