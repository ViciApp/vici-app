// Deterministic stand-ins for the clearing + registry canisters and the VXP
// ledger, installed by the E2E server through the same provider seams the
// unit tests use (setEngineActorProvider / setVxpLedgerProvider). They serve
// the fixture catalog read-only and hold no state:
//
//   - public reads answer from fixtures.ts (live markets, one settled market,
//     the VXP collateral asset, empty trade tapes and leaderboards);
//   - every account reads as the never-deposited empty account, the state a
//     new custodial principal really has, through the same NoAccountStateFound
//     mapping the production wrapper applies;
//   - any method not listed here, including every write (orders, collateral,
//     settlement, transfers), rejects. Nothing can be submitted anywhere, and
//     an unexpected engine call surfaces as a failing request in the specs
//     instead of silently passing.

import { toNullable } from '@dfinity/utils';
import { Principal } from '@icp-sdk/core/principal';
import type {
	ClearingDid,
	ClearingService,
	RegistryDid,
	RegistryService
} from '../src/declarations';
import type { EngineActorProvider } from '../src/engine/actors';
import { ZERO } from '../src/lib/constants';
import type { VxpLedger, VxpLedgerProvider } from '../src/vxp/payout';
import {
	E2E_ALL_SERIES,
	E2E_CREATOR_PRINCIPAL,
	E2E_ENGINE_ID,
	E2E_ORACLE_ID,
	E2E_SETTLED_SERIES,
	type E2eSeries
} from './fixtures';

const NS_PER_MS = BigInt(1_000_000);

/** Seeded VXP ledger id (migration 0003): collateral catalog data only. */
const VXP_LEDGER_CANISTER_ID = 's7ux4-yyaaa-aaaam-qidha-cai';

const VXP_DECIMALS = 8;

/** Fixed so every run serves byte-identical series payloads. */
const CREATED_AT_NS = BigInt(Date.parse('2025-01-01T00:00:00.000Z')) * NS_PER_MS;

const nsFromIso = (iso: string): bigint => BigInt(Date.parse(iso)) * NS_PER_MS;

const VICI_XP: RegistryDid.BalanceDomain = { ViciXp: null };

const toSeries = (fixture: E2eSeries): RegistryDid.Series => ({
	title: fixture.title,
	strike: toNullable(),
	creator: Principal.fromText(E2E_CREATOR_PRINCIPAL),
	payoff_type: { Binary: null },
	engine_id: toNullable(E2E_ENGINE_ID),
	payout_unit: { Fiat: { Usd: null } },
	expiry_ns: nsFromIso(fixture.expiry),
	banner_url: toNullable(),
	start_ns: toNullable(),
	series_id: fixture.seriesId,
	underlying: fixture.seriesId,
	locale: toNullable('en'),
	description: { plain: fixture.description, html: toNullable(), markdown: toNullable() },
	resolution: { clause: fixture.description },
	outcomes: toNullable(),
	created_at_ns: CREATED_AT_NS,
	icon_url: toNullable(),
	trading_access: [{ Open: null }],
	price_precision: 8,
	balance_domain: VICI_XP,
	oracle_source: E2E_ORACLE_ID,
	forked_from: toNullable()
});

const ALL_SERIES = E2E_ALL_SERIES.map(toSeries);

const isTradeableNow = (series: RegistryDid.Series): boolean =>
	series.expiry_ns > BigInt(Date.now()) * NS_PER_MS;

const onePage = (items: RegistryDid.Series[]): RegistryDid.SeriesPage => ({
	items,
	next_cursor: toNullable()
});

const settledStatus = (): ClearingDid.SettlementStatusView => ({
	status: { Finalised: null },
	series_id: E2E_SETTLED_SERIES.seriesId,
	fee_usd: ZERO,
	accounting_cursor: ZERO,
	insurance_fee_usd: ZERO,
	accounting_applied: true,
	balance_domain: VICI_XP,
	oracle_source: E2E_ORACLE_ID,
	total_positions: ZERO,
	settlement: {
		Price: {
			timestamp: toNullable(nsFromIso(E2E_SETTLED_SERIES.expiry)),
			oracle_id: toNullable(E2E_ORACLE_ID),
			// Binary payoff convention: 100 settles YES, 0 settles NO.
			decimal: {
				value: E2E_SETTLED_SERIES.settledOutcome === 'YES' ? BigInt(100) : ZERO,
				decimals: 0
			}
		}
	}
});

const vxpCollateral: ClearingDid.CollateralAssetInfo = {
	metrics: toNullable({
		haircut_bps: 0,
		latest_transfer_fee: toNullable(BigInt(100_000)),
		insurance_fee_ratio: toNullable(),
		last_updated_ns: toNullable(CREATED_AT_NS),
		protocol_fee_ratio: toNullable(),
		price_usd: { value: BigInt(1), decimals: 2 }
	}),
	config: {
		decimals: VXP_DECIMALS,
		asset: { Icrc: Principal.fromText(VXP_LEDGER_CANISTER_ID) },
		is_enabled: true,
		allowed_balance_domains: [VICI_XP],
		oracle_id: toNullable(),
		asset_id: 'VXP',
		symbol: 'VXP'
	}
};

const noAccount: ClearingDid.GetAccountStateResult = { Err: { NoAccountStateFound: null } };

const registryMethods: Partial<Record<keyof RegistryService, unknown>> = {
	get_series: (seriesId: string) =>
		Promise.resolve(toNullable(ALL_SERIES.find((series) => series.series_id === seriesId))),
	list_series: () => Promise.resolve(onePage(ALL_SERIES)),
	list_series_with: (params: RegistryDid.ListSeriesParams) =>
		Promise.resolve(
			onePage(params.tradeable_now[0] === true ? ALL_SERIES.filter(isTradeableNow) : ALL_SERIES)
		)
};

const clearingMethods: Partial<Record<keyof ClearingService, unknown>> = {
	list_collateral_assets: () => Promise.resolve([vxpCollateral]),
	get_settlement_status: (seriesId: string) =>
		Promise.resolve(
			seriesId === E2E_SETTLED_SERIES.seriesId ? toNullable(settledStatus()) : toNullable()
		),
	get_settlement_plan: () => Promise.resolve(toNullable()),
	list_settled_series: () =>
		Promise.resolve({ items: [E2E_SETTLED_SERIES.seriesId], next_cursor: toNullable() }),
	get_series_price_history: () => Promise.resolve({ candles: [] }),
	list_series_trade_history: () => Promise.resolve({ items: [], next_cursor: toNullable() }),
	list_series_traded_volumes: () => Promise.resolve([]),
	list_leaderboard: () => Promise.resolve({ items: [], total: ZERO, next_cursor: toNullable() }),
	aggregate_settlement_accuracy: () => Promise.resolve([]),
	get_account_state: () => Promise.resolve(noAccount),
	get_account_state_query: () => Promise.resolve(noAccount),
	get_positions: () => Promise.resolve([]),
	get_position: () => Promise.resolve(toNullable()),
	get_orders: () => Promise.resolve([]),
	list_orders: () => Promise.resolve([]),
	get_trade_history: () => Promise.resolve([])
};

/** An actor whose listed methods answer from fixtures and whose every other
 * method rejects, so an unanticipated call is loud rather than a hang. */
const fakeActor = <T>({
	canister,
	methods
}: {
	canister: string;
	methods: Partial<Record<string, unknown>>;
}): T =>
	new Proxy(methods, {
		get: (target, property) => {
			// The actor is handed out through a resolved promise, which probes
			// `then`: answering it would turn the actor into a never-settling
			// thenable.
			if (typeof property !== 'string' || property === 'then') {
				return;
			}

			return property in target
				? target[property]
				: () =>
						Promise.reject(
							new Error(`e2e fake ${canister}: ${property} is not served in the E2E stack`)
						);
		}
	}) as T;

export const fakeEngineActorProvider: EngineActorProvider = {
	clearing: () =>
		Promise.resolve(fakeActor<ClearingService>({ canister: 'clearing', methods: clearingMethods })),
	registry: () =>
		Promise.resolve(fakeActor<RegistryService>({ canister: 'registry', methods: registryMethods }))
};

/** Balance reads answer zero (the empty treasury and user balances a fresh
 * stack has); a transfer is refused outright. The E2E server also runs the
 * economy record-only (VXP_TREASURY_DISABLED=1), so no award ever gets as far
 * as asking this ledger to move funds. */
const fakeVxpLedger: VxpLedger = {
	balance: () => Promise.resolve(ZERO),
	transfer: () => Promise.reject(new Error('e2e fake VXP ledger: transfers are disabled')),
	findTreasuryTransfer: () => Promise.resolve({ status: 'unknown', reason: 'e2e fake ledger' })
};

export const fakeVxpLedgerProvider: VxpLedgerProvider = () => Promise.resolve(fakeVxpLedger);
