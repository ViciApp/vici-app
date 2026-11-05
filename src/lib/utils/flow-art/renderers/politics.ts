import type { RenderArgs } from '#lib/utils/flow-art/types.ts';

export const renderPolitics = ({ rng, p, state, uid }: RenderArgs): string => {
	let s = '';
	const cols = rng.int(5, 9);
	const lintelY = rng.range(18, 28);
	const baseY = rng.range(80, 90);
	const focalCol = rng.int(0, cols - 1);

	s += `<defs>
      <linearGradient id="pwash-${uid}" x1="0" x2="0" y1="0" y2="1">
        <stop offset="0%" stop-color="${p.bg}" stop-opacity="1"/>
        <stop offset="100%" stop-color="${p.base}" stop-opacity="1"/>
      </linearGradient>
    </defs>`;
	s += `<rect width="100" height="100" fill="url(#pwash-${uid})"/>`;

	s += `<ellipse cx="50" cy="${(lintelY + baseY) / 2}" rx="42" ry="22" fill="${p.ink}" opacity="0.18"/>`;

	s += `<rect x="8" y="${lintelY - 2}" width="84" height="1.8" fill="${p.accent}" opacity="0.55"/>`;
	s += `<rect x="10" y="${lintelY}" width="80" height="3.5" fill="${p.ink}" opacity="0.78"/>`;
	s += `<rect x="11" y="${lintelY + 3.5}" width="78" height="0.6" fill="${p.dim}" opacity="0.9"/>`;

	s += `<rect x="6" y="${baseY}" width="88" height="2" fill="${p.ink}" opacity="0.85"/>`;
	s += `<rect x="4" y="${baseY + 2}" width="92" height="1.2" fill="${p.accent}" opacity="0.40"/>`;

	const colSpan = 80;
	const colStart = 10;
	const colW = (colSpan - 6) / cols;

	for (let i = 0; i < cols; i++) {
		const xMid = colStart + colW * (i + 0.5);
		const isFocal = i === focalCol;
		const w = isFocal ? colW * 0.65 : colW * 0.45;
		const x = xMid - w / 2;
		const y1 = lintelY + 4;
		const y2 = baseY - 1;
		s += `<rect x="${x}" y="${y1}" width="${w}" height="${y2 - y1}" fill="${isFocal ? p.accent : p.dim}" opacity="${isFocal ? (state === 'won' ? 0.95 : 0.85) : 0.78}"/>`;
		s += `<rect x="${x - 0.6}" y="${y1}" width="${w + 1.2}" height="1.2" fill="${p.ink}" opacity="0.95"/>`;
		s += `<rect x="${x - 0.6}" y="${y2 - 1.2}" width="${w + 1.2}" height="1.2" fill="${p.ink}" opacity="0.95"/>`;

		if (!isFocal) {
			s += `<line x1="${x + w * 0.5}" y1="${y1 + 2}" x2="${x + w * 0.5}" y2="${y2 - 2}" stroke="${p.bg}" stroke-width="0.25" opacity="0.6"/>`;
		}
	}

	const fxMid = colStart + colW * (focalCol + 0.5);

	if (state !== 'lost') {
		s += `<circle cx="${fxMid}" cy="${lintelY - 4}" r="${state === 'won' ? 2.4 : 1.6}" fill="${p.hot}" opacity="${state === 'won' ? 1 : 0.85}"/>`;
	}

	if (state === 'won') {
		s += `<rect x="10" y="${lintelY}" width="80" height="0.8" fill="${p.accent}" opacity="0.7"/>`;
	} else if (state === 'lost') {
		s += `<line x1="${fxMid - 4}" y1="${lintelY + 1}" x2="${fxMid + 4}" y2="${lintelY + 4}" stroke="${p.bg}" stroke-width="1.2"/>`;
		s += `<rect width="100" height="100" fill="${p.bg}" opacity="0.34"/>`;
	}

	return s;
};
