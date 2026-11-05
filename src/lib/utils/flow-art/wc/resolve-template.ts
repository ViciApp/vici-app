// WC per-market artwork — runtime question → template resolver.
//
// The curated `WC_RECIPES` table only keys ~121 tentpole market ids,
// and the per-nation `WC_NATIONS` scenes only fire on `wc-{cc}-*` ids.
// The live World-Cup universe is dominated by group-stage markets whose
// ids match neither, so they all collapsed onto the single generic
// fallback composition — every such card looked identical.
//
// This resolver reads the market's question text (and optional category
// hint) and, for the patterns it recognises, returns a template
// descriptor the renderer composes into a distinct, nation-coloured
// scene. Anything it doesn't recognise — or any team with no kit-colour
// entry — returns `null`, so the existing generic fallback is preserved
// unchanged (no regression). Pure string logic, no DOM / I/O.

import { WC_NATION_KITS, type WCKit } from '#lib/constants/flow-art-wc.constants.ts';

// Template ids the WC renderer knows how to draw. Kept a string union
// so the renderer's dispatch is exhaustive at the type level. The first
// two are the heuristic-resolver pair; the rest are driven by the
// authoritative `WC_MARKET_ART` catalogue (one brief-matched scene per
// live market) and rendered by `renderWcTemplate`.
export type WcTemplateId =
	| 'kit-clash'
	| 'qualify-bracket'
	| 'ball-in-net'
	| 'split-pitch'
	| 'keeper-wall'
	| 'penalty-spot'
	| 'podium'
	| 'stopwatch'
	| 'referee-card'
	| 'stadium-clock'
	| 'striker-juggle'
	| 'player-figure'
	| 'player-card'
	| 'player-assist'
	| 'crest-ladder'
	| 'host-flags'
	| 'debutant-door'
	| 'draw-balls'
	| 'wildcard-icon';

export interface WcResolvedTemplate {
	templateId: WcTemplateId;
	// Resolved kit colours for the parsed team(s). Optional because most
	// catalogue templates (props, podium, player) carry zero or one team:
	// `teamA` is the focal nation (kit-clash / crest-ladder left,
	// qualify / player / podium nation), `teamB` only the two-sided
	// templates' right side. A template with no resolved kit renders in a
	// neutral palette rather than crashing.
	teamA?: WCKit;
	teamB?: WCKit;
}

// Normalise a parsed team name for the kit lookup: trim, collapse inner
// whitespace, lowercase, and strip a leading English article ("the
// United States" → "united states", "the Netherlands" → "netherlands").
// Names in the table are stored already-articled-stripped + lowercased.
const normaliseTeam = (raw: string): string =>
	raw
		.trim()
		.replace(/\s+/g, ' ')
		.toLowerCase()
		.replace(/^the\s+/, '');

// Look a parsed team name up in the kit table. Returns `undefined` for
// unknown nations (and the non-nation question phrases like
// "a World Cup debutant" / "all three host nations"), which the caller
// treats as "no template" → generic fallback.
const lookupKit = (raw: string): WCKit | undefined => WC_NATION_KITS[normaliseTeam(raw)];

// Match patterns are anchored and tolerant of trailing punctuation /
// whitespace. Team capture is non-greedy and bounded by the connector
// word so multi-word nations ("Bosnia and Herzegovina", "Korea
// Republic", "the United States") parse whole.
const RESULT_BEAT = /^will\s+(.+?)\s+beat\s+(.+?)\s*\??$/i;
const RESULT_DRAW = /^will\s+(.+?)\s+vs\.?\s+(.+?)\s+end\s+in\s+a\s+draw\s*\??$/i;
const QUALIFY_R32 = /^will\s+(.+?)\s+reach\s+the\s+round\s+of\s+32\s*\??$/i;
const QUALIFY_GROUP = /^will\s+(.+?)\s+win\s+group\s+[a-z]\s*\??$/i;

/**
 * Resolve a WC market question into a template descriptor, or `null`
 * when no implemented pattern matches or a parsed team has no kit
 * colours. The pilot implements two patterns:
 *
 *   - `kit-clash`     — `Will {A} beat {B}?` /
 *                       `Will {A} vs {B} end in a draw?`
 *   - `qualify-bracket` — `Will {A} reach the Round of 32?` /
 *                         `Will {A} win Group {X}?`
 *
 * `category` is accepted for forward-compatibility (future templates
 * may disambiguate purely on category) but the current patterns are
 * unambiguous from the question alone, so it's not yet consulted.
 */
export const resolveWcTemplate = ({
	question,
	category
}: {
	question?: string | null;
	category?: string | null;
}): WcResolvedTemplate | null => {
	// `category` reserved for future template routing; referenced so the
	// param isn't flagged unused while the API stays stable.
	void category;

	const q = (question ?? '').trim();

	if (q.length === 0) {
		return null;
	}

	// --- kit-clash: two-sided result / draw ---
	const clash = RESULT_BEAT.exec(q) ?? RESULT_DRAW.exec(q);

	if (clash) {
		const teamA = lookupKit(clash[1]);
		const teamB = lookupKit(clash[2]);

		if (teamA && teamB) {
			return { templateId: 'kit-clash', teamA, teamB };
		}

		return null;
	}

	// --- qualify-bracket: single-team advancement / group win ---
	const qualify = QUALIFY_R32.exec(q) ?? QUALIFY_GROUP.exec(q);

	if (qualify) {
		const teamA = lookupKit(qualify[1]);

		if (teamA) {
			return { templateId: 'qualify-bracket', teamA };
		}

		return null;
	}

	return null;
};
