import { WC_SHIRT } from '#lib/constants/flow-art-wc.constants.ts';
import type { WcHelpers } from '#lib/utils/flow-art/wc/helpers.ts';

// === RECIPES (curated compositions) =====================
// Each key is a WC market id → a fully deterministic scene
// (backdrop + figure + optional prop), ported 1:1 from the
// prototype's hand-authored table so every tentpole / prop /
// advancement market renders its own composition rather than the
// generic fallback. The figure's `emotion` drives its expression.
// (The prototype's caption pill is a no-op there and is omitted.)
// Helpers arrive via the `h` bundle so each scene closes over the
// per-render palette + uid.
//
// `Partial<…>` so a lookup on an unlisted market id is typed `… |
// undefined` (only a curated subset of ids is present), matching the
// runtime miss the resolver handles before falling through to the
// nation tier / generative fallback.
export const WC_RECIPES: Partial<Record<string, (h: WcHelpers) => string>> = {
	// ─── CLASSIC ─────────────────────────────────────────────
	'wc-winner-brazil': (h) =>
		h.bgFlagDiag({ c1: '#FFD800', c2: '#0F8C3A', c3: '#0033A0' }) +
		h.wcFace({
			cx: 140,
			cy: 44,
			skin: 'umber',
			hair: 'jet',
			hairStyle: 'short',
			shirt: WC_SHIRT.brazil,
			shirtShadow: '#C4A300',
			emotion: 'joy'
		}) +
		h.trophyIcon({ cx: 220, cy: 56, scale: 0.9 }),

	'wc-winner-spain': (h) =>
		h.bgFlagHoriz({ c1: '#C8102E', c2: '#F1BF00', c3: '#C8102E' }) +
		h.wcFace({
			cx: 140,
			cy: 44,
			skin: 'almond',
			hair: 'brown',
			hairStyle: 'short',
			shirt: WC_SHIRT.spain,
			shirtShadow: '#8A0E20',
			emotion: 'focus'
		}),

	'wc-winner-france': (h) =>
		h.bgFlagVert({ c1: '#0055A4', c2: '#F2ECDC', c3: '#EF4135' }) +
		h.wcFace({
			cx: 140,
			cy: 44,
			skin: 'sand',
			hair: 'auburn',
			hairStyle: 'short',
			shirt: WC_SHIRT.france,
			shirtShadow: '#003A78',
			emotion: 'focus'
		}),

	'wc-winner-argentina': (h) =>
		h.bgFlagHoriz({ c1: '#75AADB', c2: '#F2ECDC', c3: '#75AADB' }) +
		h.wcFace({
			cx: 140,
			cy: 44,
			skin: 'olive',
			hair: 'brown',
			hairStyle: 'curly',
			shirt: WC_SHIRT.arg,
			shirtShadow: '#5189B8',
			emotion: 'anticipation'
		}),

	'wc-golden-boot': (h) =>
		h.bgCircle({ color: WC_SHIRT.gold, cx: 200, cy: 50, r: 55 }) +
		h.wcFace({
			cx: 110,
			cy: 44,
			skin: 'mahog',
			hair: 'jet',
			hairStyle: 'short',
			shirt: WC_SHIRT.dark,
			shirtShadow: '#100B07',
			emotion: 'focus'
		}) +
		h.goldenBoot({ cx: 220, cy: 60, scale: 1.0 }),

	'wc-usa-quarter': (h) => {
		// Stars-and-stripes hosted variant — bg striped + canton + bracket dot
		let m = '';
		m += `<rect width="280" height="100" fill="${h.p.base}"/>`;

		for (let i = 0; i < 7; i++) {
			m += `<rect x="0" y="${i * 14.3}" width="280" height="${14.3 * 0.5}" fill="${i % 2 ? '#C8102E' : '#F2ECDC'}" opacity="0.78"/>`;
		}

		m += `<rect x="0" y="0" width="120" height="50" fill="#0A3161" opacity="0.95"/>`;

		// tiny stars
		for (let r = 0; r < 5; r++) {
			for (let c = 0; c < 9; c++) {
				m += `<circle cx="${10 + c * 12}" cy="${6 + r * 9}" r="0.9" fill="#F2ECDC" opacity="0.85"/>`;
			}
		}

		return (
			m +
			h.wcFace({
				cx: 190,
				cy: 50,
				skin: 'bronze',
				hair: 'brown',
				hairStyle: 'cap',
				shirt: WC_SHIRT.usaW,
				shirtShadow: '#B0A480',
				stripe: '#C8102E',
				emotion: 'joy'
			})
		);
	},

	'wc-over-3-final': (h) =>
		h.bgPerspective(WC_SHIRT.cream) +
		h.wcFace({
			cx: 80,
			cy: 50,
			skin: 'olive',
			hair: 'gray',
			hairStyle: 'short',
			shirt: WC_SHIRT.jersey,
			shirtShadow: '#1F3A1A',
			emotion: 'dread'
		}) +
		h.ballProp({ cx: 180, cy: 56, r: 7 }) +
		h.ballProp({ cx: 212, cy: 38, r: 5 }) +
		h.ballProp({ cx: 234, cy: 64, r: 5 }) +
		h.ballProp({ cx: 258, cy: 50, r: 4 }),

	'wc-german-out-group': (h) =>
		h.bgFlagHoriz({ c1: '#000000', c2: '#DD0000', c3: '#FFCE00' }) +
		h.wcFace({
			cx: 140,
			cy: 44,
			skin: 'sand',
			hair: 'blonde',
			hairStyle: 'short',
			shirt: WC_SHIRT.dark,
			shirtShadow: '#100B07',
			emotion: 'defeat'
		}),

	// ─── PLAYFUL ─────────────────────────────────────────────
	'wc-neymar-dive': (h) =>
		h.bgSpotlight({ c1: WC_SHIRT.gold, c2: WC_SHIRT.cream }) +
		h.wcFace({
			cx: 140,
			cy: 50,
			skin: 'almond',
			hair: 'brown',
			hairStyle: 'mohawk',
			shirt: WC_SHIRT.brazil,
			shirtShadow: '#C4A300',
			emotion: 'playful'
		}),

	'wc-player-haircut': (h) =>
		h.bgCircle({ color: WC_SHIRT.gold, cx: 70, cy: 50, r: 50 }) +
		h.wcFace({
			cx: 160,
			cy: 44,
			skin: 'umber',
			hair: 'jet',
			hairStyle: 'mohawk',
			shirt: WC_SHIRT.dark,
			shirtShadow: '#100B07',
			emotion: 'playful'
		}) +
		h.scissorsProp({ cx: 220, cy: 50 }),

	'wc-trophy-drop': (h) =>
		h.bgPerspective(WC_SHIRT.cream) +
		h.wcFace({
			cx: 110,
			cy: 46,
			skin: 'bronze',
			hair: 'auburn',
			hairStyle: 'short',
			shirt: WC_SHIRT.cream,
			shirtShadow: '#B0A480',
			emotion: 'dread'
		}) +
		(() => {
			// falling rotated trophy + bounce dots
			let m = `<g transform="rotate(28 200 56)">`;
			m += h.trophyIcon({ cx: 200, cy: 56, scale: 0.75 });
			m += `</g>`;

			for (let i = 0; i < 5; i++) {
				const a = -140 + i * 18;
				const r = 18;
				const x = 200 + Math.cos((a * Math.PI) / 180) * r;
				const y = 84 + Math.sin((a * Math.PI) / 180) * r;
				m += `<circle cx="${x.toFixed(2)}" cy="${y.toFixed(2)}" r="0.8" fill="${WC_SHIRT.gold}" opacity="0.85"/>`;
			}

			return m;
		})(),

	'wc-coach-stands': (h) =>
		h.bgStands('#7E7A75') +
		h.wcFace({
			cx: 110,
			cy: 50,
			skin: 'sand',
			hair: 'gray',
			hairStyle: 'short',
			shirt: WC_SHIRT.suit,
			shirtShadow: '#0E1626',
			emotion: 'defeat'
		}) +
		h.redCardProp({ cx: 170, cy: 36, rot: -16 }),

	'wc-pitch-propose': (h) =>
		h.bgPropose(WC_SHIRT.gold) +
		h.wcFace({
			cx: 110,
			cy: 50,
			skin: 'almond',
			hair: 'brown',
			hairStyle: 'curly',
			shirt: WC_SHIRT.france,
			shirtShadow: '#003A78',
			emotion: 'joy'
		}) +
		h.ringProp({ cx: 210, cy: 52 }),

	'wc-var-final': (h) =>
		h.bgTV(WC_SHIRT.gold) +
		h.wcFace({
			cx: 60,
			cy: 50,
			skin: 'mahog',
			hair: 'charcoal',
			hairStyle: 'short',
			shirt: WC_SHIRT.ref,
			shirtShadow: '#0E0D0B',
			emotion: 'focus'
		}),

	'wc-celebration': (h) =>
		h.bgCircle({ color: WC_SHIRT.gold, cx: 70, cy: 50, r: 50 }) +
		h.wcFace({
			cx: 150,
			cy: 46,
			skin: 'umber',
			hair: 'jet',
			hairStyle: 'short',
			shirt: WC_SHIRT.dark,
			shirtShadow: '#100B07',
			emotion: 'joy'
		}) +
		h.goldenBoot({ cx: 214, cy: 58, scale: 0.9 }),

	// ─── BETA V1.4 MARQUEE (hand-authored for the 50-card expansion) ───
	// Host opener — Mexican tricolor, jubilant home figure, ball at feet.
	'wc-host-mex-opener': (h) =>
		h.bgFlagVert({ c1: '#006847', c2: '#F2ECDC', c3: '#CE1126' }) +
		h.wcFace({
			cx: 140,
			cy: 46,
			skin: 'bronze',
			hair: 'jet',
			hairStyle: 'short',
			shirt: '#006847',
			shirtShadow: '#00432E',
			emotion: 'joy'
		}) +
		h.ballProp({ cx: 222, cy: 62, r: 6 }),

	// USA on home soil — stars-and-stripes canton, focused host figure.
	'wc-usa-r16': (h) => {
		let m = `<rect width="280" height="100" fill="${h.p.base}"/>`;

		for (let i = 0; i < 7; i++) {
			m += `<rect x="0" y="${i * 14.3}" width="280" height="${14.3 * 0.5}" fill="${i % 2 ? '#C8102E' : '#F2ECDC'}" opacity="0.78"/>`;
		}

		m += `<rect x="0" y="0" width="120" height="50" fill="#0A3161" opacity="0.95"/>`;

		for (let r = 0; r < 5; r++) {
			for (let c = 0; c < 9; c++) {
				m += `<circle cx="${10 + c * 12}" cy="${6 + r * 9}" r="0.9" fill="#F2ECDC" opacity="0.85"/>`;
			}
		}

		return (
			m +
			h.wcFace({
				cx: 190,
				cy: 50,
				skin: 'bronze',
				hair: 'brown',
				hairStyle: 'cap',
				shirt: WC_SHIRT.usaW,
				shirtShadow: '#B0A480',
				stripe: '#C8102E',
				emotion: 'focus'
			})
		);
	},

	// Germany redemption — black/red/gold bands, determined figure.
	'wc-germany-advance': (h) =>
		h.bgFlagHoriz({ c1: '#000000', c2: '#DD0000', c3: '#FFCE00' }) +
		h.wcFace({
			cx: 140,
			cy: 44,
			skin: 'sand',
			hair: 'blonde',
			hairStyle: 'short',
			shirt: '#F2ECDC',
			shirtShadow: '#C2BBA8',
			emotion: 'focus'
		}),

	// Portugal talisman — green/red vertical, anticipation, ball ready.
	'wc-portugal-goal-grp': (h) =>
		h.bgFlagVert({ c1: '#046A38', c2: '#046A38', c3: '#DA291C' }) +
		h.wcFace({
			cx: 140,
			cy: 44,
			skin: 'almond',
			hair: 'jet',
			hairStyle: 'short',
			shirt: '#A4123F',
			shirtShadow: '#6E0C2A',
			emotion: 'anticipation'
		}) +
		h.ballProp({ cx: 224, cy: 60, r: 6 }),

	// France QF — tricolore, composed figure, ball.
	'wc-france-qf': (h) =>
		h.bgFlagVert({ c1: '#0055A4', c2: '#F2ECDC', c3: '#EF4135' }) +
		h.wcFace({
			cx: 140,
			cy: 44,
			skin: 'sand',
			hair: 'auburn',
			hairStyle: 'short',
			shirt: WC_SHIRT.france,
			shirtShadow: '#003A78',
			emotion: 'focus'
		}) +
		h.ballProp({ cx: 232, cy: 62, r: 6 }),

	// Brazil QF — diagonal canary/green/blue, joyful figure.
	'wc-brazil-qf': (h) =>
		h.bgFlagDiag({ c1: '#FFD800', c2: '#0F8C3A', c3: '#0033A0' }) +
		h.wcFace({
			cx: 140,
			cy: 44,
			skin: 'umber',
			hair: 'jet',
			hairStyle: 'short',
			shirt: WC_SHIRT.brazil,
			shirtShadow: '#C4A300',
			emotion: 'anticipation'
		}) +
		h.ballProp({ cx: 230, cy: 64, r: 6 }),

	// Argentina QF — sky-blue/white bands, hopeful figure.
	'wc-argentina-qf': (h) =>
		h.bgFlagHoriz({ c1: '#75AADB', c2: '#F2ECDC', c3: '#75AADB' }) +
		h.wcFace({
			cx: 140,
			cy: 44,
			skin: 'olive',
			hair: 'brown',
			hairStyle: 'curly',
			shirt: WC_SHIRT.arg,
			shirtShadow: '#5189B8',
			emotion: 'anticipation'
		}) +
		h.ballProp({ cx: 232, cy: 62, r: 6 }),

	// Host in the final — golden spotlight, trophy looming, lone host figure.
	'wc-host-in-final': (h) =>
		h.bgSpotlight({ c1: WC_SHIRT.gold, c2: WC_SHIRT.cream }) +
		h.wcFace({
			cx: 96,
			cy: 50,
			skin: 'bronze',
			hair: 'brown',
			hairStyle: 'short',
			shirt: WC_SHIRT.usaW,
			shirtShadow: '#B0A480',
			stripe: '#C8102E',
			emotion: 'anticipation'
		}) +
		h.trophyIcon({ cx: 208, cy: 52, scale: 0.95 }),

	// Final on penalties — broadcast TV frame, ball on the spot, ref focus.
	'wc-final-penalties': (h) =>
		h.bgTV(WC_SHIRT.gold) +
		h.wcFace({
			cx: 64,
			cy: 50,
			skin: 'mahog',
			hair: 'charcoal',
			hairStyle: 'short',
			shirt: WC_SHIRT.ref,
			shirtShadow: '#0E0D0B',
			emotion: 'dread'
		}) +
		h.ballProp({ cx: 206, cy: 70, r: 6 }),

	// First-time champion — bunting + trophy raised, pure joy.
	'wc-first-time-winner': (h) =>
		h.bgBunting({ c1: WC_SHIRT.gold, c2: '#FF6B6B', c3: '#6FE0B6' }) +
		h.wcFace({
			cx: 120,
			cy: 48,
			skin: 'almond',
			hair: 'brown',
			hairStyle: 'short',
			shirt: WC_SHIRT.dark,
			shirtShadow: '#100B07',
			emotion: 'joy'
		}) +
		h.trophyIcon({ cx: 208, cy: 52, scale: 1.0 }),

	// ─── BETA V1.4 EXPANSION II (50 new pre-tournament + prop cards) ───
	'wc-ball-viral': (h) =>
		h.bgFlagVert({ c1: '#046A38', c2: '#046A38', c3: '#DA291C' }) +
		h.wcFace({
			cx: 140,
			cy: 44,
			skin: 'sand',
			hair: 'jet',
			hairStyle: 'short',
			shirt: '#A4123F',
			shirtShadow: '#6E0C2A',
			emotion: 'focus'
		}),
	'wc-captain-change': (h) =>
		h.bgFlagHoriz({ c1: '#75AADB', c2: '#F2ECDC', c3: '#75AADB' }) +
		h.wcFace({
			cx: 140,
			cy: 46,
			skin: 'olive',
			hair: 'brown',
			hairStyle: 'short',
			shirt: WC_SHIRT.arg,
			shirtShadow: '#5189B8',
			stripe: WC_SHIRT.gold,
			emotion: 'anticipation'
		}),
	'wc-squad-snub': (h) =>
		h.bgFlagHoriz({ c1: '#000000', c2: '#DD0000', c3: '#FFCE00' }) +
		h.wcFace({
			cx: 140,
			cy: 46,
			skin: 'sand',
			hair: 'blonde',
			hairStyle: 'short',
			shirt: '#F2ECDC',
			shirtShadow: '#C2BBA8',
			emotion: 'defeat'
		}),
	'wc-friendly-brazil': (h) =>
		h.bgFlagDiag({ c1: '#FFD800', c2: '#0F8C3A', c3: '#0033A0' }) +
		h.wcFace({
			cx: 140,
			cy: 46,
			skin: 'umber',
			hair: 'jet',
			hairStyle: 'short',
			shirt: WC_SHIRT.brazil,
			shirtShadow: '#C4A300',
			emotion: 'focus'
		}) +
		h.ballProp({ cx: 228, cy: 62, r: 6 }),
	'wc-friendly-england': (h) =>
		h.bgFlagHoriz({ c1: '#F2ECDC', c2: '#C8102E', c3: '#F2ECDC' }) +
		h.wcFace({
			cx: 140,
			cy: 46,
			skin: 'sand',
			hair: 'brown',
			hairStyle: 'short',
			shirt: '#F2ECDC',
			shirtShadow: '#C2BBA8',
			emotion: 'focus'
		}) +
		h.ballProp({ cx: 228, cy: 62, r: 6 }),
	'wc-friendly-sweep': (h) =>
		h.bgBunting({ c1: WC_SHIRT.gold, c2: '#0F8C3A', c3: '#75AADB' }) +
		h.wcFace({
			cx: 120,
			cy: 48,
			skin: 'almond',
			hair: 'brown',
			hairStyle: 'short',
			shirt: WC_SHIRT.dark,
			shirtShadow: '#100B07',
			emotion: 'anticipation'
		}) +
		h.trophyIcon({ cx: 210, cy: 54, scale: 0.85 }),
	'wc-kit-sellout': (h) =>
		h.bgCircle({ color: WC_SHIRT.gold, cx: 196, cy: 50, r: 52 }) +
		h.wcFace({
			cx: 124,
			cy: 46,
			skin: 'bronze',
			hair: 'jet',
			hairStyle: 'short',
			shirt: WC_SHIRT.brazil,
			shirtShadow: '#C4A300',
			emotion: 'joy'
		}),
	'wc-injury-return': (h) =>
		h.bgFlagHoriz({ c1: '#C8102E', c2: '#F1BF00', c3: '#C8102E' }) +
		h.wcFace({
			cx: 140,
			cy: 44,
			skin: 'almond',
			hair: 'jet',
			hairStyle: 'short',
			shirt: WC_SHIRT.spain,
			shirtShadow: '#8A0E20',
			emotion: 'anticipation'
		}) +
		h.ballProp({ cx: 232, cy: 62, r: 6 }),
	'wc-anthem-star': (h) =>
		h.bgSpotlight({ c1: WC_SHIRT.gold, c2: WC_SHIRT.cream }) +
		h.wcFace({
			cx: 140,
			cy: 50,
			skin: 'almond',
			hair: 'jet',
			hairStyle: 'mohawk',
			shirt: WC_SHIRT.dark,
			shirtShadow: '#100B07',
			emotion: 'joy'
		}),
	'wc-ceremony-record': (h) =>
		h.bgBunting({ c1: WC_SHIRT.gold, c2: '#FF6B6B', c3: '#6FE0B6' }) +
		h.wcFace({
			cx: 140,
			cy: 46,
			skin: 'almond',
			hair: 'brown',
			hairStyle: 'short',
			shirt: WC_SHIRT.cream,
			shirtShadow: '#B0A480',
			emotion: 'joy'
		}),
	'wc-lineup-teen': (h) =>
		h.bgFlagHoriz({ c1: '#F2ECDC', c2: '#C8102E', c3: '#F2ECDC' }) +
		h.wcFace({
			cx: 140,
			cy: 48,
			skin: 'sand',
			hair: 'brown',
			hairStyle: 'short',
			shirt: '#F2ECDC',
			shirtShadow: '#C2BBA8',
			emotion: 'anticipation'
		}) +
		h.ballProp({ cx: 232, cy: 62, r: 6 }),
	'wc-late-drama-grp': (h) =>
		h.bgStands('#E2B842') +
		h.wcFace({
			cx: 140,
			cy: 46,
			skin: 'umber',
			hair: 'jet',
			hairStyle: 'short',
			shirt: WC_SHIRT.brazil,
			shirtShadow: '#C4A300',
			emotion: 'joy'
		}) +
		h.ballProp({ cx: 228, cy: 60, r: 6 }),
	'wc-opening-sellout': (h) =>
		h.bgStands('#E2B842') +
		h.wcFace({
			cx: 140,
			cy: 46,
			skin: 'bronze',
			hair: 'brown',
			hairStyle: 'cap',
			shirt: WC_SHIRT.usaW,
			shirtShadow: '#B0A480',
			stripe: '#C8102E',
			emotion: 'joy'
		}),
	'wc-top-team-lose-open': (h) =>
		h.bgPerspective(WC_SHIRT.cream) +
		h.wcFace({
			cx: 140,
			cy: 46,
			skin: 'almond',
			hair: 'brown',
			hairStyle: 'short',
			shirt: WC_SHIRT.spain,
			shirtShadow: '#8A0E20',
			emotion: 'defeat'
		}),
	'wc-comeback-grp': (h) =>
		h.bgPerspective(WC_SHIRT.cream) +
		h.wcFace({
			cx: 140,
			cy: 46,
			skin: 'olive',
			hair: 'brown',
			hairStyle: 'curly',
			shirt: WC_SHIRT.arg,
			shirtShadow: '#5189B8',
			emotion: 'joy'
		}) +
		h.ballProp({ cx: 228, cy: 60, r: 6 }),
	'wc-messi-goal': (h) =>
		h.bgFlagHoriz({ c1: '#75AADB', c2: '#F2ECDC', c3: '#75AADB' }) +
		h.wcFace({
			cx: 140,
			cy: 44,
			skin: 'sand',
			hair: 'brown',
			hairStyle: 'short',
			shirt: WC_SHIRT.arg,
			shirtShadow: '#5189B8',
			emotion: 'joy'
		}) +
		h.ballProp({ cx: 230, cy: 62, r: 6 }),
	'wc-penalty-miss-grp': (h) =>
		h.bgPerspective(WC_SHIRT.cream) +
		h.wcFace({
			cx: 120,
			cy: 48,
			skin: 'almond',
			hair: 'brown',
			hairStyle: 'short',
			shirt: WC_SHIRT.dark,
			shirtShadow: '#100B07',
			emotion: 'dread'
		}) +
		h.ballProp({ cx: 206, cy: 70, r: 7 }),
	'wc-five-goal-game': (h) =>
		h.bgPerspective(WC_SHIRT.cream) +
		h.wcFace({
			cx: 78,
			cy: 50,
			skin: 'olive',
			hair: 'gray',
			hairStyle: 'short',
			shirt: WC_SHIRT.jersey,
			shirtShadow: '#1F3A1A',
			emotion: 'joy'
		}) +
		h.ballProp({ cx: 176, cy: 54, r: 7 }) +
		h.ballProp({ cx: 210, cy: 38, r: 5 }) +
		h.ballProp({ cx: 236, cy: 64, r: 5 }) +
		h.ballProp({ cx: 258, cy: 48, r: 4 }),
	'wc-veteran-goal': (h) =>
		h.bgCircle({ color: WC_SHIRT.gold, cx: 198, cy: 50, r: 50 }) +
		h.wcFace({
			cx: 122,
			cy: 46,
			skin: 'sand',
			hair: 'gray',
			hairStyle: 'short',
			shirt: WC_SHIRT.dark,
			shirtShadow: '#100B07',
			emotion: 'joy'
		}),
	'wc-own-goal-grp': (h) =>
		h.bgPerspective(WC_SHIRT.cream) +
		h.wcFace({
			cx: 120,
			cy: 48,
			skin: 'bronze',
			hair: 'brown',
			hairStyle: 'short',
			shirt: WC_SHIRT.jersey,
			shirtShadow: '#1F3A1A',
			emotion: 'dread'
		}) +
		h.ballProp({ cx: 206, cy: 68, r: 6 }),
	'wc-brazil-group-perfect': (h) =>
		h.bgFlagDiag({ c1: '#FFD800', c2: '#0F8C3A', c3: '#0033A0' }) +
		h.wcFace({
			cx: 140,
			cy: 44,
			skin: 'umber',
			hair: 'jet',
			hairStyle: 'short',
			shirt: WC_SHIRT.brazil,
			shirtShadow: '#C4A300',
			emotion: 'joy'
		}) +
		h.ballProp({ cx: 230, cy: 62, r: 6 }),
	'wc-clean-sheet-keeper': (h) =>
		h.bgStands('#7E7A75') +
		h.wcFace({
			cx: 140,
			cy: 46,
			skin: 'sand',
			hair: 'brown',
			hairStyle: 'short',
			shirt: WC_SHIRT.jersey,
			shirtShadow: '#1F3A1A',
			emotion: 'focus'
		}),
	'wc-portugal-r16': (h) =>
		h.bgFlagVert({ c1: '#046A38', c2: '#046A38', c3: '#DA291C' }) +
		h.wcFace({
			cx: 140,
			cy: 44,
			skin: 'almond',
			hair: 'jet',
			hairStyle: 'short',
			shirt: '#A4123F',
			shirtShadow: '#6E0C2A',
			emotion: 'anticipation'
		}) +
		h.ballProp({ cx: 228, cy: 60, r: 6 }),
	'wc-netherlands-r16': (h) =>
		h.bgFlagHoriz({ c1: '#AE1C28', c2: '#F2ECDC', c3: '#21468B' }) +
		h.wcFace({
			cx: 140,
			cy: 44,
			skin: 'sand',
			hair: 'blonde',
			hairStyle: 'short',
			shirt: '#EA6F1E',
			shirtShadow: '#B5530F',
			emotion: 'focus'
		}),
	'wc-r32-host-exit': (h) =>
		h.bgStands('#7E7A75') +
		h.wcFace({
			cx: 140,
			cy: 46,
			skin: 'bronze',
			hair: 'brown',
			hairStyle: 'cap',
			shirt: WC_SHIRT.usaW,
			shirtShadow: '#B0A480',
			stripe: '#C8102E',
			emotion: 'defeat'
		}),
	'wc-r32-extra-time': (h) =>
		h.bgStands('#E2B842') +
		h.wcFace({
			cx: 140,
			cy: 46,
			skin: 'almond',
			hair: 'brown',
			hairStyle: 'short',
			shirt: WC_SHIRT.dark,
			shirtShadow: '#100B07',
			emotion: 'anticipation'
		}),
	'wc-netherlands-qf': (h) =>
		h.bgFlagHoriz({ c1: '#AE1C28', c2: '#F2ECDC', c3: '#21468B' }) +
		h.wcFace({
			cx: 140,
			cy: 44,
			skin: 'sand',
			hair: 'blonde',
			hairStyle: 'short',
			shirt: '#EA6F1E',
			shirtShadow: '#B5530F',
			emotion: 'anticipation'
		}) +
		h.ballProp({ cx: 230, cy: 62, r: 6 }),
	'wc-germany-qf': (h) =>
		h.bgFlagHoriz({ c1: '#000000', c2: '#DD0000', c3: '#FFCE00' }) +
		h.wcFace({
			cx: 140,
			cy: 44,
			skin: 'sand',
			hair: 'blonde',
			hairStyle: 'short',
			shirt: '#F2ECDC',
			shirtShadow: '#C2BBA8',
			emotion: 'focus'
		}) +
		h.ballProp({ cx: 230, cy: 62, r: 6 }),
	'wc-r16-red-card': (h) =>
		h.bgStands('#7E7A75') +
		h.wcFace({
			cx: 120,
			cy: 50,
			skin: 'almond',
			hair: 'charcoal',
			hairStyle: 'short',
			shirt: WC_SHIRT.ref,
			shirtShadow: '#0E0D0B',
			emotion: 'defeat'
		}) +
		h.redCardProp({ cx: 186, cy: 38, rot: -14 }),
	'wc-r16-penalty-shootout': (h) =>
		h.bgPerspective(WC_SHIRT.cream) +
		h.wcFace({
			cx: 120,
			cy: 48,
			skin: 'mahog',
			hair: 'jet',
			hairStyle: 'short',
			shirt: WC_SHIRT.jersey,
			shirtShadow: '#1F3A1A',
			emotion: 'dread'
		}) +
		h.ballProp({ cx: 206, cy: 70, r: 7 }),
	'wc-africa-qf': (h) =>
		h.bgFlagHoriz({ c1: '#1F8A5B', c2: '#F2ECDC', c3: '#D4A017' }) +
		h.wcFace({
			cx: 140,
			cy: 44,
			skin: 'mahog',
			hair: 'jet',
			hairStyle: 'short',
			shirt: '#1F8A5B',
			shirtShadow: '#145F3E',
			emotion: 'joy'
		}) +
		h.ballProp({ cx: 230, cy: 62, r: 6 }),
	'wc-asia-qf': (h) =>
		h.bgFlagHoriz({ c1: '#C8102E', c2: '#F2ECDC', c3: '#C8102E' }) +
		h.wcFace({
			cx: 140,
			cy: 44,
			skin: 'almond',
			hair: 'jet',
			hairStyle: 'short',
			shirt: '#C8102E',
			shirtShadow: '#8A0E20',
			emotion: 'anticipation'
		}) +
		h.ballProp({ cx: 230, cy: 62, r: 6 }),
	'wc-qf-late-winner': (h) =>
		h.bgStands('#E2B842') +
		h.wcFace({
			cx: 140,
			cy: 46,
			skin: 'umber',
			hair: 'jet',
			hairStyle: 'short',
			shirt: WC_SHIRT.brazil,
			shirtShadow: '#C4A300',
			emotion: 'joy'
		}) +
		h.ballProp({ cx: 228, cy: 60, r: 6 }),
	'wc-qf-goalless-90': (h) =>
		h.bgPerspective(WC_SHIRT.cream) +
		h.wcFace({
			cx: 140,
			cy: 46,
			skin: 'sand',
			hair: 'brown',
			hairStyle: 'short',
			shirt: WC_SHIRT.dark,
			shirtShadow: '#100B07',
			emotion: 'focus'
		}),
	'wc-keeper-double-save': (h) =>
		h.bgPerspective(WC_SHIRT.cream) +
		h.wcFace({
			cx: 120,
			cy: 48,
			skin: 'sand',
			hair: 'brown',
			hairStyle: 'short',
			shirt: WC_SHIRT.jersey,
			shirtShadow: '#1F3A1A',
			emotion: 'joy'
		}) +
		h.ballProp({ cx: 206, cy: 70, r: 7 }),
	'wc-europe-three-sf': (h) =>
		h.bgFlagHoriz({ c1: '#0055A4', c2: '#F2ECDC', c3: '#C8102E' }) +
		h.wcFace({
			cx: 120,
			cy: 48,
			skin: 'sand',
			hair: 'brown',
			hairStyle: 'short',
			shirt: WC_SHIRT.france,
			shirtShadow: '#003A78',
			emotion: 'focus'
		}) +
		h.trophyIcon({ cx: 212, cy: 54, scale: 0.8 }),
	'wc-sf-comeback': (h) =>
		h.bgSpotlight({ c1: WC_SHIRT.gold, c2: WC_SHIRT.cream }) +
		h.wcFace({
			cx: 140,
			cy: 46,
			skin: 'olive',
			hair: 'brown',
			hairStyle: 'curly',
			shirt: WC_SHIRT.arg,
			shirtShadow: '#5189B8',
			emotion: 'joy'
		}) +
		h.ballProp({ cx: 228, cy: 62, r: 6 }),
	'wc-final-rematch': (h) =>
		h.bgTV(WC_SHIRT.gold) +
		h.wcFace({
			cx: 64,
			cy: 50,
			skin: 'almond',
			hair: 'brown',
			hairStyle: 'short',
			shirt: WC_SHIRT.dark,
			shirtShadow: '#100B07',
			emotion: 'anticipation'
		}),
	'wc-final-red-card': (h) =>
		h.bgStands('#7E7A75') +
		h.wcFace({
			cx: 120,
			cy: 50,
			skin: 'almond',
			hair: 'charcoal',
			hairStyle: 'short',
			shirt: WC_SHIRT.ref,
			shirtShadow: '#0E0D0B',
			emotion: 'defeat'
		}) +
		h.redCardProp({ cx: 188, cy: 36, rot: -16 }),
	'wc-final-extra-time': (h) =>
		h.bgSpotlight({ c1: WC_SHIRT.gold, c2: WC_SHIRT.cream }) +
		h.wcFace({
			cx: 120,
			cy: 48,
			skin: 'almond',
			hair: 'brown',
			hairStyle: 'short',
			shirt: WC_SHIRT.dark,
			shirtShadow: '#100B07',
			emotion: 'dread'
		}) +
		h.ballProp({ cx: 208, cy: 68, r: 6 }),
	'wc-final-sub-scores': (h) =>
		h.bgBunting({ c1: WC_SHIRT.gold, c2: '#FF6B6B', c3: '#6FE0B6' }) +
		h.wcFace({
			cx: 140,
			cy: 46,
			skin: 'almond',
			hair: 'brown',
			hairStyle: 'short',
			shirt: WC_SHIRT.brazil,
			shirtShadow: '#C4A300',
			emotion: 'joy'
		}) +
		h.ballProp({ cx: 228, cy: 62, r: 6 }),
	'wc-final-captain-30': (h) =>
		h.bgSpotlight({ c1: WC_SHIRT.gold, c2: WC_SHIRT.cream }) +
		h.wcFace({
			cx: 120,
			cy: 48,
			skin: 'bronze',
			hair: 'gray',
			hairStyle: 'short',
			shirt: WC_SHIRT.dark,
			shirtShadow: '#100B07',
			emotion: 'joy'
		}) +
		h.trophyIcon({ cx: 210, cy: 52, scale: 0.95 }),
	'wc-final-attendance': (h) =>
		h.bgStands('#E2B842') +
		h.wcFace({
			cx: 140,
			cy: 46,
			skin: 'bronze',
			hair: 'brown',
			hairStyle: 'short',
			shirt: WC_SHIRT.cream,
			shirtShadow: '#B0A480',
			emotion: 'joy'
		}),
	'wc-golden-glove-eur': (h) =>
		h.bgCircle({ color: WC_SHIRT.gold, cx: 198, cy: 50, r: 50 }) +
		h.wcFace({
			cx: 122,
			cy: 46,
			skin: 'sand',
			hair: 'brown',
			hairStyle: 'short',
			shirt: WC_SHIRT.jersey,
			shirtShadow: '#1F3A1A',
			emotion: 'focus'
		}),
	'wc-topscorer-host': (h) =>
		h.bgCircle({ color: WC_SHIRT.gold, cx: 70, cy: 50, r: 50 }) +
		h.wcFace({
			cx: 150,
			cy: 46,
			skin: 'bronze',
			hair: 'brown',
			hairStyle: 'cap',
			shirt: WC_SHIRT.usaW,
			shirtShadow: '#B0A480',
			stripe: '#C8102E',
			emotion: 'focus'
		}) +
		h.goldenBoot({ cx: 214, cy: 58, scale: 0.95 }),
	'wc-cards-record': (h) =>
		h.bgStands('#7E7A75') +
		h.wcFace({
			cx: 120,
			cy: 50,
			skin: 'almond',
			hair: 'charcoal',
			hairStyle: 'short',
			shirt: WC_SHIRT.ref,
			shirtShadow: '#0E0D0B',
			emotion: 'defeat'
		}) +
		h.redCardProp({ cx: 180, cy: 38, rot: -12 }) +
		h.redCardProp({ cx: 206, cy: 40, rot: 12 }),
	'wc-goals-record': (h) =>
		h.bgPerspective(WC_SHIRT.cream) +
		h.wcFace({
			cx: 78,
			cy: 50,
			skin: 'umber',
			hair: 'jet',
			hairStyle: 'short',
			shirt: WC_SHIRT.brazil,
			shirtShadow: '#C4A300',
			emotion: 'joy'
		}) +
		h.ballProp({ cx: 176, cy: 54, r: 7 }) +
		h.ballProp({ cx: 212, cy: 40, r: 5 }) +
		h.ballProp({ cx: 240, cy: 64, r: 5 }),
	'wc-five-shootouts': (h) =>
		h.bgPerspective(WC_SHIRT.cream) +
		h.wcFace({
			cx: 120,
			cy: 48,
			skin: 'mahog',
			hair: 'jet',
			hairStyle: 'short',
			shirt: WC_SHIRT.jersey,
			shirtShadow: '#1F3A1A',
			emotion: 'dread'
		}) +
		h.ballProp({ cx: 206, cy: 70, r: 7 }),
	'wc-manager-former-winner': (h) =>
		h.bgStands('#7E7A75') +
		h.wcFace({
			cx: 110,
			cy: 50,
			skin: 'sand',
			hair: 'gray',
			hairStyle: 'short',
			shirt: WC_SHIRT.suit,
			shirtShadow: '#0E1626',
			emotion: 'anticipation'
		}) +
		h.trophyIcon({ cx: 206, cy: 52, scale: 0.85 }),
	'wc-final-most-watched': (h) =>
		h.bgTV(WC_SHIRT.gold) +
		h.wcFace({
			cx: 64,
			cy: 50,
			skin: 'almond',
			hair: 'brown',
			hairStyle: 'short',
			shirt: WC_SHIRT.dark,
			shirtShadow: '#100B07',
			emotion: 'joy'
		}),

	// ── Expansion: bespoke recipes replacing the generic-pitch fallback ──
	'wc-fast-squads': (h) =>
		h.bgStands('#7E7A75') +
		h.wcFace({
			cx: 140,
			cy: 46,
			skin: 'sand',
			hair: 'brown',
			hairStyle: 'short',
			shirt: WC_SHIRT.suit,
			shirtShadow: '#0E1626',
			emotion: 'focus'
		}),
	'wc-fast-friendly': (h) =>
		h.bgFlagHoriz({ c1: '#C8102E', c2: '#F2ECDC', c3: '#0A3161' }) +
		h.wcFace({
			cx: 140,
			cy: 46,
			skin: 'bronze',
			hair: 'brown',
			hairStyle: 'cap',
			shirt: WC_SHIRT.usaW,
			shirtShadow: '#B0A480',
			stripe: '#C8102E',
			emotion: 'focus'
		}) +
		h.ballProp({ cx: 232, cy: 62, r: 6 }),
	'wc-fast-injury': (h) =>
		h.bgFlagVert({ c1: '#0055A4', c2: '#F2ECDC', c3: '#EF4135' }) +
		h.wcFace({
			cx: 140,
			cy: 44,
			skin: 'sand',
			hair: 'auburn',
			hairStyle: 'short',
			shirt: WC_SHIRT.france,
			shirtShadow: '#003A78',
			emotion: 'focus'
		}) +
		h.ballProp({ cx: 232, cy: 62, r: 6 }),
	'wc-fast-kit': (h) =>
		h.bgFlagDiag({ c1: '#FFD800', c2: '#0F8C3A', c3: '#0033A0' }) +
		h.wcFace({
			cx: 140,
			cy: 46,
			skin: 'almond',
			hair: 'brown',
			hairStyle: 'curly',
			shirt: WC_SHIRT.brazil,
			shirtShadow: '#C4A300',
			emotion: 'anticipation'
		}),
	'wc-opener-early-goal': (h) =>
		h.bgFlagVert({ c1: '#006847', c2: '#F2ECDC', c3: '#CE1126' }) +
		h.wcFace({
			cx: 140,
			cy: 46,
			skin: 'bronze',
			hair: 'jet',
			hairStyle: 'short',
			shirt: '#006847',
			shirtShadow: '#00432E',
			emotion: 'anticipation'
		}) +
		h.ballProp({ cx: 228, cy: 60, r: 6 }),
	'wc-canada-md1': (h) =>
		h.bgFlagVert({ c1: '#FF0000', c2: '#F2ECDC', c3: '#FF0000' }) +
		h.wcFace({
			cx: 140,
			cy: 46,
			skin: 'sand',
			hair: 'brown',
			hairStyle: 'short',
			shirt: '#D80621',
			shirtShadow: '#8A0010',
			emotion: 'focus'
		}) +
		h.ballProp({ cx: 232, cy: 62, r: 6 }),
	'wc-usa-md1': (h) =>
		h.bgFlagHoriz({ c1: '#C8102E', c2: '#F2ECDC', c3: '#0A3161' }) +
		h.wcFace({
			cx: 140,
			cy: 46,
			skin: 'bronze',
			hair: 'brown',
			hairStyle: 'cap',
			shirt: WC_SHIRT.usaW,
			shirtShadow: '#B0A480',
			stripe: '#C8102E',
			emotion: 'focus'
		}) +
		h.ballProp({ cx: 232, cy: 62, r: 6 }),
	'wc-brazil-clean-md1': (h) =>
		h.bgFlagDiag({ c1: '#FFD800', c2: '#0F8C3A', c3: '#0033A0' }) +
		h.wcFace({
			cx: 140,
			cy: 44,
			skin: 'umber',
			hair: 'jet',
			hairStyle: 'short',
			shirt: WC_SHIRT.brazil,
			shirtShadow: '#C4A300',
			emotion: 'focus'
		}) +
		h.ballProp({ cx: 230, cy: 62, r: 6 }),
	'wc-england-md1': (h) =>
		h.bgFlagHoriz({ c1: '#F2ECDC', c2: '#C8102E', c3: '#F2ECDC' }) +
		h.wcFace({
			cx: 140,
			cy: 46,
			skin: 'sand',
			hair: 'brown',
			hairStyle: 'short',
			shirt: '#F2ECDC',
			shirtShadow: '#C2BBA8',
			emotion: 'focus'
		}) +
		h.ballProp({ cx: 232, cy: 62, r: 6 }),
	'wc-md1-redcard': (h) =>
		h.bgStands('#7E7A75') +
		h.wcFace({
			cx: 120,
			cy: 50,
			skin: 'almond',
			hair: 'charcoal',
			hairStyle: 'short',
			shirt: WC_SHIRT.ref,
			shirtShadow: '#0E0D0B',
			emotion: 'defeat'
		}) +
		h.redCardProp({ cx: 186, cy: 38, rot: -15 }),
	'wc-md1-hattrick': (h) =>
		h.bgPerspective(WC_SHIRT.cream) +
		h.wcFace({
			cx: 78,
			cy: 50,
			skin: 'umber',
			hair: 'jet',
			hairStyle: 'short',
			shirt: WC_SHIRT.jersey,
			shirtShadow: '#1F3A1A',
			emotion: 'joy'
		}) +
		h.ballProp({ cx: 176, cy: 54, r: 7 }) +
		h.ballProp({ cx: 212, cy: 40, r: 5 }) +
		h.ballProp({ cx: 240, cy: 64, r: 5 }),
	'wc-debutant-upset': (h) =>
		h.bgPerspective(WC_SHIRT.cream) +
		h.wcFace({
			cx: 140,
			cy: 46,
			skin: 'mahog',
			hair: 'jet',
			hairStyle: 'short',
			shirt: WC_SHIRT.dark,
			shirtShadow: '#100B07',
			emotion: 'joy'
		}) +
		h.ballProp({ cx: 228, cy: 60, r: 6 }),
	'wc-argentina-2wins': (h) =>
		h.bgFlagHoriz({ c1: '#75AADB', c2: '#F2ECDC', c3: '#75AADB' }) +
		h.wcFace({
			cx: 140,
			cy: 44,
			skin: 'olive',
			hair: 'brown',
			hairStyle: 'curly',
			shirt: WC_SHIRT.arg,
			shirtShadow: '#5189B8',
			emotion: 'anticipation'
		}) +
		h.ballProp({ cx: 232, cy: 62, r: 6 }),
	'wc-france-top-group': (h) =>
		h.bgFlagVert({ c1: '#0055A4', c2: '#F2ECDC', c3: '#EF4135' }) +
		h.wcFace({
			cx: 140,
			cy: 44,
			skin: 'sand',
			hair: 'auburn',
			hairStyle: 'short',
			shirt: WC_SHIRT.france,
			shirtShadow: '#003A78',
			emotion: 'focus'
		}) +
		h.ballProp({ cx: 232, cy: 62, r: 6 }),
	'wc-spain-9pts': (h) =>
		h.bgFlagHoriz({ c1: '#C8102E', c2: '#F1BF00', c3: '#C8102E' }) +
		h.wcFace({
			cx: 140,
			cy: 44,
			skin: 'almond',
			hair: 'brown',
			hairStyle: 'short',
			shirt: WC_SHIRT.spain,
			shirtShadow: '#8A0E20',
			emotion: 'focus'
		}) +
		h.ballProp({ cx: 232, cy: 62, r: 6 }),
	'wc-group-0-0': (h) =>
		h.bgPerspective(WC_SHIRT.cream) +
		h.wcFace({
			cx: 140,
			cy: 46,
			skin: 'sand',
			hair: 'brown',
			hairStyle: 'short',
			shirt: WC_SHIRT.dark,
			shirtShadow: '#100B07',
			emotion: 'dread'
		}),
	'wc-late-qualify-goal': (h) =>
		h.bgStands('#E2B842') +
		h.wcFace({
			cx: 140,
			cy: 46,
			skin: 'almond',
			hair: 'brown',
			hairStyle: 'short',
			shirt: WC_SHIRT.jersey,
			shirtShadow: '#1F3A1A',
			emotion: 'joy'
		}) +
		h.ballProp({ cx: 228, cy: 60, r: 6 }),
	'wc-hosts-all-advance': (h) =>
		h.bgFlagHoriz({ c1: '#C8102E', c2: '#F2ECDC', c3: '#0A3161' }) +
		h.wcFace({
			cx: 140,
			cy: 46,
			skin: 'bronze',
			hair: 'brown',
			hairStyle: 'cap',
			shirt: WC_SHIRT.usaW,
			shirtShadow: '#B0A480',
			stripe: '#C8102E',
			emotion: 'joy'
		}),
	'wc-africa-2-advance': (h) =>
		h.bgFlagHoriz({ c1: '#1F8A5B', c2: '#F2ECDC', c3: '#D4A017' }) +
		h.wcFace({
			cx: 140,
			cy: 44,
			skin: 'mahog',
			hair: 'jet',
			hairStyle: 'short',
			shirt: '#1F8A5B',
			shirtShadow: '#145F3E',
			emotion: 'joy'
		}) +
		h.ballProp({ cx: 232, cy: 62, r: 6 }),
	'wc-asia-knockouts': (h) =>
		h.bgFlagHoriz({ c1: '#C8102E', c2: '#F2ECDC', c3: '#C8102E' }) +
		h.wcFace({
			cx: 140,
			cy: 44,
			skin: 'almond',
			hair: 'jet',
			hairStyle: 'short',
			shirt: '#C8102E',
			shirtShadow: '#8A0E20',
			emotion: 'anticipation'
		}) +
		h.ballProp({ cx: 232, cy: 62, r: 6 }),
	'wc-debutant-knockout': (h) =>
		h.bgPerspective(WC_SHIRT.cream) +
		h.wcFace({
			cx: 140,
			cy: 46,
			skin: 'bronze',
			hair: 'jet',
			hairStyle: 'short',
			shirt: WC_SHIRT.dark,
			shirtShadow: '#100B07',
			emotion: 'joy'
		}) +
		h.ballProp({ cx: 228, cy: 60, r: 6 }),
	'wc-group-goals-avg': (h) =>
		h.bgPerspective(WC_SHIRT.cream) +
		h.wcFace({
			cx: 78,
			cy: 50,
			skin: 'olive',
			hair: 'gray',
			hairStyle: 'short',
			shirt: WC_SHIRT.jersey,
			shirtShadow: '#1F3A1A',
			emotion: 'joy'
		}) +
		h.ballProp({ cx: 176, cy: 54, r: 7 }) +
		h.ballProp({ cx: 214, cy: 42, r: 5 }) +
		h.ballProp({ cx: 242, cy: 64, r: 5 }),
	'wc-r32-penalties': (h) =>
		h.bgPerspective(WC_SHIRT.cream) +
		h.wcFace({
			cx: 120,
			cy: 48,
			skin: 'mahog',
			hair: 'jet',
			hairStyle: 'short',
			shirt: WC_SHIRT.jersey,
			shirtShadow: '#1F3A1A',
			emotion: 'dread'
		}) +
		h.ballProp({ cx: 206, cy: 70, r: 7 }),
	'wc-mexico-r16': (h) =>
		h.bgFlagVert({ c1: '#006847', c2: '#F2ECDC', c3: '#CE1126' }) +
		h.wcFace({
			cx: 140,
			cy: 46,
			skin: 'bronze',
			hair: 'jet',
			hairStyle: 'short',
			shirt: '#006847',
			shirtShadow: '#00432E',
			emotion: 'anticipation'
		}) +
		h.ballProp({ cx: 228, cy: 60, r: 6 }),
	'wc-favorite-out-r32': (h) =>
		h.bgPerspective(WC_SHIRT.cream) +
		h.wcFace({
			cx: 140,
			cy: 46,
			skin: 'almond',
			hair: 'brown',
			hairStyle: 'short',
			shirt: WC_SHIRT.spain,
			shirtShadow: '#8A0E20',
			emotion: 'defeat'
		}),
	'wc-r32-comeback': (h) =>
		h.bgPerspective(WC_SHIRT.cream) +
		h.wcFace({
			cx: 140,
			cy: 46,
			skin: 'olive',
			hair: 'brown',
			hairStyle: 'curly',
			shirt: WC_SHIRT.arg,
			shirtShadow: '#5189B8',
			emotion: 'joy'
		}) +
		h.ballProp({ cx: 228, cy: 60, r: 6 }),
	'wc-spain-qf': (h) =>
		h.bgFlagHoriz({ c1: '#C8102E', c2: '#F1BF00', c3: '#C8102E' }) +
		h.wcFace({
			cx: 140,
			cy: 44,
			skin: 'almond',
			hair: 'brown',
			hairStyle: 'short',
			shirt: WC_SHIRT.spain,
			shirtShadow: '#8A0E20',
			emotion: 'anticipation'
		}) +
		h.ballProp({ cx: 232, cy: 62, r: 6 }),
	'wc-england-qf': (h) =>
		h.bgFlagHoriz({ c1: '#F2ECDC', c2: '#C8102E', c3: '#F2ECDC' }) +
		h.wcFace({
			cx: 140,
			cy: 46,
			skin: 'sand',
			hair: 'brown',
			hairStyle: 'short',
			shirt: '#F2ECDC',
			shirtShadow: '#C2BBA8',
			emotion: 'anticipation'
		}) +
		h.ballProp({ cx: 232, cy: 62, r: 6 }),
	'wc-host-in-qf': (h) =>
		h.bgFlagHoriz({ c1: '#C8102E', c2: '#F2ECDC', c3: '#0A3161' }) +
		h.wcFace({
			cx: 140,
			cy: 46,
			skin: 'bronze',
			hair: 'brown',
			hairStyle: 'cap',
			shirt: WC_SHIRT.usaW,
			shirtShadow: '#B0A480',
			stripe: '#C8102E',
			emotion: 'anticipation'
		}),
	'wc-r16-extra-time': (h) =>
		h.bgStands('#E2B842') +
		h.wcFace({
			cx: 140,
			cy: 46,
			skin: 'almond',
			hair: 'brown',
			hairStyle: 'short',
			shirt: WC_SHIRT.dark,
			shirtShadow: '#100B07',
			emotion: 'anticipation'
		}),
	'wc-qf-shootout': (h) =>
		h.bgPerspective(WC_SHIRT.cream) +
		h.wcFace({
			cx: 120,
			cy: 48,
			skin: 'sand',
			hair: 'brown',
			hairStyle: 'short',
			shirt: WC_SHIRT.jersey,
			shirtShadow: '#1F3A1A',
			emotion: 'dread'
		}) +
		h.ballProp({ cx: 206, cy: 70, r: 7 }),
	'wc-samerica-sf': (h) =>
		h.bgFlagDiag({ c1: '#FFD800', c2: '#0F8C3A', c3: '#75AADB' }) +
		h.wcFace({
			cx: 140,
			cy: 44,
			skin: 'umber',
			hair: 'jet',
			hairStyle: 'short',
			shirt: WC_SHIRT.brazil,
			shirtShadow: '#C4A300',
			emotion: 'anticipation'
		}) +
		h.ballProp({ cx: 230, cy: 64, r: 6 }),
	'wc-all-top8-sf': (h) =>
		h.bgSpotlight({ c1: WC_SHIRT.gold, c2: WC_SHIRT.cream }) +
		h.wcFace({
			cx: 120,
			cy: 48,
			skin: 'almond',
			hair: 'brown',
			hairStyle: 'short',
			shirt: WC_SHIRT.dark,
			shirtShadow: '#100B07',
			emotion: 'focus'
		}) +
		h.trophyIcon({ cx: 210, cy: 54, scale: 0.8 }),
	'wc-surprise-sf': (h) =>
		h.bgPerspective(WC_SHIRT.cream) +
		h.wcFace({
			cx: 140,
			cy: 46,
			skin: 'mahog',
			hair: 'jet',
			hairStyle: 'short',
			shirt: WC_SHIRT.jersey,
			shirtShadow: '#1F3A1A',
			emotion: 'joy'
		}) +
		h.ballProp({ cx: 228, cy: 60, r: 6 }),
	'wc-brazil-final': (h) =>
		h.bgFlagDiag({ c1: '#FFD800', c2: '#0F8C3A', c3: '#0033A0' }) +
		h.wcFace({
			cx: 120,
			cy: 44,
			skin: 'umber',
			hair: 'jet',
			hairStyle: 'short',
			shirt: WC_SHIRT.brazil,
			shirtShadow: '#C4A300',
			emotion: 'anticipation'
		}) +
		h.trophyIcon({ cx: 214, cy: 52, scale: 0.9 }),
	'wc-eur-vs-sam-final': (h) =>
		h.bgFlagDiag({ c1: '#0055A4', c2: '#F2ECDC', c3: '#FFD800' }) +
		h.wcFace({
			cx: 120,
			cy: 48,
			skin: 'sand',
			hair: 'brown',
			hairStyle: 'short',
			shirt: WC_SHIRT.france,
			shirtShadow: '#003A78',
			emotion: 'focus'
		}) +
		h.trophyIcon({ cx: 214, cy: 54, scale: 0.85 }),
	'wc-sf-both-90': (h) =>
		h.bgStands('#7E7A75') +
		h.wcFace({
			cx: 140,
			cy: 46,
			skin: 'almond',
			hair: 'brown',
			hairStyle: 'short',
			shirt: WC_SHIRT.dark,
			shirtShadow: '#100B07',
			emotion: 'focus'
		}),
	'wc-3rd-place-goals': (h) =>
		h.bgPerspective(WC_SHIRT.cream) +
		h.wcFace({
			cx: 96,
			cy: 50,
			skin: 'olive',
			hair: 'brown',
			hairStyle: 'short',
			shirt: WC_SHIRT.jersey,
			shirtShadow: '#1F3A1A',
			emotion: 'joy'
		}) +
		h.ballProp({ cx: 190, cy: 54, r: 7 }) +
		h.ballProp({ cx: 224, cy: 40, r: 5 }) +
		h.ballProp({ cx: 252, cy: 64, r: 5 }),
	'wc-final-1h-goal': (h) =>
		h.bgSpotlight({ c1: WC_SHIRT.gold, c2: WC_SHIRT.cream }) +
		h.wcFace({
			cx: 140,
			cy: 46,
			skin: 'almond',
			hair: 'brown',
			hairStyle: 'short',
			shirt: WC_SHIRT.dark,
			shirtShadow: '#100B07',
			emotion: 'anticipation'
		}) +
		h.ballProp({ cx: 226, cy: 62, r: 6 }),
	'wc-golden-ball-fwd': (h) =>
		h.bgCircle({ color: WC_SHIRT.gold, cx: 198, cy: 50, r: 52 }) +
		h.wcFace({
			cx: 122,
			cy: 46,
			skin: 'umber',
			hair: 'jet',
			hairStyle: 'short',
			shirt: WC_SHIRT.dark,
			shirtShadow: '#100B07',
			emotion: 'focus'
		}) +
		h.trophyIcon({ cx: 214, cy: 54, scale: 0.7 }),
	'wc-young-player-eur': (h) =>
		h.bgCircle({ color: WC_SHIRT.gold, cx: 198, cy: 50, r: 50 }) +
		h.wcFace({
			cx: 124,
			cy: 46,
			skin: 'sand',
			hair: 'brown',
			hairStyle: 'short',
			shirt: WC_SHIRT.france,
			shirtShadow: '#003A78',
			emotion: 'focus'
		}),
	'wc-topscorer-6': (h) =>
		h.bgCircle({ color: WC_SHIRT.gold, cx: 70, cy: 50, r: 50 }) +
		h.wcFace({
			cx: 150,
			cy: 46,
			skin: 'mahog',
			hair: 'jet',
			hairStyle: 'short',
			shirt: WC_SHIRT.dark,
			shirtShadow: '#100B07',
			emotion: 'focus'
		}) +
		h.goldenBoot({ cx: 214, cy: 58, scale: 0.95 }),
	'wc-new-champion-conf': (h) =>
		h.bgPerspective(WC_SHIRT.cream) +
		h.wcFace({
			cx: 120,
			cy: 48,
			skin: 'mahog',
			hair: 'jet',
			hairStyle: 'short',
			shirt: '#1F8A5B',
			shirtShadow: '#145F3E',
			emotion: 'joy'
		}) +
		h.trophyIcon({ cx: 212, cy: 54, scale: 0.85 }),
	'wc-mascot-meme': (h) =>
		h.bgFlagHoriz({ c1: '#C8102E', c2: '#F1BF00', c3: '#C8102E' }) +
		h.wcFace({
			cx: 120,
			cy: 44,
			skin: 'almond',
			hair: 'brown',
			hairStyle: 'short',
			shirt: WC_SHIRT.spain,
			shirtShadow: '#8A0E20',
			emotion: 'focus'
		}) +
		h.trophyIcon({ cx: 214, cy: 52, scale: 0.9 }),
	'wc-pitch-invader': (h) =>
		h.bgStands('#7E7A75') +
		h.wcFace({
			cx: 140,
			cy: 50,
			skin: 'sand',
			hair: 'brown',
			hairStyle: 'short',
			shirt: WC_SHIRT.cream,
			shirtShadow: '#B0A480',
			emotion: 'playful'
		}) +
		h.ballProp({ cx: 232, cy: 64, r: 6 }),
	'wc-commentator-cry': (h) =>
		h.bgTV(WC_SHIRT.gold) +
		h.wcFace({
			cx: 64,
			cy: 50,
			skin: 'almond',
			hair: 'gray',
			hairStyle: 'short',
			shirt: WC_SHIRT.suit,
			shirtShadow: '#0E1626',
			emotion: 'defeat'
		})
};
