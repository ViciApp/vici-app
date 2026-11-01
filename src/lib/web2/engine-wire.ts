import type { ClearingDid, RegistryDid } from '$declarations';
import { Principal } from '@icp-sdk/core/principal';

/**
 * Wire shapes and mappers for the HTTP API's public engine reads.
 *
 * The API proxies the registry / clearing canisters and serializes the candid
 * responses to JSON-clean trees: bigints become decimal strings, principals
 * become their text form, and candid optionals stay `[] | [value]` arrays.
 * These mappers convert that wire tree back into the exact `$declarations`
 * candid types the app's utils and stores already consume, so downstream code
 * stays backend-agnostic. Every mapper is explicit per field: a blanket
 * "digits back to bigint" pass could not tell a numeric id string from a
 * serialized bigint.
 */

/** Candid optional as it survives JSON serialization. */
type Opt<W> = [] | [W];

const mapOpt = <W, T>({ value, map }: { value: Opt<W>; map: (wire: W) => T }): [] | [T] =>
	value.length === 0 ? [] : [map(value[0])];

interface Web2DecimalValueWire {
	decimals: number;
	value: string;
}

const mapDecimalValue = (wire: Web2DecimalValueWire): ClearingDid.DecimalValue => ({
	decimals: wire.decimals,
	value: BigInt(wire.value)
});

interface Web2PriceWire {
	timestamp: Opt<string>;
	oracle_id: Opt<string>;
	decimal: Web2DecimalValueWire;
}

const mapPrice = (wire: Web2PriceWire): RegistryDid.Price => ({
	timestamp: mapOpt({ value: wire.timestamp, map: BigInt }),
	oracle_id: wire.oracle_id,
	decimal: mapDecimalValue(wire.decimal)
});

type Web2AssetWire =
	| { Erc20: { decimals: number; token_address: string; chain_id: string } }
	| { Icrc: string }
	| { NativeEvm: { decimals: number; chain_id: string } };

const mapAsset = (wire: Web2AssetWire): RegistryDid.Asset => {
	if ('Icrc' in wire) {
		return { Icrc: Principal.fromText(wire.Icrc) };
	}

	if ('Erc20' in wire) {
		return { Erc20: { ...wire.Erc20, chain_id: BigInt(wire.Erc20.chain_id) } };
	}

	return { NativeEvm: { ...wire.NativeEvm, chain_id: BigInt(wire.NativeEvm.chain_id) } };
};

type Web2PayoutUnitWire =
	| { Fiat: RegistryDid.FiatUnit }
	| { Asset: Web2AssetWire }
	| { NonMonetary: RegistryDid.NonMonetaryUnit };

const mapPayoutUnit = (wire: Web2PayoutUnitWire): RegistryDid.PayoutUnit =>
	'Asset' in wire ? { Asset: mapAsset(wire.Asset) } : wire;

export interface Web2SeriesWire {
	title: string;
	strike: Opt<Web2PriceWire>;
	creator: string;
	payoff_type: RegistryDid.PayoffType;
	engine_id: Opt<string>;
	payout_unit: Web2PayoutUnitWire;
	expiry_ns: string;
	banner_url: Opt<string>;
	start_ns: Opt<string>;
	series_id: string;
	underlying: string;
	locale: Opt<string>;
	description: RegistryDid.Description;
	resolution: RegistryDid.Resolution;
	outcomes: Opt<RegistryDid.Outcome[]>;
	created_at_ns: string;
	icon_url: Opt<string>;
	trading_access: RegistryDid.TradingAccess[];
	price_precision: number;
	balance_domain: RegistryDid.BalanceDomain;
	oracle_source: string;
	forked_from: Opt<string>;
}

export const mapSeries = (wire: Web2SeriesWire): RegistryDid.Series => ({
	title: wire.title,
	strike: mapOpt({ value: wire.strike, map: mapPrice }),
	creator: Principal.fromText(wire.creator),
	payoff_type: wire.payoff_type,
	engine_id: wire.engine_id,
	payout_unit: mapPayoutUnit(wire.payout_unit),
	expiry_ns: BigInt(wire.expiry_ns),
	banner_url: wire.banner_url,
	start_ns: mapOpt({ value: wire.start_ns, map: BigInt }),
	series_id: wire.series_id,
	underlying: wire.underlying,
	locale: wire.locale,
	description: wire.description,
	resolution: wire.resolution,
	outcomes: wire.outcomes,
	created_at_ns: BigInt(wire.created_at_ns),
	icon_url: wire.icon_url,
	trading_access: wire.trading_access,
	price_precision: wire.price_precision,
	balance_domain: wire.balance_domain,
	oracle_source: wire.oracle_source,
	forked_from: wire.forked_from
});

type Web2SettlementInputWire = { Price: Web2PriceWire } | { Outcome: string };

const mapSettlementInput = (wire: Web2SettlementInputWire): ClearingDid.SettlementInput =>
	'Price' in wire ? { Price: mapPrice(wire.Price) } : wire;

export interface Web2SettlementStatusWire {
	status: ClearingDid.PlanStatus;
	series_id: string;
	fee_usd: string;
	accounting_cursor: string;
	insurance_fee_usd: string;
	accounting_applied: boolean;
	balance_domain: ClearingDid.BalanceDomain;
	oracle_source: string;
	total_positions: string;
	settlement: Web2SettlementInputWire;
}

export const mapSettlementStatus = (
	wire: Web2SettlementStatusWire
): ClearingDid.SettlementStatusView => ({
	status: wire.status,
	series_id: wire.series_id,
	fee_usd: BigInt(wire.fee_usd),
	accounting_cursor: BigInt(wire.accounting_cursor),
	insurance_fee_usd: BigInt(wire.insurance_fee_usd),
	accounting_applied: wire.accounting_applied,
	balance_domain: wire.balance_domain,
	oracle_source: wire.oracle_source,
	total_positions: BigInt(wire.total_positions),
	settlement: mapSettlementInput(wire.settlement)
});

export interface Web2PriceCandleWire {
	low: Web2PriceWire;
	high: Web2PriceWire;
	close: Web2PriceWire;
	open: Web2PriceWire;
	volume: string;
	trade_count: string;
	bucket_start_ns: string;
}

export const mapPriceCandle = (wire: Web2PriceCandleWire): ClearingDid.SeriesPriceCandle => ({
	low: mapPrice(wire.low),
	high: mapPrice(wire.high),
	close: mapPrice(wire.close),
	open: mapPrice(wire.open),
	volume: BigInt(wire.volume),
	trade_count: BigInt(wire.trade_count),
	bucket_start_ns: BigInt(wire.bucket_start_ns)
});

export interface Web2SeriesTradePageWire {
	next_cursor: Opt<string>;
	items: {
		qty: string;
		timestamp: string;
		event_id: string;
		price: Web2PriceWire;
	}[];
}

export const mapSeriesTradePage = (
	wire: Web2SeriesTradePageWire
): ClearingDid.SeriesTradeHistoryPage => ({
	next_cursor: mapOpt({ value: wire.next_cursor, map: BigInt }),
	items: wire.items.map(({ qty, timestamp, event_id, price }) => ({
		qty: BigInt(qty),
		timestamp: BigInt(timestamp),
		event_id: BigInt(event_id),
		price: mapPrice(price)
	}))
});

export interface Web2SeriesTradedVolumeWire {
	series_id: string;
	volume: string;
	trade_count: string;
}

export const mapSeriesTradedVolume = (
	wire: Web2SeriesTradedVolumeWire
): ClearingDid.SeriesTradedVolume => ({
	series_id: wire.series_id,
	volume: BigInt(wire.volume),
	trade_count: BigInt(wire.trade_count)
});

export interface Web2CollateralAssetInfoWire {
	metrics: Opt<{
		haircut_bps: number;
		latest_transfer_fee: Opt<string>;
		insurance_fee_ratio: Opt<number>;
		last_updated_ns: Opt<string>;
		protocol_fee_ratio: Opt<number>;
		price_usd: Web2DecimalValueWire;
	}>;
	config: {
		decimals: number;
		asset: Web2AssetWire;
		is_enabled: boolean;
		allowed_balance_domains: ClearingDid.BalanceDomain[];
		oracle_id: Opt<string>;
		asset_id: string;
		symbol: string;
	};
}

export const mapCollateralAssetInfo = (
	wire: Web2CollateralAssetInfoWire
): ClearingDid.CollateralAssetInfo => ({
	metrics: mapOpt({
		value: wire.metrics,
		map: (metrics) => ({
			haircut_bps: metrics.haircut_bps,
			latest_transfer_fee: mapOpt({ value: metrics.latest_transfer_fee, map: BigInt }),
			insurance_fee_ratio: metrics.insurance_fee_ratio,
			last_updated_ns: mapOpt({ value: metrics.last_updated_ns, map: BigInt }),
			protocol_fee_ratio: metrics.protocol_fee_ratio,
			price_usd: mapDecimalValue(metrics.price_usd)
		})
	}),
	config: {
		...wire.config,
		asset: mapAsset(wire.config.asset)
	}
});

export interface Web2LeaderboardEntryWire {
	principal: string;
	prior_rank: Opt<string>;
	rank: string;
	realized_pnl: string;
	win_count: string;
	settled_count: string;
}

export const mapLeaderboardEntry = (
	wire: Web2LeaderboardEntryWire
): ClearingDid.LeaderboardEntry => ({
	principal: Principal.fromText(wire.principal),
	prior_rank: mapOpt({ value: wire.prior_rank, map: BigInt }),
	rank: BigInt(wire.rank),
	realized_pnl: BigInt(wire.realized_pnl),
	win_count: BigInt(wire.win_count),
	settled_count: BigInt(wire.settled_count)
});

export interface Web2LimitOrderWire {
	qty: string;
	creator: string;
	outcome_id: Opt<string>;
	blocked_margin_usd: string;
	series_id: string;
	side: ClearingDid.Side;
	order_id: string;
	price: Web2PriceWire;
	balance_domain: ClearingDid.BalanceDomain;
}

export const mapLimitOrder = (wire: Web2LimitOrderWire): ClearingDid.LimitOrder => ({
	qty: BigInt(wire.qty),
	creator: Principal.fromText(wire.creator),
	outcome_id: wire.outcome_id,
	blocked_margin_usd: BigInt(wire.blocked_margin_usd),
	series_id: wire.series_id,
	side: wire.side,
	order_id: wire.order_id,
	price: mapPrice(wire.price),
	balance_domain: wire.balance_domain
});

export interface Web2PositionWire {
	outcome_id: Opt<string>;
	series_id: string;
	net_qty: string;
	user: string;
	reserved_margin_usd: string;
}

export const mapPosition = (wire: Web2PositionWire): ClearingDid.Position => ({
	outcome_id: wire.outcome_id,
	series_id: wire.series_id,
	net_qty: BigInt(wire.net_qty),
	user: Principal.fromText(wire.user),
	reserved_margin_usd: BigInt(wire.reserved_margin_usd)
});

export interface Web2EventWire {
	qty: string;
	series_id: string;
	user: string;
	timestamp: string;
	event_id: string;
	price: Web2PriceWire;
	event_type: ClearingDid.EventType;
	clearing_id: string;
}

export const mapEvent = (wire: Web2EventWire): ClearingDid.Event => ({
	qty: BigInt(wire.qty),
	series_id: wire.series_id,
	user: Principal.fromText(wire.user),
	timestamp: BigInt(wire.timestamp),
	event_id: BigInt(wire.event_id),
	price: mapPrice(wire.price),
	event_type: wire.event_type,
	clearing_id: Principal.fromText(wire.clearing_id)
});

interface Web2AssetWorthWire {
	pre_haircut_value_usd: string;
	haircut_bps: number;
	balance: string;
	value_usd: string;
	asset_id: string;
}

/** Domain-keyed candid maps (`vec record { BalanceDomain; nat }`) survive JSON
 * as pair arrays; only the numeric halves need reviving. */
type Web2DomainPairsWire = [ClearingDid.BalanceDomain, string][];

const mapDomainPairs = (wire: Web2DomainPairsWire): Array<[ClearingDid.BalanceDomain, bigint]> =>
	wire.map(([domain, value]) => [domain, BigInt(value)]);

export interface Web2AccountStateResponseWire {
	assets: Web2AssetWorthWire[];
	state: {
		user: string;
		reserved_margins_usd: Web2DomainPairsWire;
		cash_balances_usd: Web2DomainPairsWire;
		balances: [ClearingDid.BalanceDomain, [string, string][]][];
	};
	total_equity_usd: string;
	available_margin_usd: string;
}

export const mapAccountStateResponse = (
	wire: Web2AccountStateResponseWire
): ClearingDid.AccountStateResponse => ({
	assets: wire.assets.map((asset) => ({
		pre_haircut_value_usd: BigInt(asset.pre_haircut_value_usd),
		haircut_bps: asset.haircut_bps,
		balance: BigInt(asset.balance),
		value_usd: BigInt(asset.value_usd),
		asset_id: asset.asset_id
	})),
	state: {
		user: Principal.fromText(wire.state.user),
		reserved_margins_usd: mapDomainPairs(wire.state.reserved_margins_usd),
		cash_balances_usd: mapDomainPairs(wire.state.cash_balances_usd),
		balances: wire.state.balances.map(([domain, entries]) => [
			domain,
			entries.map(([assetId, balance]): [string, bigint] => [assetId, BigInt(balance)])
		])
	},
	total_equity_usd: BigInt(wire.total_equity_usd),
	available_margin_usd: BigInt(wire.available_margin_usd)
});

/** The API selects the candle interval by name; map the candid variant the
 * chart utils produce onto that query value. */
export const intervalToWire = (interval: ClearingDid.PriceHistoryInterval): 'hour' | 'day' =>
	'Hour' in interval ? 'hour' : 'day';

/** The API selects the balance domain by its candid variant name. */
export const balanceDomainToWire = (domain: ClearingDid.BalanceDomain): string =>
	Object.keys(domain)[0];

/** The API selects the leaderboard window by name; map the candid variant the
 * standings service produces onto that query value. */
export const leaderboardWindowToWire = (
	window: ClearingDid.LeaderboardWindow
): 'week' | 'month' | 'all_time' =>
	'Week' in window ? 'week' : 'Month' in window ? 'month' : 'all_time';
