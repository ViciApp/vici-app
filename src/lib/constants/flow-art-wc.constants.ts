// Flow Mode World-Cup artwork constants: figure palettes (skin / hair
// / kit), the per-nation flag + kit table for advancement markets, and
// the shared hair-style / emotion unions. Pure data; consumed by the WC
// renderer in `flow-art.utils.ts`. Figure colours are intentionally NOT
// palette-derived so the editorial figure reads identically across
// dark / light / peach themes.

// ---- WC figure system: mode-independent constants ----------
// Figure colors are intentionally NOT palette-derived so
// the editorial figure layer reads identically across dark / light /
// peach themes. That's why `boostOpacities` skips WC (it would
// over-saturate these fixed inks against light backdrops).

// `as const satisfies` (rather than a `Record<string, …>` annotation)
// keeps the literal keys, so `keyof typeof WC_SKIN` is the skin-name
// union and `WCNation['skin']` / `wcFace`'s `skin` param stay key-safe.
export const WC_SKIN = {
	umber: { base: '#9C6E45', shadow: '#6E4A2A', high: '#C0916A' },
	olive: { base: '#A78657', shadow: '#7A5E37', high: '#C9A879' },
	almond: { base: '#B98968', shadow: '#86603F', high: '#D4A988' },
	mahog: { base: '#6E4A2A', shadow: '#4A2F18', high: '#8E6238' },
	sand: { base: '#C99F75', shadow: '#9C7250', high: '#E0BC95' },
	bronze: { base: '#7E5638', shadow: '#553820', high: '#9E7558' }
} as const satisfies Record<string, { base: string; shadow: string; high: string }>;

export const WC_HAIR = {
	jet: '#1A1410',
	charcoal: '#2A211A',
	brown: '#3E2C20',
	auburn: '#5A2F1E',
	blonde: '#A98E60',
	gray: '#7E7A75'
} as const;

export type WCHairStyle = 'short' | 'curly' | 'mohawk' | 'cap' | 'bun' | 'bald';

export type WCEmotion = 'joy' | 'focus' | 'anticipation' | 'dread' | 'defeat' | 'playful';

// Kit / costume colours referenced by the curated recipes. Mirrors the
// nation jerseys (Brazil canary, Spain scarlet, France royal, Argentina
// celeste, USA away cream) plus the neutral wardrobe (dark, suit, ref)
// and the metallic gold used by the trophy / boot props.
export const WC_SHIRT = {
	brazil: '#FFD800',
	spain: '#C8102E',
	france: '#0055A4',
	arg: '#75AADB',
	usaR: '#C8102E',
	usaW: '#F2ECDC',
	dark: '#2A211A',
	suit: '#1F2A3A',
	gold: '#E2B842',
	cream: '#F2ECDC',
	stripeBlue: '#0A3161',
	ref: '#2D2D2D',
	jersey: '#3E5A38'
} as const;

// Per-nation scene data for the featured-event advancement markets
// (`wc-br-r16`, `wc-it-r16`, …). These ids are app-specific (ISO-3166
// alpha-2 per nation) and never matched a hand-authored `recipes` key,
// so they used to fall to the generic figure. Each entry pairs the
// nation's flag colours + flag layout with a home-kit colour and a
// figure trait set: reusing the same backdrop / face vocabulary as the
// curated recipes, so every nation card renders a distinct, flag-true
// scene. Keyed by lowercased alpha-2 code; the renderer resolves any
// `wc-{cc}-*` seed against this table before the generic fallback.
export type WCFlagLayout = 'horiz' | 'vert' | 'diag';

export interface WCNation {
	c1: string;
	c2: string;
	c3: string;
	layout: WCFlagLayout;
	shirt: string;
	shadow: string;
	skin: keyof typeof WC_SKIN;
	hair: keyof typeof WC_HAIR;
	hairStyle: WCHairStyle;
}

export const WC_NATIONS: Record<string, WCNation> = {
	// Favourites: kits + figure traits mirror the curated winner recipes.
	br: {
		c1: '#FFD800',
		c2: '#0F8C3A',
		c3: '#0033A0',
		layout: 'diag',
		shirt: WC_SHIRT.brazil,
		shadow: '#C4A300',
		skin: 'umber',
		hair: 'jet',
		hairStyle: 'short'
	}, // Brazil
	es: {
		c1: '#C8102E',
		c2: '#F1BF00',
		c3: '#C8102E',
		layout: 'horiz',
		shirt: WC_SHIRT.spain,
		shadow: '#8A0E20',
		skin: 'almond',
		hair: 'brown',
		hairStyle: 'short'
	}, // Spain
	fr: {
		c1: '#0055A4',
		c2: '#F2ECDC',
		c3: '#EF4135',
		layout: 'vert',
		shirt: WC_SHIRT.france,
		shadow: '#003A78',
		skin: 'sand',
		hair: 'auburn',
		hairStyle: 'short'
	}, // France
	ar: {
		c1: '#75AADB',
		c2: '#F2ECDC',
		c3: '#75AADB',
		layout: 'horiz',
		shirt: WC_SHIRT.arg,
		shadow: '#5189B8',
		skin: 'olive',
		hair: 'brown',
		hairStyle: 'curly'
	}, // Argentina
	// Tier two.
	en: {
		c1: '#F2ECDC',
		c2: '#C8102E',
		c3: '#F2ECDC',
		layout: 'horiz',
		shirt: '#F2ECDC',
		shadow: '#C2BBA8',
		skin: 'sand',
		hair: 'brown',
		hairStyle: 'short'
	}, // England
	de: {
		c1: '#000000',
		c2: '#DD0000',
		c3: '#FFCE00',
		layout: 'horiz',
		shirt: '#F2ECDC',
		shadow: '#C2BBA8',
		skin: 'sand',
		hair: 'blonde',
		hairStyle: 'short'
	}, // Germany
	pt: {
		c1: '#046A38',
		c2: '#DA291C',
		c3: '#FFE05A',
		layout: 'vert',
		shirt: '#DA291C',
		shadow: '#8E1A12',
		skin: 'almond',
		hair: 'brown',
		hairStyle: 'short'
	}, // Portugal
	nl: {
		c1: '#AE1C28',
		c2: '#F2ECDC',
		c3: '#21468B',
		layout: 'horiz',
		shirt: '#EE7700',
		shadow: '#A85200',
		skin: 'sand',
		hair: 'blonde',
		hairStyle: 'short'
	}, // Netherlands
	be: {
		c1: '#000000',
		c2: '#FAE042',
		c3: '#ED2939',
		layout: 'vert',
		shirt: '#ED2939',
		shadow: '#A01825',
		skin: 'sand',
		hair: 'brown',
		hairStyle: 'short'
	}, // Belgium
	it: {
		c1: '#008C45',
		c2: '#F2ECDC',
		c3: '#CD212A',
		layout: 'vert',
		shirt: '#0066B2',
		shadow: '#003F73',
		skin: 'almond',
		hair: 'charcoal',
		hairStyle: 'short'
	}, // Italy
	hr: {
		c1: '#C8102E',
		c2: '#F2ECDC',
		c3: '#171796',
		layout: 'horiz',
		shirt: '#C8102E',
		shadow: '#8A0E20',
		skin: 'sand',
		hair: 'brown',
		hairStyle: 'short'
	}, // Croatia
	uy: {
		c1: '#7BAFD4',
		c2: '#F2ECDC',
		c3: '#7BAFD4',
		layout: 'horiz',
		shirt: '#5CBFEB',
		shadow: '#3E8CB0',
		skin: 'olive',
		hair: 'brown',
		hairStyle: 'short'
	}, // Uruguay
	us: {
		c1: '#C8102E',
		c2: '#F2ECDC',
		c3: '#0A3161',
		layout: 'horiz',
		shirt: WC_SHIRT.usaW,
		shadow: '#B0A480',
		skin: 'bronze',
		hair: 'brown',
		hairStyle: 'cap'
	}, // USA
	ma: {
		c1: '#C1272D',
		c2: '#006233',
		c3: '#C1272D',
		layout: 'horiz',
		shirt: '#C1272D',
		shadow: '#7E191D',
		skin: 'bronze',
		hair: 'jet',
		hairStyle: 'short'
	}, // Morocco
	jp: {
		c1: '#F2ECDC',
		c2: '#BC002D',
		c3: '#F2ECDC',
		layout: 'horiz',
		shirt: '#0A1A6B',
		shadow: '#06104A',
		skin: 'almond',
		hair: 'jet',
		hairStyle: 'short'
	}, // Japan
	sn: {
		c1: '#00853F',
		c2: '#FDEF42',
		c3: '#E31B23',
		layout: 'vert',
		shirt: '#00853F',
		shadow: '#005A2A',
		skin: 'mahog',
		hair: 'jet',
		hairStyle: 'short'
	} // Senegal
};

// Cap brim + cap-band reference colors used inside `wcFace` so the
// hair-style="cap" branch reads naturally.
export const WC_CAP_DARK = '#2A211A';
export const WC_CAP_BAND = WC_HAIR.charcoal;

// ---- Per-nation kit colour pairs (resolver-driven templates) -------
// The runtime question→template resolver
// (`utils/flow-art/wc/resolve-template.ts`) parses nation names out of
// the live market question and looks the kit colours up here. Keyed by
// the lowercased canonical nation name as it appears in the question
// text (article words like "the" stripped by the resolver before the
// lookup). Each pair is `{ primary, secondary }`; the two dominant kit
// / flag colours used by the `kit-clash` and `qualify-bracket`
// templates so each nation's card reads distinct.
//
// Distinct from `WC_NATIONS` above: that table is keyed by alpha-2 code
// and carries full figure traits for the advancement (`wc-{cc}-*`)
// scenes; this table is keyed by name and carries only the two-colour
// kit the templates need. A name with no entry omits the kit, so the
// catalogue template renders in `WC_KIT_NEUTRAL` (below) rather than a
// generic fallback: never a crash.
export interface WCKit {
	primary: string;
	secondary: string;
}

// Neutral two-colour kit for catalogue templates whose market carries no
// (or an unknown) nation: the Vici parchment / ink pair, matching the
// "vici parchment/ink" register some briefs call for. Lets a prop scene
// render its full composition in a brand-true palette rather than
// dropping to the generic fallback.
export const WC_KIT_NEUTRAL: WCKit = {
	primary: WC_SHIRT.cream,
	secondary: WC_SHIRT.dark
};

export const WC_NATION_KITS: Record<string, WCKit> = {
	algeria: { primary: '#006233', secondary: '#C8102E' },
	argentina: { primary: '#75AADB', secondary: '#F2ECDC' },
	australia: { primary: '#F1BF00', secondary: '#006A4E' },
	austria: { primary: '#C8102E', secondary: '#F2ECDC' },
	belgium: { primary: '#ED2939', secondary: '#FAE042' },
	'bosnia and herzegovina': { primary: '#002395', secondary: '#FAE042' },
	brazil: { primary: '#FFD800', secondary: '#0F8C3A' },
	canada: { primary: '#C8102E', secondary: '#F2ECDC' },
	'cape verde': { primary: '#003893', secondary: '#F2ECDC' },
	colombia: { primary: '#FCD116', secondary: '#003893' },
	croatia: { primary: '#C8102E', secondary: '#171796' },
	curaçao: { primary: '#002B7F', secondary: '#F9D616' },
	czechia: { primary: '#11457E', secondary: '#C8102E' },
	'dr congo': { primary: '#007FFF', secondary: '#F7D618' },
	ecuador: { primary: '#FFD100', secondary: '#0072CE' },
	egypt: { primary: '#C8102E', secondary: '#F2ECDC' },
	england: { primary: '#F2ECDC', secondary: '#C8102E' },
	france: { primary: '#0055A4', secondary: '#EF4135' },
	germany: { primary: '#F2ECDC', secondary: '#000000' },
	ghana: { primary: '#006B3F', secondary: '#FCD116' },
	haiti: { primary: '#00209F', secondary: '#D21034' },
	iran: { primary: '#239F40', secondary: '#DA0000' },
	iraq: { primary: '#007A3D', secondary: '#CE1126' },
	'ivory coast': { primary: '#F77F00', secondary: '#009E60' },
	japan: { primary: '#0A1A6B', secondary: '#BC002D' },
	jordan: { primary: '#007A3D', secondary: '#CE1126' },
	'korea republic': { primary: '#C8102E', secondary: '#003478' },
	mexico: { primary: '#006847', secondary: '#CE1126' },
	morocco: { primary: '#C1272D', secondary: '#006233' },
	'new zealand': { primary: '#000000', secondary: '#F2ECDC' },
	netherlands: { primary: '#EE7700', secondary: '#21468B' },
	norway: { primary: '#BA0C2F', secondary: '#00205B' },
	panama: { primary: '#DA121A', secondary: '#072357' },
	paraguay: { primary: '#0038A8', secondary: '#D52B1E' },
	portugal: { primary: '#DA291C', secondary: '#046A38' },
	qatar: { primary: '#8A1538', secondary: '#F2ECDC' },
	'saudi arabia': { primary: '#006C35', secondary: '#F2ECDC' },
	scotland: { primary: '#0065BF', secondary: '#F2ECDC' },
	senegal: { primary: '#00853F', secondary: '#FDEF42' },
	'south africa': { primary: '#007A4D', secondary: '#FCB514' },
	spain: { primary: '#C8102E', secondary: '#F1BF00' },
	sweden: { primary: '#006AA7', secondary: '#FECC02' },
	switzerland: { primary: '#C8102E', secondary: '#F2ECDC' },
	tunisia: { primary: '#E70013', secondary: '#F2ECDC' },
	türkiye: { primary: '#E30A17', secondary: '#F2ECDC' },
	'united states': { primary: '#0A3161', secondary: '#C8102E' },
	uruguay: { primary: '#5CBFEB', secondary: '#F2ECDC' },
	uzbekistan: { primary: '#1EB53A', secondary: '#0099B5' }
};
