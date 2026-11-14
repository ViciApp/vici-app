import type { RegistryDid } from '#declarations';
import { isDev } from '#lib/env/app.env.ts';
import { toNullable, type Nullable } from '@dfinity/utils';

export const REPLICA_HOST = isDev() ? window.location.origin : 'https://icp-api.io';

// eslint-disable-next-line no-restricted-syntax -- This is the definition
export const ZERO = 0n;

export const PAYOFF_TYPE: RegistryDid.PayoffType = { Binary: null };
export const STRIKE: Nullable<RegistryDid.Price> = toNullable();
export const PRICE_DECIMALS = 2;
/**
 * Must match `icdc-core` `shared::constants::USD_DECIMALS` (margin / equity use this scale).
 */
export const USD_DECIMALS = 4;

export const VICI_ORACLE_V1 = 'VICI_ORACLE_V1';

/**
 * Maximum length of a series' resolution clause (`Resolution.clause`). Mirrors
 * the `icdc-core` registry bound — a clause beyond this is rejected with
 * `ResolutionClauseTooLong`. Used to validate the admin form and to cap the
 * clause sent in `add_series` / `fork_series`.
 */
export const RESOLUTION_CLAUSE_MAX_LENGTH = 1024;

/** Em-dash placeholder for an absent / not-yet-served value in the UI. */
export const EM_DASH = '—';

export const SECOND_IN_NANOSECONDS = 1_000_000_000n;
export const MILLISECOND_IN_NANOSECONDS = 1_000_000n;

/** One minute in milliseconds. */
export const MINUTE_IN_MS = 60_000;
/** One hour in milliseconds. */
export const HOUR_IN_MS = 60 * MINUTE_IN_MS;
/** One day in milliseconds — `24 × 60 × 60 × 1000`. */
export const DAY_IN_MS = 24 * HOUR_IN_MS;
export const MINUTE_IN_SECONDS = 60n;
export const HOUR_IN_SECONDS = 60n * MINUTE_IN_SECONDS;
export const DAY_IN_SECONDS = 24n * HOUR_IN_SECONDS;
export const DAY_IN_NANOSECONDS = DAY_IN_SECONDS * SECOND_IN_NANOSECONDS;
export const WEEK_IN_SECONDS = 7n * DAY_IN_SECONDS;
export const WEEK_IN_NANOSECONDS = WEEK_IN_SECONDS * SECOND_IN_NANOSECONDS;

/**
 * Retention horizon for the `resolved_results` collection, in milliseconds.
 *
 * The friend-readable results feed accrues one row per participant of every
 * resolved market and would grow unbounded without a cap, so the satellite's
 * controllers-only cleanup prunes rows whose `resolvedAtMs` is older than this.
 * The horizon must not be shorter than the digest's active `StandingsWindow`
 * (the longest bounded window the consumer reads is `'month'`); it is sized at
 * 45 days — a calendar month plus a ~2-week grace margin — so a row stays
 * readable for the whole window even at the month boundary, and a slightly
 * delayed prune never drops a row the digest still needs.
 */
export const RESOLVED_RESULTS_RETENTION_MS = 45 * DAY_IN_MS;

/**
 * Recovery window for a soft-deleted account. After `deleteMyAccount` sets
 * `deletedAtMs`, the owner has this long to call `recoverMyAccount`; past it the
 * account is eligible for the admin sweep's hard-delete, and a too-late
 * `recoverMyAccount` hard-deletes it.
 */
export const ACCOUNT_RECOVERY_WINDOW_MS = 30 * DAY_IN_MS;

export const II_MAX_TIME_TO_LIVE_NS = WEEK_IN_NANOSECONDS;

export const WALLET_PAGINATION = 10n;

/** Rows per page on the `/dash/transactions` history table. */
export const TRANSACTION_HISTORY_PAGE_SIZE = 10;

/**
 * Ledger-walk bounds for the transaction-history page. The page needs the
 * user's full VXP ledger trail to label bonuses and compute running
 * balances, so it pages the ICRC index to exhaustion — these cap a
 * pathological account at `PAGE_SIZE × MAX_PAGES` transactions, after which
 * the page renders a "history starts here" footer instead of fanning out
 * unbounded query calls.
 */
export const TRANSACTION_HISTORY_LEDGER_PAGE_SIZE = 100n;
export const TRANSACTION_HISTORY_MAX_LEDGER_PAGES = 20;

/**
 * Default auto-dismiss duration for global toasts (`notificationsStore`).
 * Per-call overrides still win — this is just the implicit default.
 */
export const TOAST_DEFAULT_MS = 5_000;

/**
 * localStorage hint that this device has an authenticated session. Written
 * by `Authn.svelte` on every auth-state transition and read by the root gate
 * (`src/routes/+page.svelte`) to hold a resume spinner on `/` while the auth
 * handshake is still unresolved. Centralised here so the TS-side
 * writers/clearers/readers share one source of truth. Anything that fails a
 * sign-in MUST clear this, or a stale `'1'` makes the gate hold its resume
 * spinner waiting for a session that never arrives.
 */
export const SIGNED_IN_FLAG_KEY = 'vici.signed-in';

/**
 * Prefix for the per-principal, per-domain last-known holdings snapshot
 * (see `vxp-holdings.derived.ts`). Full key:
 * `vici.holdings.v1.<domain>.<principal>`.
 */
export const HOLDINGS_SNAPSHOT_STORAGE_KEY = 'vici.holdings.v1';
