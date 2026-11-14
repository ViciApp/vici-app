// World-Cup per-market artwork map — authoritative, data-derived.
//
// One entry per live group-stage market, keyed by the **normalized
// market question** (`normalizeWcQuestion` in
// `wc-market-schedule.constants.ts`, which the renderer applies to the
// incoming title before the lookup). Each entry names the drawn
// template (`WcTemplateId`) plus the parsed team / nation the template
// recolours from — resolved against `WC_NATION_KITS`, so a nation with
// no kit entry simply omits the field and the template falls back to a
// neutral palette rather than crashing.
//
// The WC renderer (`utils/flow-art/wc/render.ts`) consults this table
// after the curated recipes and hand-authored nation scenes, and before
// the heuristic resolver / generic fallback — so every catalogued market
// renders its brief-matched scene while anything off-catalogue still
// degrades safely.
//
// Generated from the prediction catalogue; the per-template distribution
// is asserted against the brief histogram at author time. Do not
// hand-edit individual rows — regenerate the whole table if the
// catalogue changes.
//
// The catalogue covers the player-prop templates `player-card`
// (booking) and `player-assist` (assist) alongside `player-figure`
// (goal), so a future manual regeneration follows the same
// brief→template classification and won't revert these rows.

import type { WcTemplateId } from '#lib/utils/flow-art/wc/resolve-template.ts';

export interface WcMarketArt {
	template: WcTemplateId;
	/** Parsed primary team (kit-clash / crest-ladder left side, qualify nation). */
	teamA?: string;
	/** Parsed secondary team (kit-clash / crest-ladder right side). */
	teamB?: string;
	/** Single featured nation (player-figure, podium). */
	nation?: string;
}

/** Normalized market question -> brief-matched artwork descriptor. */
export const WC_MARKET_ART: Record<string, WcMarketArt> = {
	'will a goal be scored in the first half of argentina vs austria?': {
		template: 'stadium-clock',
		teamA: 'argentina',
		teamB: 'austria'
	},
	'will a goal be scored in the first half of australia vs türkiye?': {
		template: 'stadium-clock',
		teamA: 'australia',
		teamB: 'türkiye'
	},
	'will a goal be scored in the first half of austria vs jordan?': {
		template: 'stadium-clock',
		teamA: 'austria',
		teamB: 'jordan'
	},
	'will a goal be scored in the first half of colombia vs portugal?': {
		template: 'stadium-clock',
		teamA: 'colombia',
		teamB: 'portugal'
	},
	'will a goal be scored in the first half of czechia vs mexico?': {
		template: 'stadium-clock',
		teamA: 'czechia',
		teamB: 'mexico'
	},
	'will a goal be scored in the first half of czechia vs south africa?': {
		template: 'stadium-clock',
		teamA: 'czechia',
		teamB: 'south africa'
	},
	'will a goal be scored in the first half of egypt vs iran?': {
		template: 'stadium-clock',
		teamA: 'egypt',
		teamB: 'iran'
	},
	'will a goal be scored in the first half of germany vs curaçao?': {
		template: 'stadium-clock',
		teamA: 'germany',
		teamB: 'curaçao'
	},
	'will a goal be scored in the first half of iran vs new zealand?': {
		template: 'stadium-clock',
		teamA: 'iran',
		teamB: 'new zealand'
	},
	'will a goal be scored in the first half of japan vs sweden?': {
		template: 'stadium-clock',
		teamA: 'japan',
		teamB: 'sweden'
	},
	'will a goal be scored in the first half of mexico vs south africa?': {
		template: 'stadium-clock',
		teamA: 'mexico',
		teamB: 'south africa'
	},
	'will a goal be scored in the first half of norway vs france?': {
		template: 'stadium-clock',
		teamA: 'norway',
		teamB: 'france'
	},
	'will a goal be scored in the first half of portugal vs dr congo?': {
		template: 'stadium-clock',
		teamA: 'portugal',
		teamB: 'dr congo'
	},
	'will a goal be scored in the first half of portugal vs uzbekistan?': {
		template: 'stadium-clock',
		teamA: 'portugal',
		teamB: 'uzbekistan'
	},
	'will a goal be scored in the first half of spain vs saudi arabia?': {
		template: 'stadium-clock',
		teamA: 'spain',
		teamB: 'saudi arabia'
	},
	'will a goal be scored in the first half of switzerland vs canada?': {
		template: 'stadium-clock',
		teamA: 'switzerland',
		teamB: 'canada'
	},
	'will a goal be scored in the first half of tunisia vs japan?': {
		template: 'stadium-clock',
		teamA: 'tunisia',
		teamB: 'japan'
	},
	'will a goal be scored in the first half of türkiye vs paraguay?': {
		template: 'stadium-clock',
		teamA: 'türkiye',
		teamB: 'paraguay'
	},
	'will a host nation top its group?': { template: 'host-flags' },
	'will a penalty be awarded in algeria vs austria?': {
		template: 'penalty-spot',
		teamA: 'algeria',
		teamB: 'austria'
	},
	'will a penalty be awarded in argentina vs algeria?': {
		template: 'penalty-spot',
		teamA: 'argentina',
		teamB: 'algeria'
	},
	'will a penalty be awarded in argentina vs austria?': {
		template: 'penalty-spot',
		teamA: 'argentina',
		teamB: 'austria'
	},
	'will a penalty be awarded in australia vs türkiye?': {
		template: 'penalty-spot',
		teamA: 'australia',
		teamB: 'türkiye'
	},
	'will a penalty be awarded in austria vs jordan?': {
		template: 'penalty-spot',
		teamA: 'austria',
		teamB: 'jordan'
	},
	'will a penalty be awarded in belgium vs egypt?': {
		template: 'penalty-spot',
		teamA: 'belgium',
		teamB: 'egypt'
	},
	'will a penalty be awarded in brazil vs haiti?': {
		template: 'penalty-spot',
		teamA: 'brazil',
		teamB: 'haiti'
	},
	'will a penalty be awarded in brazil vs morocco?': {
		template: 'penalty-spot',
		teamA: 'brazil',
		teamB: 'morocco'
	},
	'will a penalty be awarded in canada vs bosnia and herzegovina?': {
		template: 'penalty-spot',
		teamA: 'canada',
		teamB: 'bosnia and herzegovina'
	},
	'will a penalty be awarded in canada vs qatar?': {
		template: 'penalty-spot',
		teamA: 'canada',
		teamB: 'qatar'
	},
	'will a penalty be awarded in cape verde vs saudi arabia?': {
		template: 'penalty-spot',
		teamA: 'cape verde',
		teamB: 'saudi arabia'
	},
	'will a penalty be awarded in colombia vs dr congo?': {
		template: 'penalty-spot',
		teamA: 'colombia',
		teamB: 'dr congo'
	},
	'will a penalty be awarded in colombia vs portugal?': {
		template: 'penalty-spot',
		teamA: 'colombia',
		teamB: 'portugal'
	},
	'will a penalty be awarded in croatia vs ghana?': {
		template: 'penalty-spot',
		teamA: 'croatia',
		teamB: 'ghana'
	},
	'will a penalty be awarded in curaçao vs ivory coast?': {
		template: 'penalty-spot',
		teamA: 'curaçao',
		teamB: 'ivory coast'
	},
	'will a penalty be awarded in czechia vs mexico?': {
		template: 'penalty-spot',
		teamA: 'czechia',
		teamB: 'mexico'
	},
	'will a penalty be awarded in czechia vs south africa?': {
		template: 'penalty-spot',
		teamA: 'czechia',
		teamB: 'south africa'
	},
	'will a penalty be awarded in ecuador vs curaçao?': {
		template: 'penalty-spot',
		teamA: 'ecuador',
		teamB: 'curaçao'
	},
	'will a penalty be awarded in ecuador vs germany?': {
		template: 'penalty-spot',
		teamA: 'ecuador',
		teamB: 'germany'
	},
	'will a penalty be awarded in egypt vs iran?': {
		template: 'penalty-spot',
		teamA: 'egypt',
		teamB: 'iran'
	},
	'will a penalty be awarded in germany vs curaçao?': {
		template: 'penalty-spot',
		teamA: 'germany',
		teamB: 'curaçao'
	},
	'will a penalty be awarded in germany vs ivory coast?': {
		template: 'penalty-spot',
		teamA: 'germany',
		teamB: 'ivory coast'
	},
	'will a penalty be awarded in ghana vs panama?': {
		template: 'penalty-spot',
		teamA: 'ghana',
		teamB: 'panama'
	},
	'will a penalty be awarded in haiti vs scotland?': {
		template: 'penalty-spot',
		teamA: 'haiti',
		teamB: 'scotland'
	},
	'will a penalty be awarded in iran vs new zealand?': {
		template: 'penalty-spot',
		teamA: 'iran',
		teamB: 'new zealand'
	},
	'will a penalty be awarded in iraq vs norway?': {
		template: 'penalty-spot',
		teamA: 'iraq',
		teamB: 'norway'
	},
	'will a penalty be awarded in ivory coast vs ecuador?': {
		template: 'penalty-spot',
		teamA: 'ivory coast',
		teamB: 'ecuador'
	},
	'will a penalty be awarded in japan vs sweden?': {
		template: 'penalty-spot',
		teamA: 'japan',
		teamB: 'sweden'
	},
	'will a penalty be awarded in jordan vs algeria?': {
		template: 'penalty-spot',
		teamA: 'jordan',
		teamB: 'algeria'
	},
	'will a penalty be awarded in jordan vs argentina?': {
		template: 'penalty-spot',
		teamA: 'jordan',
		teamB: 'argentina'
	},
	'will a penalty be awarded in mexico vs korea republic?': {
		template: 'penalty-spot',
		teamA: 'mexico',
		teamB: 'korea republic'
	},
	'will a penalty be awarded in mexico vs south africa?': {
		template: 'penalty-spot',
		teamA: 'mexico',
		teamB: 'south africa'
	},
	'will a penalty be awarded in morocco vs haiti?': {
		template: 'penalty-spot',
		teamA: 'morocco',
		teamB: 'haiti'
	},
	'will a penalty be awarded in new zealand vs egypt?': {
		template: 'penalty-spot',
		teamA: 'new zealand',
		teamB: 'egypt'
	},
	'will a penalty be awarded in norway vs france?': {
		template: 'penalty-spot',
		teamA: 'norway',
		teamB: 'france'
	},
	'will a penalty be awarded in norway vs senegal?': {
		template: 'penalty-spot',
		teamA: 'norway',
		teamB: 'senegal'
	},
	'will a penalty be awarded in panama vs croatia?': {
		template: 'penalty-spot',
		teamA: 'panama',
		teamB: 'croatia'
	},
	'will a penalty be awarded in panama vs england?': {
		template: 'penalty-spot',
		teamA: 'panama',
		teamB: 'england'
	},
	'will a penalty be awarded in paraguay vs australia?': {
		template: 'penalty-spot',
		teamA: 'paraguay',
		teamB: 'australia'
	},
	'will a penalty be awarded in portugal vs dr congo?': {
		template: 'penalty-spot',
		teamA: 'portugal',
		teamB: 'dr congo'
	},
	'will a penalty be awarded in portugal vs uzbekistan?': {
		template: 'penalty-spot',
		teamA: 'portugal',
		teamB: 'uzbekistan'
	},
	'will a penalty be awarded in saudi arabia vs uruguay?': {
		template: 'penalty-spot',
		teamA: 'saudi arabia',
		teamB: 'uruguay'
	},
	'will a penalty be awarded in scotland vs brazil?': {
		template: 'penalty-spot',
		teamA: 'scotland',
		teamB: 'brazil'
	},
	'will a penalty be awarded in scotland vs morocco?': {
		template: 'penalty-spot',
		teamA: 'scotland',
		teamB: 'morocco'
	},
	'will a penalty be awarded in spain vs saudi arabia?': {
		template: 'penalty-spot',
		teamA: 'spain',
		teamB: 'saudi arabia'
	},
	'will a penalty be awarded in sweden vs tunisia?': {
		template: 'penalty-spot',
		teamA: 'sweden',
		teamB: 'tunisia'
	},
	'will a penalty be awarded in switzerland vs canada?': {
		template: 'penalty-spot',
		teamA: 'switzerland',
		teamB: 'canada'
	},
	'will a penalty be awarded in the united states vs paraguay?': {
		template: 'penalty-spot',
		teamA: 'united states',
		teamB: 'paraguay'
	},
	'will a penalty be awarded in tunisia vs japan?': {
		template: 'penalty-spot',
		teamA: 'tunisia',
		teamB: 'japan'
	},
	'will a penalty be awarded in türkiye vs paraguay?': {
		template: 'penalty-spot',
		teamA: 'türkiye',
		teamB: 'paraguay'
	},
	'will a penalty be awarded in türkiye vs the united states?': {
		template: 'penalty-spot',
		teamA: 'türkiye',
		teamB: 'united states'
	},
	'will a penalty be awarded in uruguay vs cape verde?': {
		template: 'penalty-spot',
		teamA: 'uruguay',
		teamB: 'cape verde'
	},
	'will a penalty be awarded in uruguay vs spain?': {
		template: 'penalty-spot',
		teamA: 'uruguay',
		teamB: 'spain'
	},
	'will a penalty be awarded in uzbekistan vs colombia?': {
		template: 'penalty-spot',
		teamA: 'uzbekistan',
		teamB: 'colombia'
	},
	'will a world cup debutant reach the round of 32?': { template: 'debutant-door' },
	'will algeria beat argentina?': { template: 'kit-clash', teamA: 'algeria', teamB: 'argentina' },
	'will algeria beat austria?': { template: 'kit-clash', teamA: 'algeria', teamB: 'austria' },
	'will algeria beat jordan?': { template: 'kit-clash', teamA: 'algeria', teamB: 'jordan' },
	'will algeria keep a clean sheet against jordan?': {
		template: 'keeper-wall',
		teamA: 'algeria',
		teamB: 'jordan'
	},
	'will algeria reach the round of 32?': { template: 'qualify-bracket', teamA: 'algeria' },
	'will algeria vs austria end in a draw?': {
		template: 'kit-clash',
		teamA: 'algeria',
		teamB: 'austria'
	},
	'will algeria win group j?': { template: 'podium', nation: 'algeria' },
	'will all three host nations reach the round of 32?': { template: 'host-flags' },
	'will any group be decided by drawing of lots or fair-play points?': { template: 'draw-balls' },
	'will any player receive a red card in algeria vs austria?': {
		template: 'referee-card',
		teamA: 'algeria',
		teamB: 'austria'
	},
	'will any player receive a red card in belgium vs egypt?': {
		template: 'referee-card',
		teamA: 'belgium',
		teamB: 'egypt'
	},
	'will any player receive a red card in belgium vs iran?': {
		template: 'referee-card',
		teamA: 'belgium',
		teamB: 'iran'
	},
	'will any player receive a red card in bosnia and herzegovina vs qatar?': {
		template: 'referee-card',
		teamA: 'bosnia and herzegovina',
		teamB: 'qatar'
	},
	'will any player receive a red card in brazil vs morocco?': {
		template: 'referee-card',
		teamA: 'brazil',
		teamB: 'morocco'
	},
	'will any player receive a red card in canada vs bosnia and herzegovina?': {
		template: 'referee-card',
		teamA: 'canada',
		teamB: 'bosnia and herzegovina'
	},
	'will any player receive a red card in canada vs qatar?': {
		template: 'referee-card',
		teamA: 'canada',
		teamB: 'qatar'
	},
	'will any player receive a red card in cape verde vs saudi arabia?': {
		template: 'referee-card',
		teamA: 'cape verde',
		teamB: 'saudi arabia'
	},
	'will any player receive a red card in dr congo vs uzbekistan?': {
		template: 'referee-card',
		teamA: 'dr congo',
		teamB: 'uzbekistan'
	},
	'will any player receive a red card in ecuador vs germany?': {
		template: 'referee-card',
		teamA: 'ecuador',
		teamB: 'germany'
	},
	'will any player receive a red card in england vs croatia?': {
		template: 'referee-card',
		teamA: 'england',
		teamB: 'croatia'
	},
	'will any player receive a red card in england vs ghana?': {
		template: 'referee-card',
		teamA: 'england',
		teamB: 'ghana'
	},
	'will any player receive a red card in france vs iraq?': {
		template: 'referee-card',
		teamA: 'france',
		teamB: 'iraq'
	},
	'will any player receive a red card in france vs senegal?': {
		template: 'referee-card',
		teamA: 'france',
		teamB: 'senegal'
	},
	'will any player receive a red card in germany vs ivory coast?': {
		template: 'referee-card',
		teamA: 'germany',
		teamB: 'ivory coast'
	},
	'will any player receive a red card in ghana vs panama?': {
		template: 'referee-card',
		teamA: 'ghana',
		teamB: 'panama'
	},
	'will any player receive a red card in iraq vs norway?': {
		template: 'referee-card',
		teamA: 'iraq',
		teamB: 'norway'
	},
	'will any player receive a red card in ivory coast vs ecuador?': {
		template: 'referee-card',
		teamA: 'ivory coast',
		teamB: 'ecuador'
	},
	'will any player receive a red card in korea republic vs czechia?': {
		template: 'referee-card',
		teamA: 'korea republic',
		teamB: 'czechia'
	},
	'will any player receive a red card in new zealand vs belgium?': {
		template: 'referee-card',
		teamA: 'new zealand',
		teamB: 'belgium'
	},
	'will any player receive a red card in norway vs senegal?': {
		template: 'referee-card',
		teamA: 'norway',
		teamB: 'senegal'
	},
	'will any player receive a red card in panama vs croatia?': {
		template: 'referee-card',
		teamA: 'panama',
		teamB: 'croatia'
	},
	'will any player receive a red card in panama vs england?': {
		template: 'referee-card',
		teamA: 'panama',
		teamB: 'england'
	},
	'will any player receive a red card in qatar vs switzerland?': {
		template: 'referee-card',
		teamA: 'qatar',
		teamB: 'switzerland'
	},
	'will any player receive a red card in scotland vs brazil?': {
		template: 'referee-card',
		teamA: 'scotland',
		teamB: 'brazil'
	},
	'will any player receive a red card in scotland vs morocco?': {
		template: 'referee-card',
		teamA: 'scotland',
		teamB: 'morocco'
	},
	'will any player receive a red card in senegal vs iraq?': {
		template: 'referee-card',
		teamA: 'senegal',
		teamB: 'iraq'
	},
	'will any player receive a red card in south africa vs korea republic?': {
		template: 'referee-card',
		teamA: 'south africa',
		teamB: 'korea republic'
	},
	'will any player receive a red card in spain vs cape verde?': {
		template: 'referee-card',
		teamA: 'spain',
		teamB: 'cape verde'
	},
	'will any player receive a red card in switzerland vs bosnia and herzegovina?': {
		template: 'referee-card',
		teamA: 'switzerland',
		teamB: 'bosnia and herzegovina'
	},
	'will any player receive a red card in the netherlands vs japan?': {
		template: 'referee-card',
		teamA: 'netherlands',
		teamB: 'japan'
	},
	'will any player receive a red card in the netherlands vs sweden?': {
		template: 'referee-card',
		teamA: 'netherlands',
		teamB: 'sweden'
	},
	'will any player receive a red card in the united states vs australia?': {
		template: 'referee-card',
		teamA: 'united states',
		teamB: 'australia'
	},
	'will any player receive a red card in tunisia vs the netherlands?': {
		template: 'referee-card',
		teamA: 'tunisia',
		teamB: 'netherlands'
	},
	'will any player receive a red card in türkiye vs the united states?': {
		template: 'referee-card',
		teamA: 'türkiye',
		teamB: 'united states'
	},
	'will any player receive a red card in uruguay vs cape verde?': {
		template: 'referee-card',
		teamA: 'uruguay',
		teamB: 'cape verde'
	},
	'will argentina beat algeria?': { template: 'kit-clash', teamA: 'argentina', teamB: 'algeria' },
	'will argentina beat austria?': { template: 'kit-clash', teamA: 'argentina', teamB: 'austria' },
	'will argentina beat jordan?': { template: 'kit-clash', teamA: 'argentina', teamB: 'jordan' },
	'will argentina finish above austria in group j?': {
		template: 'crest-ladder',
		teamA: 'argentina',
		teamB: 'austria'
	},
	'will argentina keep a clean sheet against algeria?': {
		template: 'keeper-wall',
		teamA: 'argentina',
		teamB: 'algeria'
	},
	'will argentina keep a clean sheet against austria?': {
		template: 'keeper-wall',
		teamA: 'argentina',
		teamB: 'austria'
	},
	'will argentina keep a clean sheet against jordan?': {
		template: 'keeper-wall',
		teamA: 'argentina',
		teamB: 'jordan'
	},
	'will argentina reach the round of 32?': { template: 'qualify-bracket', teamA: 'argentina' },
	'will argentina vs algeria end in a draw?': {
		template: 'kit-clash',
		teamA: 'argentina',
		teamB: 'algeria'
	},
	'will argentina vs austria end in a draw?': {
		template: 'kit-clash',
		teamA: 'argentina',
		teamB: 'austria'
	},
	'will argentina win group j?': { template: 'podium', nation: 'argentina' },
	'will australia beat paraguay?': { template: 'kit-clash', teamA: 'australia', teamB: 'paraguay' },
	'will australia beat the united states?': {
		template: 'kit-clash',
		teamA: 'australia',
		teamB: 'united states'
	},
	'will australia beat türkiye?': { template: 'kit-clash', teamA: 'australia', teamB: 'türkiye' },
	'will australia reach the round of 32?': { template: 'qualify-bracket', teamA: 'australia' },
	'will australia vs türkiye end in a draw?': {
		template: 'kit-clash',
		teamA: 'australia',
		teamB: 'türkiye'
	},
	'will australia win group d?': { template: 'podium', nation: 'australia' },
	'will austria beat algeria?': { template: 'kit-clash', teamA: 'austria', teamB: 'algeria' },
	'will austria beat argentina?': { template: 'kit-clash', teamA: 'austria', teamB: 'argentina' },
	'will austria beat jordan?': { template: 'kit-clash', teamA: 'austria', teamB: 'jordan' },
	'will austria keep a clean sheet against jordan?': {
		template: 'keeper-wall',
		teamA: 'austria',
		teamB: 'jordan'
	},
	'will austria reach the round of 32?': { template: 'qualify-bracket', teamA: 'austria' },
	'will austria score 2 or more goals against algeria?': {
		template: 'striker-juggle',
		teamA: 'austria',
		teamB: 'algeria'
	},
	'will austria vs jordan end in a draw?': {
		template: 'kit-clash',
		teamA: 'austria',
		teamB: 'jordan'
	},
	'will austria win group j?': { template: 'podium', nation: 'austria' },
	'will belgium beat egypt?': { template: 'kit-clash', teamA: 'belgium', teamB: 'egypt' },
	'will belgium beat iran?': { template: 'kit-clash', teamA: 'belgium', teamB: 'iran' },
	'will belgium beat new zealand?': {
		template: 'kit-clash',
		teamA: 'belgium',
		teamB: 'new zealand'
	},
	'will belgium keep a clean sheet against iran?': {
		template: 'keeper-wall',
		teamA: 'belgium',
		teamB: 'iran'
	},
	'will belgium keep a clean sheet against new zealand?': {
		template: 'keeper-wall',
		teamA: 'belgium',
		teamB: 'new zealand'
	},
	'will belgium reach the round of 32?': { template: 'qualify-bracket', teamA: 'belgium' },
	'will belgium score 2 or more goals against egypt?': {
		template: 'striker-juggle',
		teamA: 'belgium',
		teamB: 'egypt'
	},
	'will belgium vs egypt end in a draw?': {
		template: 'kit-clash',
		teamA: 'belgium',
		teamB: 'egypt'
	},
	'will belgium vs iran end in a draw?': { template: 'kit-clash', teamA: 'belgium', teamB: 'iran' },
	'will belgium win group g?': { template: 'podium', nation: 'belgium' },
	'will bosnia and herzegovina beat canada?': {
		template: 'kit-clash',
		teamA: 'bosnia and herzegovina',
		teamB: 'canada'
	},
	'will bosnia and herzegovina beat qatar?': {
		template: 'kit-clash',
		teamA: 'bosnia and herzegovina',
		teamB: 'qatar'
	},
	'will bosnia and herzegovina beat switzerland?': {
		template: 'kit-clash',
		teamA: 'bosnia and herzegovina',
		teamB: 'switzerland'
	},
	'will bosnia and herzegovina keep a clean sheet against qatar?': {
		template: 'keeper-wall',
		teamA: 'bosnia and herzegovina',
		teamB: 'qatar'
	},
	'will bosnia and herzegovina reach the round of 32?': {
		template: 'qualify-bracket',
		teamA: 'bosnia and herzegovina'
	},
	'will bosnia and herzegovina vs qatar end in a draw?': {
		template: 'kit-clash',
		teamA: 'bosnia and herzegovina',
		teamB: 'qatar'
	},
	'will bosnia and herzegovina win group b?': {
		template: 'podium',
		nation: 'bosnia and herzegovina'
	},
	'will both teams score in algeria vs austria?': {
		template: 'split-pitch',
		teamA: 'algeria',
		teamB: 'austria'
	},
	'will both teams score in argentina vs algeria?': {
		template: 'split-pitch',
		teamA: 'argentina',
		teamB: 'algeria'
	},
	'will both teams score in argentina vs austria?': {
		template: 'split-pitch',
		teamA: 'argentina',
		teamB: 'austria'
	},
	'will both teams score in australia vs türkiye?': {
		template: 'split-pitch',
		teamA: 'australia',
		teamB: 'türkiye'
	},
	'will both teams score in austria vs jordan?': {
		template: 'split-pitch',
		teamA: 'austria',
		teamB: 'jordan'
	},
	'will both teams score in belgium vs egypt?': {
		template: 'split-pitch',
		teamA: 'belgium',
		teamB: 'egypt'
	},
	'will both teams score in belgium vs iran?': {
		template: 'split-pitch',
		teamA: 'belgium',
		teamB: 'iran'
	},
	'will both teams score in bosnia and herzegovina vs qatar?': {
		template: 'split-pitch',
		teamA: 'bosnia and herzegovina',
		teamB: 'qatar'
	},
	'will both teams score in brazil vs haiti?': {
		template: 'split-pitch',
		teamA: 'brazil',
		teamB: 'haiti'
	},
	'will both teams score in brazil vs morocco?': {
		template: 'split-pitch',
		teamA: 'brazil',
		teamB: 'morocco'
	},
	'will both teams score in canada vs bosnia and herzegovina?': {
		template: 'split-pitch',
		teamA: 'canada',
		teamB: 'bosnia and herzegovina'
	},
	'will both teams score in canada vs qatar?': {
		template: 'split-pitch',
		teamA: 'canada',
		teamB: 'qatar'
	},
	'will both teams score in cape verde vs saudi arabia?': {
		template: 'split-pitch',
		teamA: 'cape verde',
		teamB: 'saudi arabia'
	},
	'will both teams score in colombia vs dr congo?': {
		template: 'split-pitch',
		teamA: 'colombia',
		teamB: 'dr congo'
	},
	'will both teams score in colombia vs portugal?': {
		template: 'split-pitch',
		teamA: 'colombia',
		teamB: 'portugal'
	},
	'will both teams score in croatia vs ghana?': {
		template: 'split-pitch',
		teamA: 'croatia',
		teamB: 'ghana'
	},
	'will both teams score in curaçao vs ivory coast?': {
		template: 'split-pitch',
		teamA: 'curaçao',
		teamB: 'ivory coast'
	},
	'will both teams score in czechia vs mexico?': {
		template: 'split-pitch',
		teamA: 'czechia',
		teamB: 'mexico'
	},
	'will both teams score in czechia vs south africa?': {
		template: 'split-pitch',
		teamA: 'czechia',
		teamB: 'south africa'
	},
	'will both teams score in dr congo vs uzbekistan?': {
		template: 'split-pitch',
		teamA: 'dr congo',
		teamB: 'uzbekistan'
	},
	'will both teams score in ecuador vs curaçao?': {
		template: 'split-pitch',
		teamA: 'ecuador',
		teamB: 'curaçao'
	},
	'will both teams score in ecuador vs germany?': {
		template: 'split-pitch',
		teamA: 'ecuador',
		teamB: 'germany'
	},
	'will both teams score in egypt vs iran?': {
		template: 'split-pitch',
		teamA: 'egypt',
		teamB: 'iran'
	},
	'will both teams score in england vs croatia?': {
		template: 'split-pitch',
		teamA: 'england',
		teamB: 'croatia'
	},
	'will both teams score in england vs ghana?': {
		template: 'split-pitch',
		teamA: 'england',
		teamB: 'ghana'
	},
	'will both teams score in france vs iraq?': {
		template: 'split-pitch',
		teamA: 'france',
		teamB: 'iraq'
	},
	'will both teams score in france vs senegal?': {
		template: 'split-pitch',
		teamA: 'france',
		teamB: 'senegal'
	},
	'will both teams score in germany vs curaçao?': {
		template: 'split-pitch',
		teamA: 'germany',
		teamB: 'curaçao'
	},
	'will both teams score in germany vs ivory coast?': {
		template: 'split-pitch',
		teamA: 'germany',
		teamB: 'ivory coast'
	},
	'will both teams score in ghana vs panama?': {
		template: 'split-pitch',
		teamA: 'ghana',
		teamB: 'panama'
	},
	'will both teams score in haiti vs scotland?': {
		template: 'split-pitch',
		teamA: 'haiti',
		teamB: 'scotland'
	},
	'will both teams score in iran vs new zealand?': {
		template: 'split-pitch',
		teamA: 'iran',
		teamB: 'new zealand'
	},
	'will both teams score in iraq vs norway?': {
		template: 'split-pitch',
		teamA: 'iraq',
		teamB: 'norway'
	},
	'will both teams score in ivory coast vs ecuador?': {
		template: 'split-pitch',
		teamA: 'ivory coast',
		teamB: 'ecuador'
	},
	'will both teams score in japan vs sweden?': {
		template: 'split-pitch',
		teamA: 'japan',
		teamB: 'sweden'
	},
	'will both teams score in jordan vs algeria?': {
		template: 'split-pitch',
		teamA: 'jordan',
		teamB: 'algeria'
	},
	'will both teams score in jordan vs argentina?': {
		template: 'split-pitch',
		teamA: 'jordan',
		teamB: 'argentina'
	},
	'will both teams score in korea republic vs czechia?': {
		template: 'split-pitch',
		teamA: 'korea republic',
		teamB: 'czechia'
	},
	'will both teams score in mexico vs korea republic?': {
		template: 'split-pitch',
		teamA: 'mexico',
		teamB: 'korea republic'
	},
	'will both teams score in mexico vs south africa?': {
		template: 'split-pitch',
		teamA: 'mexico',
		teamB: 'south africa'
	},
	'will both teams score in morocco vs haiti?': {
		template: 'split-pitch',
		teamA: 'morocco',
		teamB: 'haiti'
	},
	'will both teams score in new zealand vs belgium?': {
		template: 'split-pitch',
		teamA: 'new zealand',
		teamB: 'belgium'
	},
	'will both teams score in new zealand vs egypt?': {
		template: 'split-pitch',
		teamA: 'new zealand',
		teamB: 'egypt'
	},
	'will both teams score in norway vs france?': {
		template: 'split-pitch',
		teamA: 'norway',
		teamB: 'france'
	},
	'will both teams score in norway vs senegal?': {
		template: 'split-pitch',
		teamA: 'norway',
		teamB: 'senegal'
	},
	'will both teams score in panama vs croatia?': {
		template: 'split-pitch',
		teamA: 'panama',
		teamB: 'croatia'
	},
	'will both teams score in panama vs england?': {
		template: 'split-pitch',
		teamA: 'panama',
		teamB: 'england'
	},
	'will both teams score in paraguay vs australia?': {
		template: 'split-pitch',
		teamA: 'paraguay',
		teamB: 'australia'
	},
	'will both teams score in portugal vs dr congo?': {
		template: 'split-pitch',
		teamA: 'portugal',
		teamB: 'dr congo'
	},
	'will both teams score in portugal vs uzbekistan?': {
		template: 'split-pitch',
		teamA: 'portugal',
		teamB: 'uzbekistan'
	},
	'will both teams score in qatar vs switzerland?': {
		template: 'split-pitch',
		teamA: 'qatar',
		teamB: 'switzerland'
	},
	'will both teams score in saudi arabia vs uruguay?': {
		template: 'split-pitch',
		teamA: 'saudi arabia',
		teamB: 'uruguay'
	},
	'will both teams score in scotland vs brazil?': {
		template: 'split-pitch',
		teamA: 'scotland',
		teamB: 'brazil'
	},
	'will both teams score in scotland vs morocco?': {
		template: 'split-pitch',
		teamA: 'scotland',
		teamB: 'morocco'
	},
	'will both teams score in senegal vs iraq?': {
		template: 'split-pitch',
		teamA: 'senegal',
		teamB: 'iraq'
	},
	'will both teams score in south africa vs korea republic?': {
		template: 'split-pitch',
		teamA: 'south africa',
		teamB: 'korea republic'
	},
	'will both teams score in spain vs cape verde?': {
		template: 'split-pitch',
		teamA: 'spain',
		teamB: 'cape verde'
	},
	'will both teams score in spain vs saudi arabia?': {
		template: 'split-pitch',
		teamA: 'spain',
		teamB: 'saudi arabia'
	},
	'will both teams score in sweden vs tunisia?': {
		template: 'split-pitch',
		teamA: 'sweden',
		teamB: 'tunisia'
	},
	'will both teams score in switzerland vs bosnia and herzegovina?': {
		template: 'split-pitch',
		teamA: 'switzerland',
		teamB: 'bosnia and herzegovina'
	},
	'will both teams score in switzerland vs canada?': {
		template: 'split-pitch',
		teamA: 'switzerland',
		teamB: 'canada'
	},
	'will both teams score in the netherlands vs japan?': {
		template: 'split-pitch',
		teamA: 'netherlands',
		teamB: 'japan'
	},
	'will both teams score in the netherlands vs sweden?': {
		template: 'split-pitch',
		teamA: 'netherlands',
		teamB: 'sweden'
	},
	'will both teams score in the united states vs australia?': {
		template: 'split-pitch',
		teamA: 'united states',
		teamB: 'australia'
	},
	'will both teams score in the united states vs paraguay?': {
		template: 'split-pitch',
		teamA: 'united states',
		teamB: 'paraguay'
	},
	'will both teams score in tunisia vs japan?': {
		template: 'split-pitch',
		teamA: 'tunisia',
		teamB: 'japan'
	},
	'will both teams score in tunisia vs the netherlands?': {
		template: 'split-pitch',
		teamA: 'tunisia',
		teamB: 'netherlands'
	},
	'will both teams score in türkiye vs paraguay?': {
		template: 'split-pitch',
		teamA: 'türkiye',
		teamB: 'paraguay'
	},
	'will both teams score in türkiye vs the united states?': {
		template: 'split-pitch',
		teamA: 'türkiye',
		teamB: 'united states'
	},
	'will both teams score in uruguay vs cape verde?': {
		template: 'split-pitch',
		teamA: 'uruguay',
		teamB: 'cape verde'
	},
	'will both teams score in uruguay vs spain?': {
		template: 'split-pitch',
		teamA: 'uruguay',
		teamB: 'spain'
	},
	'will both teams score in uzbekistan vs colombia?': {
		template: 'split-pitch',
		teamA: 'uzbekistan',
		teamB: 'colombia'
	},
	'will brazil beat haiti?': { template: 'kit-clash', teamA: 'brazil', teamB: 'haiti' },
	'will brazil beat morocco?': { template: 'kit-clash', teamA: 'brazil', teamB: 'morocco' },
	'will brazil beat scotland?': { template: 'kit-clash', teamA: 'brazil', teamB: 'scotland' },
	'will brazil finish above morocco in group c?': {
		template: 'crest-ladder',
		teamA: 'brazil',
		teamB: 'morocco'
	},
	'will brazil keep a clean sheet against haiti?': {
		template: 'keeper-wall',
		teamA: 'brazil',
		teamB: 'haiti'
	},
	'will brazil reach the round of 32?': { template: 'qualify-bracket', teamA: 'brazil' },
	'will brazil score 2 or more goals against morocco?': {
		template: 'striker-juggle',
		teamA: 'brazil',
		teamB: 'morocco'
	},
	'will brazil score 2 or more goals against scotland?': {
		template: 'striker-juggle',
		teamA: 'brazil',
		teamB: 'scotland'
	},
	'will brazil vs haiti end in a draw?': { template: 'kit-clash', teamA: 'brazil', teamB: 'haiti' },
	'will brazil vs morocco end in a draw?': {
		template: 'kit-clash',
		teamA: 'brazil',
		teamB: 'morocco'
	},
	'will brazil win group c?': { template: 'podium', nation: 'brazil' },
	"will bruno fernandes register an assist in portugal's opening match vs dr congo?": {
		template: 'player-assist',
		nation: 'portugal'
	},
	'will canada beat bosnia and herzegovina?': {
		template: 'kit-clash',
		teamA: 'canada',
		teamB: 'bosnia and herzegovina'
	},
	'will canada beat qatar?': { template: 'kit-clash', teamA: 'canada', teamB: 'qatar' },
	'will canada beat switzerland?': { template: 'kit-clash', teamA: 'canada', teamB: 'switzerland' },
	'will canada reach the round of 32?': { template: 'qualify-bracket', teamA: 'canada' },
	'will canada score 2 or more goals against bosnia and herzegovina?': {
		template: 'striker-juggle',
		teamA: 'canada',
		teamB: 'bosnia and herzegovina'
	},
	'will canada score 2 or more goals against qatar?': {
		template: 'striker-juggle',
		teamA: 'canada',
		teamB: 'qatar'
	},
	'will canada vs bosnia and herzegovina end in a draw?': {
		template: 'kit-clash',
		teamA: 'canada',
		teamB: 'bosnia and herzegovina'
	},
	'will canada vs qatar end in a draw?': { template: 'kit-clash', teamA: 'canada', teamB: 'qatar' },
	'will canada win group b?': { template: 'podium', nation: 'canada' },
	'will cape verde beat saudi arabia?': {
		template: 'kit-clash',
		teamA: 'cape verde',
		teamB: 'saudi arabia'
	},
	'will cape verde beat spain?': { template: 'kit-clash', teamA: 'cape verde', teamB: 'spain' },
	'will cape verde beat uruguay?': { template: 'kit-clash', teamA: 'cape verde', teamB: 'uruguay' },
	'will cape verde reach the round of 32?': { template: 'qualify-bracket', teamA: 'cape verde' },
	'will cape verde score 2 or more goals against saudi arabia?': {
		template: 'striker-juggle',
		teamA: 'cape verde',
		teamB: 'saudi arabia'
	},
	'will cape verde vs saudi arabia end in a draw?': {
		template: 'kit-clash',
		teamA: 'cape verde',
		teamB: 'saudi arabia'
	},
	'will cape verde win group h?': { template: 'podium', nation: 'cape verde' },
	"will casemiro be booked in brazil's opening match vs morocco?": {
		template: 'player-card',
		nation: 'brazil'
	},
	"will christian pulisic score in the united states' opening match vs paraguay?": {
		template: 'player-figure',
		nation: 'united states'
	},
	'will colombia beat dr congo?': { template: 'kit-clash', teamA: 'colombia', teamB: 'dr congo' },
	'will colombia beat portugal?': { template: 'kit-clash', teamA: 'colombia', teamB: 'portugal' },
	'will colombia beat uzbekistan?': {
		template: 'kit-clash',
		teamA: 'colombia',
		teamB: 'uzbekistan'
	},
	'will colombia keep a clean sheet against dr congo?': {
		template: 'keeper-wall',
		teamA: 'colombia',
		teamB: 'dr congo'
	},
	'will colombia keep a clean sheet against uzbekistan?': {
		template: 'keeper-wall',
		teamA: 'colombia',
		teamB: 'uzbekistan'
	},
	'will colombia reach the round of 32?': { template: 'qualify-bracket', teamA: 'colombia' },
	'will colombia vs dr congo end in a draw?': {
		template: 'kit-clash',
		teamA: 'colombia',
		teamB: 'dr congo'
	},
	'will colombia vs portugal end in a draw?': {
		template: 'kit-clash',
		teamA: 'colombia',
		teamB: 'portugal'
	},
	'will colombia win group k?': { template: 'podium', nation: 'colombia' },
	"will cristiano ronaldo score in portugal's opening match vs dr congo?": {
		template: 'player-figure',
		nation: 'portugal'
	},
	'will croatia beat england?': { template: 'kit-clash', teamA: 'croatia', teamB: 'england' },
	'will croatia beat ghana?': { template: 'kit-clash', teamA: 'croatia', teamB: 'ghana' },
	'will croatia beat panama?': { template: 'kit-clash', teamA: 'croatia', teamB: 'panama' },
	'will croatia keep a clean sheet against ghana?': {
		template: 'keeper-wall',
		teamA: 'croatia',
		teamB: 'ghana'
	},
	'will croatia reach the round of 32?': { template: 'qualify-bracket', teamA: 'croatia' },
	'will croatia score 2 or more goals against panama?': {
		template: 'striker-juggle',
		teamA: 'croatia',
		teamB: 'panama'
	},
	'will croatia vs ghana end in a draw?': {
		template: 'kit-clash',
		teamA: 'croatia',
		teamB: 'ghana'
	},
	'will croatia win group l?': { template: 'podium', nation: 'croatia' },
	'will curaçao beat ecuador?': { template: 'kit-clash', teamA: 'curaçao', teamB: 'ecuador' },
	'will curaçao beat germany?': { template: 'kit-clash', teamA: 'curaçao', teamB: 'germany' },
	'will curaçao beat ivory coast?': {
		template: 'kit-clash',
		teamA: 'curaçao',
		teamB: 'ivory coast'
	},
	'will curaçao reach the round of 32?': { template: 'qualify-bracket', teamA: 'curaçao' },
	'will curaçao vs ivory coast end in a draw?': {
		template: 'kit-clash',
		teamA: 'curaçao',
		teamB: 'ivory coast'
	},
	'will curaçao win group e?': { template: 'podium', nation: 'curaçao' },
	'will czechia beat korea republic?': {
		template: 'kit-clash',
		teamA: 'czechia',
		teamB: 'korea republic'
	},
	'will czechia beat mexico?': { template: 'kit-clash', teamA: 'czechia', teamB: 'mexico' },
	'will czechia beat south africa?': {
		template: 'kit-clash',
		teamA: 'czechia',
		teamB: 'south africa'
	},
	'will czechia keep a clean sheet against south africa?': {
		template: 'keeper-wall',
		teamA: 'czechia',
		teamB: 'south africa'
	},
	'will czechia reach the round of 32?': { template: 'qualify-bracket', teamA: 'czechia' },
	'will czechia vs mexico end in a draw?': {
		template: 'kit-clash',
		teamA: 'czechia',
		teamB: 'mexico'
	},
	'will czechia vs south africa end in a draw?': {
		template: 'kit-clash',
		teamA: 'czechia',
		teamB: 'south africa'
	},
	'will czechia win group a?': { template: 'podium', nation: 'czechia' },
	"will declan rice be booked in england's opening match vs croatia?": {
		template: 'player-card',
		nation: 'england'
	},
	'will dr congo beat colombia?': { template: 'kit-clash', teamA: 'dr congo', teamB: 'colombia' },
	'will dr congo beat portugal?': { template: 'kit-clash', teamA: 'dr congo', teamB: 'portugal' },
	'will dr congo beat uzbekistan?': {
		template: 'kit-clash',
		teamA: 'dr congo',
		teamB: 'uzbekistan'
	},
	'will dr congo keep a clean sheet against uzbekistan?': {
		template: 'keeper-wall',
		teamA: 'dr congo',
		teamB: 'uzbekistan'
	},
	'will dr congo reach the round of 32?': { template: 'qualify-bracket', teamA: 'dr congo' },
	'will dr congo vs uzbekistan end in a draw?': {
		template: 'kit-clash',
		teamA: 'dr congo',
		teamB: 'uzbekistan'
	},
	'will dr congo win group k?': { template: 'podium', nation: 'dr congo' },
	'will ecuador beat curaçao?': { template: 'kit-clash', teamA: 'ecuador', teamB: 'curaçao' },
	'will ecuador beat germany?': { template: 'kit-clash', teamA: 'ecuador', teamB: 'germany' },
	'will ecuador beat ivory coast?': {
		template: 'kit-clash',
		teamA: 'ecuador',
		teamB: 'ivory coast'
	},
	'will ecuador keep a clean sheet against curaçao?': {
		template: 'keeper-wall',
		teamA: 'ecuador',
		teamB: 'curaçao'
	},
	'will ecuador reach the round of 32?': { template: 'qualify-bracket', teamA: 'ecuador' },
	'will ecuador score 2 or more goals against ivory coast?': {
		template: 'striker-juggle',
		teamA: 'ecuador',
		teamB: 'ivory coast'
	},
	'will ecuador vs curaçao end in a draw?': {
		template: 'kit-clash',
		teamA: 'ecuador',
		teamB: 'curaçao'
	},
	'will ecuador vs germany end in a draw?': {
		template: 'kit-clash',
		teamA: 'ecuador',
		teamB: 'germany'
	},
	'will ecuador win group e?': { template: 'podium', nation: 'ecuador' },
	'will egypt beat belgium?': { template: 'kit-clash', teamA: 'egypt', teamB: 'belgium' },
	'will egypt beat iran?': { template: 'kit-clash', teamA: 'egypt', teamB: 'iran' },
	'will egypt beat new zealand?': { template: 'kit-clash', teamA: 'egypt', teamB: 'new zealand' },
	'will egypt keep a clean sheet against iran?': {
		template: 'keeper-wall',
		teamA: 'egypt',
		teamB: 'iran'
	},
	'will egypt keep a clean sheet against new zealand?': {
		template: 'keeper-wall',
		teamA: 'egypt',
		teamB: 'new zealand'
	},
	'will egypt reach the round of 32?': { template: 'qualify-bracket', teamA: 'egypt' },
	'will egypt vs iran end in a draw?': { template: 'kit-clash', teamA: 'egypt', teamB: 'iran' },
	'will egypt win group g?': { template: 'podium', nation: 'egypt' },
	'will england beat croatia?': { template: 'kit-clash', teamA: 'england', teamB: 'croatia' },
	'will england beat ghana?': { template: 'kit-clash', teamA: 'england', teamB: 'ghana' },
	'will england beat panama?': { template: 'kit-clash', teamA: 'england', teamB: 'panama' },
	'will england finish above croatia in group l?': {
		template: 'crest-ladder',
		teamA: 'england',
		teamB: 'croatia'
	},
	'will england keep a clean sheet against croatia?': {
		template: 'keeper-wall',
		teamA: 'england',
		teamB: 'croatia'
	},
	'will england keep a clean sheet against ghana?': {
		template: 'keeper-wall',
		teamA: 'england',
		teamB: 'ghana'
	},
	'will england reach the round of 32?': { template: 'qualify-bracket', teamA: 'england' },
	'will england score 2 or more goals against panama?': {
		template: 'striker-juggle',
		teamA: 'england',
		teamB: 'panama'
	},
	'will england vs croatia end in a draw?': {
		template: 'kit-clash',
		teamA: 'england',
		teamB: 'croatia'
	},
	'will england vs ghana end in a draw?': {
		template: 'kit-clash',
		teamA: 'england',
		teamB: 'ghana'
	},
	'will england win group l?': { template: 'podium', nation: 'england' },
	"will erling haaland score in norway's opening match vs iraq?": {
		template: 'player-figure',
		nation: 'norway'
	},
	"will florian wirtz register an assist in germany's opening match vs curaçao?": {
		template: 'player-assist',
		nation: 'germany'
	},
	'will france beat iraq?': { template: 'kit-clash', teamA: 'france', teamB: 'iraq' },
	'will france beat norway?': { template: 'kit-clash', teamA: 'france', teamB: 'norway' },
	'will france beat senegal?': { template: 'kit-clash', teamA: 'france', teamB: 'senegal' },
	'will france finish above senegal in group i?': {
		template: 'crest-ladder',
		teamA: 'france',
		teamB: 'senegal'
	},
	'will france keep a clean sheet against iraq?': {
		template: 'keeper-wall',
		teamA: 'france',
		teamB: 'iraq'
	},
	'will france keep a clean sheet against norway?': {
		template: 'keeper-wall',
		teamA: 'france',
		teamB: 'norway'
	},
	'will france keep a clean sheet against senegal?': {
		template: 'keeper-wall',
		teamA: 'france',
		teamB: 'senegal'
	},
	'will france reach the round of 32?': { template: 'qualify-bracket', teamA: 'france' },
	'will france vs iraq end in a draw?': { template: 'kit-clash', teamA: 'france', teamB: 'iraq' },
	'will france vs senegal end in a draw?': {
		template: 'kit-clash',
		teamA: 'france',
		teamB: 'senegal'
	},
	'will france win group i?': { template: 'podium', nation: 'france' },
	'will germany beat curaçao?': { template: 'kit-clash', teamA: 'germany', teamB: 'curaçao' },
	'will germany beat ecuador?': { template: 'kit-clash', teamA: 'germany', teamB: 'ecuador' },
	'will germany beat ivory coast?': {
		template: 'kit-clash',
		teamA: 'germany',
		teamB: 'ivory coast'
	},
	'will germany finish above ecuador in group e?': {
		template: 'crest-ladder',
		teamA: 'germany',
		teamB: 'ecuador'
	},
	'will germany keep a clean sheet against curaçao?': {
		template: 'keeper-wall',
		teamA: 'germany',
		teamB: 'curaçao'
	},
	'will germany reach the round of 32?': { template: 'qualify-bracket', teamA: 'germany' },
	'will germany score 2 or more goals against ecuador?': {
		template: 'striker-juggle',
		teamA: 'germany',
		teamB: 'ecuador'
	},
	'will germany score 2 or more goals against ivory coast?': {
		template: 'striker-juggle',
		teamA: 'germany',
		teamB: 'ivory coast'
	},
	'will germany vs curaçao end in a draw?': {
		template: 'kit-clash',
		teamA: 'germany',
		teamB: 'curaçao'
	},
	'will germany vs ivory coast end in a draw?': {
		template: 'kit-clash',
		teamA: 'germany',
		teamB: 'ivory coast'
	},
	'will germany win group e?': { template: 'podium', nation: 'germany' },
	'will ghana beat croatia?': { template: 'kit-clash', teamA: 'ghana', teamB: 'croatia' },
	'will ghana beat england?': { template: 'kit-clash', teamA: 'ghana', teamB: 'england' },
	'will ghana beat panama?': { template: 'kit-clash', teamA: 'ghana', teamB: 'panama' },
	'will ghana reach the round of 32?': { template: 'qualify-bracket', teamA: 'ghana' },
	'will ghana score 2 or more goals against panama?': {
		template: 'striker-juggle',
		teamA: 'ghana',
		teamB: 'panama'
	},
	'will ghana vs panama end in a draw?': { template: 'kit-clash', teamA: 'ghana', teamB: 'panama' },
	'will ghana win group l?': { template: 'podium', nation: 'ghana' },
	"will granit xhaka be booked in switzerland's opening match vs qatar?": {
		template: 'player-card',
		nation: 'switzerland'
	},
	'will haiti beat brazil?': { template: 'kit-clash', teamA: 'haiti', teamB: 'brazil' },
	'will haiti beat morocco?': { template: 'kit-clash', teamA: 'haiti', teamB: 'morocco' },
	'will haiti beat scotland?': { template: 'kit-clash', teamA: 'haiti', teamB: 'scotland' },
	'will haiti reach the round of 32?': { template: 'qualify-bracket', teamA: 'haiti' },
	'will haiti vs scotland end in a draw?': {
		template: 'kit-clash',
		teamA: 'haiti',
		teamB: 'scotland'
	},
	'will haiti win group c?': { template: 'podium', nation: 'haiti' },
	"will harry kane score in england's opening match vs croatia?": {
		template: 'player-figure',
		nation: 'england'
	},
	'will iran beat belgium?': { template: 'kit-clash', teamA: 'iran', teamB: 'belgium' },
	'will iran beat egypt?': { template: 'kit-clash', teamA: 'iran', teamB: 'egypt' },
	'will iran beat new zealand?': { template: 'kit-clash', teamA: 'iran', teamB: 'new zealand' },
	'will iran keep a clean sheet against new zealand?': {
		template: 'keeper-wall',
		teamA: 'iran',
		teamB: 'new zealand'
	},
	'will iran reach the round of 32?': { template: 'qualify-bracket', teamA: 'iran' },
	'will iran vs new zealand end in a draw?': {
		template: 'kit-clash',
		teamA: 'iran',
		teamB: 'new zealand'
	},
	'will iran win group g?': { template: 'podium', nation: 'iran' },
	'will iraq beat france?': { template: 'kit-clash', teamA: 'iraq', teamB: 'france' },
	'will iraq beat norway?': { template: 'kit-clash', teamA: 'iraq', teamB: 'norway' },
	'will iraq beat senegal?': { template: 'kit-clash', teamA: 'iraq', teamB: 'senegal' },
	'will iraq reach the round of 32?': { template: 'qualify-bracket', teamA: 'iraq' },
	'will iraq vs norway end in a draw?': { template: 'kit-clash', teamA: 'iraq', teamB: 'norway' },
	'will iraq win group i?': { template: 'podium', nation: 'iraq' },
	'will ivory coast beat curaçao?': {
		template: 'kit-clash',
		teamA: 'ivory coast',
		teamB: 'curaçao'
	},
	'will ivory coast beat ecuador?': {
		template: 'kit-clash',
		teamA: 'ivory coast',
		teamB: 'ecuador'
	},
	'will ivory coast beat germany?': {
		template: 'kit-clash',
		teamA: 'ivory coast',
		teamB: 'germany'
	},
	'will ivory coast keep a clean sheet against curaçao?': {
		template: 'keeper-wall',
		teamA: 'ivory coast',
		teamB: 'curaçao'
	},
	'will ivory coast reach the round of 32?': { template: 'qualify-bracket', teamA: 'ivory coast' },
	'will ivory coast vs ecuador end in a draw?': {
		template: 'kit-clash',
		teamA: 'ivory coast',
		teamB: 'ecuador'
	},
	'will ivory coast win group e?': { template: 'podium', nation: 'ivory coast' },
	"will james rodríguez register an assist in colombia's opening match vs uzbekistan?": {
		template: 'player-assist',
		nation: 'colombia'
	},
	'will japan beat sweden?': { template: 'kit-clash', teamA: 'japan', teamB: 'sweden' },
	'will japan beat the netherlands?': {
		template: 'kit-clash',
		teamA: 'japan',
		teamB: 'netherlands'
	},
	'will japan beat tunisia?': { template: 'kit-clash', teamA: 'japan', teamB: 'tunisia' },
	'will japan keep a clean sheet against sweden?': {
		template: 'keeper-wall',
		teamA: 'japan',
		teamB: 'sweden'
	},
	'will japan keep a clean sheet against tunisia?': {
		template: 'keeper-wall',
		teamA: 'japan',
		teamB: 'tunisia'
	},
	'will japan reach the round of 32?': { template: 'qualify-bracket', teamA: 'japan' },
	'will japan vs sweden end in a draw?': { template: 'kit-clash', teamA: 'japan', teamB: 'sweden' },
	'will japan win group f?': { template: 'podium', nation: 'japan' },
	'will jordan beat algeria?': { template: 'kit-clash', teamA: 'jordan', teamB: 'algeria' },
	'will jordan beat argentina?': { template: 'kit-clash', teamA: 'jordan', teamB: 'argentina' },
	'will jordan beat austria?': { template: 'kit-clash', teamA: 'jordan', teamB: 'austria' },
	'will jordan reach the round of 32?': { template: 'qualify-bracket', teamA: 'jordan' },
	'will jordan vs algeria end in a draw?': {
		template: 'kit-clash',
		teamA: 'jordan',
		teamB: 'algeria'
	},
	'will jordan vs argentina end in a draw?': {
		template: 'kit-clash',
		teamA: 'jordan',
		teamB: 'argentina'
	},
	'will jordan win group j?': { template: 'podium', nation: 'jordan' },
	"will jude bellingham register an assist in england's opening match vs croatia?": {
		template: 'player-assist',
		nation: 'england'
	},
	"will jude bellingham score in england's opening match vs croatia?": {
		template: 'player-figure',
		nation: 'england'
	},
	"will julián álvarez score in argentina's opening match vs algeria?": {
		template: 'player-figure',
		nation: 'argentina'
	},
	"will kai havertz score in germany's opening match vs curaçao?": {
		template: 'player-figure',
		nation: 'germany'
	},
	"will kevin de bruyne register an assist in belgium's opening match vs egypt?": {
		template: 'player-assist',
		nation: 'belgium'
	},
	'will korea republic beat czechia?': {
		template: 'kit-clash',
		teamA: 'korea republic',
		teamB: 'czechia'
	},
	'will korea republic beat mexico?': {
		template: 'kit-clash',
		teamA: 'korea republic',
		teamB: 'mexico'
	},
	'will korea republic beat south africa?': {
		template: 'kit-clash',
		teamA: 'korea republic',
		teamB: 'south africa'
	},
	'will korea republic keep a clean sheet against czechia?': {
		template: 'keeper-wall',
		teamA: 'korea republic',
		teamB: 'czechia'
	},
	'will korea republic keep a clean sheet against south africa?': {
		template: 'keeper-wall',
		teamA: 'korea republic',
		teamB: 'south africa'
	},
	'will korea republic reach the round of 32?': {
		template: 'qualify-bracket',
		teamA: 'korea republic'
	},
	'will korea republic vs czechia end in a draw?': {
		template: 'kit-clash',
		teamA: 'korea republic',
		teamB: 'czechia'
	},
	'will korea republic win group a?': { template: 'podium', nation: 'korea republic' },
	"will kylian mbappé score in france's opening match vs senegal?": {
		template: 'player-figure',
		nation: 'france'
	},
	"will lamine yamal score in spain's opening match vs cape verde?": {
		template: 'player-figure',
		nation: 'spain'
	},
	"will lionel messi register an assist in argentina's opening match vs algeria?": {
		template: 'player-assist',
		nation: 'argentina'
	},
	"will lionel messi score in argentina's opening match vs algeria?": {
		template: 'player-figure',
		nation: 'argentina'
	},
	"will luis díaz score in colombia's opening match vs uzbekistan?": {
		template: 'player-figure',
		nation: 'colombia'
	},
	"will luka modrić be booked in croatia's opening match vs england?": {
		template: 'player-card',
		nation: 'croatia'
	},
	"will martin ødegaard register an assist in norway's opening match vs iraq?": {
		template: 'player-assist',
		nation: 'norway'
	},
	'will mexico (vs south africa), the usa (vs paraguay) and canada (vs bosnia and herzegovina) all win their opening matches?':
		{ template: 'wildcard-icon' },
	'will mexico beat czechia?': { template: 'kit-clash', teamA: 'mexico', teamB: 'czechia' },
	'will mexico beat korea republic?': {
		template: 'kit-clash',
		teamA: 'mexico',
		teamB: 'korea republic'
	},
	'will mexico beat south africa?': {
		template: 'kit-clash',
		teamA: 'mexico',
		teamB: 'south africa'
	},
	'will mexico keep a clean sheet against czechia?': {
		template: 'keeper-wall',
		teamA: 'mexico',
		teamB: 'czechia'
	},
	'will mexico keep a clean sheet against korea republic?': {
		template: 'keeper-wall',
		teamA: 'mexico',
		teamB: 'korea republic'
	},
	'will mexico keep a clean sheet against south africa?': {
		template: 'keeper-wall',
		teamA: 'mexico',
		teamB: 'south africa'
	},
	'will mexico reach the round of 32?': { template: 'qualify-bracket', teamA: 'mexico' },
	'will mexico vs korea republic end in a draw?': {
		template: 'kit-clash',
		teamA: 'mexico',
		teamB: 'korea republic'
	},
	'will mexico vs south africa end in a draw?': {
		template: 'kit-clash',
		teamA: 'mexico',
		teamB: 'south africa'
	},
	'will mexico win group a?': { template: 'podium', nation: 'mexico' },
	"will mohamed salah score in egypt's opening match vs belgium?": {
		template: 'player-figure',
		nation: 'egypt'
	},
	'will morocco beat brazil?': { template: 'kit-clash', teamA: 'morocco', teamB: 'brazil' },
	'will morocco beat haiti?': { template: 'kit-clash', teamA: 'morocco', teamB: 'haiti' },
	'will morocco beat scotland?': { template: 'kit-clash', teamA: 'morocco', teamB: 'scotland' },
	'will morocco keep a clean sheet against haiti?': {
		template: 'keeper-wall',
		teamA: 'morocco',
		teamB: 'haiti'
	},
	'will morocco reach the round of 32?': { template: 'qualify-bracket', teamA: 'morocco' },
	'will morocco score 2 or more goals against scotland?': {
		template: 'striker-juggle',
		teamA: 'morocco',
		teamB: 'scotland'
	},
	'will morocco vs haiti end in a draw?': {
		template: 'kit-clash',
		teamA: 'morocco',
		teamB: 'haiti'
	},
	'will morocco win group c?': { template: 'podium', nation: 'morocco' },
	'will new zealand beat belgium?': {
		template: 'kit-clash',
		teamA: 'new zealand',
		teamB: 'belgium'
	},
	'will new zealand beat egypt?': { template: 'kit-clash', teamA: 'new zealand', teamB: 'egypt' },
	'will new zealand beat iran?': { template: 'kit-clash', teamA: 'new zealand', teamB: 'iran' },
	'will new zealand reach the round of 32?': { template: 'qualify-bracket', teamA: 'new zealand' },
	'will new zealand vs belgium end in a draw?': {
		template: 'kit-clash',
		teamA: 'new zealand',
		teamB: 'belgium'
	},
	'will new zealand vs egypt end in a draw?': {
		template: 'kit-clash',
		teamA: 'new zealand',
		teamB: 'egypt'
	},
	'will new zealand win group g?': { template: 'podium', nation: 'new zealand' },
	"will nicolás otamendi be booked in argentina's opening match vs algeria?": {
		template: 'player-card',
		nation: 'argentina'
	},
	'will norway beat france?': { template: 'kit-clash', teamA: 'norway', teamB: 'france' },
	'will norway beat iraq?': { template: 'kit-clash', teamA: 'norway', teamB: 'iraq' },
	'will norway beat senegal?': { template: 'kit-clash', teamA: 'norway', teamB: 'senegal' },
	'will norway reach the round of 32?': { template: 'qualify-bracket', teamA: 'norway' },
	'will norway score 2 or more goals against iraq?': {
		template: 'striker-juggle',
		teamA: 'norway',
		teamB: 'iraq'
	},
	'will norway vs france end in a draw?': {
		template: 'kit-clash',
		teamA: 'norway',
		teamB: 'france'
	},
	'will norway vs senegal end in a draw?': {
		template: 'kit-clash',
		teamA: 'norway',
		teamB: 'senegal'
	},
	'will norway win group i?': { template: 'podium', nation: 'norway' },
	'will panama beat croatia?': { template: 'kit-clash', teamA: 'panama', teamB: 'croatia' },
	'will panama beat england?': { template: 'kit-clash', teamA: 'panama', teamB: 'england' },
	'will panama beat ghana?': { template: 'kit-clash', teamA: 'panama', teamB: 'ghana' },
	'will panama reach the round of 32?': { template: 'qualify-bracket', teamA: 'panama' },
	'will panama vs croatia end in a draw?': {
		template: 'kit-clash',
		teamA: 'panama',
		teamB: 'croatia'
	},
	'will panama vs england end in a draw?': {
		template: 'kit-clash',
		teamA: 'panama',
		teamB: 'england'
	},
	'will panama win group l?': { template: 'podium', nation: 'panama' },
	'will paraguay beat australia?': { template: 'kit-clash', teamA: 'paraguay', teamB: 'australia' },
	'will paraguay beat the united states?': {
		template: 'kit-clash',
		teamA: 'paraguay',
		teamB: 'united states'
	},
	'will paraguay beat türkiye?': { template: 'kit-clash', teamA: 'paraguay', teamB: 'türkiye' },
	'will paraguay keep a clean sheet against australia?': {
		template: 'keeper-wall',
		teamA: 'paraguay',
		teamB: 'australia'
	},
	'will paraguay reach the round of 32?': { template: 'qualify-bracket', teamA: 'paraguay' },
	'will paraguay vs australia end in a draw?': {
		template: 'kit-clash',
		teamA: 'paraguay',
		teamB: 'australia'
	},
	'will paraguay win group d?': { template: 'podium', nation: 'paraguay' },
	"will pedri register an assist in spain's opening match vs cape verde?": {
		template: 'player-assist',
		nation: 'spain'
	},
	"will pervis estupiñán be booked in ecuador's opening match vs ivory coast?": {
		template: 'player-card',
		nation: 'ecuador'
	},
	'will portugal beat colombia?': { template: 'kit-clash', teamA: 'portugal', teamB: 'colombia' },
	'will portugal beat dr congo?': { template: 'kit-clash', teamA: 'portugal', teamB: 'dr congo' },
	'will portugal beat uzbekistan?': {
		template: 'kit-clash',
		teamA: 'portugal',
		teamB: 'uzbekistan'
	},
	'will portugal finish above colombia in group k?': {
		template: 'crest-ladder',
		teamA: 'portugal',
		teamB: 'colombia'
	},
	'will portugal keep a clean sheet against colombia?': {
		template: 'keeper-wall',
		teamA: 'portugal',
		teamB: 'colombia'
	},
	'will portugal keep a clean sheet against dr congo?': {
		template: 'keeper-wall',
		teamA: 'portugal',
		teamB: 'dr congo'
	},
	'will portugal keep a clean sheet against uzbekistan?': {
		template: 'keeper-wall',
		teamA: 'portugal',
		teamB: 'uzbekistan'
	},
	'will portugal reach the round of 32?': { template: 'qualify-bracket', teamA: 'portugal' },
	'will portugal vs dr congo end in a draw?': {
		template: 'kit-clash',
		teamA: 'portugal',
		teamB: 'dr congo'
	},
	'will portugal vs uzbekistan end in a draw?': {
		template: 'kit-clash',
		teamA: 'portugal',
		teamB: 'uzbekistan'
	},
	'will portugal win group k?': { template: 'podium', nation: 'portugal' },
	'will qatar beat bosnia and herzegovina?': {
		template: 'kit-clash',
		teamA: 'qatar',
		teamB: 'bosnia and herzegovina'
	},
	'will qatar beat canada?': { template: 'kit-clash', teamA: 'qatar', teamB: 'canada' },
	'will qatar beat switzerland?': { template: 'kit-clash', teamA: 'qatar', teamB: 'switzerland' },
	'will qatar reach the round of 32?': { template: 'qualify-bracket', teamA: 'qatar' },
	'will qatar vs switzerland end in a draw?': {
		template: 'kit-clash',
		teamA: 'qatar',
		teamB: 'switzerland'
	},
	'will qatar win group b?': { template: 'podium', nation: 'qatar' },
	"will rodri be booked in spain's opening match vs cape verde?": {
		template: 'player-card',
		nation: 'spain'
	},
	"will sadio mané score in senegal's opening match vs france?": {
		template: 'player-figure',
		nation: 'senegal'
	},
	'will saudi arabia beat cape verde?': {
		template: 'kit-clash',
		teamA: 'saudi arabia',
		teamB: 'cape verde'
	},
	'will saudi arabia beat spain?': { template: 'kit-clash', teamA: 'saudi arabia', teamB: 'spain' },
	'will saudi arabia beat uruguay?': {
		template: 'kit-clash',
		teamA: 'saudi arabia',
		teamB: 'uruguay'
	},
	'will saudi arabia reach the round of 32?': {
		template: 'qualify-bracket',
		teamA: 'saudi arabia'
	},
	'will saudi arabia vs uruguay end in a draw?': {
		template: 'kit-clash',
		teamA: 'saudi arabia',
		teamB: 'uruguay'
	},
	'will saudi arabia win group h?': { template: 'podium', nation: 'saudi arabia' },
	'will scotland beat brazil?': { template: 'kit-clash', teamA: 'scotland', teamB: 'brazil' },
	'will scotland beat haiti?': { template: 'kit-clash', teamA: 'scotland', teamB: 'haiti' },
	'will scotland beat morocco?': { template: 'kit-clash', teamA: 'scotland', teamB: 'morocco' },
	'will scotland keep a clean sheet against haiti?': {
		template: 'keeper-wall',
		teamA: 'scotland',
		teamB: 'haiti'
	},
	'will scotland reach the round of 32?': { template: 'qualify-bracket', teamA: 'scotland' },
	'will scotland vs brazil end in a draw?': {
		template: 'kit-clash',
		teamA: 'scotland',
		teamB: 'brazil'
	},
	'will scotland vs morocco end in a draw?': {
		template: 'kit-clash',
		teamA: 'scotland',
		teamB: 'morocco'
	},
	'will scotland win group c?': { template: 'podium', nation: 'scotland' },
	'will senegal beat france?': { template: 'kit-clash', teamA: 'senegal', teamB: 'france' },
	'will senegal beat iraq?': { template: 'kit-clash', teamA: 'senegal', teamB: 'iraq' },
	'will senegal beat norway?': { template: 'kit-clash', teamA: 'senegal', teamB: 'norway' },
	'will senegal keep a clean sheet against iraq?': {
		template: 'keeper-wall',
		teamA: 'senegal',
		teamB: 'iraq'
	},
	'will senegal reach the round of 32?': { template: 'qualify-bracket', teamA: 'senegal' },
	'will senegal score 2 or more goals against norway?': {
		template: 'striker-juggle',
		teamA: 'senegal',
		teamB: 'norway'
	},
	'will senegal vs iraq end in a draw?': { template: 'kit-clash', teamA: 'senegal', teamB: 'iraq' },
	'will senegal win group i?': { template: 'podium', nation: 'senegal' },
	'will south africa beat czechia?': {
		template: 'kit-clash',
		teamA: 'south africa',
		teamB: 'czechia'
	},
	'will south africa beat korea republic?': {
		template: 'kit-clash',
		teamA: 'south africa',
		teamB: 'korea republic'
	},
	'will south africa beat mexico?': {
		template: 'kit-clash',
		teamA: 'south africa',
		teamB: 'mexico'
	},
	'will south africa reach the round of 32?': {
		template: 'qualify-bracket',
		teamA: 'south africa'
	},
	'will south africa vs korea republic end in a draw?': {
		template: 'kit-clash',
		teamA: 'south africa',
		teamB: 'korea republic'
	},
	'will south africa win group a?': { template: 'podium', nation: 'south africa' },
	'will spain beat cape verde?': { template: 'kit-clash', teamA: 'spain', teamB: 'cape verde' },
	'will spain beat saudi arabia?': { template: 'kit-clash', teamA: 'spain', teamB: 'saudi arabia' },
	'will spain beat uruguay?': { template: 'kit-clash', teamA: 'spain', teamB: 'uruguay' },
	'will spain finish above uruguay in group h?': {
		template: 'crest-ladder',
		teamA: 'spain',
		teamB: 'uruguay'
	},
	'will spain keep a clean sheet against cape verde?': {
		template: 'keeper-wall',
		teamA: 'spain',
		teamB: 'cape verde'
	},
	'will spain keep a clean sheet against saudi arabia?': {
		template: 'keeper-wall',
		teamA: 'spain',
		teamB: 'saudi arabia'
	},
	'will spain keep a clean sheet against uruguay?': {
		template: 'keeper-wall',
		teamA: 'spain',
		teamB: 'uruguay'
	},
	'will spain reach the round of 32?': { template: 'qualify-bracket', teamA: 'spain' },
	'will spain vs cape verde end in a draw?': {
		template: 'kit-clash',
		teamA: 'spain',
		teamB: 'cape verde'
	},
	'will spain vs saudi arabia end in a draw?': {
		template: 'kit-clash',
		teamA: 'spain',
		teamB: 'saudi arabia'
	},
	'will spain win group h?': { template: 'podium', nation: 'spain' },
	'will sweden beat japan?': { template: 'kit-clash', teamA: 'sweden', teamB: 'japan' },
	'will sweden beat the netherlands?': {
		template: 'kit-clash',
		teamA: 'sweden',
		teamB: 'netherlands'
	},
	'will sweden beat tunisia?': { template: 'kit-clash', teamA: 'sweden', teamB: 'tunisia' },
	'will sweden keep a clean sheet against tunisia?': {
		template: 'keeper-wall',
		teamA: 'sweden',
		teamB: 'tunisia'
	},
	'will sweden reach the round of 32?': { template: 'qualify-bracket', teamA: 'sweden' },
	'will sweden vs tunisia end in a draw?': {
		template: 'kit-clash',
		teamA: 'sweden',
		teamB: 'tunisia'
	},
	'will sweden win group f?': { template: 'podium', nation: 'sweden' },
	'will switzerland beat bosnia and herzegovina?': {
		template: 'kit-clash',
		teamA: 'switzerland',
		teamB: 'bosnia and herzegovina'
	},
	'will switzerland beat canada?': { template: 'kit-clash', teamA: 'switzerland', teamB: 'canada' },
	'will switzerland beat qatar?': { template: 'kit-clash', teamA: 'switzerland', teamB: 'qatar' },
	'will switzerland keep a clean sheet against bosnia and herzegovina?': {
		template: 'keeper-wall',
		teamA: 'switzerland',
		teamB: 'bosnia and herzegovina'
	},
	'will switzerland keep a clean sheet against canada?': {
		template: 'keeper-wall',
		teamA: 'switzerland',
		teamB: 'canada'
	},
	'will switzerland keep a clean sheet against qatar?': {
		template: 'keeper-wall',
		teamA: 'switzerland',
		teamB: 'qatar'
	},
	'will switzerland reach the round of 32?': { template: 'qualify-bracket', teamA: 'switzerland' },
	'will switzerland vs bosnia and herzegovina end in a draw?': {
		template: 'kit-clash',
		teamA: 'switzerland',
		teamB: 'bosnia and herzegovina'
	},
	'will switzerland vs canada end in a draw?': {
		template: 'kit-clash',
		teamA: 'switzerland',
		teamB: 'canada'
	},
	'will switzerland win group b?': { template: 'podium', nation: 'switzerland' },
	"will takefusa kubo score in japan's opening match vs the netherlands?": {
		template: 'player-figure',
		nation: 'japan'
	},
	'will the netherlands beat japan?': {
		template: 'kit-clash',
		teamA: 'netherlands',
		teamB: 'japan'
	},
	'will the netherlands beat sweden?': {
		template: 'kit-clash',
		teamA: 'netherlands',
		teamB: 'sweden'
	},
	'will the netherlands beat tunisia?': {
		template: 'kit-clash',
		teamA: 'netherlands',
		teamB: 'tunisia'
	},
	'will the netherlands finish above japan in group f?': {
		template: 'crest-ladder',
		teamA: 'netherlands',
		teamB: 'japan'
	},
	'will the netherlands keep a clean sheet against japan?': {
		template: 'keeper-wall',
		teamA: 'netherlands',
		teamB: 'japan'
	},
	'will the netherlands keep a clean sheet against sweden?': {
		template: 'keeper-wall',
		teamA: 'netherlands',
		teamB: 'sweden'
	},
	'will the netherlands keep a clean sheet against tunisia?': {
		template: 'keeper-wall',
		teamA: 'netherlands',
		teamB: 'tunisia'
	},
	'will the netherlands reach the round of 32?': {
		template: 'qualify-bracket',
		teamA: 'netherlands'
	},
	'will the netherlands vs japan end in a draw?': {
		template: 'kit-clash',
		teamA: 'netherlands',
		teamB: 'japan'
	},
	'will the netherlands vs sweden end in a draw?': {
		template: 'kit-clash',
		teamA: 'netherlands',
		teamB: 'sweden'
	},
	'will the netherlands win group f?': { template: 'podium', nation: 'netherlands' },
	'will the opening goal come inside the first 15 minutes of argentina vs algeria?': {
		template: 'stopwatch',
		teamA: 'argentina',
		teamB: 'algeria'
	},
	'will the opening goal come inside the first 15 minutes of belgium vs iran?': {
		template: 'stopwatch',
		teamA: 'belgium',
		teamB: 'iran'
	},
	'will the opening goal come inside the first 15 minutes of bosnia and herzegovina vs qatar?': {
		template: 'stopwatch',
		teamA: 'bosnia and herzegovina',
		teamB: 'qatar'
	},
	'will the opening goal come inside the first 15 minutes of brazil vs haiti?': {
		template: 'stopwatch',
		teamA: 'brazil',
		teamB: 'haiti'
	},
	'will the opening goal come inside the first 15 minutes of colombia vs dr congo?': {
		template: 'stopwatch',
		teamA: 'colombia',
		teamB: 'dr congo'
	},
	'will the opening goal come inside the first 15 minutes of croatia vs ghana?': {
		template: 'stopwatch',
		teamA: 'croatia',
		teamB: 'ghana'
	},
	'will the opening goal come inside the first 15 minutes of curaçao vs ivory coast?': {
		template: 'stopwatch',
		teamA: 'curaçao',
		teamB: 'ivory coast'
	},
	'will the opening goal come inside the first 15 minutes of dr congo vs uzbekistan?': {
		template: 'stopwatch',
		teamA: 'dr congo',
		teamB: 'uzbekistan'
	},
	'will the opening goal come inside the first 15 minutes of ecuador vs curaçao?': {
		template: 'stopwatch',
		teamA: 'ecuador',
		teamB: 'curaçao'
	},
	'will the opening goal come inside the first 15 minutes of england vs croatia?': {
		template: 'stopwatch',
		teamA: 'england',
		teamB: 'croatia'
	},
	'will the opening goal come inside the first 15 minutes of england vs ghana?': {
		template: 'stopwatch',
		teamA: 'england',
		teamB: 'ghana'
	},
	'will the opening goal come inside the first 15 minutes of france vs iraq?': {
		template: 'stopwatch',
		teamA: 'france',
		teamB: 'iraq'
	},
	'will the opening goal come inside the first 15 minutes of france vs senegal?': {
		template: 'stopwatch',
		teamA: 'france',
		teamB: 'senegal'
	},
	'will the opening goal come inside the first 15 minutes of haiti vs scotland?': {
		template: 'stopwatch',
		teamA: 'haiti',
		teamB: 'scotland'
	},
	'will the opening goal come inside the first 15 minutes of jordan vs algeria?': {
		template: 'stopwatch',
		teamA: 'jordan',
		teamB: 'algeria'
	},
	'will the opening goal come inside the first 15 minutes of jordan vs argentina?': {
		template: 'stopwatch',
		teamA: 'jordan',
		teamB: 'argentina'
	},
	'will the opening goal come inside the first 15 minutes of korea republic vs czechia?': {
		template: 'stopwatch',
		teamA: 'korea republic',
		teamB: 'czechia'
	},
	'will the opening goal come inside the first 15 minutes of mexico vs korea republic?': {
		template: 'stopwatch',
		teamA: 'mexico',
		teamB: 'korea republic'
	},
	'will the opening goal come inside the first 15 minutes of morocco vs haiti?': {
		template: 'stopwatch',
		teamA: 'morocco',
		teamB: 'haiti'
	},
	'will the opening goal come inside the first 15 minutes of new zealand vs belgium?': {
		template: 'stopwatch',
		teamA: 'new zealand',
		teamB: 'belgium'
	},
	'will the opening goal come inside the first 15 minutes of new zealand vs egypt?': {
		template: 'stopwatch',
		teamA: 'new zealand',
		teamB: 'egypt'
	},
	'will the opening goal come inside the first 15 minutes of paraguay vs australia?': {
		template: 'stopwatch',
		teamA: 'paraguay',
		teamB: 'australia'
	},
	'will the opening goal come inside the first 15 minutes of qatar vs switzerland?': {
		template: 'stopwatch',
		teamA: 'qatar',
		teamB: 'switzerland'
	},
	'will the opening goal come inside the first 15 minutes of saudi arabia vs uruguay?': {
		template: 'stopwatch',
		teamA: 'saudi arabia',
		teamB: 'uruguay'
	},
	'will the opening goal come inside the first 15 minutes of senegal vs iraq?': {
		template: 'stopwatch',
		teamA: 'senegal',
		teamB: 'iraq'
	},
	'will the opening goal come inside the first 15 minutes of south africa vs korea republic?': {
		template: 'stopwatch',
		teamA: 'south africa',
		teamB: 'korea republic'
	},
	'will the opening goal come inside the first 15 minutes of spain vs cape verde?': {
		template: 'stopwatch',
		teamA: 'spain',
		teamB: 'cape verde'
	},
	'will the opening goal come inside the first 15 minutes of sweden vs tunisia?': {
		template: 'stopwatch',
		teamA: 'sweden',
		teamB: 'tunisia'
	},
	'will the opening goal come inside the first 15 minutes of switzerland vs bosnia and herzegovina?':
		{ template: 'stopwatch', teamA: 'switzerland', teamB: 'bosnia and herzegovina' },
	'will the opening goal come inside the first 15 minutes of the netherlands vs japan?': {
		template: 'stopwatch',
		teamA: 'netherlands',
		teamB: 'japan'
	},
	'will the opening goal come inside the first 15 minutes of the netherlands vs sweden?': {
		template: 'stopwatch',
		teamA: 'netherlands',
		teamB: 'sweden'
	},
	'will the opening goal come inside the first 15 minutes of the united states vs australia?': {
		template: 'stopwatch',
		teamA: 'united states',
		teamB: 'australia'
	},
	'will the opening goal come inside the first 15 minutes of the united states vs paraguay?': {
		template: 'stopwatch',
		teamA: 'united states',
		teamB: 'paraguay'
	},
	'will the opening goal come inside the first 15 minutes of tunisia vs the netherlands?': {
		template: 'stopwatch',
		teamA: 'tunisia',
		teamB: 'netherlands'
	},
	'will the opening goal come inside the first 15 minutes of uruguay vs spain?': {
		template: 'stopwatch',
		teamA: 'uruguay',
		teamB: 'spain'
	},
	'will the opening goal come inside the first 15 minutes of uzbekistan vs colombia?': {
		template: 'stopwatch',
		teamA: 'uzbekistan',
		teamB: 'colombia'
	},
	'will the united states beat australia?': {
		template: 'kit-clash',
		teamA: 'united states',
		teamB: 'australia'
	},
	'will the united states beat paraguay?': {
		template: 'kit-clash',
		teamA: 'united states',
		teamB: 'paraguay'
	},
	'will the united states beat türkiye?': {
		template: 'kit-clash',
		teamA: 'united states',
		teamB: 'türkiye'
	},
	'will the united states keep a clean sheet against australia?': {
		template: 'keeper-wall',
		teamA: 'united states',
		teamB: 'australia'
	},
	'will the united states keep a clean sheet against paraguay?': {
		template: 'keeper-wall',
		teamA: 'united states',
		teamB: 'paraguay'
	},
	'will the united states reach the round of 32?': {
		template: 'qualify-bracket',
		teamA: 'united states'
	},
	'will the united states score 2 or more goals against türkiye?': {
		template: 'striker-juggle',
		teamA: 'united states',
		teamB: 'türkiye'
	},
	'will the united states vs australia end in a draw?': {
		template: 'kit-clash',
		teamA: 'united states',
		teamB: 'australia'
	},
	'will the united states vs paraguay end in a draw?': {
		template: 'kit-clash',
		teamA: 'united states',
		teamB: 'paraguay'
	},
	'will the united states win group d?': { template: 'podium', nation: 'united states' },
	'will there be 3 or more goals in algeria vs austria?': {
		template: 'ball-in-net',
		teamA: 'algeria',
		teamB: 'austria'
	},
	'will there be 3 or more goals in argentina vs algeria?': {
		template: 'ball-in-net',
		teamA: 'argentina',
		teamB: 'algeria'
	},
	'will there be 3 or more goals in argentina vs austria?': {
		template: 'ball-in-net',
		teamA: 'argentina',
		teamB: 'austria'
	},
	'will there be 3 or more goals in australia vs türkiye?': {
		template: 'ball-in-net',
		teamA: 'australia',
		teamB: 'türkiye'
	},
	'will there be 3 or more goals in austria vs jordan?': {
		template: 'ball-in-net',
		teamA: 'austria',
		teamB: 'jordan'
	},
	'will there be 3 or more goals in belgium vs egypt?': {
		template: 'ball-in-net',
		teamA: 'belgium',
		teamB: 'egypt'
	},
	'will there be 3 or more goals in brazil vs haiti?': {
		template: 'ball-in-net',
		teamA: 'brazil',
		teamB: 'haiti'
	},
	'will there be 3 or more goals in brazil vs morocco?': {
		template: 'ball-in-net',
		teamA: 'brazil',
		teamB: 'morocco'
	},
	'will there be 3 or more goals in canada vs bosnia and herzegovina?': {
		template: 'ball-in-net',
		teamA: 'canada',
		teamB: 'bosnia and herzegovina'
	},
	'will there be 3 or more goals in canada vs qatar?': {
		template: 'ball-in-net',
		teamA: 'canada',
		teamB: 'qatar'
	},
	'will there be 3 or more goals in cape verde vs saudi arabia?': {
		template: 'ball-in-net',
		teamA: 'cape verde',
		teamB: 'saudi arabia'
	},
	'will there be 3 or more goals in colombia vs dr congo?': {
		template: 'ball-in-net',
		teamA: 'colombia',
		teamB: 'dr congo'
	},
	'will there be 3 or more goals in colombia vs portugal?': {
		template: 'ball-in-net',
		teamA: 'colombia',
		teamB: 'portugal'
	},
	'will there be 3 or more goals in croatia vs ghana?': {
		template: 'ball-in-net',
		teamA: 'croatia',
		teamB: 'ghana'
	},
	'will there be 3 or more goals in curaçao vs ivory coast?': {
		template: 'ball-in-net',
		teamA: 'curaçao',
		teamB: 'ivory coast'
	},
	'will there be 3 or more goals in czechia vs mexico?': {
		template: 'ball-in-net',
		teamA: 'czechia',
		teamB: 'mexico'
	},
	'will there be 3 or more goals in czechia vs south africa?': {
		template: 'ball-in-net',
		teamA: 'czechia',
		teamB: 'south africa'
	},
	'will there be 3 or more goals in ecuador vs curaçao?': {
		template: 'ball-in-net',
		teamA: 'ecuador',
		teamB: 'curaçao'
	},
	'will there be 3 or more goals in ecuador vs germany?': {
		template: 'ball-in-net',
		teamA: 'ecuador',
		teamB: 'germany'
	},
	'will there be 3 or more goals in egypt vs iran?': {
		template: 'ball-in-net',
		teamA: 'egypt',
		teamB: 'iran'
	},
	'will there be 3 or more goals in germany vs curaçao?': {
		template: 'ball-in-net',
		teamA: 'germany',
		teamB: 'curaçao'
	},
	'will there be 3 or more goals in germany vs ivory coast?': {
		template: 'ball-in-net',
		teamA: 'germany',
		teamB: 'ivory coast'
	},
	'will there be 3 or more goals in ghana vs panama?': {
		template: 'ball-in-net',
		teamA: 'ghana',
		teamB: 'panama'
	},
	'will there be 3 or more goals in haiti vs scotland?': {
		template: 'ball-in-net',
		teamA: 'haiti',
		teamB: 'scotland'
	},
	'will there be 3 or more goals in iran vs new zealand?': {
		template: 'ball-in-net',
		teamA: 'iran',
		teamB: 'new zealand'
	},
	'will there be 3 or more goals in iraq vs norway?': {
		template: 'ball-in-net',
		teamA: 'iraq',
		teamB: 'norway'
	},
	'will there be 3 or more goals in ivory coast vs ecuador?': {
		template: 'ball-in-net',
		teamA: 'ivory coast',
		teamB: 'ecuador'
	},
	'will there be 3 or more goals in japan vs sweden?': {
		template: 'ball-in-net',
		teamA: 'japan',
		teamB: 'sweden'
	},
	'will there be 3 or more goals in jordan vs algeria?': {
		template: 'ball-in-net',
		teamA: 'jordan',
		teamB: 'algeria'
	},
	'will there be 3 or more goals in jordan vs argentina?': {
		template: 'ball-in-net',
		teamA: 'jordan',
		teamB: 'argentina'
	},
	'will there be 3 or more goals in mexico vs korea republic?': {
		template: 'ball-in-net',
		teamA: 'mexico',
		teamB: 'korea republic'
	},
	'will there be 3 or more goals in mexico vs south africa?': {
		template: 'ball-in-net',
		teamA: 'mexico',
		teamB: 'south africa'
	},
	'will there be 3 or more goals in morocco vs haiti?': {
		template: 'ball-in-net',
		teamA: 'morocco',
		teamB: 'haiti'
	},
	'will there be 3 or more goals in new zealand vs egypt?': {
		template: 'ball-in-net',
		teamA: 'new zealand',
		teamB: 'egypt'
	},
	'will there be 3 or more goals in norway vs france?': {
		template: 'ball-in-net',
		teamA: 'norway',
		teamB: 'france'
	},
	'will there be 3 or more goals in norway vs senegal?': {
		template: 'ball-in-net',
		teamA: 'norway',
		teamB: 'senegal'
	},
	'will there be 3 or more goals in panama vs croatia?': {
		template: 'ball-in-net',
		teamA: 'panama',
		teamB: 'croatia'
	},
	'will there be 3 or more goals in panama vs england?': {
		template: 'ball-in-net',
		teamA: 'panama',
		teamB: 'england'
	},
	'will there be 3 or more goals in paraguay vs australia?': {
		template: 'ball-in-net',
		teamA: 'paraguay',
		teamB: 'australia'
	},
	'will there be 3 or more goals in portugal vs dr congo?': {
		template: 'ball-in-net',
		teamA: 'portugal',
		teamB: 'dr congo'
	},
	'will there be 3 or more goals in portugal vs uzbekistan?': {
		template: 'ball-in-net',
		teamA: 'portugal',
		teamB: 'uzbekistan'
	},
	'will there be 3 or more goals in saudi arabia vs uruguay?': {
		template: 'ball-in-net',
		teamA: 'saudi arabia',
		teamB: 'uruguay'
	},
	'will there be 3 or more goals in scotland vs brazil?': {
		template: 'ball-in-net',
		teamA: 'scotland',
		teamB: 'brazil'
	},
	'will there be 3 or more goals in scotland vs morocco?': {
		template: 'ball-in-net',
		teamA: 'scotland',
		teamB: 'morocco'
	},
	'will there be 3 or more goals in spain vs saudi arabia?': {
		template: 'ball-in-net',
		teamA: 'spain',
		teamB: 'saudi arabia'
	},
	'will there be 3 or more goals in sweden vs tunisia?': {
		template: 'ball-in-net',
		teamA: 'sweden',
		teamB: 'tunisia'
	},
	'will there be 3 or more goals in switzerland vs canada?': {
		template: 'ball-in-net',
		teamA: 'switzerland',
		teamB: 'canada'
	},
	'will there be 3 or more goals in the united states vs paraguay?': {
		template: 'ball-in-net',
		teamA: 'united states',
		teamB: 'paraguay'
	},
	'will there be 3 or more goals in tunisia vs japan?': {
		template: 'ball-in-net',
		teamA: 'tunisia',
		teamB: 'japan'
	},
	'will there be 3 or more goals in türkiye vs paraguay?': {
		template: 'ball-in-net',
		teamA: 'türkiye',
		teamB: 'paraguay'
	},
	'will there be 3 or more goals in türkiye vs the united states?': {
		template: 'ball-in-net',
		teamA: 'türkiye',
		teamB: 'united states'
	},
	'will there be 3 or more goals in uruguay vs cape verde?': {
		template: 'ball-in-net',
		teamA: 'uruguay',
		teamB: 'cape verde'
	},
	'will there be 3 or more goals in uruguay vs spain?': {
		template: 'ball-in-net',
		teamA: 'uruguay',
		teamB: 'spain'
	},
	'will there be 3 or more goals in uzbekistan vs colombia?': {
		template: 'ball-in-net',
		teamA: 'uzbekistan',
		teamB: 'colombia'
	},
	'will there be 4 or more goals in belgium vs iran?': {
		template: 'ball-in-net',
		teamA: 'belgium',
		teamB: 'iran'
	},
	'will there be 4 or more goals in bosnia and herzegovina vs qatar?': {
		template: 'ball-in-net',
		teamA: 'bosnia and herzegovina',
		teamB: 'qatar'
	},
	'will there be 4 or more goals in dr congo vs uzbekistan?': {
		template: 'ball-in-net',
		teamA: 'dr congo',
		teamB: 'uzbekistan'
	},
	'will there be 4 or more goals in england vs croatia?': {
		template: 'ball-in-net',
		teamA: 'england',
		teamB: 'croatia'
	},
	'will there be 4 or more goals in england vs ghana?': {
		template: 'ball-in-net',
		teamA: 'england',
		teamB: 'ghana'
	},
	'will there be 4 or more goals in france vs iraq?': {
		template: 'ball-in-net',
		teamA: 'france',
		teamB: 'iraq'
	},
	'will there be 4 or more goals in france vs senegal?': {
		template: 'ball-in-net',
		teamA: 'france',
		teamB: 'senegal'
	},
	'will there be 4 or more goals in korea republic vs czechia?': {
		template: 'ball-in-net',
		teamA: 'korea republic',
		teamB: 'czechia'
	},
	'will there be 4 or more goals in new zealand vs belgium?': {
		template: 'ball-in-net',
		teamA: 'new zealand',
		teamB: 'belgium'
	},
	'will there be 4 or more goals in qatar vs switzerland?': {
		template: 'ball-in-net',
		teamA: 'qatar',
		teamB: 'switzerland'
	},
	'will there be 4 or more goals in senegal vs iraq?': {
		template: 'ball-in-net',
		teamA: 'senegal',
		teamB: 'iraq'
	},
	'will there be 4 or more goals in south africa vs korea republic?': {
		template: 'ball-in-net',
		teamA: 'south africa',
		teamB: 'korea republic'
	},
	'will there be 4 or more goals in spain vs cape verde?': {
		template: 'ball-in-net',
		teamA: 'spain',
		teamB: 'cape verde'
	},
	'will there be 4 or more goals in switzerland vs bosnia and herzegovina?': {
		template: 'ball-in-net',
		teamA: 'switzerland',
		teamB: 'bosnia and herzegovina'
	},
	'will there be 4 or more goals in the netherlands vs japan?': {
		template: 'ball-in-net',
		teamA: 'netherlands',
		teamB: 'japan'
	},
	'will there be 4 or more goals in the netherlands vs sweden?': {
		template: 'ball-in-net',
		teamA: 'netherlands',
		teamB: 'sweden'
	},
	'will there be 4 or more goals in the united states vs australia?': {
		template: 'ball-in-net',
		teamA: 'united states',
		teamB: 'australia'
	},
	'will there be 4 or more goals in tunisia vs the netherlands?': {
		template: 'ball-in-net',
		teamA: 'tunisia',
		teamB: 'netherlands'
	},
	'will tunisia beat japan?': { template: 'kit-clash', teamA: 'tunisia', teamB: 'japan' },
	'will tunisia beat sweden?': { template: 'kit-clash', teamA: 'tunisia', teamB: 'sweden' },
	'will tunisia beat the netherlands?': {
		template: 'kit-clash',
		teamA: 'tunisia',
		teamB: 'netherlands'
	},
	'will tunisia reach the round of 32?': { template: 'qualify-bracket', teamA: 'tunisia' },
	'will tunisia vs japan end in a draw?': {
		template: 'kit-clash',
		teamA: 'tunisia',
		teamB: 'japan'
	},
	'will tunisia vs the netherlands end in a draw?': {
		template: 'kit-clash',
		teamA: 'tunisia',
		teamB: 'netherlands'
	},
	'will tunisia win group f?': { template: 'podium', nation: 'tunisia' },
	'will türkiye beat australia?': { template: 'kit-clash', teamA: 'türkiye', teamB: 'australia' },
	'will türkiye beat paraguay?': { template: 'kit-clash', teamA: 'türkiye', teamB: 'paraguay' },
	'will türkiye beat the united states?': {
		template: 'kit-clash',
		teamA: 'türkiye',
		teamB: 'united states'
	},
	'will türkiye keep a clean sheet against australia?': {
		template: 'keeper-wall',
		teamA: 'türkiye',
		teamB: 'australia'
	},
	'will türkiye keep a clean sheet against paraguay?': {
		template: 'keeper-wall',
		teamA: 'türkiye',
		teamB: 'paraguay'
	},
	'will türkiye reach the round of 32?': { template: 'qualify-bracket', teamA: 'türkiye' },
	'will türkiye vs paraguay end in a draw?': {
		template: 'kit-clash',
		teamA: 'türkiye',
		teamB: 'paraguay'
	},
	'will türkiye vs the united states end in a draw?': {
		template: 'kit-clash',
		teamA: 'türkiye',
		teamB: 'united states'
	},
	'will türkiye win group d?': { template: 'podium', nation: 'türkiye' },
	'will uruguay beat cape verde?': { template: 'kit-clash', teamA: 'uruguay', teamB: 'cape verde' },
	'will uruguay beat saudi arabia?': {
		template: 'kit-clash',
		teamA: 'uruguay',
		teamB: 'saudi arabia'
	},
	'will uruguay beat spain?': { template: 'kit-clash', teamA: 'uruguay', teamB: 'spain' },
	'will uruguay keep a clean sheet against saudi arabia?': {
		template: 'keeper-wall',
		teamA: 'uruguay',
		teamB: 'saudi arabia'
	},
	'will uruguay reach the round of 32?': { template: 'qualify-bracket', teamA: 'uruguay' },
	'will uruguay score 2 or more goals against cape verde?': {
		template: 'striker-juggle',
		teamA: 'uruguay',
		teamB: 'cape verde'
	},
	'will uruguay vs cape verde end in a draw?': {
		template: 'kit-clash',
		teamA: 'uruguay',
		teamB: 'cape verde'
	},
	'will uruguay vs spain end in a draw?': {
		template: 'kit-clash',
		teamA: 'uruguay',
		teamB: 'spain'
	},
	'will uruguay win group h?': { template: 'podium', nation: 'uruguay' },
	'will uzbekistan beat colombia?': {
		template: 'kit-clash',
		teamA: 'uzbekistan',
		teamB: 'colombia'
	},
	'will uzbekistan beat dr congo?': {
		template: 'kit-clash',
		teamA: 'uzbekistan',
		teamB: 'dr congo'
	},
	'will uzbekistan beat portugal?': {
		template: 'kit-clash',
		teamA: 'uzbekistan',
		teamB: 'portugal'
	},
	'will uzbekistan reach the round of 32?': { template: 'qualify-bracket', teamA: 'uzbekistan' },
	'will uzbekistan vs colombia end in a draw?': {
		template: 'kit-clash',
		teamA: 'uzbekistan',
		teamB: 'colombia'
	},
	'will uzbekistan win group k?': { template: 'podium', nation: 'uzbekistan' },
	"will viktor gyökeres score in sweden's opening match vs tunisia?": {
		template: 'player-figure',
		nation: 'sweden'
	},
	"will vinícius júnior score in brazil's opening match vs morocco?": {
		template: 'player-figure',
		nation: 'brazil'
	},
	"will wataru endo be booked in japan's opening match vs the netherlands?": {
		template: 'player-card',
		nation: 'japan'
	}
};
