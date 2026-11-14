import type { RegistryDid } from '#declarations';
import { VICI_ENGINE_ID } from '#lib/constants/icdc.constants.ts';
import { getMarketsLite } from '#lib/services/market.services.ts';
import { getSettledSeriesIds } from '#lib/services/resolution.services.ts';
import type { CalibrationCard } from '#lib/types/calibration.ts';
import type { Market } from '#lib/types/market.ts';

/**
 * Builds the Calibration practice deck: finalised Vici-engine binary
 * markets, outcome hidden until the user commits.
 *
 * Our normal market list does not scope by engine; the live Flow / Markets
 * surfaces show every engine's markets. Calibration is different: the
 * reward only mints for Vici-engine (`eng_0`) binary markets, so the deck
 * filters on `engineId` here to avoid arming the user on a card that the
 * server will always reject with `not_vici_market`.
 *
 * "Which markets are resolved" comes from clearing's authoritative
 * `list_settled_series` (scoped to the ViciXp domain) rather than from the
 * activity-log-derived `status`: clearing is the single source of truth for
 * resolution, so a series is in the deck only if it is in that settled set.
 * The market view-models still come from {@link getMarketsLite} (titles, engine,
 * payoff shape, and the activity-derived outcome label used only to drop
 * un-scoreable cards below): the deck never reads order-book prices, so the
 * lite fetch avoids a catalog-wide book fan-out.
 *
 * Inclusion gate (all must hold):
 * - settled per `list_settled_series`: the authoritative resolved set;
 * - `engineId === VICI_ENGINE_ID`: matches the server's market gate;
 * - `payoffType === 'Binary'`: the only shape with a YES / NO call;
 * - `outcome` is `'YES'` or `'NO'`: a definite side. A settled market
 *   whose settlement was a cancellation / undetermined outcome carries no
 *   binary side, so the server would return `outcome_undetermined`; we
 *   drop it from the deck rather than surface an un-scoreable card.
 *
 * The mint path is untouched: `claimCalibrationReward` independently
 * validates correctness server-side via `get_settlement_status`, so this
 * change is deck-sourcing only.
 *
 * Per-market dedupe (already-earned markets) is enforced server-side via
 * the award-doc key, returning `alreadyClaimed`: the practice surface
 * advances gracefully on that result rather than pre-excluding here, so
 * the deck never needs the user's full award history to build.
 */
export const getCalibrationDeck = async (): Promise<CalibrationCard[]> => {
	// The reward pays in VXP, so scope the deck to the ViciXp domain.
	const domain: RegistryDid.BalanceDomain = { ViciXp: null };

	// Both inputs must share a certification level: `getMarketsLite` forces
	// `certified: true`, so the settled set must too. Mixing a certified
	// catalog with an uncertified settled set can transiently drop a
	// recently-settled series, wrongly flipping its eligibility.
	const [markets, settledIds] = await Promise.all([
		getMarketsLite(domain),
		getSettledSeriesIds({ certified: true, balanceDomain: domain })
	]);

	return markets
		.filter((market) => isCalibrationEligible({ market, settledIds }))
		.map((market) => ({ market }));
};

const isCalibrationEligible = ({
	market,
	settledIds
}: {
	market: Market;
	settledIds: Set<string>;
}): boolean =>
	settledIds.has(market.id) &&
	market.engineId === VICI_ENGINE_ID &&
	market.payoffType === 'Binary' &&
	(market.outcome === 'YES' || market.outcome === 'NO');
