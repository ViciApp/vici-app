import type { CallSide, MarketId } from '#lib/types/market.ts';
import type { FlowArtCategory } from '#lib/utils/flow-art.utils.ts';

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

export interface UserMarketSignals {
	categoryAcc: Partial<Record<FlowArtCategory, CategoryAccuracySignal>>;
	priorCalls: Partial<Record<MarketId, PriorCallSignal>>;
}
