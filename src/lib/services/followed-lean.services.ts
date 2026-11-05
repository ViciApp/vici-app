import { aggregateLean as aggregateLeanApi } from '#lib/api/clearing.api.ts';
import { MAX_MARKETS } from '#lib/services/flow-prep.services.ts';
import { safeGetIdentityOnce } from '#lib/services/identity.services.ts';
import type { FollowedLeanSignal } from '#lib/types/market-signals.ts';
import type { MarketId } from '#lib/types/market.ts';
import { parseMarketId } from '#lib/validation/market.validation.ts';
import type { ClearingDid } from '$declarations';
import { fromNullable, isNullish, nonNullish } from '@dfinity/utils';
import type { Identity } from '@icp-sdk/core/agent';
import { Principal } from '@icp-sdk/core/principal';
import type { PrincipalText } from '@junobuild/schema';

/**
 * Maps one series' aggregate lean onto the binary YES/NO shape the Flow card
 * consumes. The clearing query reports per-outcome counts; the card's social
 * row is the binary payoff, so we read the `None` (binary long-vs-short)
 * outcome — `long` = YES holders, `short` = NO holders. Returns `undefined`
 * when no followed principal holds a non-flat binary position, so the caller
 * omits the market (the card then shows its neutral fallback line rather than
 * an awkward "0 · 0").
 */
const toFollowedLean = ({
	marketId,
	lean
}: {
	marketId: MarketId;
	lean: ClearingDid.AggregateLean;
}): FollowedLeanSignal | undefined => {
	const binary = lean.outcomes.find((o) => isNullish(fromNullable(o.outcome_id)));

	if (isNullish(binary)) {
		return;
	}

	const total = Number(binary.total);

	if (total <= 0) {
		return;
	}

	return { marketId, yes: Number(binary.long), total };
};

/**
 * Per-market YES/NO lean of the predictors a viewer follows, sourced from the
 * clearing canister's privacy-preserving `aggregate_lean` query.
 *
 * Given the viewer's followed principal set, each market is aggregated over
 * that set: the query returns counts only (never identities, sides, amounts,
 * or P&L), so no individual follow's own position is ever singled out. The
 * result is a sparse map — markets with no non-flat followed position are
 * omitted, and the whole signal is empty when the viewer follows no one.
 *
 * Fails open: any per-market query error drops that market from the map
 * rather than rejecting, so a card never blocks on this signal.
 */
export const getFollowedLean = async ({
	following,
	seriesIds
}: {
	following: PrincipalText[];
	seriesIds: MarketId[];
}): Promise<Partial<Record<MarketId, FollowedLeanSignal>>> => {
	if (following.length === 0 || seriesIds.length === 0) {
		return {};
	}

	const identity = await safeGetIdentityOnce();
	const principals = following.map((p) => Principal.fromText(p));

	// Cap the fan-out at the Flow deck size: one `aggregate_lean` query per
	// market a session can show, so the round-trip count can't drift from the
	// deck cap (`MAX_MARKETS`). Markets beyond it fall back to the
	// predictors-count line until they surface.
	return await aggregateFollowedLean({
		identity,
		principals,
		seriesIds: seriesIds.slice(0, MAX_MARKETS)
	});
};

const aggregateFollowedLean = async ({
	identity,
	principals,
	seriesIds
}: {
	identity: Identity;
	principals: Principal[];
	seriesIds: MarketId[];
}): Promise<Partial<Record<MarketId, FollowedLeanSignal>>> => {
	const entries = await Promise.all(
		seriesIds.map((marketId): Promise<FollowedLeanSignal | undefined> =>
			aggregateLeanApi({
				identity,
				params: { series_id: marketId, principals },
				certified: false
			})
				.then((lean) => toFollowedLean({ marketId: parseMarketId(marketId), lean }))
				// Per-market failures are non-fatal: drop this market from the
				// lean map so the card falls back rather than blocking the deck.
				.catch(() => undefined)
		)
	);

	const followedLean: Partial<Record<MarketId, FollowedLeanSignal>> = {};

	for (const entry of entries) {
		if (nonNullish(entry)) {
			followedLean[entry.marketId] = entry;
		}
	}

	return followedLean;
};
