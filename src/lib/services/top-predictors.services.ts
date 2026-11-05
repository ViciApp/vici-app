import { aggregateLean as aggregateLeanApi } from '#lib/api/clearing.api.ts';
import { getIdentityOrAnonymous } from '#lib/services/identity.services.ts';
import type { TopPredictorSignal } from '#lib/types/market-signals.ts';
import type { MarketId } from '#lib/types/market.ts';
import type { ClearingDid } from '$declarations';
import { fromNullable, isNullish, nonNullish } from '@dfinity/utils';
import { Principal } from '@icp-sdk/core/principal';
import type { PrincipalText } from '@junobuild/schema';

/**
 * How many leaderboard candidates are probed per market. Each probe is one
 * uncertified `aggregate_lean` query, so the cap bounds the fan-out a single
 * market-detail open can issue while still leaving headroom to find
 * {@link TOP_PREDICTORS_LIMIT} holders below the very top of the board.
 */
const TOP_PREDICTORS_SCAN_CAP = 16;

/**
 * How many predictors the market-detail section renders.
 */
const TOP_PREDICTORS_LIMIT = 4;

/**
 * Maps one candidate's singleton aggregate lean onto their committed side.
 * Returns `undefined` when the candidate holds no non-flat binary position on
 * the series, so the caller drops them from the list. With a single supplied
 * principal the binary outcome's `long`/`short` counts are that principal's
 * own lean — the same fact their trade already published to the public
 * activity feed, so no privacy boundary is crossed.
 */
const toTopPredictor = ({
	owner,
	lean
}: {
	owner: PrincipalText;
	lean: ClearingDid.AggregateLean;
}): TopPredictorSignal | undefined => {
	const binary = lean.outcomes.find((o) => isNullish(fromNullable(o.outcome_id)));

	if (isNullish(binary) || Number(binary.total) <= 0) {
		return;
	}

	return { owner, side: Number(binary.long) > 0 ? 'YES' : 'NO' };
};

/**
 * The leaderboard-ranked predictors who actually hold a position on one
 * market, each with the side they took — the data behind the market detail's
 * "Top predictors here" section.
 *
 * `candidates` is the global leaderboard's principal order (best first);
 * rank on the board is the "top" criterion, holding a live position here is
 * the "here" criterion. The first {@link TOP_PREDICTORS_SCAN_CAP} candidates
 * are probed concurrently and the first {@link TOP_PREDICTORS_LIMIT} holders
 * in rank order are returned. Public read — works signed-out via the
 * anonymous identity.
 *
 * Fails open per candidate: a probe error drops that candidate rather than
 * rejecting the list, so one flaky query never blanks the section.
 */
export const getMarketTopPredictors = async ({
	marketId,
	candidates
}: {
	marketId: MarketId;
	candidates: PrincipalText[];
}): Promise<TopPredictorSignal[]> => {
	if (candidates.length === 0) {
		return [];
	}

	const identity = await getIdentityOrAnonymous();

	const probed = await Promise.all(
		candidates
			.slice(0, TOP_PREDICTORS_SCAN_CAP)
			.map(async (owner): Promise<TopPredictorSignal | undefined> => {
				try {
					const lean = await aggregateLeanApi({
						identity,
						params: { series_id: marketId, principals: [Principal.fromText(owner)] },
						certified: false
					});

					return toTopPredictor({ owner, lean });
				} catch {
					// The try also covers `Principal.fromText` — a malformed
					// owner string in the cached leaderboard drops just this
					// candidate instead of rejecting the whole `Promise.all`.
				}
			})
	);

	return probed.filter(nonNullish).slice(0, TOP_PREDICTORS_LIMIT);
};
