import * as z from 'zod';

/** A non-negative integer amount in an asset's base units, sent as a decimal
 * string so it survives JSON without losing precision. */
export const Web2BaseUnitsSchema = z.string().regex(/^\d+$/);

/** A custody book balance: a sum of signed ledger deltas, so the wire allows
 * a sign even though a user's balance is never expected to go below zero. */
const Web2SignedBaseUnitsSchema = z.string().regex(/^-?\d+$/);

// ─── Identity ────────────────────────────────────────────────────────────

const Web2IdentitySchema = z.object({
	provider: z.string(),
	email: z.string().nullable()
});

const Web2LegacyPrincipalSchema = z.object({
	principal: z.string(),
	matchedVia: z.string()
});

export const Web2MeSchema = z.object({
	id: z.string(),
	role: z.string(),
	displayName: z.string().nullable(),
	avatarUrl: z.string().nullable(),
	createdAt: z.string(),
	identities: z.array(Web2IdentitySchema),
	legacyPrincipals: z.array(Web2LegacyPrincipalSchema)
});

/** The body of `GET /me` and of the OTP verify that opens a session. */
export const Web2MeResponseSchema = z.object({ user: Web2MeSchema });

export const Web2ClaimResponseSchema = z.object({
	principal: z.string(),
	alreadyLinked: z.boolean(),
	adopted: z.boolean().optional()
});

// ─── Engine order submits ────────────────────────────────────────────────

export const Web2OrderFilledResponseSchema = z.object({ filled: z.boolean() });

export const Web2OrderCancelledResponseSchema = z.object({ cancelled: z.boolean() });

// ─── Custodial wallet ────────────────────────────────────────────────────

/** Every state of the API's withdrawal state machine, pinned against it by the
 * backend shared-drift suite. */
const WEB2_WITHDRAWAL_STATES = [
	'requested',
	'processing',
	'submitted',
	'confirmed',
	'failed',
	'rejected'
] as const;

export const Web2WalletAssetSchema = z.object({
	id: z.string(),
	chain: z.string(),
	symbol: z.string(),
	decimals: z.number().int().nonnegative(),
	chainEnabled: z.boolean(),
	withdrawable: z.boolean(),
	/** Base-unit network fee a withdrawal pays on top of its amount, held from
	 * the same balance. Null when the asset cannot be withdrawn right now. */
	withdrawalFee: Web2BaseUnitsSchema.nullable()
});

export const Web2WalletAssetsResponseSchema = z.object({
	assets: z.array(Web2WalletAssetSchema)
});

const Web2WalletAccountSchema = z.object({
	chain: z.string(),
	address: z.string()
});

export const Web2WalletBalanceSchema = z.object({
	assetId: z.string(),
	symbol: z.string(),
	chain: z.string(),
	decimals: z.number().int().nonnegative(),
	balance: Web2SignedBaseUnitsSchema.transform((balance) => BigInt(balance))
});

export const Web2WalletBalancesResponseSchema = z.object({
	accounts: z.array(Web2WalletAccountSchema),
	balances: z.array(Web2WalletBalanceSchema)
});

export const Web2WalletDepositAddressResponseSchema = Web2WalletAccountSchema;

export const Web2WalletWithdrawalSchema = z.object({
	id: z.string(),
	assetId: z.string(),
	amount: Web2BaseUnitsSchema,
	/** Base-unit network fee held on top of `amount`, refunded with it on a
	 * failed or rejected withdrawal. */
	fee: Web2BaseUnitsSchema,
	destination: z.string(),
	selfCustody: z.boolean(),
	state: z.enum(WEB2_WITHDRAWAL_STATES),
	txRef: z.string().nullable(),
	failureReason: z.string().nullable()
});

export const Web2WalletWithdrawalResponseSchema = z.object({
	withdrawal: Web2WalletWithdrawalSchema
});
