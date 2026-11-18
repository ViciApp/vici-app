import {
	WC_CAP_BAND,
	WC_CAP_DARK,
	WC_HAIR,
	WC_SKIN,
	type WCEmotion,
	type WCHairStyle
} from '#lib/constants/flow-art-wc.constants.ts';

// Composes a 4–6-plane bust portrait around an anchor (cx, cy).
// Hair drawn behind face plane for cleaner silhouette; jaw and ears
// drawn after the face plane. Expression layer (brows + eyes +
// mouth) reads at small sizes via stroke weights tuned for the
// 280×100 viewBox. All `<g class="wc-figure">` so future CSS
// keyframes can target it without per-part selectors.
export const wcFace = ({
	cx,
	cy,
	skin,
	hair,
	hairStyle,
	shirt,
	shirtShadow = '#1F1A14',
	stripe,
	emotion
}: {
	cx: number;
	cy: number;
	skin: keyof typeof WC_SKIN;
	hair: keyof typeof WC_HAIR;
	hairStyle: WCHairStyle;
	shirt: string;
	shirtShadow?: string;
	stripe?: string;
	emotion: WCEmotion;
}): string => {
	const sk = WC_SKIN[skin] ?? WC_SKIN.umber;
	const hairColor = WC_HAIR[hair] ?? WC_HAIR.brown;
	const headW = 16;
	const headH = 14;

	let m = `<g class="wc-figure">`;

	// Shoulders (full bust): drawn first behind the head, then
	// shadow plane, optional national-kit shoulder stripe, collar.
	m += `<polygon points="${cx - 30},${cy + 18} ${cx + 30},${cy + 18} ${cx + 40},${cy + 58} ${cx - 40},${cy + 58}" fill="${shirt}"/>`;
	m += `<polygon points="${cx},${cy + 18} ${cx + 30},${cy + 18} ${cx + 40},${cy + 58} ${cx},${cy + 58}" fill="${shirtShadow}" opacity="0.45"/>`;

	if (stripe) {
		m += `<polygon points="${cx - 10},${cy + 18} ${cx - 4},${cy + 18} ${cx - 2},${cy + 58} ${cx - 14},${cy + 58}" fill="${stripe}" opacity="0.85"/>`;
	}

	m += `<polygon points="${cx - 7},${cy + 16} ${cx + 7},${cy + 16} ${cx + 5},${cy + 22} ${cx - 5},${cy + 22}" fill="${sk.base}"/>`;

	// Hair: six styles; `bald` is intentionally a no-op.
	if (hairStyle === 'short') {
		m += `<polygon points="${cx - headW - 1},${cy - headH - 2} ${cx + headW + 1},${cy - headH - 2} ${cx + headW + 2},${cy - 2} ${cx - headW - 2},${cy - 2}" fill="${hairColor}"/>`;
	} else if (hairStyle === 'curly') {
		m += `<path d="M ${cx - headW - 3} ${cy - 2} Q ${cx - headW - 3} ${cy - headH - 8} ${cx} ${cy - headH - 6} Q ${cx + headW + 3} ${cy - headH - 8} ${cx + headW + 3} ${cy - 2} Z" fill="${hairColor}"/>`;
	} else if (hairStyle === 'mohawk') {
		m += `<polygon points="${cx - headW},${cy - 2} ${cx - headW},${cy - headH - 1} ${cx + headW},${cy - headH - 1} ${cx + headW},${cy - 2}" fill="${hairColor}" opacity="0.85"/>`;
		m += `<polygon points="${cx - 3},${cy - headH - 1} ${cx + 3},${cy - headH - 1} ${cx + 4},${cy - headH - 8} ${cx - 4},${cy - headH - 8}" fill="${hairColor}"/>`;
	} else if (hairStyle === 'cap') {
		m += `<polygon points="${cx - headW - 2},${cy - headH + 2} ${cx + headW + 2},${cy - headH + 2} ${cx + headW + 4},${cy - 3} ${cx - headW - 4},${cy - 3}" fill="${WC_CAP_DARK}"/>`;
		m += `<rect x="${cx - headW - 6}" y="${cy - 3}" width="${headW * 2 + 12}" height="2" fill="${WC_CAP_BAND}"/>`;
	} else if (hairStyle === 'bun') {
		m += `<polygon points="${cx - headW - 1},${cy - headH - 2} ${cx + headW + 1},${cy - headH - 2} ${cx + headW + 2},${cy + 10} ${cx - headW - 2},${cy + 10}" fill="${hairColor}" opacity="0.95"/>`;
		m += `<circle cx="${cx + headW + 4}" cy="${cy - headH - 4}" r="4" fill="${hairColor}"/>`;
	}

	// Face plane + shadow (right half) + cheek highlight (left) +
	// jaw trapezoid + ears.
	m += `<polygon points="${cx - headW},${cy - headH} ${cx + headW},${cy - headH} ${cx + headW - 1},${cy + headH - 2} ${cx - headW + 1},${cy + headH - 2}" fill="${sk.base}"/>`;
	m += `<polygon points="${cx},${cy - headH} ${cx + headW},${cy - headH} ${cx + headW - 1},${cy + headH - 2} ${cx},${cy + headH - 2}" fill="${sk.shadow}" opacity="0.55"/>`;
	m += `<polygon points="${cx - headW},${cy - 2} ${cx - headW + 5},${cy - 2} ${cx - headW + 4},${cy + 8} ${cx - headW},${cy + 8}" fill="${sk.high}" opacity="0.65"/>`;
	m += `<polygon points="${cx - headW + 1},${cy + headH - 2} ${cx + headW - 1},${cy + headH - 2} ${cx + headW - 3},${cy + headH + 4} ${cx - headW + 3},${cy + headH + 4}" fill="${sk.shadow}"/>`;
	m += `<rect x="${cx - headW - 1.5}" y="${cy - 1}" width="2" height="5" fill="${sk.shadow}"/>`;
	m += `<rect x="${cx + headW - 0.5}" y="${cy - 1}" width="2" height="5" fill="${sk.shadow}" opacity="0.7"/>`;

	// Expression layer: brows, eyes, mouth, all in #0E0D0B for max
	// contrast on the editorial figure regardless of theme.
	const eyeY = cy - 2;
	const mouthY = cy + 6;
	const eyeL = cx - 6;
	const eyeR = cx + 6;
	const browInk = '#0E0D0B';

	// Brows
	if (emotion === 'joy' || emotion === 'playful') {
		m += `<line x1="${eyeL - 3}" y1="${eyeY - 4}" x2="${eyeL + 3}" y2="${eyeY - 3.5}" stroke="${browInk}" stroke-width="0.9" stroke-linecap="round"/>`;
		m += `<line x1="${eyeR - 3}" y1="${eyeY - 3.5}" x2="${eyeR + 3}" y2="${eyeY - 4}" stroke="${browInk}" stroke-width="0.9" stroke-linecap="round"/>`;
	} else if (emotion === 'focus' || emotion === 'anticipation') {
		m += `<line x1="${eyeL - 3}" y1="${eyeY - 3.5}" x2="${eyeL + 3}" y2="${eyeY - 3.5}" stroke="${browInk}" stroke-width="1" stroke-linecap="round"/>`;
		m += `<line x1="${eyeR - 3}" y1="${eyeY - 3.5}" x2="${eyeR + 3}" y2="${eyeY - 3.5}" stroke="${browInk}" stroke-width="1" stroke-linecap="round"/>`;
	} else if (emotion === 'dread' || emotion === 'defeat') {
		m += `<line x1="${eyeL - 3}" y1="${eyeY - 3}" x2="${eyeL + 3}" y2="${eyeY - 4.5}" stroke="${browInk}" stroke-width="1" stroke-linecap="round"/>`;
		m += `<line x1="${eyeR - 3}" y1="${eyeY - 4.5}" x2="${eyeR + 3}" y2="${eyeY - 3}" stroke="${browInk}" stroke-width="1" stroke-linecap="round"/>`;
	}

	// Eyes
	if (emotion === 'joy') {
		m += `<path d="M ${eyeL - 2.5} ${eyeY} Q ${eyeL} ${eyeY - 1.5} ${eyeL + 2.5} ${eyeY}" stroke="${browInk}" stroke-width="1" fill="none" stroke-linecap="round"/>`;
		m += `<path d="M ${eyeR - 2.5} ${eyeY} Q ${eyeR} ${eyeY - 1.5} ${eyeR + 2.5} ${eyeY}" stroke="${browInk}" stroke-width="1" fill="none" stroke-linecap="round"/>`;
	} else if (emotion === 'dread') {
		m += `<ellipse cx="${eyeL}" cy="${eyeY}" rx="1.6" ry="1.8" fill="#F2ECDC"/>`;
		m += `<ellipse cx="${eyeR}" cy="${eyeY}" rx="1.6" ry="1.8" fill="#F2ECDC"/>`;
		m += `<circle cx="${eyeL}" cy="${eyeY + 0.2}" r="0.8" fill="${browInk}"/>`;
		m += `<circle cx="${eyeR}" cy="${eyeY + 0.2}" r="0.8" fill="${browInk}"/>`;
	} else if (emotion === 'playful') {
		m += `<path d="M ${eyeL - 2.5} ${eyeY} Q ${eyeL} ${eyeY - 1.5} ${eyeL + 2.5} ${eyeY}" stroke="${browInk}" stroke-width="1" fill="none" stroke-linecap="round"/>`;
		m += `<circle cx="${eyeR}" cy="${eyeY}" r="1.3" fill="${browInk}"/>`;
	} else if (emotion === 'defeat') {
		m += `<path d="M ${eyeL - 2.5} ${eyeY + 0.5} Q ${eyeL} ${eyeY + 2} ${eyeL + 2.5} ${eyeY + 0.5}" stroke="${browInk}" stroke-width="1" fill="none" stroke-linecap="round"/>`;
		m += `<path d="M ${eyeR - 2.5} ${eyeY + 0.5} Q ${eyeR} ${eyeY + 2} ${eyeR + 2.5} ${eyeY + 0.5}" stroke="${browInk}" stroke-width="1" fill="none" stroke-linecap="round"/>`;
	} else {
		m += `<circle cx="${eyeL}" cy="${eyeY}" r="1.1" fill="${browInk}"/>`;
		m += `<circle cx="${eyeR}" cy="${eyeY}" r="1.1" fill="${browInk}"/>`;
	}

	// Mouth
	if (emotion === 'joy') {
		m += `<path d="M ${cx - 5} ${mouthY} Q ${cx} ${mouthY + 4} ${cx + 5} ${mouthY}" stroke="${browInk}" stroke-width="1.2" fill="none" stroke-linecap="round"/>`;
	} else if (emotion === 'focus' || emotion === 'anticipation') {
		m += `<line x1="${cx - 3}" y1="${mouthY + 1}" x2="${cx + 3}" y2="${mouthY + 1}" stroke="${browInk}" stroke-width="1.1" stroke-linecap="round"/>`;
	} else if (emotion === 'dread') {
		m += `<ellipse cx="${cx}" cy="${mouthY + 1}" rx="2" ry="2.5" fill="${browInk}"/>`;
	} else if (emotion === 'defeat') {
		m += `<path d="M ${cx - 4} ${mouthY + 2} Q ${cx} ${mouthY - 1} ${cx + 4} ${mouthY + 2}" stroke="${browInk}" stroke-width="1.1" fill="none" stroke-linecap="round"/>`;
	} else if (emotion === 'playful') {
		m += `<path d="M ${cx - 4} ${mouthY + 1} Q ${cx + 1} ${mouthY + 3} ${cx + 5} ${mouthY - 1}" stroke="${browInk}" stroke-width="1.1" fill="none" stroke-linecap="round"/>`;
	}

	m += `</g>`;

	return m;
};
