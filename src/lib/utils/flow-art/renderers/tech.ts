import type { RenderArgs } from '#lib/utils/flow-art/types.ts';

export const renderTech = ({ rng, p, state, uid: _uid }: RenderArgs): string => {
	let s = '';
	s += `<rect width="100" height="100" fill="${p.bg}"/>`;

	for (let r = 0; r < 10; r++) {
		for (let c = 0; c < 10; c++) {
			s += `<circle cx="${5 + c * 10}" cy="${5 + r * 10}" r="0.4" fill="${p.ink}" opacity="0.35"/>`;
		}
	}

	const ox = 50;
	const oy = 76;
	const u = 11;
	const ix: [number, number] = [u * 0.866, -u * 0.5];
	const iy: [number, number] = [-u * 0.866, -u * 0.5];
	const iz: [number, number] = [0, -u];

	// 3D-to-screen isometric projection. Positional `(x, y, z)` is the
	// standard signature for a coordinate transform; object form would
	// be unreadable in the per-vertex calls below.
	// eslint-disable-next-line local-rules/prefer-object-params
	const iso = (x: number, y: number, z: number): [number, number] => [
		ox + x * ix[0] + y * iy[0] + z * iz[0],
		oy + x * ix[1] + y * iy[1] + z * iz[1]
	];

	const ptStr = (pts: ReadonlyArray<readonly [number, number]>): string =>
		pts.map((pp) => pp.map((n) => n.toFixed(2)).join(',')).join(' ');

	// `(x, y, z)` mirrors the iso-coordinate signature; the trailing
	// `hot` flag toggles the focal-block treatment. Positional preserves
	// the parallel between the call sites (`drawBox(b.x, b.y, z, isHot)`)
	// and the coordinate transform.
	// eslint-disable-next-line local-rules/prefer-object-params
	const drawBox = (x: number, y: number, z: number, hot: boolean): void => {
		const tA = iso(x, y, z + 1);
		const tB = iso(x + 1, y, z + 1);
		const tC = iso(x + 1, y + 1, z + 1);
		const tD = iso(x, y + 1, z + 1);
		const rA = iso(x + 1, y, z + 1);
		const rB = iso(x + 1, y, z);
		const rC = iso(x + 1, y + 1, z);
		const rD = iso(x + 1, y + 1, z + 1);
		const lA = iso(x, y + 1, z + 1);
		const lB = iso(x, y + 1, z);
		const lC = iso(x + 1, y + 1, z);
		const lD = iso(x + 1, y + 1, z + 1);
		const stroke = p.hot;
		const sw = 0.4;

		if (hot) {
			s += `<polygon points="${ptStr([tA, tB, tC, tD])}" fill="${p.accent}" opacity="${state === 'won' ? 0.95 : 0.85}" stroke="${stroke}" stroke-width="${sw}"/>`;
			s += `<polygon points="${ptStr([rA, rB, rC, rD])}" fill="${p.accent}" opacity="0.55" stroke="${stroke}" stroke-width="${sw}"/>`;
			s += `<polygon points="${ptStr([lA, lB, lC, lD])}" fill="${p.accent}" opacity="0.70" stroke="${stroke}" stroke-width="${sw}"/>`;
		} else {
			s += `<polygon points="${ptStr([tA, tB, tC, tD])}" fill="${p.ink}" opacity="0.95" stroke="${stroke}" stroke-width="${sw}"/>`;
			s += `<polygon points="${ptStr([rA, rB, rC, rD])}" fill="${p.base}" opacity="0.95" stroke="${stroke}" stroke-width="${sw}"/>`;
			s += `<polygon points="${ptStr([lA, lB, lC, lD])}" fill="${p.dim}" opacity="0.95" stroke="${stroke}" stroke-width="${sw}"/>`;
		}
	};

	const footprint: { x: number; y: number; h: number }[] = [];
	const colsX = rng.int(2, 3);
	const colsY = rng.int(2, 3);

	for (let xi = 0; xi < colsX; xi++) {
		for (let yi = 0; yi < colsY; yi++) {
			const h = rng.int(0, 3);

			if (h > 0) {
				footprint.push({
					x: xi - Math.floor(colsX / 2),
					y: yi - Math.floor(colsY / 2),
					h
				});
			}
		}
	}

	let focal: { x: number; y: number; h: number } | null = null;
	let maxH = 0;
	footprint.forEach((b) => {
		if (b.h > maxH) {
			maxH = b.h;
			focal = b;
		}
	});

	footprint.sort((a, b) => a.y - b.y || a.x - b.x);
	footprint.forEach((b) => {
		for (let z = 0; z < b.h; z++) {
			const isHot = b === focal && z === b.h - 1;
			drawBox(b.x, b.y, z, isHot);
		}
	});

	if (state === 'won') {
		if (focal) {
			const fb: { x: number; y: number; h: number } = focal;
			const [px, py] = iso(fb.x + 0.5, fb.y + 0.5, fb.h);
			s += `<circle cx="${px}" cy="${py - 1}" r="6" fill="none" stroke="${p.accent}" stroke-width="0.6" opacity="0.6"/>`;
			s += `<circle cx="${px}" cy="${py - 1}" r="2.4" fill="${p.fg}" opacity="0.85"/>`;
		}
	} else if (state === 'lost') {
		for (let i = 0; i < 6; i++) {
			const y = rng.range(20, 80);
			const h = rng.range(1, 2.4);
			const dx = rng.range(-4, 4);
			s += `<rect x="${0 + dx}" y="${y}" width="100" height="${h}" fill="${p.bg}" opacity="0.9"/>`;
		}

		s += `<rect width="100" height="100" fill="${p.bg}" opacity="0.30"/>`;
	}

	return s;
};
