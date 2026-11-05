import { ZERO } from '#lib/constants/app.constants.ts';
import type {
	CategoryAccuracySignal,
	PriorCallSignal,
	UserMarketSignals
} from '#lib/types/market-signals.ts';
import type { CallSide, MarketId } from '#lib/types/market.ts';
import { resolveFlowArtCategory, type FlowArtCategory } from '#lib/utils/flow-art.utils.ts';
import {
	eventExecutionPrice,
	isExecutedEvent,
	isSettledEvent,
	isWinningSettledEvent
} from '#lib/utils/resolved-position.utils.ts';
import { parseMarketId } from '#lib/validation/market.validation.ts';
import type { ClearingDid } from '$declarations';
import { isNullish } from '@dfinity/utils';

const eventSide = (event: ClearingDid.Event): CallSide => (event.qty >= ZERO ? 'YES' : 'NO');

const eventCategory = ({
	event,
	tagsBySeries
}: {
	event: ClearingDid.Event;
	tagsBySeries: Record<string, string[]>;
}): FlowArtCategory => {
	const marketId = parseMarketId(event.series_id);

	return resolveFlowArtCategory({ tags: tagsBySeries[marketId], seed: marketId });
};

const formatWhen = (timestampNs: bigint): string => {
	const date = new Date(Number(timestampNs / 1_000_000n));

	if (Number.isNaN(date.getTime())) {
		return '';
	}

	return date.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
};

const eventConsensus = (event: ClearingDid.Event): number | undefined => {
	const value = eventExecutionPrice(event);

	if (!Number.isFinite(value)) {
		return;
	}

	return Math.max(0, Math.min(1, value));
};

export const deriveCategoryAccuracySignals = ({
	events,
	tagMappings
}: {
	events: ClearingDid.Event[];
	tagMappings: Record<string, string[]>;
}): Partial<Record<FlowArtCategory, CategoryAccuracySignal>> => {
	const bucket = new Map<FlowArtCategory, { calls: number; wins: number }>();

	for (const event of events.filter(isSettledEvent)) {
		const category = eventCategory({ event, tagsBySeries: tagMappings });
		const current = bucket.get(category) ?? { calls: 0, wins: 0 };
		current.calls += 1;
		current.wins += isWinningSettledEvent(event) ? 1 : 0;
		bucket.set(category, current);
	}

	const signals: Partial<Record<FlowArtCategory, CategoryAccuracySignal>> = {};

	for (const [category, { calls, wins }] of bucket.entries()) {
		signals[category] = {
			category,
			calls,
			wins,
			accuracy: calls > 0 ? wins / calls : 0
		};
	}

	return signals;
};

export const derivePriorCallSignals = (
	events: ClearingDid.Event[]
): Partial<Record<MarketId, PriorCallSignal>> => {
	const priorCalls: Partial<Record<MarketId, PriorCallSignal>> = {};
	const latestTimestampByMarket = new Map<MarketId, bigint>();

	for (const event of events) {
		if (isExecutedEvent(event)) {
			const marketId = parseMarketId(event.series_id);
			const previous = latestTimestampByMarket.get(marketId);

			if (isNullish(previous) || event.timestamp > previous) {
				latestTimestampByMarket.set(marketId, event.timestamp);
				priorCalls[marketId] = {
					marketId,
					side: eventSide(event),
					when: formatWhen(event.timestamp),
					consensusThen: eventConsensus(event)
				};
			}
		}
	}

	return priorCalls;
};

/**
 * The set of market ids the viewer has an executed call on — the
 * deck-exclusion input for Flow (`prepareFlow`). Deliberately lighter than
 * {@link derivePriorCallSignals}: it skips the per-market latest-event
 * resolution, date formatting, and consensus conversion that only the
 * card back face needs, keeping just the ids. Fails open per event (a
 * malformed `series_id` is skipped, not thrown) so one bad legacy event
 * can't crash the deck build.
 */
export const deriveCalledMarketIds = (events: ClearingDid.Event[]): Set<MarketId> => {
	const ids = new Set<MarketId>();

	for (const event of events.filter(isExecutedEvent)) {
		try {
			ids.add(parseMarketId(event.series_id));
		} catch {
			// Skip a malformed/legacy `series_id` rather than crashing a
			// derivation that iterates the viewer's whole trade history.
		}
	}

	return ids;
};

/**
 * Trade-history-derived signals (category accuracy + prior calls). The
 * friends-lean signal is sourced separately from the clearing canister's
 * privacy-preserving `aggregate_lean` query — see
 * `#lib/services/followed-lean.services.ts` — and merged in by the caller, so
 * it is not produced here.
 */
export const deriveUserMarketSignals = ({
	events,
	tagMappings
}: {
	events: ClearingDid.Event[];
	tagMappings: Record<string, string[]>;
}): Omit<UserMarketSignals, 'followedLean'> => ({
	categoryAcc: deriveCategoryAccuracySignals({ events, tagMappings }),
	priorCalls: derivePriorCallSignals(events)
});
