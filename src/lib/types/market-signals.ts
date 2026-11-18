import type { CallSide, MarketId } from '#lib/types/market.ts';
import type { FlowArtCategory } from '#lib/utils/flow-art.utils.ts';
import type { PrincipalText } from '@junobuild/schema';

export interface CategoryAccuracySignal {
	category: FlowArtCategory;
	accuracy: number;
	calls: number;
	wins: number;
}

export interface PriorCallSignal {
	marketId: MarketId;
	side: CallSide;
	when: string;
	consensusThen?: number;
}

export interface FollowedLeanSignal {
	marketId: MarketId;
	yes: number;
	total: number;
}

/**
 * One leaderboard-ranked predictor who holds a live position on a market,
 * with the side they actually committed. Unlike the viewer-relative signals
 * above this is public data: the same list for every visitor.
 */
export interface TopPredictorSignal {
	owner: PrincipalText;
	side: CallSide;
}

export interface UserMarketSignals {
	categoryAcc: Partial<Record<FlowArtCategory, CategoryAccuracySignal>>;
	priorCalls: Partial<Record<MarketId, PriorCallSignal>>;
	followedLean: Partial<Record<MarketId, FollowedLeanSignal>>;
}
