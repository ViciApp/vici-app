// Deterministic stand-ins for the clearing + registry canisters and the ICRC
// ledgers, installed by the E2E server through the same provider seams the
// unit tests use (setEngineActorProvider / setVxpLedgerProvider). They serve
// the fixture catalog and keep the funding path honest:
//
//   - public reads answer from fixtures.ts (live markets, one settled market,
//     the VXP collateral asset, empty trade tapes and leaderboards);
//   - the ledgers hold real balances and allowances in memory (zero until
//     fundFakeAccount): an approval costs one fee, and clearing's deposit pulls
//     through icrc2_transfer_from, which costs another and fails without an
//     allowance covering amount + fee, exactly like the real pair;
//   - deposit_collateral enforces the asset's allowed domains and replays an
//     id without moving funds; an account reads as the never-deposited empty
//     one until a deposit lands, through the same NoAccountStateFound mapping
//     the production wrapper applies;
//   - get_account_state_query scopes its figures to Settlement whatever the
//     account holds, like the real query;
//   - any method not listed here, including every other write (orders,
//     settlement), rejects. An unexpected engine call surfaces as a failing
//     request in the specs instead of silently passing.

import { fromNullable, isNullish, nonNullish, toNullable } from '@dfinity/utils';
import { IcrcTransferError } from '@icp-sdk/canisters/ledger/icrc';
import { Principal } from '@icp-sdk/core/principal';
import type {
	ClearingDid,
	ClearingService,
	RegistryDid,
	RegistryService
} from '../src/declarations';
import type { EngineActorProvider, IcrcLedgerActor } from '../src/engine/actors';
import { env } from '../src/env';
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

/** Seeded VXP ledger id (migration 0003). */
export const VXP_LEDGER_CANISTER_ID = 's7ux4-yyaaa-aaaam-qidha-cai';

const VXP_DECIMALS = 8;

export const FAKE_LEDGER_FEE = BigInt(100_000);

const VXP_ASSET_ID = 'VXP';

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
		latest_transfer_fee: toNullable(FAKE_LEDGER_FEE),
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
		asset_id: VXP_ASSET_ID,
		symbol: 'VXP'
	}
};

const noAccount: ClearingDid.GetAccountStateResult = { Err: { NoAccountStateFound: null } };

interface FakeAllowance {
	amount: bigint;
	expiresAtNs: bigint | undefined;
}

const ledgerBalances = new Map<string, bigint>();
const allowances = new Map<string, FakeAllowance>();
/** VXP collateral per principal, credited to the ViciXp domain. */
const collateral = new Map<string, bigint>();
const finalisedDeposits = new Set<string>();

let nextBlock = BigInt(1);

const ledgerKey = ({ ledger, owner }: { ledger: string; owner: Principal }): string =>
	`${ledger}:${owner.toText()}`;

const allowanceKey = ({
	ledger,
	owner,
	spender
}: {
	ledger: string;
	owner: Principal;
	spender: Principal;
}): string => `${ledger}:${owner.toText()}:${spender.toText()}`;

const balanceOf = ({ ledger, owner }: { ledger: string; owner: Principal }): bigint =>
	ledgerBalances.get(ledgerKey({ ledger, owner })) ?? ZERO;

const setBalance = ({
	ledger,
	owner,
	balance
}: {
	ledger: string;
	owner: Principal;
	balance: bigint;
}): void => {
	ledgerBalances.set(ledgerKey({ ledger, owner }), balance);
};

const block = (): bigint => {
	nextBlock += BigInt(1);

	return nextBlock;
};

/** Seed a ledger balance, the way an award payout lands on a custodial
 * principal. */
export const fundFakeAccount = ({
	owner,
	amount,
	ledger = VXP_LEDGER_CANISTER_ID
}: {
	owner: Principal;
	amount: bigint;
	ledger?: string;
}): void => {
	setBalance({ ledger, owner, balance: balanceOf({ ledger, owner }) + amount });
};

export const fakeLedgerBalance = ({
	owner,
	ledger = VXP_LEDGER_CANISTER_ID
}: {
	owner: Principal;
	ledger?: string;
}): bigint => balanceOf({ ledger, owner });

const fakeLedger = ({
	ledger,
	caller
}: {
	ledger: string;
	caller: Principal;
}): IcrcLedgerActor => ({
	balance: ({ owner }) => Promise.resolve(balanceOf({ ledger, owner })),
	transactionFee: () => Promise.resolve(FAKE_LEDGER_FEE),
	approve: ({ spender, amount, expires_at }) => {
		const balance = balanceOf({ ledger, owner: caller });

		if (balance < FAKE_LEDGER_FEE) {
			return Promise.reject(
				new IcrcTransferError({
					msg: 'e2e fake ledger: approve',
					errorType: { InsufficientFunds: { balance } }
				})
			);
		}

		setBalance({ ledger, owner: caller, balance: balance - FAKE_LEDGER_FEE });
		allowances.set(allowanceKey({ ledger, owner: caller, spender: spender.owner }), {
			amount,
			expiresAtNs: expires_at
		});

		return Promise.resolve(block());
	}
});

/** icrc2_transfer_from as clearing calls it: the amount leaves the owner's
 * default account, the ledger fee on top, and both draw on the allowance. */
const transferFrom = ({
	ledger,
	owner,
	amount
}: {
	ledger: string;
	owner: Principal;
	amount: bigint;
}): string | undefined => {
	const key = allowanceKey({
		ledger,
		owner,
		spender: Principal.fromText(env.ic.clearingCanisterId)
	});
	const allowance = allowances.get(key);
	const required = amount + FAKE_LEDGER_FEE;
	const nowNs = BigInt(Date.now()) * NS_PER_MS;

	if (
		isNullish(allowance) ||
		allowance.amount < required ||
		(nonNullish(allowance.expiresAtNs) && allowance.expiresAtNs < nowNs)
	) {
		return `InsufficientAllowance: ${required} required`;
	}

	const balance = balanceOf({ ledger, owner });

	if (balance < required) {
		return `InsufficientFunds: ${balance} of ${required}`;
	}

	setBalance({ ledger, owner, balance: balance - required });
	allowances.set(key, { ...allowance, amount: allowance.amount - required });
};

const depositCollateral =
	(caller: Principal) =>
	({
		deposit_id,
		asset_id,
		amount,
		domain
	}: ClearingDid.DepositCollateralParams): Promise<ClearingDid.DepositCollateralResult> => {
		const refuse = (
			Err: ClearingDid.DepositCollateralError
		): Promise<ClearingDid.DepositCollateralResult> => Promise.resolve({ Err });

		if (asset_id !== VXP_ASSET_ID) {
			return refuse({ Asset: { UnsupportedAsset: null } });
		}

		const balanceDomain = fromNullable(domain) ?? { Settlement: null };

		if (!('ViciXp' in balanceDomain)) {
			return refuse({ DomainNotAllowed: { domain: balanceDomain, asset_id } });
		}

		const plan = `${caller.toText()}:${deposit_id}`;

		if (finalisedDeposits.has(plan)) {
			return Promise.resolve({ Ok: null });
		}

		const refusal = transferFrom({ ledger: VXP_LEDGER_CANISTER_ID, owner: caller, amount });

		if (nonNullish(refusal)) {
			return refuse({ Asset: { TransferError: refusal } });
		}

		finalisedDeposits.add(plan);
		collateral.set(caller.toText(), (collateral.get(caller.toText()) ?? ZERO) + amount);

		return Promise.resolve({ Ok: null });
	};

const accountState = ({
	caller,
	held,
	domain
}: {
	caller: Principal;
	held: bigint;
	domain: ClearingDid.BalanceDomain;
}): ClearingDid.GetAccountStateResult => {
	const value = 'ViciXp' in domain ? held : ZERO;

	return {
		Ok: {
			assets:
				value > ZERO
					? [
							{
								pre_haircut_value_usd: value,
								haircut_bps: 0,
								balance: value,
								value_usd: value,
								asset_id: VXP_ASSET_ID
							}
						]
					: [],
			state: {
				user: caller,
				reserved_margins_usd: [],
				cash_balances_usd: [],
				balances: [[VICI_XP, [[VXP_ASSET_ID, held]]]]
			},
			total_equity_usd: value,
			available_margin_usd: value
		}
	};
};

const accountMethods = (caller: Principal): Partial<Record<keyof ClearingService, unknown>> => {
	const read = (domain: ClearingDid.BalanceDomain): ClearingDid.GetAccountStateResult => {
		const held = collateral.get(caller.toText());

		return nonNullish(held) ? accountState({ caller, held, domain }) : noAccount;
	};

	return {
		deposit_collateral: depositCollateral(caller),
		get_account_state: ({ domain }: ClearingDid.GetAccountStateParams) =>
			Promise.resolve(read(fromNullable(domain) ?? { Settlement: null })),
		get_account_state_query: () => Promise.resolve(read({ Settlement: null }))
	};
};

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
	list_series_settlement_statuses: ({
		series_ids
	}: ClearingDid.ListSeriesSettlementStatusesParams) =>
		Promise.resolve(
			series_ids.map((series_id) => ({
				series_id,
				status:
					series_id === E2E_SETTLED_SERIES.seriesId ? toNullable(settledStatus()) : toNullable()
			}))
		),
	get_settlement_plan: () => Promise.resolve(toNullable()),
	list_settled_series: () =>
		Promise.resolve({ items: [E2E_SETTLED_SERIES.seriesId], next_cursor: toNullable() }),
	get_series_price_history: () => Promise.resolve({ candles: [] }),
	list_series_trade_history: () => Promise.resolve({ items: [], next_cursor: toNullable() }),
	list_series_traded_volumes: () => Promise.resolve([]),
	list_leaderboard: () => Promise.resolve({ items: [], total: ZERO, next_cursor: toNullable() }),
	aggregate_settlement_accuracy: () => Promise.resolve([]),
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
	clearing: (identity) =>
		Promise.resolve(
			fakeActor<ClearingService>({
				canister: 'clearing',
				methods: { ...clearingMethods, ...accountMethods(identity.getPrincipal()) }
			})
		),
	registry: () =>
		Promise.resolve(fakeActor<RegistryService>({ canister: 'registry', methods: registryMethods })),
	ledger: (identity, ledger) =>
		Promise.resolve(fakeLedger({ ledger, caller: identity.getPrincipal() }))
};

/** Balance reads answer from the fake ledger; a treasury transfer is refused
 * outright. The E2E server also runs the economy record-only
 * (VXP_TREASURY_DISABLED=1), so no award ever gets as far as asking this ledger
 * to move funds. */
const fakeVxpLedger: VxpLedger = {
	balance: ({ owner }) => Promise.resolve(balanceOf({ ledger: VXP_LEDGER_CANISTER_ID, owner })),
	transfer: () => Promise.reject(new Error('e2e fake VXP ledger: transfers are disabled')),
	findTreasuryTransfer: () => Promise.resolve({ status: 'unknown', reason: 'e2e fake ledger' })
};

export const fakeVxpLedgerProvider: VxpLedgerProvider = () => Promise.resolve(fakeVxpLedger);
