import { WC_MARKET_ART } from '#lib/constants/flow-art-wc-markets.constants.ts';
import {
	WC_HAIR,
	WC_NATION_KITS,
	WC_NATIONS,
	WC_SHIRT,
	WC_SKIN,
	type WCEmotion,
	type WCHairStyle,
	type WCNation
} from '#lib/constants/flow-art-wc.constants.ts';
import { normalizeWcQuestion } from '#lib/constants/wc-market-schedule.constants.ts';
import { makeRng } from '#lib/utils/flow-art/rng.ts';
import type { RenderArgs } from '#lib/utils/flow-art/types.ts';
import { makeWcHelpers, type WcHelpers } from '#lib/utils/flow-art/wc/helpers.ts';
import { WC_RECIPES } from '#lib/utils/flow-art/wc/recipes.ts';
import {
	resolveWcTemplate,
	type WcResolvedTemplate
} from '#lib/utils/flow-art/wc/resolve-template.ts';
import { renderWcTemplate } from '#lib/utils/flow-art/wc/templates.ts';

// ---- WC — Faceted Editorial system (curated, per market) -----
// Coordinate space is 280×100 (slice fill) — the wide full-bleed
// artwork band on the front of WC cards.
//
// Two layers:
//   Figure layer  — fixed colours (skin / hair / kit) that read on
//                   any mode background, drawn by `wcFace`.
//   Background    — palette-token backdrops that recolour per
//                   dark / light / peach theme.
//
// Each tentpole WC market id maps to a curated composition in
// `recipes` { backdrop + figure params + foreign word (top-right)
// + emotion tag (bottom-right) }. Any id without a recipe (e.g. the
// onboarding advancement markets `wc-it-r16`) falls back to a
// generic pitch-perspective + centred figure + ball scene, so new
// markets never crash and always carry a character.
//
// `bgSpotlight` and `bgBunting` carry CSS class hooks
// (`wc-spot wc-spot-left/right` and `wc-cnf wc-cnf-${i}`) and the
// figure wraps in `<g class="wc-figure">`. The matching keyframes
// live in `FlowArtFrame.svelte` and respect `prefers-reduced-motion`.
export const renderWC = ({ p, state, uid, seed, title }: RenderArgs): string => {
	const h = makeWcHelpers(p, uid);

	// === FALLBACK (seed-varied) ==============================
	// Most live WC markets never match a curated `recipes` key — the
	// backend hands the frontend opaque market ids, and even the
	// hand-authored advancement markets (`wc-it-r16`, …) aren't keyed
	// here. They used to collapse onto one identical pitch-and-figure
	// scene, so every WC card looked the same (#502). Instead, compose
	// a deterministic-but-distinct scene from the seed: each market
	// picks its own backdrop, kit, figure and prop, and the same id
	// always renders the same scene. Seeded off the raw market id only
	// (not theme/state) so the composition stays stable across
	// dark / light / peach while the palette `p` still recolours it.
	const seedKey = typeof seed === 'string' ? seed : String(seed);

	// Threaded the helper bundle + seed positionally — both are plumbing
	// for the seed-derived scene, not a user-facing option object.
	// eslint-disable-next-line local-rules/prefer-object-params
	const generativeFallback = (h: WcHelpers, seedKey: string): string => {
		const g = makeRng(`wc-fallback::${seedKey}`);

		const backdrops: Array<() => string> = [
			() => h.bgPerspective(WC_SHIRT.cream),
			() => h.bgCircle({ color: WC_SHIRT.gold, cx: g.int(80, 200), cy: 50, r: g.int(48, 58) }),
			() => h.bgSpotlight({ c1: WC_SHIRT.gold, c2: WC_SHIRT.cream }),
			() => h.bgStands('#7E7A75'),
			() => h.bgBunting({ c1: WC_SHIRT.gold, c2: '#FF6B6B', c3: '#6FE0B6' })
		];

		// Kit + matching shadow, mirroring the curated recipes so light
		// shirts (cream) don't get a near-black shadow plane.
		const kits = [
			{ shirt: WC_SHIRT.brazil, shadow: '#C4A300' },
			{ shirt: WC_SHIRT.spain, shadow: '#8A0E20' },
			{ shirt: WC_SHIRT.france, shadow: '#003A78' },
			{ shirt: WC_SHIRT.arg, shadow: '#5189B8' },
			{ shirt: WC_SHIRT.dark, shadow: '#100B07' },
			{ shirt: WC_SHIRT.jersey, shadow: '#1F3A1A' },
			{ shirt: WC_SHIRT.suit, shadow: '#0E1626' },
			{ shirt: WC_SHIRT.cream, shadow: '#B0A480' }
		];

		// Both tables carry literal keys (`as const` / `as const
		// satisfies`), so `keyof typeof` is a name union and the assertion
		// recovers it from `Object.keys`' `string[]`.
		const skins = Object.keys(WC_SKIN) as (keyof typeof WC_SKIN)[];
		const hairs = Object.keys(WC_HAIR) as (keyof typeof WC_HAIR)[];
		const hairStyles: WCHairStyle[] = ['short', 'curly', 'mohawk', 'cap', 'bun', 'bald'];
		const emotions: WCEmotion[] = ['joy', 'focus', 'anticipation', 'dread', 'defeat', 'playful'];

		// Figure to one side (or centred) so a prop has room on the far
		// side without overlapping the bust.
		const placement = g.pick(['left', 'center', 'right'] as const);
		const figCx = placement === 'left' ? 100 : placement === 'right' ? 180 : 140;
		const kit = g.pick(kits);

		let scene = g.pick(backdrops)();
		scene += h.wcFace({
			cx: figCx,
			cy: 48,
			skin: g.pick(skins),
			hair: g.pick(hairs),
			hairStyle: g.pick(hairStyles),
			shirt: kit.shirt,
			shirtShadow: kit.shadow,
			emotion: g.pick(emotions)
		});

		if (placement !== 'center') {
			const propCx = placement === 'left' ? 218 : 62;
			const prop = g.pick([
				() => h.ballProp({ cx: propCx, cy: 60, r: 6 }),
				() => h.trophyIcon({ cx: propCx, cy: 56, scale: 0.85 }),
				() => h.goldenBoot({ cx: propCx, cy: 60, scale: 0.9 }),
				() => h.redCardProp({ cx: propCx, cy: 40 })
			]);
			scene += prop();
		}

		return scene;
	};

	// Per-nation advancement scene — flag backdrop + home kit + figure,
	// driven by the `WC_NATIONS` table. Renders a flag-true card for the
	// featured-event markets (`wc-br-r16`, `wc-it-r16`, …) and any other
	// `wc-{cc}-*` id whose code is a known nation.
	// Helper bundle + nation row threaded positionally — internal scene
	// plumbing, not a user-facing option object.
	// eslint-disable-next-line local-rules/prefer-object-params
	const nationScene = (h: WcHelpers, n: WCNation): string => {
		const flag = { c1: n.c1, c2: n.c2, c3: n.c3 };
		const bg =
			n.layout === 'diag'
				? h.bgFlagDiag(flag)
				: n.layout === 'vert'
					? h.bgFlagVert(flag)
					: h.bgFlagHoriz(flag);

		return (
			bg +
			h.wcFace({
				cx: 140,
				cy: 44,
				skin: n.skin,
				hair: n.hair,
				hairStyle: n.hairStyle,
				shirt: n.shirt,
				shirtShadow: n.shadow,
				emotion: 'anticipation'
			}) +
			h.ballProp({ cx: 232, cy: 62, r: 6 })
		);
	};

	// Resolution order: curated recipe → known nation → authoritative
	// per-market catalogue (`WC_MARKET_ART`, keyed by normalized question)
	// → question-derived heuristic template → seed-varied fallback.
	// Recipes and the hand-authored nation scenes win first so neither is
	// shadowed. The catalogue + heuristic tiers only fire when a `title`
	// (the market question) is supplied — otherwise the generic fallback
	// renders exactly as before, so call sites that don't pass a title are
	// completely unaffected.
	const nationCode = /^wc-([a-z]{2})(?:-|$)/.exec(seedKey)?.[1];
	const nation = nationCode ? WC_NATIONS[nationCode] : undefined;
	const recipeFn = WC_RECIPES[seedKey];

	// Resolve the authoritative catalogue entry (if any) for this market's
	// question into a renderable template descriptor: team / nation names
	// are looked up in `WC_NATION_KITS`; an unknown name simply omits the
	// kit and the template falls back to a neutral palette (never crashes).
	const catalogueTemplate = (rawTitle?: string | null): WcResolvedTemplate | null => {
		const key = rawTitle ? normalizeWcQuestion(rawTitle) : '';
		const art = key.length > 0 ? WC_MARKET_ART[key] : undefined;

		if (!art) {
			return null;
		}

		// `nation` and `teamA` both feed the single-focal-team slot.
		const focalName = art.teamA ?? art.nation;

		return {
			templateId: art.template,
			teamA: focalName ? WC_NATION_KITS[focalName] : undefined,
			teamB: art.teamB ? WC_NATION_KITS[art.teamB] : undefined
		};
	};

	let s: string;

	if (recipeFn) {
		s = recipeFn(h);
	} else if (nation) {
		s = nationScene(h, nation);
	} else {
		// Same id → same scene: seed the template's detail PRNG off the
		// raw market id only (not theme / state), matching the generative
		// fallback's stability contract. The catalogue (authoritative,
		// brief-matched) is tried first, then the heuristic resolver.
		const template = catalogueTemplate(title) ?? resolveWcTemplate({ question: title });
		const templateBody = template
			? renderWcTemplate({ template, h, g: makeRng(`wc-template::${seedKey}`), uid })
			: '';
		s = templateBody.length > 0 ? templateBody : generativeFallback(h, seedKey);
	}

	// Lost → desaturated veil over whichever scene fired.
	if (state === 'lost') {
		s += `<rect width="280" height="100" fill="${p.bg}" opacity="0.32"/>`;
	}

	return s;
};
