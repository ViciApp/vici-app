import { WC_SHIRT } from '#lib/constants/flow-art-wc.constants.ts';
import type { FlowArtPalette } from '#lib/utils/flow-art/types.ts';
import { wcFace } from '#lib/utils/flow-art/wc/figure.ts';

// WC scene helpers — background backdrops + focal props. Bundled in
// a factory so each helper closes over the per-render palette `p` and
// `uid` exactly as it did when these were locals inside renderWC.
// `(p, uid)` are the two render-scoped primitives the helper closures
// bind; an object form would only obscure that one-shot factory call.
// eslint-disable-next-line local-rules/prefer-object-params
export const makeWcHelpers = (p: FlowArtPalette, uid: string) => {
	// === BACKGROUND HELPERS ===================================
	// Each backdrop fills the full 280×100 band. Palette tokens
	// (`p.bg` / `p.base` / `p.ink` / `p.fg` / `p.hot`) recolour per
	// theme; the flag trios passed in are fixed national colours.
	const bgFlagDiag = ({ c1, c2, c3 }: { c1: string; c2: string; c3: string }): string =>
		`<rect width="280" height="100" fill="${p.base}"/>` +
		`<polygon points="-20,120 90,0 120,0 0,120" fill="${c1}" opacity="0.78"/>` +
		`<polygon points="90,0 120,0 30,120 0,120" fill="${c2}" opacity="0.88"/>` +
		`<polygon points="120,0 280,0 280,40 60,40" fill="${c3}" opacity="0.18"/>`;

	const bgFlagHoriz = ({ c1, c2, c3 }: { c1: string; c2: string; c3: string }): string =>
		`<rect x="0" y="0" width="280" height="33" fill="${c1}" opacity="0.85"/>` +
		`<rect x="0" y="33" width="280" height="34" fill="${c2}" opacity="0.95"/>` +
		`<rect x="0" y="67" width="280" height="33" fill="${c3}" opacity="0.85"/>`;

	const bgFlagVert = ({ c1, c2, c3 }: { c1: string; c2: string; c3: string }): string =>
		`<rect x="0" y="0" width="93.3" height="100" fill="${c1}" opacity="0.9"/>` +
		`<rect x="93.3" y="0" width="93.4" height="100" fill="${c2}" opacity="0.9"/>` +
		`<rect x="186.7" y="0" width="93.3" height="100" fill="${c3}" opacity="0.9"/>`;

	const bgCircle = ({
		color,
		cx = 200,
		cy = 50,
		r = 60
	}: {
		color: string;
		cx?: number;
		cy?: number;
		r?: number;
	}): string =>
		`<rect width="280" height="100" fill="${p.bg}"/>` +
		`<rect width="280" height="100" fill="${p.base}" opacity="0.55"/>` +
		`<circle cx="${cx}" cy="${cy}" r="${r}" fill="${color}" opacity="0.85"/>` +
		`<circle cx="${cx}" cy="${cy}" r="${r + 6}" fill="none" stroke="${color}" stroke-width="0.5" opacity="0.40"/>`;

	const bgPerspective = (color: string): string => {
		let m = `<rect width="280" height="100" fill="${p.bg}"/>`;
		m += `<polygon points="0,100 280,100 200,40 80,40" fill="${p.base}" opacity="0.65"/>`;

		// Eight floor lines converging toward the back, then four
		// receding crossbars to anchor depth.
		for (let i = 0; i < 8; i++) {
			const t = i / 7;
			const x1 = t * 280;
			const x2 = 80 + t * 120;
			m += `<line x1="${x1.toFixed(1)}" y1="100" x2="${x2.toFixed(1)}" y2="40" stroke="${color}" stroke-width="0.4" opacity="0.35"/>`;
		}

		for (let i = 0; i < 4; i++) {
			const y = 50 + i * 12;
			const xL = 100 - (y - 40) * 0.2;
			const xR = 180 + (y - 40) * 0.2;
			m += `<line x1="${xL}" y1="${y}" x2="${xR}" y2="${y}" stroke="${color}" stroke-width="0.3" opacity="0.30"/>`;
		}

		return m;
	};

	const bgSpotlight = ({ c1, c2 }: { c1: string; c2: string }): string =>
		`<rect width="280" height="100" fill="${p.bg}"/>` +
		// Two spotlight cones from the top — classes drive the CSS sweep.
		`<polygon class="wc-spot wc-spot-left" points="50,-10 80,-10 130,100 30,100" fill="${c1}" opacity="0.15"/>` +
		`<polygon class="wc-spot wc-spot-right" points="200,-10 230,-10 250,100 150,100" fill="${c2}" opacity="0.15"/>` +
		`<rect width="280" height="100" fill="${p.base}" opacity="0.35"/>`;

	const bgBunting = ({ c1, c2, c3 }: { c1: string; c2: string; c3: string }): string => {
		let m = `<rect width="280" height="100" fill="${p.bg}"/>`;
		m += `<rect x="0" y="62" width="280" height="38" fill="${p.base}" opacity="0.55"/>`;
		// Bunting string + triangular flags.
		m += `<path d="M 0 18 Q 140 26 280 18" fill="none" stroke="${p.fg}" stroke-width="0.4" opacity="0.55"/>`;
		const cols = [c1, c2, c3];

		for (let i = 0; i < 12; i++) {
			const t = i / 11;
			const x = t * 280;
			const y = 18 + Math.sin(t * Math.PI) * 5;
			const c = cols[i % cols.length];
			// `% 10` keeps the stagger class in range — `FlowArtFrame`
			// only defines `.wc-cnf-0`…`.wc-cnf-9` delay hooks, so the
			// 11th/12th shards reuse an existing offset rather than
			// falling back to the unstaggered base animation.
			m += `<path class="wc-cnf wc-cnf-${i % 10}" d="M ${x - 5} ${y} L ${x + 5} ${y} L ${x} ${y + 10} Z" fill="${c}" opacity="${0.78 + (i % 2) * 0.15}"/>`;
		}

		return m;
	};

	const bgStands = (stripe: string): string => {
		let m = `<rect width="280" height="100" fill="${p.bg}"/>`;

		// Stadium tiers.
		for (let i = 0; i < 6; i++) {
			m += `<rect x="-4" y="${10 + i * 6}" width="290" height="3" fill="${p.base}" opacity="${0.55 - i * 0.05}"/>`;
		}

		// Tiny crowd dots.
		for (let r = 0; r < 5; r++) {
			for (let c = 0; c < 28; c++) {
				m += `<circle cx="${4 + c * 10}" cy="${10.5 + r * 6}" r="0.6" fill="${stripe}" opacity="${0.35 + (r % 2) * 0.18}"/>`;
			}
		}

		// Low pitch line.
		m += `<rect x="0" y="46" width="280" height="54" fill="${p.ink}" opacity="0.30"/>`;
		m += `<line x1="0" y1="74" x2="280" y2="74" stroke="${p.fg}" stroke-width="0.4" opacity="0.30"/>`;

		return m;
	};

	const bgTV = (color: string): string =>
		`<rect width="280" height="100" fill="${p.bg}"/>` +
		// Big TV frame on the right.
		`<rect x="142" y="14" width="124" height="72" rx="3" fill="${p.ink}" opacity="0.92"/>` +
		`<rect x="142" y="14" width="124" height="72" rx="3" fill="none" stroke="${color}" stroke-width="0.6" opacity="0.55"/>` +
		// 'replay' grid inside.
		`<line x1="146" y1="64" x2="262" y2="64" stroke="${p.hot}" stroke-width="0.4" opacity="0.55"/>` +
		`<line x1="190" y1="20" x2="190" y2="84" stroke="${color}" stroke-width="0.5" stroke-dasharray="2 2" opacity="0.9"/>` +
		// VAR pill.
		`<rect x="142" y="14" width="34" height="9" fill="#D04444" opacity="0.95"/>` +
		`<text x="159" y="20.5" text-anchor="middle" font-family="ui-monospace,monospace" font-size="6" font-weight="800" fill="#F2ECDC">VAR</text>`;

	const bgPropose = (accentRing: string): string => {
		let m = `<rect width="280" height="100" fill="${p.bg}"/>`;
		m += `<rect x="0" y="55" width="280" height="45" fill="${p.base}" opacity="0.6"/>`;
		m += `<line x1="0" y1="68" x2="280" y2="68" stroke="${p.fg}" stroke-width="0.4" opacity="0.30"/>`;

		// Floating hearts.
		for (let i = 0; i < 5; i++) {
			const x = 30 + i * 56;
			const y = 24 + (i % 2) * 8;
			m += `<path d="M ${x} ${y + 4} C ${x - 4} ${y - 2} ${x - 8} ${y + 2} ${x} ${y + 8} C ${x + 8} ${y + 2} ${x + 4} ${y - 2} ${x} ${y + 4} Z" fill="${accentRing}" opacity="0.70"/>`;
		}

		return m;
	};

	// === FOCAL PROPS (scene-specific accents) =================
	const trophyIcon = ({
		cx,
		cy,
		scale = 1
	}: {
		cx: number;
		cy: number;
		scale?: number;
	}): string => {
		const sx = (x: number): number => cx + x * scale;
		const sy = (y: number): number => cy + y * scale;
		const gradId = `wctrophy-${uid}`;
		let m = `<defs><linearGradient id="${gradId}" x1="0" x2="0" y1="0" y2="1"><stop offset="0%" stop-color="${WC_SHIRT.gold}"/><stop offset="100%" stop-color="#A87D14"/></linearGradient></defs>`;
		// Cup.
		m += `<path d="M ${sx(-8)} ${sy(-10)} Q ${sx(-9)} ${sy(-3)} ${sx(-5)} ${sy(4)} Q ${sx(-3)} ${sy(8)} ${sx(-4)} ${sy(10)} L ${sx(-7)} ${sy(15)} L ${sx(7)} ${sy(15)} L ${sx(4)} ${sy(10)} Q ${sx(3)} ${sy(8)} ${sx(5)} ${sy(4)} Q ${sx(9)} ${sy(-3)} ${sx(8)} ${sy(-10)} Z" fill="url(#${gradId})"/>`;
		// Base.
		m += `<rect x="${sx(-9)}" y="${sy(15)}" width="${18 * scale}" height="${3 * scale}" fill="${WC_SHIRT.gold}"/>`;
		m += `<rect x="${sx(-11)}" y="${sy(18)}" width="${22 * scale}" height="${3.5 * scale}" fill="${WC_SHIRT.gold}" opacity="0.85"/>`;

		return m;
	};

	const goldenBoot = ({
		cx,
		cy,
		scale = 1
	}: {
		cx: number;
		cy: number;
		scale?: number;
	}): string => {
		const sx = (x: number): number => cx + x * scale;
		const sy = (y: number): number => cy + y * scale;
		let m = `<path d="M ${sx(-15)} ${sy(0)} Q ${sx(-18)} ${sy(-6)} ${sx(-8)} ${sy(-10)} L ${sx(8)} ${sy(-12)} Q ${sx(16)} ${sy(-12)} ${sx(18)} ${sy(-5)} L ${sx(18)} ${sy(2)} Q ${sx(18)} ${sy(8)} ${sx(10)} ${sy(8)} L ${sx(-10)} ${sy(10)} Q ${sx(-16)} ${sy(10)} ${sx(-15)} ${sy(0)} Z" fill="${WC_SHIRT.gold}"/>`;

		// Laces.
		for (let i = 0; i < 4; i++) {
			m += `<line x1="${sx(-6 + i * 5)}" y1="${sy(-7)}" x2="${sx(-6 + i * 5)}" y2="${sy(-2)}" stroke="#A87D14" stroke-width="0.5"/>`;
		}

		// Studs.
		for (let i = 0; i < 4; i++) {
			m += `<circle cx="${sx(-4 + i * 5)}" cy="${sy(11)}" r="0.7" fill="${p.bg}" opacity="0.8"/>`;
		}

		return m;
	};

	const redCardProp = ({ cx, cy, rot = -16 }: { cx: number; cy: number; rot?: number }): string =>
		`<g transform="rotate(${rot} ${cx} ${cy})">` +
		`<rect x="${cx - 7}" y="${cy - 10}" width="14" height="20" fill="#D04444"/>` +
		`<rect x="${cx - 7}" y="${cy - 10}" width="14" height="20" fill="none" stroke="#0E0D0B" stroke-width="0.4" opacity="0.5"/>` +
		`</g>`;

	const ringProp = ({ cx, cy }: { cx: number; cy: number }): string =>
		`<ellipse cx="${cx}" cy="${cy}" rx="8" ry="8" fill="none" stroke="${WC_SHIRT.gold}" stroke-width="2" opacity="0.95"/>` +
		`<path d="M ${cx} ${cy - 12} L ${cx + 3} ${cy - 9} L ${cx} ${cy - 6} L ${cx - 3} ${cy - 9} Z" fill="${WC_SHIRT.gold}"/>`;

	const scissorsProp = ({ cx, cy }: { cx: number; cy: number }): string =>
		`<circle cx="${cx - 5}" cy="${cy - 2}" r="2.5" fill="none" stroke="${p.fg}" stroke-width="0.8"/>` +
		`<circle cx="${cx + 5}" cy="${cy + 4}" r="2.5" fill="none" stroke="${p.fg}" stroke-width="0.8"/>` +
		`<line x1="${cx - 3}" y1="${cy - 1}" x2="${cx + 6}" y2="${cy + 9}" stroke="${p.fg}" stroke-width="1"/>` +
		`<line x1="${cx + 3}" y1="${cy + 3}" x2="${cx - 6}" y2="${cy + 11}" stroke="${p.fg}" stroke-width="1"/>`;

	const ballProp = ({ cx, cy, r = 6 }: { cx: number; cy: number; r?: number }): string => {
		let m = `<circle cx="${cx}" cy="${cy}" r="${r}" fill="#F2ECDC"/>`;
		m += `<circle cx="${cx}" cy="${cy}" r="${r}" fill="none" stroke="#0E0D0B" stroke-width="0.4"/>`;

		for (let i = 0; i < 6; i++) {
			const a = (i * 60 * Math.PI) / 180;
			const px = cx + Math.cos(a) * (r * 0.55);
			const py = cy + Math.sin(a) * (r * 0.55);
			m += `<circle cx="${px.toFixed(2)}" cy="${py.toFixed(2)}" r="${r * 0.2}" fill="#0E0D0B"/>`;
		}

		m += `<circle cx="${cx}" cy="${cy}" r="${r * 0.2}" fill="#0E0D0B"/>`;

		return m;
	};

	return {
		bgFlagDiag,
		bgFlagHoriz,
		bgFlagVert,
		bgCircle,
		bgPerspective,
		bgSpotlight,
		bgBunting,
		bgStands,
		bgTV,
		bgPropose,
		trophyIcon,
		goldenBoot,
		redCardProp,
		ringProp,
		scissorsProp,
		ballProp,
		wcFace,
		p
	};
};

export type WcHelpers = ReturnType<typeof makeWcHelpers>;
