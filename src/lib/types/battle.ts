/**
 * Social cohorts: battles.
 *
 * A battle is a time-bound competition between two parties:
 *
 *   - `league`: leagueA vs leagueB. Either league's owner can
 *     propose; the other league's owner accepts. The score is each
 *     league's prediction accuracy over the battle window, computed by
 *     the satellite from the delta of its `league_stats` counters
 *     between kickoff and settle (no human enters a score).
 *
 *   - `duel`: proposer principal vs challenger principal. Same
 *     state machine, simpler auth (both principals are explicit
 *     on the doc). Duels have no `league_stats` to delta, so they are
 *     out of scope for auto-resolution for now.
 *
 * State machine (forward-only):
 *
 *   proposed → accepted → in_flight → resolved
 *
 * Each transition is gated by the satellite assert on caller +
 * current state. Kickoff stamps each side's baseline counter snapshot;
 * resolve computes scores from the window delta and derives the
 * winner. The assert re-derives both from `league_stats` so a
 * hand-crafted write cannot post a false score.
 */

import { DAY_IN_MS, MINUTE_IN_MS } from '#lib/constants/app.constants.ts';
import { MACRO_IDS, type MacroId } from '#lib/constants/market-taxonomy.constants.ts';
import type { CategoryStatsBucket } from '#lib/types/user-stats.ts';
import { isNullish } from '@dfinity/utils';

export type BattleKind = 'league' | 'duel';

export type BattleState =
	'proposed' | 'accepted' | 'in_flight' | 'resolved' | 'declined' | 'expired';

export type BattleWinner = 'A' | 'B' | 'draw';

/**
 * Which calls count toward a battle's scoreline. `'all'` counts every
 * settled call regardless of category; any {@link MacroId} narrows the
 * battle to a single macro category (e.g. `'sports'`, `'economy'`). Picked
 * once at proposal time and frozen alongside the other identity fields.
 */
export type BattleScope = 'all' | MacroId;

/** Allowed scope values: `'all'` plus every macro category. */
export const BATTLE_SCOPES: ReadonlySet<BattleScope> = new Set<BattleScope>(['all', ...MACRO_IDS]);

/** Default scope when the proposer doesn't narrow the category. */
export const BATTLE_SCOPE_DEFAULT: BattleScope = 'all';

export const isBattleScope = (value: string): value is BattleScope =>
	(BATTLE_SCOPES as ReadonlySet<string>).has(value);

/** Inclusive bounds of the optional battle amount, in VXP. `0` means "pride only". */
export const BATTLE_AMOUNT_MIN = 0;
export const BATTLE_AMOUNT_MAX = 500;
export const BATTLE_AMOUNT_DEFAULT = BATTLE_AMOUNT_MIN;

/** Trash-talk message length cap; brevity is rewarded. */
export const BATTLE_TRASH_TALK_MAX_LENGTH = 60;

/**
 * How long a `proposed` battle waits for the opponent to respond before
 * it lapses to `expired`. Fixed; not exposed in the propose modal. The
 * deadline is stamped at proposal as `respondByMs = now + this`.
 */
export const BATTLE_RESPOND_BY_MS = 3 * DAY_IN_MS;

/**
 * Far upper bound on a single league's simultaneous `in_flight` battles.
 * A safety rail, not a product limit; normal use never approaches it.
 * Enforced client-side (the accept CTA is blocked at the cap); see the
 * spec for why a server-side count was deliberately not added.
 */
export const BATTLE_MAX_CONCURRENT_IN_FLIGHT = 100;

/**
 * Tolerance when the assert checks that an accept stamped `kickoffMs ≈
 * now`. The client uses `Date.now()` just before the call; the satellite
 * compares against IC `time()` at execution, a few seconds apart. Wide
 * enough to absorb that skew, tiny next to a multi-day window, so a
 * backdated window can't slip through.
 */
export const BATTLE_ACCEPT_CLOCK_TOLERANCE_MS = 5 * MINUTE_IN_MS;

export interface BattleDoc {
	/** Stable battle id: matches the doc key. */
	id: string;
	/** League-vs-league or principal-vs-principal? */
	kind: BattleKind;
	/** Side A: league id (for kind='league') OR proposer principal text (for kind='duel'). */
	sideA: string;
	/** Side B: league id (for kind='league') OR challenger principal text (for kind='duel'). */
	sideB: string;
	/** Who proposed the battle. Always a principal text. For 'league' battles this is the league.owner
	 *  at proposal time; for 'duel' battles this is sideA. */
	proposer: string;
	/** Current state. */
	state: BattleState;
	/** When the competition window opens (ms since epoch). Immutable after `accepted`. */
	kickoffMs: number;
	/** When the competition window closes (ms since epoch). Immutable after `accepted`. */
	settleMs: number;
	/**
	 * Which market category the battle counts. `'all'` (the default)
	 * counts every settled call; a {@link MacroId} narrows to one
	 * category. Chosen at proposal time and immutable thereafter.
	 * Absent on legacy rows written before the picker shipped; callers
	 * fall back to {@link BATTLE_SCOPE_DEFAULT}.
	 */
	scope?: BattleScope;
	/**
	 * Optional VXP amount shown on the battle, in
	 * [{@link BATTLE_AMOUNT_MIN}, {@link BATTLE_AMOUNT_MAX}]. `0` (the
	 * default) means pride only. Chosen at proposal time and immutable
	 * thereafter. Absent on legacy rows; callers fall back to
	 * {@link BATTLE_AMOUNT_DEFAULT}. Read stored docs through
	 * {@link readBattleDoc}: older ones carry it under another name.
	 */
	amount?: number;
	/**
	 * Optional short trash-talk message the proposer attaches, capped at
	 * {@link BATTLE_TRASH_TALK_MAX_LENGTH} chars. Chosen at proposal time
	 * and immutable thereafter.
	 */
	trashTalk?: string;
	/**
	 * Deadline (ms since epoch) by which the challenged side must accept
	 * or the proposal lapses to `expired`. Stamped at proposal as
	 * `now + {@link BATTLE_RESPOND_BY_MS}`. Absent on legacy rows written
	 * before expiry shipped; callers fall back to `kickoffMs` (the old
	 * "starts tomorrow" deadline). Immutable after the proposed state.
	 */
	respondByMs?: number;
	/**
	 * When the challenged side responded to the proposal, stamped on the
	 * league accept (`proposed → in_flight`, where it equals the freshly
	 * set `kickoffMs`) and on decline (`proposed → declined`). Not set by a
	 * duel accept (`proposed → accepted`), which doesn't start a clock, nor
	 * by `expired` (no response; that card uses {@link respondByMs}).
	 * Drives the proposer's inbox card "when".
	 */
	respondedAtMs?: number;
	/**
	 * Side A's counter snapshot at kickoff, for the battle's {@link scope}
	 * bucket. Stamped server-side on the `accepted → in_flight`
	 * transition and write-once thereafter. The window delta is
	 * `current league_stats − baseline`.
	 */
	baselineA?: CategoryStatsBucket;
	/** Side B's counter snapshot at kickoff. See {@link baselineA}. */
	baselineB?: CategoryStatsBucket;
	/** Side A accuracy score (0–100) over the window. Write-once at `resolved`. */
	scoreA?: number;
	/** Side B accuracy score (0–100) over the window. Write-once at `resolved`. */
	scoreB?: number;
	/** Side A window call count (`Δcalls`), the accuracy tie-break. Write-once at `resolved`. */
	callsA?: number;
	/** Side B window call count (`Δcalls`). Write-once at `resolved`. */
	callsB?: number;
	/** Derived from scores + call counts at settle. Write-once. */
	winner?: BattleWinner;
	/** When the battle resolved (ms since epoch). Write-once at `resolved`. */
	resolvedAtMs?: number;
}

/**
 * A battle doc as read from storage or an older API. Docs proposed before
 * the field was renamed hold the amount as `wager`, and Juno docs are never
 * rewritten in place.
 */
type StoredBattleDoc = BattleDoc & { wager?: number };

/**
 * The one read path for a stored battle doc: takes `amount`, falls back to
 * the legacy `wager`, and returns the doc without `wager`, so a doc spread
 * back into a write stores only `amount`.
 */
export const readBattleDoc = ({ wager, ...doc }: StoredBattleDoc): BattleDoc => {
	const amount = doc.amount ?? wager;

	return isNullish(amount) ? doc : { ...doc, amount };
};

/**
 * Window accuracy as a 0–100 percentage from a counter delta. A side
 * with no calls in the window scores 0 (it forfeits the face-off).
 */
export const battleAccuracyPct = ({ calls, wins }: CategoryStatsBucket): number =>
	calls > 0 ? Math.round((wins / calls) * 100) : 0;

/**
 * Derive the winner from both sides' window results. Accuracy-first
 * (matching the league-rank metric), tie-broken on prediction volume
 * (`calls`), then a draw. Two sides with zero windowed calls is a void
 * face-off → `draw`. Shared by the resolve endpoint and the assert so
 * both compute the identical outcome.
 */
export const deriveBattleWinner = ({
	scoreA,
	scoreB,
	callsA,
	callsB
}: {
	scoreA: number;
	scoreB: number;
	callsA: number;
	callsB: number;
}): BattleWinner => {
	if (scoreA !== scoreB) {
		return scoreA > scoreB ? 'A' : 'B';
	}

	if (callsA !== callsB) {
		return callsA > callsB ? 'A' : 'B';
	}

	return 'draw';
};

export const BATTLE_STATES: ReadonlySet<BattleState> = new Set<BattleState>([
	'proposed',
	'accepted',
	'in_flight',
	'resolved',
	'declined',
	'expired'
]);

export const BATTLE_KINDS: ReadonlySet<BattleKind> = new Set<BattleKind>(['league', 'duel']);

/**
 * Forward-only transition map. `current → allowed-next`. Terminal
 * states (`resolved`, `declined`, `expired`) have no outgoing edges.
 *
 * A `proposed` battle can: be accepted (duels go through `accepted`,
 * then a separate kickoff), kick off directly (league accept fuses the
 * kickoff; the window starts at acceptance), be declined by the
 * challenged side, or expire once `respondByMs` passes.
 */
export const BATTLE_TRANSITIONS: Readonly<Record<BattleState, ReadonlySet<BattleState>>> = {
	proposed: new Set<BattleState>(['accepted', 'in_flight', 'declined', 'expired']),
	accepted: new Set<BattleState>(['in_flight']),
	in_flight: new Set<BattleState>(['resolved']),
	resolved: new Set<BattleState>(),
	declined: new Set<BattleState>(),
	expired: new Set<BattleState>()
};
