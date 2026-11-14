/**
 * Curated editorial subtitle lines for the 2026 World Cup tentpole
 * markets. Each entry is a short italic accent line that sits below the
 * question on the Flow front card: e.g. "Five-time champions ·
 * tournament favourite", "Neymar's fitness in doubt · squad locks
 * June 2". Keyed by the canonical market id used in `getFlowQueue` and
 * the satellite metadata (the same id scheme the artwork recipes use).
 *
 * This map is one link in FlowCard's subtitle resolution order:
 * explicit prop → `MarketMetadata.subtitle` (admin-curated) → this
 * curated WC lookup → a length-clamped `market.description` blurb
 * (only when it differs from the settlement clause) → hidden. So a
 * market without a curated entry here no longer necessarily hides the
 * row; it can still fall back to a guarded description line.
 *
 * The `·` separator and `&` join the line's two beats; lines stay terse
 * so they read as an editorial accent rather than a sentence. WC markets
 * without a curated context line fall through to no subtitle (see
 * {@link lookupWcMarketSubtitle}).
 */

export const WC_MARKET_SUBTITLES: Readonly<Record<string, string>> = {
	// Winners + flagship classic outcomes
	'wc-winner-brazil': 'Five-time champions · tournament favourite',
	'wc-winner-spain': 'European champions · deep, in-form squad',
	'wc-winner-france': 'Back-to-back finalists · Mbappé in his prime',
	'wc-winner-argentina': 'Reigning champions · life after Messi begins',
	'wc-golden-boot': 'Top scorer wins the Golden Boot · 8 goals in 2022',
	'wc-usa-quarter': 'Co-hosts · strongest squad in years',
	'wc-over-3-final': 'Recent finals have been tight',
	'wc-german-out-group': 'Group with Colombia & Ghana · out in 2018, 2022',
	'wc-first-time-winner': 'Only 8 nations have ever lifted it',
	'wc-new-champion-conf': 'No team from another region ever has',

	// Playful / cultural beats
	'wc-neymar-dive': "Brazil's opener vs Switzerland",
	'wc-player-haircut': 'A World Cup tradition every tournament',
	'wc-trophy-drop': 'Rare ceremony mishap · long-shot',
	'wc-coach-stands': 'Touchline tempers flare',
	'wc-pitch-propose': 'It has happened before',
	'wc-var-final': 'Every goal gets checked',
	'wc-celebration': 'Best player and top scorer, one man',
	'wc-mascot-meme': "Spain's perfect-run bid",
	'wc-ball-viral': "Ronaldo's last World Cup bid",
	'wc-captain-change': "Life after Messi's armband",
	'wc-squad-snub': "Germany's tough 26-man calls",

	// Pre-tournament build-up: friendlies, fitness, squad locks
	'wc-fast-friendly': 'Last tune-up before the opener · home crowd',
	'wc-fast-injury': "France's captain fit for the opener",
	'wc-fast-kit': "Neymar's fitness in doubt · squad locks June 2",
	'wc-friendly-brazil': 'Last match before the tournament',
	'wc-friendly-england': 'Final test before the opener',
	'wc-friendly-sweep': 'Brazil, Spain, France, Argentina all in action',
	'wc-kit-sellout': 'Replica demand spikes pre-tournament',
	'wc-injury-return': "Spain's teenage star",

	// Opening ceremony + first matchday
	'wc-anthem-star': 'First 48-team curtain-raiser',
	'wc-ceremony-record': 'First 48-team opener · huge reach',
	'wc-opener-early-goal': 'Tournament opener · openers often start cagey',
	'wc-opening-sellout': 'Home fans pack the first games',
	'wc-lineup-teen': "England's next generation",
	'wc-late-drama-grp': 'Drama from the very first day',

	// Group stage
	'wc-portugal-goal-grp': 'Three games · penalty duties his',
	'wc-late-qualify-goal': 'Final-round simultaneity = chaos',
	'wc-hosts-all-advance': 'USA, Mexico, Canada · home advantage',
	'wc-debutant-knockout': 'First expanded field · room for newcomers',
	'wc-top-team-lose-open': 'Slow starts happen to the best',
	'wc-comeback-grp': 'Second-half turnarounds',
	'wc-messi-goal': "Argentina's captain · three games",
	'wc-penalty-miss-grp': 'Nerves and great keepers',
	'wc-five-goal-game': 'Mismatches produce goal-fests',
	'wc-veteran-goal': 'Experience still finds the net',
	'wc-own-goal-grp': '2022 set an own-goal record',
	'wc-brazil-group-perfect': 'Group with Switzerland & Nigeria',
	'wc-clean-sheet-keeper': 'Concede nothing across three games',

	// Round of 32 / Round of 16
	'wc-portugal-r16': 'Group with Austria & Korea Rep.',
	'wc-netherlands-r16': 'Group with Turkey & Cameroon',
	'wc-r32-host-exit': 'USA, Mexico or Canada at risk',
	'wc-r32-extra-time': 'Win-or-go-home tightens games',
	'wc-r16-red-card': 'Stakes rise · tackles fly',
	'wc-r16-penalty-shootout': 'Knockout football · fine margins',

	// Quarter-finals
	'wc-netherlands-qf': 'Deep runs are their habit',
	'wc-germany-qf': 'Chasing a return to form',
	'wc-africa-qf': 'Morocco reached the semis in 2022',
	'wc-asia-qf': 'Japan and others on the rise',
	'wc-qf-late-winner': 'Tight games · late drama',
	'wc-qf-goalless-90': 'Caution grips the last eight',
	'wc-keeper-double-save': 'A keeper can be the hero',

	// Semi-finals
	'wc-europe-three-sf': 'Europe usually rules the last four',
	'wc-sf-comeback': 'Nerve under the brightest lights',

	// Final
	'wc-final-rematch': 'Some pairings come round again',
	'wc-final-red-card': 'Tension can boil over',
	'wc-final-extra-time': 'Three of the last six did',
	'wc-final-sub-scores': 'Bench impact decides finals',
	'wc-final-captain-30': 'Experience often lifts the cup',
	'wc-final-attendance': 'A huge venue for the showpiece',
	'wc-final-most-watched': 'A global audience across three host nations',

	// Tournament-wide records + awards
	'wc-golden-glove-eur': 'Europe stocks the top keepers',
	'wc-topscorer-host': 'Home strikers in the spotlight',
	'wc-cards-record': 'More teams · more bookings',
	'wc-goals-record': '104 matches · more chances',
	'wc-five-shootouts': 'More knockout ties than ever',
	'wc-manager-former-winner': 'Champions who became coaches'
} as const;

/**
 * Resolve the curated subtitle for a market id. Returns `undefined`
 * when no curated entry exists: callers should hide the subtitle
 * row in that case.
 */
export const lookupWcMarketSubtitle = (marketId: string): string | undefined =>
	WC_MARKET_SUBTITLES[marketId];
