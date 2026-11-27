import * as z from 'zod';

/** A non-negative integer amount in an asset's base units, sent as a decimal
 * string so it survives JSON without losing precision. */
export const ApiBaseUnitsSchema = z.string().regex(/^\d+$/);

/** A custody book balance: a sum of signed ledger deltas, so the wire allows
 * a sign even though a user's balance is never expected to go below zero. */
const ApiSignedBaseUnitsSchema = z.string().regex(/^-?\d+$/);

// ─── Identity ────────────────────────────────────────────────────────────

const ApiIdentitySchema = z.object({
	provider: z.string(),
	email: z.string().nullable()
});

const ApiLegacyPrincipalSchema = z.object({
	principal: z.string(),
	matchedVia: z.string()
});

export const ApiMeSchema = z.object({
	id: z.string(),
	role: z.string(),
	displayName: z.string().nullable(),
	avatarUrl: z.string().nullable(),
	createdAt: z.string(),
	identities: z.array(ApiIdentitySchema),
	legacyPrincipals: z.array(ApiLegacyPrincipalSchema)
});

/** The body of `GET /me` and of the OTP verify that opens a session. */
export const ApiMeResponseSchema = z.object({ user: ApiMeSchema });

// ─── Engine order submits ────────────────────────────────────────────────

export const ApiOrderFilledResponseSchema = z.object({ filled: z.boolean() });

export const ApiOrderCancelledResponseSchema = z.object({ cancelled: z.boolean() });

// ─── Custodial wallet ────────────────────────────────────────────────────

/** Every state of the API's withdrawal state machine, pinned against it by the
 * backend shared-drift suite. */
const WITHDRAWAL_STATES = [
	'requested',
	'processing',
	'submitted',
	'confirmed',
	'failed',
	'rejected'
] as const;

export const ApiWalletAssetSchema = z.object({
	id: z.string(),
	chain: z.string(),
	symbol: z.string(),
	decimals: z.number().int().nonnegative(),
	chainEnabled: z.boolean(),
	withdrawable: z.boolean(),
	/** Base-unit network fee a withdrawal pays on top of its amount, held from
	 * the same balance. Null when the asset cannot be withdrawn right now. */
	withdrawalFee: ApiBaseUnitsSchema.nullable()
});

export const ApiWalletAssetsResponseSchema = z.object({
	assets: z.array(ApiWalletAssetSchema)
});

const ApiWalletAccountSchema = z.object({
	chain: z.string(),
	address: z.string()
});

export const ApiWalletBalanceSchema = z.object({
	assetId: z.string(),
	symbol: z.string(),
	chain: z.string(),
	decimals: z.number().int().nonnegative(),
	balance: ApiSignedBaseUnitsSchema.transform((balance) => BigInt(balance))
});

export const ApiWalletBalancesResponseSchema = z.object({
	accounts: z.array(ApiWalletAccountSchema),
	balances: z.array(ApiWalletBalanceSchema)
});

export const ApiWalletDepositAddressResponseSchema = ApiWalletAccountSchema;

export const ApiWalletWithdrawalSchema = z.object({
	id: z.string(),
	assetId: z.string(),
	amount: ApiBaseUnitsSchema,
	/** Base-unit network fee held on top of `amount`, refunded with it on a
	 * failed or rejected withdrawal. */
	fee: ApiBaseUnitsSchema,
	destination: z.string(),
	selfCustody: z.boolean(),
	state: z.enum(WITHDRAWAL_STATES),
	txRef: z.string().nullable(),
	failureReason: z.string().nullable()
});

export const ApiWalletWithdrawalResponseSchema = z.object({
	withdrawal: ApiWalletWithdrawalSchema
});
