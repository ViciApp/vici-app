import type { MarketId } from '#lib/types/market.ts';

/**
 * One settled call in the "while you were away" digest; a row in the Flow
 * entry recap and the {@link ResolutionRevealData} list. `side` is the side
 * the user held ('YES' / 'NO' / a categorical outcome title), `result` is the
 * tri-state outcome ('won' | 'lost' | 'neutral'), and `net` is the realized
 * VXP cashflow (positive on a win, zero on neutral, negative on a loss)
 * already scaled to whole VXP. `won` is kept as a convenience alias
 * (`result === 'won'`) for templates that only branch on won vs. not-won.
 */
export interface ResolutionItem {
	eventId: bigint;
	marketId: MarketId;
	question: string;
	side: string;
	sideKey: 'yes' | 'no' | 'hold';
	result: 'won' | 'lost' | 'neutral';
	/** Convenience alias for `result === 'won'`. */
	won: boolean;
	net: number;
}

/**
 * Aggregate of every call that settled since the user last acknowledged their
 * resolutions. Drives both the Flow entry away-digest and the
 * {@link ResolutionReveal} overlay (which the Dashboard banner opens). A
 * `count` of 0 means there is nothing new to settle; the Flow entry falls
 * back to the deck-shuffle loading state and the Dashboard banner hides.
 *
 * `titlesLoading` is true while the per-row market titles are still
 * resolving: the markets catalog hasn't loaded yet, or, for a non-English
 * reader with the translated preference: the translation overlay hasn't
 * answered for every settled market. The counts and net VXP are already
 * correct (they come straight off the positions), so the reveals only hold
 * or skeleton the titles instead of rendering the `Unknown Market` fallback
 * or flashing the untranslated original.
 */
export interface ResolutionRevealData {
	items: ResolutionItem[];
	count: number;
	wins: number;
	losses: number;
	neutrals: number;
	netVxp: number;
	titlesLoading: boolean;
}

/**
 * A centered VXP-grant pop. Routine swipes mint nothing (deflation-safe
 * economy), so every pop is a genuine engine award; the overtime finish
 * or a lifetime-volume milestone.
 */
export interface XpPop {
	id: number;
	amount: number;
	// Paired copy ("First call.", "Ten deep.") shown above the number.
	copy?: string;
}

/**
 * How a Flow session was entered, for product analytics: `'tap'` is a
 * deliberate user action (the "Enter Flow →" CTA or a tap-anywhere on the
 * entry beat), `'auto'` is a timer-driven auto-enter (the deck-mode dwell or
 * the digest safety net). Carried on the `flow_session_started` event so the
 * funnel can separate intentional opens from passive auto-entries.
 */
export type FlowEntryMethod = 'tap' | 'auto';
