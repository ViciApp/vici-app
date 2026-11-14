// Personal avatar system: a front-facing faceted portrait built from the
// same illustration grammar as the prediction-card artwork (`flow-art.utils`):
// filled colour planes (no outline strokes on the head), a left cheek
// highlight + right shadow plane, volumetric filled eyes + mouth, and a
// two-plane layered card background with a gold signature mark.
//
// Each avatar = a faceted face + one ownable signature trait + one of six
// moods, on a two-plane backdrop. The avatar is described by a small `parts`
// object (`skin / hair / hairStyle / expr / trait / shirt / bg`) and renders
// to a self-contained SVG string mounted via `{@html ...}`: pure,
// client-only, no I/O.
//
// Two consumption paths:
//   - the logged-in user picks and persists their own parts (the editor);
//   - everyone else gets a stable, deterministic parts object derived from
//     their immutable principal, so the same person always reads the same
//     face without exposing real user data.
//
// Chrome that must adapt to the active theme (dark / light / peach), the
// signature mark, the frame ring, the highlight beam, the decorative dot and
// the wordmark, is drawn with CSS custom-property tokens (`var(--brand)` …)
// so it tracks the theme. The identity palettes the user actually picks
// (skin / hair / shirt / backdrop) are literal hex: they are choices, not
// chrome, and must render identically regardless of theme.

import { nonNullish } from '@dfinity/utils';

// ── Parts model ───────────────────────────────────────────────────────

interface SkinPlanes {
	/** Base midtone plane. */
	base: string;
	/** Right-side shadow plane. */
	shadow: string;
	/** Left-cheek highlight plane. */
	high: string;
}

interface BgPlanes {
	/** Top-left dominant plane. */
	p1: string;
	/** Lower-right shadow plane. */
	p2: string;
}

/** A complete avatar description. Every field is one of the catalog keys. */
export interface ViciAvatarParts {
	skin: string;
	hair: string;
	hairStyle: string;
	expr: string;
	trait: string;
	shirt: string;
	bg: string;
}

// Editorial skin tones: base / shadow plane / highlight plane.
const SKIN: Record<string, SkinPlanes> = {
	umber: { base: '#9C6E45', shadow: '#6E4A2A', high: '#C0916A' },
	olive: { base: '#A78657', shadow: '#7A5E37', high: '#C9A879' },
	almond: { base: '#B98968', shadow: '#86603F', high: '#D4A988' },
	mahog: { base: '#6E4A2A', shadow: '#4A2F18', high: '#8E6238' },
	sand: { base: '#C99F75', shadow: '#9C7250', high: '#E0BC95' },
	bronze: { base: '#7E5638', shadow: '#553820', high: '#9E7558' }
};

const HAIR_COLOR: Record<string, string> = {
	jet: '#1A1410',
	charcoal: '#2A211A',
	brown: '#3E2C20',
	auburn: '#5A2F1E',
	blonde: '#A98E60',
	silver: '#A8A29A'
};

const HAIR_STYLE = ['short', 'wave', 'curly', 'buzz', 'long', 'bald'] as const;

// Six named moods: drive eye shaping, brow geometry, and mouth.
const EXPRESSION = ['joyful', 'focused', 'smug', 'skeptical', 'confident', 'cool'] as const;

// One ownable signature trait.
const TRAIT = ['none', 'glasses', 'earring', 'cap', 'streak', 'freckles'] as const;

// Neck / shoulder garment colour.
const SHIRT: Record<string, string> = {
	ink: '#262019',
	pine: '#2E5A2A',
	gold: '#C8A53C',
	coral: '#C85A4E',
	steel: '#3A4A5E',
	cream: '#D8CEB6'
};

// Two-plane layered backdrops (top-left light plane + lower-right shadow
// plane), each themed like a prediction-card scene.
const BG: Record<string, BgPlanes> = {
	pine: { p1: '#3E6B52', p2: '#2C4F3C' },
	slate: { p1: '#41566B', p2: '#2E3E4F' },
	rust: { p1: '#9E4B36', p2: '#7A3526' },
	moss: { p1: '#5C6B3A', p2: '#43502A' },
	plum: { p1: '#6B4A6E', p2: '#4F3551' },
	indigo: { p1: '#454C7A', p2: '#313759' },
	teal: { p1: '#2F6B6B', p2: '#224F4F' },
	clay: { p1: '#9E6B45', p2: '#7A4F33' }
};

const INK = '#14110D';
// Warm parchment cream: the eye catchlight tint (see `eyeMarkup`).
const CREAM = '#F2ECDC';

/**
 * The two backdrop planes for a parts object's backdrop key. Lets a surface
 * that renders the figure with `noBg` (e.g. the full-bleed profile hero)
 * recreate a cohesive gradient from the same palette the avatar would have
 * drawn. Falls back to `slate` for an unknown / unset key.
 */
export const avatarBackdropPlanes = (
	parts: Partial<ViciAvatarParts> | null | undefined
): BgPlanes => BG[parts?.bg ?? ''] ?? BG.slate;

/** Frozen, ordered key lists the editor iterates to build option tiles. */
export const AVATAR_PARTS = {
	skin: Object.keys(SKIN),
	hair: Object.keys(HAIR_COLOR),
	hairStyle: [...HAIR_STYLE],
	expr: [...EXPRESSION],
	trait: [...TRAIT],
	shirt: Object.keys(SHIRT),
	bg: Object.keys(BG)
} as const;

/** The avatar parts keys the editor and serializer iterate over. */
export type ViciAvatarPartKey = keyof ViciAvatarParts;

// ── Seeded picks (deterministic from a seed string) ────────────────────
//
// A dedicated 32-bit hash lives here rather than reusing the shared hash
// util: the parts mapping must stay byte-stable against this exact mixing,
// so the avatar surface owns its own hash to keep the seed → parts contract
// independent of any future hash-util change.

const hash = (str: string): number => {
	let h = 0;

	for (let i = 0; i < (str ?? '').length; i++) {
		h = ((h << 5) - h + str.charCodeAt(i)) | 0;
	}

	// Coerce the signed 32-bit accumulator to an unsigned uint32 so every
	// derived sub-hash (and the `n % len` index it feeds) stays non-negative.
	return h >>> 0;
};

// Index helper: maps a hash to a slot in a catalog. Standard `(arr, n)`
// shape, so `prefer-object-params` is relaxed here as it is for the other
// small math-style helpers in this codebase.
// eslint-disable-next-line local-rules/prefer-object-params
const at = <T>(arr: readonly T[], n: number): T => arr[n % arr.length];

/**
 * Maps a seed string to a stable parts object. The same seed always yields
 * the same parts: used to give everyone who isn't the logged-in user a
 * recognisable face derived from their immutable principal.
 */
export const deterministicParts = (seed: string): ViciAvatarParts => {
	const h = hash(seed || 'you');

	return {
		skin: at(AVATAR_PARTS.skin, h),
		hair: at(AVATAR_PARTS.hair, h >>> 3),
		hairStyle: at(AVATAR_PARTS.hairStyle, h >>> 6),
		expr: at(AVATAR_PARTS.expr, h >>> 9),
		trait: at(AVATAR_PARTS.trait, h >>> 12),
		shirt: at(AVATAR_PARTS.shirt, h >>> 15),
		bg: at(AVATAR_PARTS.bg, h >>> 18)
	};
};

// ── Normalizers ────────────────────────────────────────────────────────
// Keep any partial / unknown parts object rendering cleanly so a stored
// value that predates a catalog never crashes a surface.

const normMood = (e: string | undefined): string => {
	if ((EXPRESSION as readonly string[]).includes(e ?? '')) {
		return e as string;
	}

	const legacy: Record<string, string> = {
		joy: 'joyful',
		wise: 'focused',
		bold: 'confident',
		sly: 'smug',
		calm: 'cool',
		surprise: 'skeptical'
	};

	return legacy[e ?? ''] ?? 'focused';
};

const normStyle = (s: string | undefined): string => {
	if ((HAIR_STYLE as readonly string[]).includes(s ?? '')) {
		return s as string;
	}

	const legacy: Record<string, string> = {
		curls: 'curly',
		tied: 'long',
		locks: 'long'
	};

	return legacy[s ?? ''] ?? 'short';
};

/**
 * Coerces an arbitrary (possibly partial or legacy) parts object into a
 * fully-populated, in-catalog `ViciAvatarParts`. Falls back to a fixed
 * default rather than a seeded one so the caller controls seeding.
 */
export const normalizeParts = (
	parts: Partial<ViciAvatarParts> | null | undefined
): ViciAvatarParts => {
	const p = parts ?? {};

	return {
		skin: nonNullish(SKIN[p.skin ?? '']) ? (p.skin as string) : 'umber',
		hair: nonNullish(HAIR_COLOR[p.hair ?? '']) ? (p.hair as string) : 'brown',
		hairStyle: normStyle(p.hairStyle),
		expr: normMood(p.expr),
		trait: (TRAIT as readonly string[]).includes(p.trait ?? '') ? (p.trait as string) : 'none',
		shirt: nonNullish(SHIRT[p.shirt ?? '']) ? (p.shirt as string) : 'ink',
		bg: nonNullish(BG[p.bg ?? '']) ? (p.bg as string) : 'slate'
	};
};

// ── Serialization (persisted as a compact JSON string on the profile) ───

/**
 * Serializes parts to the compact string persisted on the profile. Only the
 * seven catalog keys are written, so an over-shaped object never leaks extra
 * fields onto the wire.
 */
export const serializeParts = (parts: ViciAvatarParts): string => {
	const p = normalizeParts(parts);

	return JSON.stringify({
		skin: p.skin,
		hair: p.hair,
		hairStyle: p.hairStyle,
		expr: p.expr,
		trait: p.trait,
		shirt: p.shirt,
		bg: p.bg
	});
};

/**
 * Parses a persisted parts string back into a normalized parts object.
 * Returns `undefined` for an empty / unset / malformed value so the caller
 * can fall back to a deterministic seed.
 */
export const parseParts = (raw: string | null | undefined): ViciAvatarParts | undefined => {
	if (!nonNullish(raw) || raw.trim().length === 0) {
		return;
	}

	try {
		return normalizeParts(JSON.parse(raw) as Partial<ViciAvatarParts>);
	} catch (_: unknown) {
		// Malformed stored value: fall through (implicit undefined) so the
		// caller can fall back to the deterministic seed rather than crashing.
	}
};

// ── SVG renderer ───────────────────────────────────────────────────────
// 100×100 viewBox. Filled planes only, no outline strokes on the head.

interface RenderOptions {
	/** Whether to gate animation. When false (default) the figure is static;
	 *  callers that have confirmed motion is allowed pass `true`. */
	animate?: boolean;
	/** Draw the circular gold frame ring. */
	frame?: boolean;
	/** Draw the gold signature circle + wordmark. Off for editor option
	 *  tiles, which crop tight to the face. */
	signature?: boolean;
	/** Draw the decorative backdrop flourishes (lower-left dot + gold
	 *  signature disc). Defaults on; off lets an overlay surface keep the
	 *  backdrop clean behind its own controls. */
	decor?: boolean;
	/** Skip the backdrop entirely so the figure sits on a caller-supplied
	 *  surface (e.g. the profile hero's palette gradient). */
	noBg?: boolean;
}

// Backdrop: two colour planes + token-driven chrome (highlight beam, shadow
// accent line, decorative dot, gold signature mark).
//
// `decor` gates the decorative flourishes: the lower-left dot and the gold
// signature disc, so a surface that overlays its own UI (e.g. the full-bleed
// profile hero, where floating controls sit over the top-right corner) can
// drop them and keep the backdrop clean.
const bgLayer = ({
	bg,
	signature,
	decor
}: {
	bg: BgPlanes;
	signature: boolean;
	decor: boolean;
}): string => {
	let m = '';

	// Identity planes (user-picked backdrop): literal palette.
	m += `<rect width="100" height="100" fill="${bg.p1}"/>`;
	m += `<polygon points="0,100 100,34 100,100" fill="${bg.p2}"/>`;

	// Chrome overlays: theme tokens so they track dark / light / peach.
	m += `<polygon points="0,0 52,0 0,46" fill="var(--text-base)" opacity="0.06"/>`;
	m += `<polygon points="0,100 100,34 100,38 0,100" fill="var(--bg-base)" opacity="0.10"/>`;

	if (decor) {
		m += `<circle cx="14" cy="83" r="5" fill="var(--text-base)" opacity="0.14"/>`;

		// Tamed signature disc: a small gold mark in the top-right corner. Kept
		// deliberately compact (radius 4.5) and hairline-stroked so it reads as a
		// quiet maker's mark rather than competing with gold-tier menagerie badges
		// or the laurel accent. The `signature` gate keeps it off the editor's
		// tight option tiles.
		if (signature) {
			m += `<circle cx="84" cy="17" r="4.5" fill="var(--brand)"/>`;
			m += `<circle cx="84" cy="17" r="4.5" fill="none" stroke="var(--bg-base)" stroke-width="0.5" opacity="0.18"/>`;
		}
	}

	return m;
};

const eyeMarkup = ({
	cx,
	eyeY,
	eyeRy,
	lid,
	pdx,
	pdy,
	skin,
	animate
}: {
	cx: number;
	eyeY: number;
	eyeRy: number;
	lid: number;
	pdx: number;
	pdy: number;
	skin: SkinPlanes;
	animate: boolean;
}): string => {
	let e = `<g${animate ? ' class="va-blink"' : ''} style="transform-origin:${cx}px ${eyeY}px">`;
	e += `<ellipse cx="${cx}" cy="${eyeY}" rx="3" ry="${eyeRy}" fill="#F4EFE3"/>`;
	e += `<ellipse cx="${cx}" cy="${eyeY}" rx="3" ry="${eyeRy}" fill="none" stroke="${INK}" stroke-width="0.4" opacity="0.18"/>`;
	e += `<circle cx="${cx + pdx}" cy="${eyeY + pdy}" r="1.7" fill="${INK}"/>`;
	// Catchlight: a warm cream rather than pure white, so the eye reads as part
	// of the editorial parchment palette instead of a hard digital spec.
	e += `<circle cx="${cx + pdx - 0.7}" cy="${eyeY + pdy - 0.8}" r="0.7" fill="${CREAM}" opacity="0.6"/>`;

	if (lid > 0) {
		e += `<rect x="${cx - 3.4}" y="${eyeY - eyeRy - 0.4}" width="6.8" height="${lid + 0.4}" rx="0.5" fill="${skin.base}"/>`;
		e += `<rect x="${cx - 3.4}" y="${eyeY - eyeRy + lid - 0.4}" width="6.8" height="0.5" fill="${skin.shadow}" opacity="0.6"/>`;
	}

	e += `</g>`;

	return e;
};

const browBar = ({
	cx,
	y1,
	y2,
	w = 6,
	th = 1.6
}: {
	cx: number;
	y1: number;
	y2: number;
	w?: number;
	th?: number;
}): string =>
	`<polygon points="${cx - w / 2},${y1} ${cx + w / 2},${y2} ${cx + w / 2},${y2 + th} ${cx - w / 2},${y1 + th}" fill="${INK}"/>`;

const hairFront = ({
	style,
	hairC,
	skin
}: {
	style: string;
	hairC: string;
	skin: SkinPlanes;
}): string => {
	if (style === 'short') {
		return (
			`<polygon points="29,33 29,24 35,18 50,16 65,18 71,24 71,33 64,29 50,28 36,29" fill="${hairC}"/>` +
			`<polygon points="50,16 65,18 71,24 71,33 64,29 50,28" fill="rgba(14,13,11,0.22)"/>`
		);
	}

	if (style === 'wave') {
		return `<path d="M 29 33 Q 28 18 50 15 Q 72 18 71 33 Q 66 25 60 30 Q 54 23 50 29 Q 46 23 40 30 Q 34 25 29 33 Z" fill="${hairC}"/>`;
	}

	if (style === 'curly') {
		let h = '';
		const tufts: ReadonlyArray<readonly [number, number, number]> = [
			[34, 22, 6],
			[42, 17, 6],
			[50, 15, 6.5],
			[58, 17, 6],
			[66, 22, 6],
			[31, 30, 5],
			[69, 30, 5]
		];

		for (const [cx, cy, r] of tufts) {
			h += `<circle cx="${cx}" cy="${cy}" r="${r}" fill="${hairC}"/>`;
		}

		h += `<circle cx="58" cy="18" r="5" fill="rgba(14,13,11,0.18)"/>`;

		return h;
	}

	if (style === 'buzz') {
		return (
			`<polygon points="30,32 30,26 36,20 50,18 64,20 70,26 70,32 64,29 50,28 36,29" fill="${hairC}" opacity="0.92"/>` +
			`<polygon points="50,18 64,20 70,26 70,32 64,29 50,28" fill="rgba(14,13,11,0.18)"/>`
		);
	}

	if (style === 'long') {
		return (
			`<polygon points="29,34 29,23 35,17 50,15 65,17 71,23 71,34 63,29 50,28 37,29" fill="${hairC}"/>` +
			`<polygon points="50,15 65,17 71,23 71,34 63,29 50,28" fill="rgba(14,13,11,0.22)"/>`
		);
	}

	if (style === 'bald') {
		return `<polygon points="33,30 50,25 67,30 64,28 50,27 36,28" fill="${skin.high}" opacity="0.25"/>`;
	}

	return '';
};

const mouthMarkup = (mood: string): string => {
	const LIP = '#9C5046';

	if (mood === 'joyful') {
		return (
			`<path d="M 43 58.5 Q 50 69 57 58.5 Q 50 61 43 58.5 Z" fill="#3A211C"/>` +
			`<path d="M 45 59.5 Q 50 65.5 55 59.5 Q 50 61 45 59.5 Z" fill="#C2736B"/>` +
			`<path d="M 44 58.8 Q 50 60.4 56 58.8" stroke="#F4EFE3" stroke-width="1" fill="none" stroke-linecap="round"/>`
		);
	}

	if (mood === 'confident') {
		return (
			`<path d="M 43.5 59 Q 50 64.5 56.5 59" stroke="#3A211C" stroke-width="2.1" fill="none" stroke-linecap="round"/>` +
			`<path d="M 44.5 59.6 Q 50 63 55.5 59.6" stroke="${LIP}" stroke-width="0.9" fill="none" stroke-linecap="round"/>`
		);
	}

	if (mood === 'smug') {
		return (
			`<path d="M 43.5 60.5 Q 49 62.5 57 57.8" stroke="#3A211C" stroke-width="2.1" fill="none" stroke-linecap="round"/>` +
			`<path d="M 44.5 60.8 Q 49 62.4 56 58.6" stroke="${LIP}" stroke-width="0.8" fill="none" stroke-linecap="round"/>`
		);
	}

	if (mood === 'skeptical') {
		return (
			`<path d="M 43.5 60 Q 49 60.4 57 61.4" stroke="#3A211C" stroke-width="2" fill="none" stroke-linecap="round"/>` +
			`<path d="M 44 60.6 L 56 61.3" stroke="${LIP}" stroke-width="0.8" fill="none" stroke-linecap="round"/>`
		);
	}

	if (mood === 'cool') {
		return (
			`<path d="M 43.5 60 Q 50 61.4 56.5 59.6" stroke="#3A211C" stroke-width="2" fill="none" stroke-linecap="round"/>` +
			`<path d="M 44.5 60.5 Q 50 61.6 55.5 60.2" stroke="${LIP}" stroke-width="0.8" fill="none" stroke-linecap="round"/>`
		);
	}

	// focused: neutral closed
	return (
		`<path d="M 44 60 Q 50 61.6 56 60" stroke="#3A211C" stroke-width="2" fill="none" stroke-linecap="round"/>` +
		`<path d="M 45 60.6 L 55 60.6" stroke="${LIP}" stroke-width="0.8" fill="none" stroke-linecap="round"/>`
	);
};

const traitOverlay = ({ trait, style }: { trait: string; style: string }): string => {
	if (trait === 'streak' && style !== 'bald') {
		return (
			`<polygon points="40,17 46,16 44,30 39,30" fill="#C9C4BC"/>` +
			`<polygon points="46,16 47.5,15.8 46,29.5 44,30" fill="#E6E2DA" opacity="0.7"/>`
		);
	}

	if (trait === 'cap') {
		// Gold cap: the gold uses the brand token so the signature accent
		// tracks the theme; the shadow side + brim + crest stay literal.
		return (
			`<polygon points="28,30 30,21 50,16 70,21 72,30 64,26 50,25 36,26" fill="var(--brand)"/>` +
			`<polygon points="50,16 70,21 72,30 64,26 50,25" fill="rgba(14,13,11,0.20)"/>` +
			`<path d="M 27 30 Q 18 31 17 35 L 30 33 Z" fill="var(--brand-deep)"/>` +
			`<rect x="46" y="20" width="8" height="6" rx="1" fill="rgba(14,13,11,0.16)"/>` +
			`<text x="50" y="25" text-anchor="middle" font-family="ui-monospace,monospace" font-size="5" font-weight="800" fill="var(--brand)">V</text>`
		);
	}

	if (trait === 'earring') {
		return (
			`<circle cx="29.5" cy="54.5" r="2.1" fill="none" stroke="var(--brand)" stroke-width="1.1"/>` +
			`<circle cx="29.5" cy="52.6" r="0.7" fill="var(--brand)"/>`
		);
	}

	if (trait === 'glasses') {
		const TORT = '#5A3A22';

		return (
			`<rect x="36.5" y="43" width="11" height="9" rx="3" fill="rgba(255,255,255,0.05)" stroke="${TORT}" stroke-width="1.7"/>` +
			`<rect x="52.5" y="43" width="11" height="9" rx="3" fill="rgba(255,255,255,0.05)" stroke="${TORT}" stroke-width="1.7"/>` +
			`<line x1="47.5" y1="46.5" x2="52.5" y2="46.5" stroke="${TORT}" stroke-width="1.7"/>` +
			`<line x1="36.5" y1="46.5" x2="31" y2="45" stroke="${TORT}" stroke-width="1.5"/>` +
			`<line x1="63.5" y1="46.5" x2="69" y2="45" stroke="${TORT}" stroke-width="1.5"/>` +
			`<path d="M 38.5 45 q 2 -1.4 4 0" stroke="#9C6E2E" stroke-width="0.7" fill="none" opacity="0.7"/>` +
			`<path d="M 54.5 45 q 2 -1.4 4 0" stroke="#9C6E2E" stroke-width="0.7" fill="none" opacity="0.7"/>`
		);
	}

	return '';
};

/**
 * Renders the inner SVG content (everything inside the
 * `<svg viewBox="0 0 100 100">`) for a parts object. Pure: the caller mounts
 * the returned string via `{@html ...}`.
 */
export const renderAvatarContent = ({
	parts,
	options
}: {
	parts: ViciAvatarParts;
	options?: RenderOptions;
}): string => {
	const p = normalizeParts(parts);
	const animate = options?.animate ?? false;
	const frame = options?.frame ?? true;
	const signature = options?.signature ?? true;
	const decor = options?.decor ?? true;
	const noBg = options?.noBg ?? false;

	const skin = SKIN[p.skin];
	const hairC = HAIR_COLOR[p.hair];
	const shirt = SHIRT[p.shirt];
	const bg = BG[p.bg];
	const mood = p.expr;
	const style = p.hairStyle;
	const { trait } = p;

	let s = '';

	// 1 · Backdrop (two planes + signature): skipped entirely when `noBg`, so
	// the figure can sit on a caller-supplied surface (the profile hero tint).
	if (!noBg) {
		s += bgLayer({ bg, signature, decor });
	}

	// 2 · Figure group (gentle bob, gated)
	s += `<g${animate ? ' class="va-bob"' : ''}>`;

	// Neck first, running past the collar line so the shoulders overlap its
	// base: otherwise a band of backdrop shows between chin and shirt.
	s += `<rect x="44" y="62" width="12" height="24" fill="${skin.shadow}"/>`;
	s += `<polygon points="44,62 56,62 54,70 46,70" fill="${skin.base}" opacity="0.6"/>`;

	// Shoulders
	s += `<polygon points="20,100 80,100 73,83 27,83" fill="${shirt}"/>`;
	s += `<polygon points="50,83 80,100 50,100" fill="rgba(14,13,11,0.20)"/>`;

	// Back hair panels (long)
	if (style === 'long') {
		s += `<polygon points="28,28 24,80 35,82 37,34" fill="${hairC}"/>`;
		s += `<polygon points="72,28 76,80 65,82 63,34" fill="${hairC}"/>`;
		s += `<polygon points="72,28 76,80 70,80 67,34" fill="rgba(14,13,11,0.22)"/>`;
	}

	// Head: faceted planes (no outline strokes)
	const FACE = '32,27 68,27 71,35 70,55 64,67 56,72 44,72 36,67 30,55 29,35';
	s += `<polygon points="${FACE}" fill="${skin.base}"/>`;
	s += `<polygon points="50,27 68,27 71,35 70,55 64,67 56,72 50,72" fill="${skin.shadow}" opacity="0.5"/>`;
	s += `<polygon points="31,46 38,44 37,59 32,58" fill="${skin.high}" opacity="0.6"/>`;
	s += `<polygon points="39,64 61,64 56,72 44,72" fill="${skin.shadow}" opacity="0.4"/>`;
	s += `<polygon points="48.4,44 50,44 50.4,55 47.4,55" fill="${skin.high}" opacity="0.45"/>`;
	s += `<polygon points="46,55 54,55 50,59" fill="${skin.shadow}" opacity="0.55"/>`;
	s += `<rect x="28" y="46" width="3" height="7" rx="1.3" fill="${skin.shadow}"/>`;
	s += `<rect x="69" y="46" width="3" height="7" rx="1.3" fill="${skin.shadow}" opacity="0.8"/>`;

	// Eyes (filled volumes, mood-shaped)
	const eyeY = 47;
	const eyeL = 42;
	const eyeR = 58;
	let eyeRy = 3.3;
	let lid = 0;
	let pdx = 0;
	let pdy = 0;

	if (mood === 'joyful') {
		eyeRy = 2.5;
		pdy = 0.6;
	} else if (mood === 'smug') {
		lid = 1.4;
		pdx = 1.2;
		pdy = -0.3;
	} else if (mood === 'cool') {
		lid = 1.0;
	} else if (mood === 'skeptical') {
		pdy = -0.6;
	}

	s += eyeMarkup({ cx: eyeL, eyeY, eyeRy, lid, pdx, pdy, skin, animate });
	s += eyeMarkup({ cx: eyeR, eyeY, eyeRy, lid, pdx, pdy, skin, animate });

	// Brows (filled bars, mood-shaped)
	const browY = 41.5;

	if (mood === 'joyful') {
		s += browBar({ cx: eyeL, y1: browY - 0.6, y2: browY - 1.4 });
		s += browBar({ cx: eyeR, y1: browY - 1.4, y2: browY - 0.6 });
	} else if (mood === 'focused') {
		s += browBar({ cx: eyeL, y1: browY, y2: browY });
		s += browBar({ cx: eyeR, y1: browY, y2: browY });
	} else if (mood === 'smug') {
		s += browBar({ cx: eyeL, y1: browY + 0.2, y2: browY + 0.2 });
		s += browBar({ cx: eyeR, y1: browY - 2.2, y2: browY - 0.6 });
	} else if (mood === 'skeptical') {
		s += browBar({ cx: eyeL, y1: browY - 2.6, y2: browY - 1.4, w: 6, th: 1.7 });
		s += browBar({ cx: eyeR, y1: browY + 0.4, y2: browY + 0.6 });
	} else if (mood === 'confident') {
		s += browBar({ cx: eyeL, y1: browY - 0.8, y2: browY - 0.8 });
		s += browBar({ cx: eyeR, y1: browY - 0.8, y2: browY - 0.8 });
	} else if (mood === 'cool') {
		s += browBar({ cx: eyeL, y1: browY + 0.4, y2: browY + 0.2 });
		s += browBar({ cx: eyeR, y1: browY + 0.2, y2: browY + 0.4 });
	}

	// Mouth
	s += mouthMarkup(mood);

	// Freckles trait (under the eyes, before hair)
	if (trait === 'freckles') {
		const dots: ReadonlyArray<readonly [number, number]> = [
			[39, 52],
			[42, 53.5],
			[45, 52.5],
			[55, 52.5],
			[58, 53.5],
			[61, 52]
		];

		for (const [x, y] of dots) {
			s += `<circle cx="${x}" cy="${y}" r="0.8" fill="${skin.shadow}" opacity="0.7"/>`;
		}
	}

	// Hair front (over the forehead)
	s += hairFront({ style, hairC, skin });

	// Remaining traits (streak / cap / earring / glasses)
	s += traitOverlay({ trait, style });

	s += `</g>`; // close figure

	// 3 · Wordmark, bottom-right (signature). Token foreground so it tracks
	// the theme. Cropped away in tight circle crops.
	if (signature) {
		s += `<text x="95" y="95.5" text-anchor="end" font-family="ui-monospace,monospace" font-size="5" font-weight="700" letter-spacing="0.06em" fill="var(--text-base)" opacity="0.55">VICI</text>`;
	}

	// 4 · Frame ring: brand token, tracks the theme.
	if (frame) {
		s += `<circle cx="50" cy="50" r="49" fill="none" stroke="var(--brand)" stroke-width="1" opacity="0.40"/>`;
		s += `<circle cx="50" cy="50" r="47" fill="none" stroke="var(--brand)" stroke-width="0.5" opacity="0.18"/>`;
	}

	return s;
};

/**
 * Convenience: wraps {@link renderAvatarContent} in a sized `<svg>`. The
 * returned string is mounted via `{@html ...}`.
 */
export const renderAvatarSvg = ({
	parts,
	size,
	options
}: {
	parts: ViciAvatarParts;
	size: number;
	options?: RenderOptions;
}): string =>
	`<svg viewBox="0 0 100 100" width="${size}" height="${size}" xmlns="http://www.w3.org/2000/svg" preserveAspectRatio="xMidYMid meet">${renderAvatarContent({ parts, options })}</svg>`;
