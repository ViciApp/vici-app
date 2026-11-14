import type { ClearingDid } from '#declarations';
import { HOLDINGS_SNAPSHOT_STORAGE_KEY, ZERO } from '#lib/constants/app.constants.ts';
import { VXP_TOKEN } from '#lib/constants/tokens/tokens.ic.constants.ts';
import { balanceDomain } from '#lib/derived/balance-domain.derived.ts';
import { walletUiTokens } from '#lib/derived/tokens.derived.ts';
import { authPrincipal } from '#lib/derived/user.derived.ts';
import { balancesStore } from '#lib/stores/balances.store.ts';
import { collateralsStore } from '#lib/stores/collaterals.store.ts';
import { icrcLedgerDecimalsFromCollateralConfig } from '#lib/utils/asset-ref.utils.ts';
import {
	intuitiveAvailableMarginUsd,
	nativeToClearingMarginUnits
} from '#lib/utils/playground-display.utils.ts';
import { get as getStorage, set as setStorage } from '#lib/utils/storage.utils.ts';
import { browser } from '$app/env';
import { isNullish, nonNullish } from '@dfinity/utils';
import { derived, type Readable } from 'svelte/store';

/**
 * Shared VXP-holdings derivation for the current balance domain, used by the
 * Dash, Portfolio, and Wallet surfaces.
 *
 * All figures are in the clearing-margin scale (4 decimals). On the ViciXp
 * playground domain: where the collateral asset is VXP, pegged 1:1 to the
 * clearing unit and sharing the same 4 decimals; they are plain VXP base
 * units, no conversion needed. (The clearing canister names its fields
 * `*_usd` because it is asset-agnostic; that suffix is the engine's accounting
 * unit, not real dollars.) Values are base units; never compare or sum in
 * whole-VXP.
 */

// Raw VXP balance sitting in the user's ICRC ledger wallet (un-deposited).
// Trends toward ~0 as VXP is swept into the clearing canister as collateral.
// Kept as its own concept for the Wallet surface (ledger balance + the
// low-balance "recovery" gate); the Dash "available to bet" figure is
// `vxpSpendable`, which also counts deposited clearing collateral.
export const vxpFree: Readable<bigint> = derived(
	balancesStore,
	($balancesStore) => $balancesStore?.[VXP_TOKEN.id] ?? ZERO
);

interface Holdings {
	/**
	 * Spendable: every VXP the user holds: free in the wallet **and**
	 * deposited as clearing collateral: minus everything reserved for open
	 * positions and resting orders. The honest "available to bet" figure.
	 */
	spendable: bigint;
	/** Reserved for open positions **and** resting limit orders. */
	backed: bigint;
}

/** Wire shape of the localStorage snapshot: bigints travel as strings. */
interface HoldingsSnapshot {
	spendable: string;
	backed: string;
}

const holdingsSnapshotKey = ({
	principal,
	domain
}: {
	principal: string;
	domain: ClearingDid.BalanceDomain;
}): string => `${HOLDINGS_SNAPSHOT_STORAGE_KEY}.${Object.keys(domain)[0]}.${principal}`;

const readHoldingsSnapshot = (params: {
	principal: string;
	domain: ClearingDid.BalanceDomain;
}): Holdings | undefined => {
	const snapshot = getStorage<HoldingsSnapshot>({ key: holdingsSnapshotKey(params) });

	if (isNullish(snapshot)) {
		return;
	}

	try {
		return { spendable: BigInt(snapshot.spendable), backed: BigInt(snapshot.backed) };
	} catch (_err: unknown) {
		// Corrupt payload: fall back to the unloaded defaults.
	}
};

interface HoldingsState {
	holdings: Holdings;
	/**
	 * False until the figures are displayable: either live data from both
	 * source stores (they reset to `undefined` on balance-domain switches too)
	 * or a persisted last-known snapshot. While false, every figure reads as a
	 * misleading 0 / wallet-only partial: surfaces should render a placeholder
	 * instead of a real-looking number.
	 */
	initialized: boolean;
}

const holdingsState: Readable<HoldingsState> = derived(
	[collateralsStore, balancesStore, walletUiTokens, authPrincipal, balanceDomain],
	([
		$collateralsStore,
		$balancesStore,
		$walletUiTokens,
		$authPrincipal,
		$balanceDomain
	]): HoldingsState => {
		// Un-deposited wallet VXP: spendable too, since it is swept into
		// clearing when the user places a call.
		let walletMargin = ZERO;

		for (const token of $walletUiTokens) {
			const walletBalance = $balancesStore?.[token.id] ?? ZERO;

			if (walletBalance > ZERO) {
				walletMargin += nativeToClearingMarginUnits({
					nativeBalance: walletBalance,
					nativeDecimals: token.decimals
				});
			}
		}

		const account = $collateralsStore?.accountState;
		const bothLoaded = nonNullish($collateralsStore) && nonNullish($balancesStore);

		// Clearing state not loaded yet. Before falling back to "wallet only"
		// (which pulses a placeholder over Holdings/In play for the whole first
		// fetch), show the signed-in user's last persisted snapshot:
		// stale-while-revalidate. Without it, every app open hides the figures
		// until the certified update lands.
		if (isNullish($collateralsStore) || isNullish(account)) {
			const snapshot = nonNullish($authPrincipal)
				? readHoldingsSnapshot({ principal: $authPrincipal, domain: $balanceDomain })
				: undefined;

			if (nonNullish(snapshot)) {
				return { holdings: snapshot, initialized: true };
			}

			// No clearing account yet (e.g. a fresh user who hasn't deposited):
			// all they can stake is whatever sits in the wallet.
			return { holdings: { spendable: walletMargin, backed: ZERO }, initialized: bothLoaded };
		}

		// Clearing collateral raw balances: the mark-value fallback used when
		// the account carries no priced `assets`.
		let clearingFallback = ZERO;

		for (const token of $walletUiTokens) {
			const balance = $collateralsStore.balances[token.id] ?? ZERO;

			if (balance > ZERO) {
				const decimals = icrcLedgerDecimalsFromCollateralConfig({
					assetsConfig: $collateralsStore.assetsConfig ?? {},
					ledgerCanisterId: token.ledgerCanisterId,
					fallbackDecimals: token.decimals
				});
				clearingFallback += nativeToClearingMarginUnits({
					nativeBalance: balance,
					nativeDecimals: decimals
				});
			}
		}

		const clearingFree = intuitiveAvailableMarginUsd({
			assets: account.assets,
			totalEquityUsd: account.total_equity_usd,
			availableMarginUsd: account.available_margin_usd,
			fallbackCollateralMarginUnits: clearingFallback
		});

		// Reserved for open positions + resting orders.
		const backed =
			account.total_equity_usd > account.available_margin_usd
				? account.total_equity_usd - account.available_margin_usd
				: ZERO;

		return {
			holdings: { spendable: walletMargin + clearingFree, backed },
			initialized: bothLoaded
		};
	}
);

const holdings: Readable<Holdings> = derived(
	holdingsState,
	($holdingsState) => $holdingsState.holdings
);

// True while the holdings figures are not displayable yet: see
// `HoldingsState.initialized`. Surfaces gate their placeholder pulse on this.
export const vxpHoldingsNotInitialized: Readable<boolean> = derived(
	holdingsState,
	($holdingsState) => !$holdingsState.initialized
);

// "Available to bet": wallet VXP + deposited clearing collateral, minus
// everything reserved for open positions and resting orders.
export const vxpSpendable: Readable<bigint> = derived(holdings, ($holdings) => $holdings.spendable);

// Reserved for open positions + resting orders (the "Backed" figure).
export const vxpBacked: Readable<bigint> = derived(holdings, ($holdings) => $holdings.backed);

// Total holdings = spendable + backed: everything the user owns in this
// domain (free + locked), in base units.
export const vxpHoldingsTotal: Readable<bigint> = derived(
	holdings,
	($holdings) => $holdings.spendable + $holdings.backed
);

// Write-through for the stale-while-revalidate snapshot consumed above: once
// both clearing state and ledger balances are loaded, persist the computed
// holdings per principal + domain. Module-level app-lifetime subscription, the
// same pattern as `preferencesStore`'s userStore mirror. The store-loaded guard
// also keeps a snapshot-fallback value from being written back to storage.
if (browser) {
	derived(
		[holdings, collateralsStore, balancesStore, authPrincipal, balanceDomain],
		(values) => values
	).subscribe(([$holdings, $collateralsStore, $balancesStore, $authPrincipal, $balanceDomain]) => {
		if (isNullish($collateralsStore) || isNullish($balancesStore) || isNullish($authPrincipal)) {
			return;
		}

		setStorage<HoldingsSnapshot>({
			key: holdingsSnapshotKey({ principal: $authPrincipal, domain: $balanceDomain }),
			value: {
				spendable: $holdings.spendable.toString(),
				backed: $holdings.backed.toString()
			}
		});
	});
}
