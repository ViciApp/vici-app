// WC per-market artwork: catalogue-driven scene templates.
//
// A family of deterministic compositions, each matched to one of the
// prediction catalogue's artwork briefs and drawn in the same blocky
// editorial register as the curated recipes (compose `WcHelpers`,
// fixed-ink figures over a palette-token backdrop). Each takes a
// per-market seeded `Rng` (seeded off the market id by the caller) so
// the same market always renders the same scene while tiny details
// (motion-line spread, lunge offset) vary between markets.
//
//   kit-clash: "Two blocky kit figures clashing … motion lines"
//                      / "locked shoulder-to-shoulder, evenly balanced".
//   qualify-bracket: "Forward bracket arrow / open door with the {A}
//                      crest-block".
//   ball-in-net: "A blocky ball bulging the net with stacked
//                      mini-balls".
//   split-pitch: "Split pitch, two mini-goals each rippling".
//   keeper-wall: "Blocky keeper plus a brick wall / padlock".
//   penalty-spot: "Blocky penalty spot, ball and net under a
//                      single spotlight".
//   podium: "Blocky podium top step with the {A} flag-block
//                      and a laurel".
//   stopwatch: "Blocky stopwatch on 15' with a fast ball-blur".
//   referee-card: "Blocky referee arm raising a card".
//   stadium-clock: "Big blocky stadium clock at 45' with a single
//                      ball".
//   striker-juggle: "Blocky striker mid-strike juggling two balls".
//   player-figure: "Generic blocky figure in {Nation} kit celebrating
//                      a goal": single nation bust + a celebratory ball.
//   player-card: "Generic blocky {Nation} player beside a raised
//                      card": the bust + a raised booking-amber card.
//   player-assist: "Generic blocky {Nation} playmaker threading a
//                      pass, arrow to a team-mate": the bust + a curved
//                      pass arrow to a small team-mate marker.
//   crest-ladder: "Two crest-blocks on a ladder, the favoured one a
//                      rung higher".
//   host-flags: "Three blocky flags: Mexico, USA, Canada".
//   debutant-door: "A fresh crest-block stepping through a doorway".
//   draw-balls: "Blocky hand drawing numbered balls from a bowl".
//   wildcard-icon: "Blocky icon that captures the question on a
//                      flag-colour field".
//
// Coordinate space is the WC band's 280×100 (see `wc/render.ts`).

import {
	WC_KIT_NEUTRAL,
	WC_NATION_KITS,
	WC_SHIRT,
	WC_SKIN,
	type WCKit
} from '#lib/constants/flow-art-wc.constants.ts';
import type { Rng } from '#lib/utils/flow-art/types.ts';
import type { WcHelpers } from '#lib/utils/flow-art/wc/helpers.ts';
import type { WcResolvedTemplate } from '#lib/utils/flow-art/wc/resolve-template.ts';

// Host-nation flag pairs for the three-host special, drawn from the
// shared nation-kit table (Mexico / USA / Canada) so the host palettes
// stay in lockstep with every other card rather than re-hardcoding them.
const HOST_FLAGS: ReadonlyArray<{ a: string; b: string }> = [
	WC_NATION_KITS['mexico'],
	WC_NATION_KITS['united states'],
	WC_NATION_KITS['canada']
].map((kit) => ({ a: kit.primary, b: kit.secondary }));

// Pick a readable ink for a kit shadow plane sitting under the figure.
// The figure layer uses fixed inks (see `wcFace`) so this only tunes
// the kit shadow: a darker shade of the primary so a light kit (cream
// / white) doesn't get a near-black shadow plane.
const shadeDown = (hex: string): string => {
	const m = /^#?([0-9a-f]{6})$/i.exec(hex);

	if (!m) {
		return '#1F1A14';
	}

	const n = parseInt(m[1], 16);
	const r = Math.round(((n >> 16) & 0xff) * 0.62);
	const g = Math.round(((n >> 8) & 0xff) * 0.62);
	const b = Math.round((n & 0xff) * 0.62);

	return `#${((1 << 24) | (r << 16) | (g << 8) | b).toString(16).slice(1)}`;
};

// A faceted shield/crest-block in a nation's two split colours, clipped
// to a rounded shield. Shared by `qualify-bracket`, `crest-ladder` and
// `debutant-door`. The clip-path id is `uid`-scoped (never random) so it
// can't collide across FlowArtFrames on the same page.
const crestBlock = ({
	h,
	cx,
	cy,
	w,
	kit,
	uid,
	tag
}: {
	h: WcHelpers;
	cx: number;
	cy: number;
	w: number;
	kit: WCKit;
	uid: string;
	tag: string;
}): string => {
	const { p } = h;
	const hw = w / 2;
	const top = cy - w * 0.59;
	const mid = cy + w * 0.18;
	const bot = cy + w * 0.68;
	const path = `M ${cx - hw} ${top} L ${cx + hw} ${top} L ${cx + hw} ${mid} Q ${cx + hw} ${bot} ${cx} ${cy + w * 0.75} Q ${cx - hw} ${bot} ${cx - hw} ${mid} Z`;
	const id = `wccrest-${uid}-${tag}`;
	let s = `<defs><clipPath id="${id}"><path d="${path}"/></clipPath></defs>`;
	s += `<g clip-path="url(#${id})">`;
	s += `<rect x="${cx - hw}" y="${top}" width="${w}" height="${(bot - top).toFixed(1)}" fill="${kit.primary}"/>`;
	s += `<polygon points="${cx - hw},${top} ${cx + hw},${top} ${cx + hw},${bot} Z" fill="${kit.secondary}"/>`;
	s += `</g>`;
	s += `<path d="${path}" fill="none" stroke="${p.fg}" stroke-width="0.8" opacity="0.5"/>`;

	return s;
};

// A goal-frame (posts + crossbar + net mesh). Shared by `ball-in-net`,
// `split-pitch`, `penalty-spot`, `keeper-wall`.
const goalFrame = ({
	h,
	x,
	y,
	w,
	hgt,
	net = true
}: {
	h: WcHelpers;
	x: number;
	y: number;
	w: number;
	hgt: number;
	net?: boolean;
}): string => {
	const { p } = h;
	let s = `<rect x="${x}" y="${y}" width="${w}" height="2.2" fill="${p.fg}" opacity="0.85"/>`;
	s += `<rect x="${x}" y="${y}" width="2.2" height="${hgt}" fill="${p.fg}" opacity="0.85"/>`;
	s += `<rect x="${x + w - 2.2}" y="${y}" width="2.2" height="${hgt}" fill="${p.fg}" opacity="0.85"/>`;

	if (net) {
		for (let i = 1; i < 5; i++) {
			const gx = x + (w / 5) * i;
			s += `<line x1="${gx.toFixed(1)}" y1="${y}" x2="${gx.toFixed(1)}" y2="${y + hgt}" stroke="${p.fg}" stroke-width="0.3" opacity="0.30"/>`;
		}

		for (let i = 1; i < 4; i++) {
			const gy = y + (hgt / 4) * i;
			s += `<line x1="${x}" y1="${gy.toFixed(1)}" x2="${x + w}" y2="${gy.toFixed(1)}" stroke="${p.fg}" stroke-width="0.3" opacity="0.30"/>`;
		}
	}

	return s;
};

// Team-led backdrop for catalogue scenes. `teamA` is the market's featured
// side, so it owns the field; `teamB` only appears as the opponent accent.
const teamFlagBackdrop = ({
	h,
	teamA,
	teamB,
	baseOpacity = 0.38
}: {
	h: WcHelpers;
	teamA: WCKit;
	teamB?: WCKit;
	baseOpacity?: number;
}): string => {
	const { p } = h;
	let s = `<rect width="280" height="100" fill="${p.bg}"/>`;
	s += `<rect x="0" y="0" width="280" height="34" fill="${teamA.primary}" opacity="0.72"/>`;
	s += `<rect x="0" y="34" width="280" height="32" fill="${teamA.secondary}" opacity="0.78"/>`;
	s += `<rect x="0" y="66" width="280" height="34" fill="${teamA.primary}" opacity="0.72"/>`;

	if (teamB) {
		s += `<polygon points="216,0 280,0 280,100 246,100" fill="${teamB.primary}" opacity="0.42"/>`;
		s += `<polygon points="246,0 280,0 280,100 266,100" fill="${teamB.secondary}" opacity="0.5"/>`;
	}

	s += `<rect width="280" height="100" fill="${p.base}" opacity="${baseOpacity}"/>`;

	return s;
};

// A blocky keeper silhouette (arms out), facing the viewer.
const keeperFigure = ({
	h,
	cx,
	cy,
	kit
}: {
	h: WcHelpers;
	cx: number;
	cy: number;
	kit: WCKit;
}): string => {
	// `h` accepted for signature symmetry with the other shared helpers
	// (and forward use); the keeper draws from fixed inks + the kit.
	void h;
	let s = `<polygon points="${cx - 26},${cy} ${cx - 20},${cy - 6} ${cx - 6},${cy + 6} ${cx + 6},${cy + 6} ${cx + 20},${cy - 6} ${cx + 26},${cy} ${cx + 20},${cy + 6} ${cx + 9},${cy + 30} ${cx - 9},${cy + 30} ${cx - 20},${cy + 6} Z" fill="${kit.primary}"/>`;
	s += `<polygon points="${cx},${cy + 6} ${cx + 20},${cy - 6} ${cx + 26},${cy} ${cx + 20},${cy + 6} ${cx + 9},${cy + 30} ${cx},${cy + 30} Z" fill="${shadeDown(kit.primary)}" opacity="0.4"/>`;
	// Gloves at the arm tips.
	s += `<rect x="${cx - 30}" y="${cy - 4}" width="6" height="6" rx="1" fill="${kit.secondary}"/>`;
	s += `<rect x="${cx + 24}" y="${cy - 4}" width="6" height="6" rx="1" fill="${kit.secondary}"/>`;
	// Head.
	s += `<rect x="${cx - 5}" y="${cy - 16}" width="10" height="10" rx="2" fill="#B98968"/>`;
	s += `<rect x="${cx - 5}" y="${cy - 16}" width="10" height="3" fill="#3E2C20"/>`;

	return s;
};

// kit-clash: two angled busts, each in its nation kit, motion lines
// sweeping between them. The figures lean toward each other; a thin
// diagonal split backdrop separates the two colour worlds.
const kitClash = ({
	h,
	g,
	teamA,
	teamB
}: {
	h: WcHelpers;
	g: Rng;
	teamA: WCKit;
	teamB: WCKit;
}): string => {
	const { p } = h;

	let s = teamFlagBackdrop({ h, teamA, teamB, baseOpacity: 0.3 });

	const lineCount = g.int(4, 6);

	for (let i = 0; i < lineCount; i++) {
		const y = 30 + i * (40 / lineCount) + g.range(-2, 2);
		const x1 = 96 + g.range(-6, 4);
		const x2 = 184 + g.range(-4, 6);
		s += `<line x1="${x1.toFixed(1)}" y1="${y.toFixed(1)}" x2="${x2.toFixed(1)}" y2="${(y + g.range(-3, 3)).toFixed(1)}" stroke="${p.fg}" stroke-width="0.6" opacity="0.32"/>`;
	}

	s += `<g transform="rotate(6 92 56)">`;
	s += h.wcFace({
		cx: 92,
		cy: 48,
		skin: g.pick(['umber', 'olive', 'almond', 'sand', 'bronze', 'mahog'] as const),
		hair: g.pick(['jet', 'charcoal', 'brown', 'auburn', 'blonde'] as const),
		hairStyle: g.pick(['short', 'curly', 'cap'] as const),
		shirt: teamA.primary,
		shirtShadow: shadeDown(teamA.primary),
		stripe: teamA.secondary,
		emotion: 'focus'
	});
	s += `</g>`;

	s += `<g transform="rotate(-6 188 56)">`;
	s += h.wcFace({
		cx: 188,
		cy: 48,
		skin: g.pick(['umber', 'olive', 'almond', 'sand', 'bronze', 'mahog'] as const),
		hair: g.pick(['jet', 'charcoal', 'brown', 'auburn', 'blonde'] as const),
		hairStyle: g.pick(['short', 'curly', 'cap'] as const),
		shirt: teamB.primary,
		shirtShadow: shadeDown(teamB.primary),
		stripe: teamB.secondary,
		emotion: 'anticipation'
	});
	s += `</g>`;

	s += h.ballProp({ cx: 140, cy: 78, r: 6 });

	return s;
};

// qualify-bracket: a single nation crest-block advancing through a
// forward bracket arrow (the "open door / forward bracket" brief).
const qualifyBracket = ({
	h,
	g,
	teamA,
	uid
}: {
	h: WcHelpers;
	g: Rng;
	teamA: WCKit;
	uid: string;
}): string => {
	const { p } = h;

	let s = teamFlagBackdrop({ h, teamA, baseOpacity: 0.42 });

	s += `<path d="M 150 16 L 214 50 L 150 84" fill="none" stroke="${p.fg}" stroke-width="1.4" opacity="0.55"/>`;
	s += `<line x1="150" y1="50" x2="214" y2="50" stroke="${p.fg}" stroke-width="1.4" opacity="0.55"/>`;
	s += `<polygon points="214,50 224,46 224,54" fill="${p.fg}" opacity="0.7"/>`;
	s += `<line x1="124" y1="50" x2="150" y2="50" stroke="${p.fg}" stroke-width="0.8" opacity="0.30"/>`;

	const cx = 78;
	const cy = 50;
	s += crestBlock({ h, cx, cy, w: 44, kit: teamA, uid, tag: 'q' });
	const pipY = cy - 10 + g.range(-3, 3);
	s += `<circle cx="${cx}" cy="${pipY.toFixed(1)}" r="3" fill="${p.bg}" opacity="0.55"/>`;

	return s;
};

// ball-in-net: a big ball bulging the net, with a few stacked mini
// balls (the over-goals "3+ / 4+ goals" prop). Two faint kit washes when
// the question pits two sides; energetic motion arcs trail the big ball.
const ballInNet = ({
	h,
	g,
	teamA,
	teamB
}: {
	h: WcHelpers;
	g: Rng;
	teamA: WCKit;
	teamB: WCKit;
}): string => {
	const { p } = h;

	let s = teamFlagBackdrop({ h, teamA, teamB });

	s += goalFrame({ h, x: 150, y: 18, w: 104, hgt: 64 });
	// Net bulge behind the ball.
	s += `<ellipse cx="202" cy="52" rx="22" ry="18" fill="${p.fg}" opacity="0.12"/>`;

	// Big ball + motion arcs trailing from the left.
	for (let i = 0; i < 3; i++) {
		const ox = 150 - i * 18 - g.range(0, 6);
		s += `<path d="M ${ox} 44 Q ${ox + 14} 52 ${ox} 60" fill="none" stroke="${p.fg}" stroke-width="0.7" opacity="${(0.4 - i * 0.1).toFixed(2)}"/>`;
	}

	s += h.ballProp({ cx: 202, cy: 52, r: 11 });

	// Stacked mini-balls bottom-left.
	const mini = g.int(3, 4);

	for (let i = 0; i < mini; i++) {
		s += h.ballProp({ cx: 30 + i * 16, cy: 84, r: 5 });
	}

	return s;
};

// split-pitch: a centre line splitting the pitch, a small rippling
// goal on each side (the "both teams to score" prop). Each half washed
// in its side's kit; a ball nestled in each net.
const splitPitch = ({
	h,
	g,
	teamA,
	teamB
}: {
	h: WcHelpers;
	g: Rng;
	teamA: WCKit;
	teamB: WCKit;
}): string => {
	const { p } = h;

	let s = teamFlagBackdrop({ h, teamA, teamB });
	// Centre line + circle.
	s += `<line x1="140" y1="0" x2="140" y2="100" stroke="${p.fg}" stroke-width="0.8" opacity="0.45"/>`;
	s += `<circle cx="140" cy="50" r="14" fill="none" stroke="${p.fg}" stroke-width="0.6" opacity="0.4"/>`;

	// Mini-goal each side, rippling (a couple of jittered net verticals).
	s += goalFrame({ h, x: 18, y: 28, w: 54, hgt: 44 });
	s += goalFrame({ h, x: 208, y: 28, w: 54, hgt: 44 });
	s += h.ballProp({ cx: 45 + g.range(-2, 2), cy: 56, r: 6 });
	s += h.ballProp({ cx: 235 + g.range(-2, 2), cy: 56, r: 6 });

	return s;
};

// keeper-wall: a blocky keeper in front of a brick wall + a padlock
// glyph, shutout mood (the "clean sheet" prop). Keeper in the featured
// kit; wall + lock in palette ink.
const keeperWall = ({ h, teamA }: { h: WcHelpers; teamA: WCKit }): string => {
	const { p } = h;

	let s = teamFlagBackdrop({ h, teamA, baseOpacity: 0.45 });

	// Brick wall on the right.
	for (let row = 0; row < 6; row++) {
		const y = 14 + row * 12;
		const off = row % 2 === 0 ? 0 : 13;

		for (let col = 0; col < 4; col++) {
			const x = 168 + off + col * 26;

			if (x < 264) {
				s += `<rect x="${x}" y="${y}" width="24" height="10" rx="1" fill="${p.fg}" opacity="0.18"/>`;
				s += `<rect x="${x}" y="${y}" width="24" height="10" rx="1" fill="none" stroke="${p.fg}" stroke-width="0.4" opacity="0.4"/>`;
			}
		}
	}

	// Padlock over the wall.
	s += `<rect x="226" y="44" width="22" height="18" rx="2" fill="${p.fg}" opacity="0.7"/>`;
	s += `<path d="M 230 44 L 230 38 Q 230 32 237 32 Q 244 32 244 38 L 244 44" fill="none" stroke="${p.fg}" stroke-width="2.2" opacity="0.7"/>`;
	s += `<circle cx="237" cy="52" r="2.2" fill="${p.bg}"/>`;

	// Keeper guarding the goal-mouth, left.
	s += keeperFigure({ h, cx: 96, cy: 48, kit: teamA });

	return s;
};

// penalty-spot: a penalty spot + ball + a lone keeper under a single
// spotlight cone (the "penalty awarded / scored" prop).
const penaltySpot = ({ h, teamA, teamB }: { h: WcHelpers; teamA: WCKit; teamB: WCKit }): string => {
	const { p } = h;

	let s = teamFlagBackdrop({ h, teamA, teamB });
	// Spotlight cone from above.
	s += `<polygon points="130,-10 150,-10 210,100 70,100" fill="${WC_SHIRT.cream}" opacity="0.12"/>`;

	// Goal at the back with the keeper.
	s += goalFrame({ h, x: 96, y: 12, w: 88, hgt: 30 });
	s += keeperFigure({ h, cx: 140, cy: 30, kit: teamB });

	// Penalty arc + spot.
	s += `<path d="M 110 78 Q 140 64 170 78" fill="none" stroke="${p.fg}" stroke-width="0.6" opacity="0.45"/>`;
	s += `<circle cx="140" cy="80" r="2" fill="${p.fg}" opacity="0.7"/>`;
	// Ball on the spot, tinted faintly by the taker's kit accent.
	s += h.ballProp({ cx: 140, cy: 72, r: 7 });
	s += `<circle cx="140" cy="72" r="7" fill="${teamA.primary}" opacity="0.12"/>`;

	return s;
};

// podium: a blocky three-step podium with the featured nation's
// flag-block on the top step and a laurel arcing over it (the "win the
// group" standings beat).
const podium = ({ h, teamA, uid }: { h: WcHelpers; teamA: WCKit; uid: string }): string => {
	const { p } = h;

	let s = teamFlagBackdrop({ h, teamA, baseOpacity: 0.45 });

	// Three steps: centre tallest.
	s += `<rect x="92" y="58" width="44" height="42" fill="${p.fg}" opacity="0.2"/>`;
	s += `<rect x="136" y="42" width="48" height="58" fill="${p.fg}" opacity="0.28"/>`;
	s += `<rect x="184" y="66" width="44" height="34" fill="${p.fg}" opacity="0.16"/>`;
	s += `<text x="160" y="74" text-anchor="middle" font-family="ui-monospace,monospace" font-size="9" font-weight="800" fill="${p.bg}" opacity="0.8">1</text>`;

	// Flag-block standing on the top step.
	s += crestBlock({ h, cx: 160, cy: 26, w: 36, kit: teamA, uid, tag: 'p' });

	// Laurel arcing over the crest.
	s += `<path d="M 138 22 Q 160 2 182 22" fill="none" stroke="${WC_SHIRT.gold}" stroke-width="1.4" opacity="0.85"/>`;

	for (let i = 0; i < 6; i++) {
		const t = i / 5;
		const x = 138 + t * 44;
		const y = 22 - Math.sin(t * Math.PI) * 20;
		s += `<ellipse cx="${x.toFixed(1)}" cy="${y.toFixed(1)}" rx="2.4" ry="1.2" fill="${WC_SHIRT.gold}" opacity="0.85" transform="rotate(${(t * 180 - 90).toFixed(0)} ${x.toFixed(1)} ${y.toFixed(1)})"/>`;
	}

	return s;
};

// stopwatch: a big blocky stopwatch reading ~15' with a fast ball-blur
// streaking past (the "goal in first 15 / early goal" prop). The two
// sides' kits split the field + tint the ball-blur lane, so the early
// goal reads in the fixture's national palette; the dial, hand and
// ball-blur stay fixed regardless of the teams.
const stopwatch = ({
	h,
	g,
	teamA,
	teamB
}: {
	h: WcHelpers;
	g: Rng;
	teamA: WCKit;
	teamB: WCKit;
}): string => {
	const { p } = h;

	let s = teamFlagBackdrop({ h, teamA, teamB, baseOpacity: 0.45 });
	// Corner accent blocks in each side's secondary colour.
	s += `<rect x="0" y="0" width="10" height="22" fill="${teamA.secondary}" opacity="0.7"/>`;
	s += `<rect x="270" y="78" width="10" height="22" fill="${teamB.secondary}" opacity="0.7"/>`;

	const cx = 96;
	const cy = 52;
	// Crown + button on top.
	s += `<rect x="${cx - 4}" y="${cy - 36}" width="8" height="6" rx="1" fill="${p.fg}" opacity="0.7"/>`;
	s += `<circle cx="${cx}" cy="${cy}" r="28" fill="${p.bg}" opacity="0.9"/>`;
	s += `<circle cx="${cx}" cy="${cy}" r="28" fill="none" stroke="${p.fg}" stroke-width="2" opacity="0.8"/>`;

	// Tick marks.
	for (let i = 0; i < 12; i++) {
		const a = (i * 30 * Math.PI) / 180;
		const x1 = cx + Math.cos(a) * 23;
		const y1 = cy + Math.sin(a) * 23;
		const x2 = cx + Math.cos(a) * 26;
		const y2 = cy + Math.sin(a) * 26;
		s += `<line x1="${x1.toFixed(1)}" y1="${y1.toFixed(1)}" x2="${x2.toFixed(1)}" y2="${y2.toFixed(1)}" stroke="${p.fg}" stroke-width="0.8" opacity="0.6"/>`;
	}

	// Hand pointing to ~15' (90°, straight up from centre then to the
	// "quarter": pointing right for a clock 15).
	s += `<line x1="${cx}" y1="${cy}" x2="${cx + 16}" y2="${cy}" stroke="${WC_SHIRT.gold}" stroke-width="2" opacity="0.95"/>`;
	s += `<line x1="${cx}" y1="${cy}" x2="${cx}" y2="${cy - 12}" stroke="${p.fg}" stroke-width="1.4" opacity="0.8"/>`;
	s += `<circle cx="${cx}" cy="${cy}" r="2.4" fill="${p.fg}"/>`;

	// Fast ball-blur streaking to the right.
	const by = cy + g.range(-6, 6);

	for (let i = 0; i < 4; i++) {
		s += `<line x1="${168 + i * 8}" y1="${by.toFixed(1)}" x2="${182 + i * 8}" y2="${by.toFixed(1)}" stroke="${p.fg}" stroke-width="0.8" opacity="${(0.5 - i * 0.1).toFixed(2)}"/>`;
	}

	s += h.ballProp({ cx: 224, cy: by, r: 8 });

	return s;
};

// referee-card: a blocky referee arm raising a card, true scarlet
// reserved for the card (the "booking / card shown" prop). The two
// sides' kits wash the field as a diagonal split + corner accent
// blocks, so the card sits in the fixture's national palette; the ref
// bust, raised arm and scarlet card stay fixed regardless of the teams.
const refereeCard = ({
	h,
	g,
	teamA,
	teamB
}: {
	h: WcHelpers;
	g: Rng;
	teamA: WCKit;
	teamB: WCKit;
}): string => {
	let s = teamFlagBackdrop({ h, teamA, teamB, baseOpacity: 0.5 });
	// Corner accent blocks in each side's secondary colour.
	s += `<rect x="0" y="0" width="10" height="22" fill="${teamA.secondary}" opacity="0.7"/>`;
	s += `<rect x="270" y="78" width="10" height="22" fill="${teamB.secondary}" opacity="0.7"/>`;

	// Referee bust (neutral dark kit) on the left. The skin tone is hoisted
	// so the raised hand below carries the referee's own face skin.
	const skin = g.pick(['umber', 'almond', 'sand', 'bronze'] as const);
	s += h.wcFace({
		cx: 96,
		cy: 52,
		skin,
		hair: g.pick(['jet', 'charcoal', 'brown'] as const),
		hairStyle: 'short',
		shirt: WC_SHIRT.ref,
		shirtShadow: '#161616',
		emotion: 'focus'
	});

	// Raised arm: a blocky forearm angling up to the card; the hand block
	// matches the referee's face skin.
	s += `<polygon points="120,72 132,70 176,30 168,24 124,62 116,66" fill="${WC_SHIRT.ref}"/>`;
	s += `<rect x="118" y="60" width="8" height="8" rx="1" fill="${WC_SKIN[skin].base}"/>`;

	// The card: true scarlet, slight rotation.
	s += h.redCardProp({ cx: 188, cy: 28, rot: 14 });

	return s;
};

// stadium-clock: a big rectangular stadium scoreboard clock reading
// 45' with a single ball below (the "first-half goal / HT" beats).
const stadiumClock = ({
	h,
	teamA,
	teamB
}: {
	h: WcHelpers;
	teamA: WCKit;
	teamB: WCKit;
}): string => {
	const { p } = h;

	let s = teamFlagBackdrop({ h, teamA, teamB, baseOpacity: 0.45 });

	// Scoreboard panel.
	s += `<rect x="68" y="18" width="144" height="40" rx="3" fill="${p.ink}" opacity="0.92"/>`;
	s += `<rect x="68" y="18" width="144" height="40" rx="3" fill="none" stroke="${p.fg}" stroke-width="0.6" opacity="0.5"/>`;
	// Two side colour pips for the two teams.
	s += `<rect x="74" y="24" width="8" height="28" fill="${teamA.primary}"/>`;
	s += `<rect x="198" y="24" width="8" height="28" fill="${teamB.primary}"/>`;
	// "45'" readout.
	s += `<text x="140" y="46" text-anchor="middle" font-family="ui-monospace,monospace" font-size="20" font-weight="800" fill="${WC_SHIRT.gold}">45'</text>`;
	// Support post.
	s += `<rect x="136" y="58" width="8" height="14" fill="${p.fg}" opacity="0.4"/>`;

	// Single ball below.
	s += h.ballProp({ cx: 140, cy: 84, r: 8 });

	return s;
};

// striker-juggle: a blocky striker mid-strike, juggling two balls (the
// "brace / multi-goal player" prop). Single bust in the scoring side's
// kit (teamA primary), the opponent (teamB) supplying a secondary accent
// (a wash band on the far side + a tint on the trailing ball), so the
// fixture reads as a two-side contest rather than one neutral kit.
const strikerJuggle = ({
	h,
	g,
	teamA,
	teamB
}: {
	h: WcHelpers;
	g: Rng;
	teamA: WCKit;
	teamB: WCKit;
}): string => {
	const { p } = h;

	let s = teamFlagBackdrop({ h, teamA, teamB, baseOpacity: 0.32 });

	s += `<g transform="rotate(-4 132 56)">`;
	s += h.wcFace({
		cx: 132,
		cy: 48,
		skin: g.pick(['umber', 'olive', 'almond', 'sand', 'bronze', 'mahog'] as const),
		hair: g.pick(['jet', 'charcoal', 'brown', 'auburn'] as const),
		hairStyle: g.pick(['short', 'curly'] as const),
		shirt: teamA.primary,
		shirtShadow: shadeDown(teamA.primary),
		stripe: teamA.secondary,
		emotion: 'joy'
	});
	s += `</g>`;

	// Two balls arcing above, with motion arcs.
	s += `<path d="M 196 70 Q 210 30 224 70" fill="none" stroke="${p.fg}" stroke-width="0.6" opacity="0.4"/>`;
	s += h.ballProp({ cx: 200, cy: 30 + g.range(-3, 3), r: 7 });
	const trailY = 56 + g.range(-3, 3);
	s += h.ballProp({ cx: 222, cy: trailY, r: 6 });
	// Faint opponent tint on the trailing ball.
	s += `<circle cx="222" cy="${trailY.toFixed(1)}" r="6" fill="${teamB.primary}" opacity="0.16"/>`;

	return s;
};

// player-figure: a single blocky bust in the featured nation's kit,
// with an optional accent (a ball for goal beats, a card glyph for card
// beats, a pass-arrow for assist). Drives the Player goal / card /
// assist markets.
const playerFigure = ({ h, g, teamA }: { h: WcHelpers; g: Rng; teamA: WCKit }): string => {
	const { p } = h;

	let s = teamFlagBackdrop({ h, teamA });

	s += h.wcFace({
		cx: 118,
		cy: 48,
		skin: g.pick(['umber', 'olive', 'almond', 'sand', 'bronze', 'mahog'] as const),
		hair: g.pick(['jet', 'charcoal', 'brown', 'auburn', 'blonde'] as const),
		hairStyle: g.pick(['short', 'curly', 'cap'] as const),
		shirt: teamA.primary,
		shirtShadow: shadeDown(teamA.primary),
		stripe: teamA.secondary,
		emotion: 'joy'
	});

	// A ball off to the right, low: the celebratory accent.
	s += h.ballProp({ cx: 222, cy: 64, r: 7 });
	// A short arrow nodding to a team-mate (reads as goal/assist motion).
	s += `<path d="M 196 36 L 226 30" fill="none" stroke="${p.fg}" stroke-width="1" opacity="0.5"/>`;
	s += `<polygon points="226,30 219,28 220,33" fill="${p.fg}" opacity="0.6"/>`;

	return s;
};

// A raised booking card in amber/yellow: the disciplinary counterpart of
// the shared scarlet `redCardProp`. The card colour is fixed (booking
// amber, `WC_SHIRT.gold`) like referee-card's scarlet; only the player
// figure beside it carries the team palette.
const amberCardProp = ({ cx, cy, rot = 12 }: { cx: number; cy: number; rot?: number }): string =>
	`<g transform="rotate(${rot} ${cx} ${cy})">` +
	`<rect x="${cx - 7}" y="${cy - 10}" width="14" height="20" fill="${WC_SHIRT.gold}"/>` +
	`<rect x="${cx - 7}" y="${cy - 10}" width="14" height="20" fill="none" stroke="#0E0D0B" stroke-width="0.4" opacity="0.5"/>` +
	`</g>`;

// player-card: a single blocky bust in the featured nation's kit beside a
// raised amber booking card (the Player "be booked / shown a card" prop).
// Figure + field wash use the team palette exactly as `player-figure`
// does; the card stays fixed booking-amber regardless of the team. A
// blocky forearm angles up to the card, echoing referee-card's raised arm.
const playerCard = ({ h, g, teamA }: { h: WcHelpers; g: Rng; teamA: WCKit }): string => {
	let s = teamFlagBackdrop({ h, teamA });
	// Corner accent block in the kit's secondary colour.
	s += `<rect x="0" y="0" width="10" height="22" fill="${teamA.secondary}" opacity="0.7"/>`;

	const skin = g.pick(['umber', 'olive', 'almond', 'sand', 'bronze', 'mahog'] as const);
	s += h.wcFace({
		cx: 96,
		cy: 52,
		skin,
		hair: g.pick(['jet', 'charcoal', 'brown', 'auburn', 'blonde'] as const),
		hairStyle: g.pick(['short', 'curly', 'cap'] as const),
		shirt: teamA.primary,
		shirtShadow: shadeDown(teamA.primary),
		stripe: teamA.secondary,
		emotion: 'focus'
	});

	// Raised forearm in the kit colour angling up toward the card; the
	// hand block carries the player's own face skin tone.
	s += `<polygon points="120,72 132,70 176,30 168,24 124,62 116,66" fill="${teamA.primary}"/>`;
	s += `<rect x="118" y="60" width="8" height="8" rx="1" fill="${WC_SKIN[skin].base}"/>`;

	// The booking card: fixed amber, raised beside/above the player.
	s += amberCardProp({ cx: 188, cy: 28, rot: 14 });

	return s;
};

// player-assist: a single blocky playmaker bust in the featured nation's
// kit threading a pass: an arrow sweeps from the playmaker to a small
// team-mate marker node on the right (the Player "register an assist"
// prop). National palette throughout, exactly as `player-figure`.
const playerAssist = ({ h, g, teamA }: { h: WcHelpers; g: Rng; teamA: WCKit }): string => {
	const { p } = h;

	let s = teamFlagBackdrop({ h, teamA });
	// Corner accent block in the kit's secondary colour.
	s += `<rect x="0" y="0" width="10" height="22" fill="${teamA.secondary}" opacity="0.7"/>`;

	const skin = g.pick(['umber', 'olive', 'almond', 'sand', 'bronze', 'mahog'] as const);
	s += h.wcFace({
		cx: 96,
		cy: 52,
		skin,
		hair: g.pick(['jet', 'charcoal', 'brown', 'auburn', 'blonde'] as const),
		hairStyle: g.pick(['short', 'curly', 'cap'] as const),
		shirt: teamA.primary,
		shirtShadow: shadeDown(teamA.primary),
		stripe: teamA.secondary,
		emotion: 'focus'
	});

	// Small team-mate marker node on the right, in the team palette; the
	// marker head shares the playmaker's skin tone (same-tone teammates).
	const mateY = 40 + g.range(-4, 4);
	s += `<circle cx="236" cy="${mateY.toFixed(1)}" r="8" fill="${teamA.primary}"/>`;
	s += `<circle cx="236" cy="${mateY.toFixed(1)}" r="8" fill="none" stroke="${p.fg}" stroke-width="0.6" opacity="0.55"/>`;
	s += `<circle cx="236" cy="${(mateY - 11).toFixed(1)}" r="3.4" fill="${WC_SKIN[skin].base}"/>`;

	// Threaded pass: a curved arrow sweeping from the playmaker to the
	// team-mate, arrowhead landing at the marker's near edge.
	const arc = `M 138 58 Q 188 ${(mateY + 24).toFixed(1)} 224 ${(mateY + 4).toFixed(1)}`;
	s += `<path d="${arc}" fill="none" stroke="${p.fg}" stroke-width="1.4" opacity="0.6" stroke-linecap="round"/>`;
	s += `<polygon points="224,${(mateY + 4).toFixed(1)} 217,${(mateY + 1).toFixed(1)} 219,${(mateY + 9).toFixed(1)}" fill="${p.fg}" opacity="0.7"/>`;
	// The ball at the playmaker's feet, where the pass originates.
	s += h.ballProp({ cx: 134, cy: 62, r: 6 });

	return s;
};

// crest-ladder: two crest-blocks on a stepped ladder, the favoured one
// a rung higher (the head-to-head "finish above" beat). teamA is the
// favoured (higher) side.
const crestLadder = ({
	h,
	teamA,
	teamB,
	uid
}: {
	h: WcHelpers;
	teamA: WCKit;
	teamB: WCKit;
	uid: string;
}): string => {
	const { p } = h;

	let s = teamFlagBackdrop({ h, teamA, teamB, baseOpacity: 0.45 });

	// Ladder rails + rungs.
	s += `<line x1="96" y1="14" x2="96" y2="92" stroke="${p.fg}" stroke-width="1" opacity="0.4"/>`;
	s += `<line x1="184" y1="14" x2="184" y2="92" stroke="${p.fg}" stroke-width="1" opacity="0.4"/>`;

	for (let i = 0; i < 5; i++) {
		const y = 22 + i * 16;
		s += `<line x1="96" y1="${y}" x2="184" y2="${y}" stroke="${p.fg}" stroke-width="0.8" opacity="0.35"/>`;
	}

	// Favoured crest a rung higher (left, up); other lower (right, down).
	s += crestBlock({ h, cx: 96, cy: 34, w: 32, kit: teamA, uid, tag: 'la' });
	s += crestBlock({ h, cx: 184, cy: 62, w: 32, kit: teamB, uid, tag: 'lb' });

	return s;
};

// host-flags: three blocky flags (Mexico / USA / Canada) raised
// together on a podium, the tri-host special.
const hostFlags = ({ h }: { h: WcHelpers }): string => {
	const { p } = h;

	let s = `<rect width="280" height="100" fill="${p.bg}"/>`;
	s += `<rect width="280" height="100" fill="${p.base}" opacity="0.45"/>`;
	// Podium ground.
	s += `<rect x="40" y="80" width="200" height="20" fill="${p.fg}" opacity="0.2"/>`;

	HOST_FLAGS.forEach((flag, i) => {
		const x = 64 + i * 64;
		// Pole.
		s += `<rect x="${x - 1}" y="24" width="2" height="56" fill="${p.fg}" opacity="0.5"/>`;
		// Two-band flag.
		s += `<rect x="${x}" y="24" width="40" height="13" fill="${flag.a}"/>`;
		s += `<rect x="${x}" y="37" width="40" height="13" fill="${flag.b}"/>`;
		s += `<rect x="${x}" y="24" width="40" height="26" fill="none" stroke="${p.fg}" stroke-width="0.4" opacity="0.4"/>`;
	});

	return s;
};

// debutant-door: a fresh crest-block stepping through a doorway, a
// bright newcomer palette on ink (the "debutant reaches R32" special).
const debutantDoor = ({ h, uid }: { h: WcHelpers; uid: string }): string => {
	const { p } = h;

	let s = `<rect width="280" height="100" fill="${p.bg}"/>`;
	s += `<rect width="280" height="100" fill="${p.base}" opacity="0.5"/>`;

	// Doorway: a lit rectangular frame, glow inside.
	s += `<rect x="150" y="20" width="70" height="76" rx="2" fill="${WC_SHIRT.gold}" opacity="0.14"/>`;
	s += `<rect x="150" y="20" width="70" height="76" rx="2" fill="none" stroke="${p.fg}" stroke-width="1.4" opacity="0.55"/>`;
	s += `<line x1="185" y1="20" x2="185" y2="96" stroke="${p.fg}" stroke-width="0.5" opacity="0.3"/>`;

	// Fresh crest stepping through (bright newcomer palette).
	s += crestBlock({
		h,
		cx: 110,
		cy: 52,
		w: 44,
		kit: { primary: WC_SHIRT.gold, secondary: WC_SHIRT.cream },
		uid,
		tag: 'd'
	});

	return s;
};

// draw-balls: a blocky hand drawing numbered balls from a bowl, tense
// neutral ink/parchment (the "decided by drawing of lots" fun special).
const drawBalls = ({ h, g }: { h: WcHelpers; g: Rng }): string => {
	const { p } = h;

	let s = `<rect width="280" height="100" fill="${p.bg}"/>`;
	s += `<rect width="280" height="100" fill="${p.base}" opacity="0.5"/>`;

	// Bowl.
	s += `<path d="M 96 58 Q 140 96 184 58 Z" fill="${p.fg}" opacity="0.2"/>`;
	s += `<path d="M 96 58 Q 140 96 184 58" fill="none" stroke="${p.fg}" stroke-width="1.2" opacity="0.55"/>`;
	s += `<ellipse cx="140" cy="58" rx="44" ry="8" fill="none" stroke="${p.fg}" stroke-width="1" opacity="0.5"/>`;

	// Numbered balls in the bowl.
	for (let i = 0; i < 4; i++) {
		const bx = 116 + i * 16;
		const by = 60 + g.range(-2, 4);
		s += `<circle cx="${bx}" cy="${by.toFixed(1)}" r="6" fill="${WC_SHIRT.cream}"/>`;
		s += `<circle cx="${bx}" cy="${by.toFixed(1)}" r="6" fill="none" stroke="${p.ink}" stroke-width="0.5"/>`;
		s += `<text x="${bx}" y="${(by + 2.4).toFixed(1)}" text-anchor="middle" font-family="ui-monospace,monospace" font-size="5" font-weight="800" fill="${p.ink}">${i + 1}</text>`;
	}

	// A blocky hand reaching in from the top-right, holding one ball.
	s += `<polygon points="206,18 224,22 220,40 200,38" fill="#B98968"/>`;
	s += `<circle cx="206" cy="44" r="7" fill="${WC_SHIRT.gold}"/>`;
	s += `<text x="206" y="46.6" text-anchor="middle" font-family="ui-monospace,monospace" font-size="6" font-weight="800" fill="${p.ink}">7</text>`;

	return s;
};

// wildcard-icon: a blocky icon (a star inside a ringed field) on a
// flag-colour field within a Vici ink/parchment frame. The catch-all
// "captures the question" fun beat.
const wildcardIcon = ({ h }: { h: WcHelpers }): string => {
	const { p } = h;

	let s = `<rect width="280" height="100" fill="${p.bg}"/>`;
	// Tri-host flag-colour field behind the frame.
	s += `<rect x="0" y="0" width="93" height="100" fill="${HOST_FLAGS[0].a}" opacity="0.3"/>`;
	s += `<rect x="93" y="0" width="94" height="100" fill="${HOST_FLAGS[1].a}" opacity="0.3"/>`;
	s += `<rect x="187" y="0" width="93" height="100" fill="${HOST_FLAGS[2].a}" opacity="0.3"/>`;
	s += `<rect width="280" height="100" fill="${p.base}" opacity="0.35"/>`;

	// Ink/parchment frame.
	s += `<rect x="20" y="14" width="240" height="72" rx="3" fill="none" stroke="${p.fg}" stroke-width="1.4" opacity="0.55"/>`;

	// Ringed star icon in the centre.
	s += `<circle cx="140" cy="50" r="24" fill="none" stroke="${WC_SHIRT.gold}" stroke-width="2" opacity="0.85"/>`;
	const pts: string[] = [];

	for (let i = 0; i < 10; i++) {
		const a = (-90 + i * 36) * (Math.PI / 180);
		const rr = i % 2 === 0 ? 16 : 7;
		pts.push(`${(140 + Math.cos(a) * rr).toFixed(1)},${(50 + Math.sin(a) * rr).toFixed(1)}`);
	}

	s += `<polygon points="${pts.join(' ')}" fill="${WC_SHIRT.gold}" opacity="0.9"/>`;

	return s;
};

/**
 * Render a resolved WC template into an SVG body fragment (no document
 * wrapper). `g` is a per-market seeded `Rng`; the caller seeds it off
 * the raw market id so the scene is stable per market. `teamA` / `teamB`
 * are the resolved kit colours (when the market parsed a nation);
 * templates that need a kit but have none fall back to `WC_KIT_NEUTRAL`
 * so they still render a full composition.
 */
export const renderWcTemplate = ({
	template,
	h,
	g,
	uid
}: {
	template: WcResolvedTemplate;
	h: WcHelpers;
	g: Rng;
	/** Per-render unique id used to scope SVG `defs` ids so they can't collide
	 *  across FlowArtFrames on the same page. */
	uid: string;
}): string => {
	const a = template.teamA ?? WC_KIT_NEUTRAL;
	const b = template.teamB ?? WC_KIT_NEUTRAL;

	switch (template.templateId) {
		case 'kit-clash':
			return kitClash({ h, g, teamA: a, teamB: b });
		case 'qualify-bracket':
			return qualifyBracket({ h, g, teamA: a, uid });
		case 'ball-in-net':
			return ballInNet({ h, g, teamA: a, teamB: b });
		case 'split-pitch':
			return splitPitch({ h, g, teamA: a, teamB: b });
		case 'keeper-wall':
			return keeperWall({ h, teamA: a });
		case 'penalty-spot':
			return penaltySpot({ h, teamA: a, teamB: b });
		case 'podium':
			return podium({ h, teamA: a, uid });
		case 'stopwatch':
			return stopwatch({ h, g, teamA: a, teamB: b });
		case 'referee-card':
			return refereeCard({ h, g, teamA: a, teamB: b });
		case 'stadium-clock':
			return stadiumClock({ h, teamA: a, teamB: b });
		case 'striker-juggle':
			return strikerJuggle({ h, g, teamA: a, teamB: b });
		case 'player-figure':
			return playerFigure({ h, g, teamA: a });
		case 'player-card':
			return playerCard({ h, g, teamA: a });
		case 'player-assist':
			return playerAssist({ h, g, teamA: a });
		case 'crest-ladder':
			return crestLadder({ h, teamA: a, teamB: b, uid });
		case 'host-flags':
			return hostFlags({ h });
		case 'debutant-door':
			return debutantDoor({ h, uid });
		case 'draw-balls':
			return drawBalls({ h, g });
		case 'wildcard-icon':
			return wildcardIcon({ h });
		default:
			// Unreachable: the switch is exhaustive over `WcTemplateId`.
			// An empty string lets the caller fall through to its generic
			// fallback rather than crash.
			return '';
	}
};
