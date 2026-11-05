import { ZERO } from '#lib/constants/app.constants.ts';
import { VXP_LEDGER_CANISTER_ID } from '#lib/constants/canisters.constants.ts';
import { Collection } from '#lib/constants/collections.constants.ts';
import {
	REFERRAL_CODE_ALPHABET,
	REFERRAL_CODE_LENGTH,
	REFERRAL_CODE_REGEX,
	REFERRAL_EXISTING_USER_REASON,
	REFERRAL_MAX_PAID,
	REFERRAL_SIGNUP_WINDOW_MS,
	REFERRAL_VXP_BONUS_BASE_UNITS,
	referrerRewardBaseUnits
} from '#lib/constants/referral.constants.ts';
import { RelationCategory, RelationState } from '#lib/enums/relation.ts';
import { ActivityType } from '#lib/enums/social.ts';
import type { ReferralCodeDoc, ReferralDoc, ReferralListItem } from '#lib/types/referral.ts';
import type { Relation } from '#lib/types/relation.ts';
import type { Activity } from '#lib/types/social.ts';
import type { VxpMilestoneState } from '#lib/types/vxp-onboarding.ts';
import { logError, logInfo } from '$satellite/utils/logger.utils';
import { transferWithBadFeeRetry } from '$satellite/utils/vxp-payout.utils';
import { isNullish, nonNullish } from '@dfinity/utils';
import { Principal } from '@icp-sdk/core/principal';
import type { AssertSetDocContext, OnSetDocContext } from '@junobuild/functions';
import { IcrcLedgerCanister } from '@junobuild/functions/canisters/ledger/icrc';
import { msgCaller, time } from '@junobuild/functions/ic-cdk';
import {
	countDocsStore,
	decodeDocData,
	encodeDocData,
	getDocStore,
	listDocsStore,
	setDocStore
} from '@junobuild/functions/sdk';
import type { PrincipalText } from '@junobuild/schema';

// ─── Code generation ─────────────────────────────────────────────────────

const FNV_OFFSET = 0xcbf29ce484222325n;
const FNV_PRIME = 0x100000001b3n;
const MASK64 = 0xffffffffffffffffn;
const ALPHABET_SIZE = BigInt(REFERRAL_CODE_ALPHABET.length);
const CODE_GENERATION_MAX_RETRIES = 8;

/**
 * 64-bit FNV-1a over the input string. Cheap, deterministic, and adequate as the entropy source
 * for an 8-char (40-bit) opaque code — we only need uniqueness across the user base, not
 * cryptographic unpredictability. The Juno satellite has no `raw_rand` exposed via
 * `@junobuild/functions/ic-cdk` today, so combining `time()` (nanoseconds) with the caller's
 * principal + a salt counter gives us enough divergence to avoid collisions in practice; on the
 * (vanishingly rare) collision, we retry with a bumped salt up to {@link CODE_GENERATION_MAX_RETRIES}.
 */
const fnv1a64 = (input: string): bigint => {
	const bytes = new TextEncoder().encode(input);
	let hash = FNV_OFFSET;

	for (const b of bytes) {
		hash = (hash ^ BigInt(b)) & MASK64;
		hash = (hash * FNV_PRIME) & MASK64;
	}

	return hash;
};

const encodeBase32 = (value: bigint): string => {
	let result = '';
	let v = value;

	for (let i = 0; i < REFERRAL_CODE_LENGTH; i++) {
		result = REFERRAL_CODE_ALPHABET[Number(v % ALPHABET_SIZE)] + result;
		v /= ALPHABET_SIZE;
	}

	return result;
};

const generateReferralCode = ({
	ownerText,
	salt
}: {
	ownerText: PrincipalText;
	salt: number;
}): string => encodeBase32(fnv1a64(`${ownerText}|${time().toString()}|${salt}`));

// ─── Code assignment (idempotent, called from the profile hook) ──────────

const findOwnedCode = ({
	caller,
	ownerText
}: {
	caller: Uint8Array;
	ownerText: PrincipalText;
}): string | undefined => {
	const { items } = listDocsStore({
		collection: Collection.REFERRAL_CODES,
		caller,
		params: {}
	});

	const match = items.find(([_, item]) => {
		try {
			return decodeDocData<ReferralCodeDoc>(item.data).owner === ownerText;
		} catch {
			return false;
		}
	});

	return match?.[0];
};

/**
 * Idempotent: returns the caller's existing code if one is already on record, otherwise
 * generates+writes a fresh code and returns it. Safe to call on every profile create / update —
 * subsequent calls short-circuit after the scan.
 */
export const assignReferralCodeIfMissing = ({
	caller,
	ownerText
}: {
	caller: Uint8Array;
	ownerText: PrincipalText;
}): string | undefined => {
	const existing = findOwnedCode({ caller, ownerText });

	if (nonNullish(existing)) {
		return existing;
	}

	for (let salt = 0; salt < CODE_GENERATION_MAX_RETRIES; salt++) {
		const code = generateReferralCode({ ownerText, salt });

		const conflict = getDocStore({
			collection: Collection.REFERRAL_CODES,
			key: code,
			caller
		});

		if (isNullish(conflict)) {
			try {
				setDocStore({
					collection: Collection.REFERRAL_CODES,
					key: code,
					caller,
					doc: {
						data: encodeDocData<ReferralCodeDoc>({ owner: ownerText })
					}
				});

				logInfo({
					message: 'referral_code_assigned',
					detail: { user: ownerText, code }
				});

				return code;
			} catch (e: unknown) {
				// Another race won the key. Fall through to the next salt.
				const msg = e instanceof Error ? e.message : String(e);
				logInfo({
					message: 'referral_code_retry',
					detail: { user: ownerText, code, salt, error: msg }
				});
			}
		}
	}

	logError({
		message: 'referral_code_exhausted',
		detail: { user: ownerText, attempts: CODE_GENERATION_MAX_RETRIES }
	});
};

/**
 * Profile-hook entry point — runs alongside the VXP onboarding hook. Only fires on the
 * `profiles/{caller}` write (the user creating their own profile); any other key is ignored.
 */
export const onProfileSetForReferralCode = (ctx: OnSetDocContext): void => {
	const {
		caller,
		data: { collection, key }
	} = ctx;

	if (collection !== Collection.PROFILES) {
		return;
	}

	const callerText = Principal.fromUint8Array(caller).toText();

	if (key !== callerText) {
		return;
	}

	try {
		assignReferralCodeIfMissing({ caller, ownerText: callerText });
	} catch (e: unknown) {
		const msg = e instanceof Error ? e.message : String(e);
		// Best effort — never fail the profile write because of a referral-code issue.
		logError({
			message: 'referral_code_assign_failed',
			detail: { user: callerText, error: msg }
		});
	}
};

// ─── Query handlers ──────────────────────────────────────────────────────

export const getMyReferralCodeFn = (): { code: string | undefined } => {
	const caller = msgCaller();
	const code = findOwnedCode({
		caller: caller.toUint8Array(),
		ownerText: caller.toText()
	});

	return { code };
};

export const lookupReferralCodeFn = ({
	code
}: {
	code: string;
}): { owner: PrincipalText | undefined } => {
	const caller = msgCaller();
	const normalized = code.trim().toUpperCase();

	if (!REFERRAL_CODE_REGEX.test(normalized)) {
		return { owner: undefined };
	}

	const doc = getDocStore({
		collection: Collection.REFERRAL_CODES,
		key: normalized,
		caller: caller.toUint8Array()
	});

	if (isNullish(doc)) {
		return { owner: undefined };
	}

	try {
		return { owner: decodeDocData<ReferralCodeDoc>(doc.data).owner };
	} catch {
		return { owner: undefined };
	}
};

/**
 * Lists every redemption where the caller is the referrer — used by the FE to show "Friends you
 * referred" plus a counter of how many are over the cap. Sorted newest-first by `redeemedAtMs`.
 *
 * The doc key (the referee principal) is folded into each row as `referee`, since the FE needs
 * it to render names/avatars and the wire schema doesn't otherwise surface keys.
 */
export const listMyReferralsFn = (): ReferralListItem[] => {
	const caller = msgCaller();
	const callerText = caller.toText();

	const { items } = listDocsStore({
		collection: Collection.REFERRALS,
		caller: caller.toUint8Array(),
		params: {}
	});

	const referrals: ReferralListItem[] = [];

	for (const [key, item] of items) {
		try {
			const doc = decodeDocData<ReferralDoc>(item.data);

			if (doc.referrer === callerText) {
				referrals.push({ ...doc, referee: key });
			}
		} catch {
			// Skip malformed rows — they should never have passed the assertion in the first place.
		}
	}

	return referrals.sort((a, b) => b.redeemedAtMs - a.redeemedAtMs);
};

// ─── Update handler (redeem) ─────────────────────────────────────────────

// The referee bonus is flat and uncapped — every eligible new user gets `REFERRAL_VXP_BONUS_BASE_UNITS` once.
const initialRefereeOwedPayout = (): VxpMilestoneState => ({
	status: 'owed',
	amountBaseUnits: REFERRAL_VXP_BONUS_BASE_UNITS.toString()
});

// The referrer payout amount is decided in the hook (`armReferrerPayoutIfFirstFire`) from the
// diminishing curve, so the redeem-time placeholder carries no amount yet — it starts at `none`/`0`
// and is overwritten with the tier reward once armed.
const initialReferrerUnpaidPayout = (): VxpMilestoneState => ({
	status: 'none',
	amountBaseUnits: ZERO.toString()
});

/**
 * Idempotently writes a confirmed bilateral friendship between two principals. Used by the
 * referral flow to auto-friend referrer and referee on redemption (and by
 * {@link claimReferralFriendshipFn} for the existing-user friendship-only path).
 *
 * No-op if a friendship already exists in any state — never downgrades an existing relation.
 */
const writeConfirmedFriendship = ({
	caller,
	sender,
	target
}: {
	caller: Uint8Array;
	sender: PrincipalText;
	target: PrincipalText;
}): void => {
	const relationId = [sender, target].sort().join('#');

	const existing = getDocStore({
		collection: Collection.RELATIONS,
		key: relationId,
		caller
	});

	if (nonNullish(existing)) {
		// Already friends / pending / blocked — never overwrite. The whole point of the
		// referral-friendship is to bootstrap a new connection; if one already exists, leave it.
		return;
	}

	const relation: Relation = {
		category: RelationCategory.FRIEND,
		state: RelationState.ACTIVE,
		participants: [sender, target]
	};

	setDocStore({
		collection: Collection.RELATIONS,
		key: relationId,
		caller,
		doc: {
			data: encodeDocData(relation)
		}
	});
};

export const redeemReferralCodeFn = ({ code }: { code: string }): void => {
	const caller = msgCaller();
	const callerBytes = caller.toUint8Array();
	const callerText = caller.toText();
	const normalized = code.trim().toUpperCase();

	if (!REFERRAL_CODE_REGEX.test(normalized)) {
		throw new Error('Invalid referral code format.');
	}

	const existingRedemption = getDocStore({
		collection: Collection.REFERRALS,
		key: callerText,
		caller: callerBytes
	});

	if (nonNullish(existingRedemption)) {
		throw new Error('You have already redeemed a referral code.');
	}

	const profileDoc = getDocStore({
		collection: Collection.PROFILES,
		key: callerText,
		caller: callerBytes
	});

	if (isNullish(profileDoc)) {
		throw new Error('Create your profile before redeeming a referral code.');
	}

	// Signup-window gate — only fresh sign-ups earn the VXP bonus. Existing users who use a
	// referral link land in {@link claimReferralFriendshipFn} instead (friendship only, no VXP).
	// `created_at` is the Juno-managed nanosecond timestamp on the profile doc.
	const nowMs = Number(time() / 1_000_000n);
	const profileCreatedAtMs = nonNullish(profileDoc.created_at)
		? Number(profileDoc.created_at / 1_000_000n)
		: 0;

	if (nowMs - profileCreatedAtMs > REFERRAL_SIGNUP_WINDOW_MS) {
		throw new Error(REFERRAL_EXISTING_USER_REASON);
	}

	const codeDoc = getDocStore({
		collection: Collection.REFERRAL_CODES,
		key: normalized,
		caller: callerBytes
	});

	if (isNullish(codeDoc)) {
		throw new Error('Unknown referral code.');
	}

	const { owner: referrer } = decodeDocData<ReferralCodeDoc>(codeDoc.data);

	if (referrer === callerText) {
		throw new Error('You cannot redeem your own referral code.');
	}

	const doc: ReferralDoc = {
		version: 1,
		referrer,
		code: normalized,
		redeemedAtMs: Number(time() / 1_000_000n),
		// `withinReferrerCap` and `referrerPayout` are decided in the hook so the cap counter
		// reads the freshest state. The referee bonus is owed unconditionally.
		withinReferrerCap: false,
		refereePayout: initialRefereeOwedPayout(),
		referrerPayout: initialReferrerUnpaidPayout()
	};

	setDocStore({
		collection: Collection.REFERRALS,
		key: callerText,
		caller: callerBytes,
		doc: {
			data: encodeDocData<ReferralDoc>(doc)
		}
	});

	// Bilateral auto-confirmed friendship — both parties already consented (one shared an invite
	// link, the other clicked it). No request/accept dance needed.
	writeConfirmedFriendship({
		caller: callerBytes,
		sender: referrer,
		target: callerText
	});

	logInfo({
		message: 'referral_redeemed',
		detail: { referee: callerText, referrer, code: normalized }
	});

	// No payout here — the bonus is deferred to the referred user's FIRST prediction. Redeeming only
	// records the `owed` row + the friendship; `onTradeActivityForReferral` drives the actual transfer
	// once the referee makes a trade (and `settleReferral` exists as a retry path). Paying at redeem
	// time would reward sign-ups that never engage.
};

/**
 * Friendship-only path for users who use a referral link but aren't eligible for the VXP bonus
 * (account older than {@link REFERRAL_SIGNUP_WINDOW_MS}, or already redeemed). Looks up the code,
 * refuses self-referral, and writes a bilateral confirmed friendship between caller and referrer.
 *
 * Idempotent: returns silently if a relation already exists in any state.
 */
export const claimReferralFriendshipFn = ({ code }: { code: string }): void => {
	const caller = msgCaller();
	const callerBytes = caller.toUint8Array();
	const callerText = caller.toText();
	const normalized = code.trim().toUpperCase();

	if (!REFERRAL_CODE_REGEX.test(normalized)) {
		throw new Error('Invalid referral code format.');
	}

	const codeDoc = getDocStore({
		collection: Collection.REFERRAL_CODES,
		key: normalized,
		caller: callerBytes
	});

	if (isNullish(codeDoc)) {
		throw new Error('Unknown referral code.');
	}

	const { owner: referrer } = decodeDocData<ReferralCodeDoc>(codeDoc.data);

	if (referrer === callerText) {
		throw new Error('You cannot use your own referral link.');
	}

	writeConfirmedFriendship({
		caller: callerBytes,
		sender: referrer,
		target: callerText
	});

	logInfo({
		message: 'referral_friendship_claimed',
		detail: { caller: callerText, referrer, code: normalized }
	});
};

// ─── Assertions (write-time guards) ──────────────────────────────────────

export const assertSetReferralCode = ({
	caller,
	data: {
		collection,
		key,
		data: { current, proposed }
	}
}: AssertSetDocContext): void => {
	if (collection !== Collection.REFERRAL_CODES) {
		return;
	}

	if (nonNullish(current)) {
		throw new Error('Referral codes are write-once.');
	}

	if (!REFERRAL_CODE_REGEX.test(key)) {
		throw new Error('Invalid referral code format.');
	}

	const callerText = Principal.fromUint8Array(caller).toText();
	const { owner } = decodeDocData<ReferralCodeDoc>(proposed.data);

	if (owner !== callerText) {
		throw new Error('Referral code owner must match the caller.');
	}

	const existing = findOwnedCode({ caller, ownerText: callerText });

	if (nonNullish(existing) && existing !== key) {
		throw new Error('You already have a referral code.');
	}
};

export const assertSetReferral = ({
	caller,
	data: {
		collection,
		key,
		data: { current, proposed }
	}
}: AssertSetDocContext): void => {
	if (collection !== Collection.REFERRALS) {
		return;
	}

	const callerText = Principal.fromUint8Array(caller).toText();
	const proposedDoc = decodeDocData<ReferralDoc>(proposed.data);

	// Updates are allowed only when the writer is the satellite itself replaying its own hook
	// (i.e. the caller is the referee whose redemption is being processed). The shape of allowed
	// updates is constrained: only payout state may evolve; referrer / code / redeemedAtMs are
	// immutable.
	if (nonNullish(current)) {
		if (key !== callerText) {
			throw new Error('Only the referee may update their referral record.');
		}

		const currentDoc = decodeDocData<ReferralDoc>(current.data);

		if (
			currentDoc.referrer !== proposedDoc.referrer ||
			currentDoc.code !== proposedDoc.code ||
			currentDoc.redeemedAtMs !== proposedDoc.redeemedAtMs
		) {
			throw new Error('Referral record core fields are immutable.');
		}

		return;
	}

	if (key !== callerText) {
		throw new Error('Referral key must match the caller (referee) principal.');
	}

	if (proposedDoc.referrer === callerText) {
		throw new Error('Self-referrals are not allowed.');
	}

	try {
		Principal.fromText(proposedDoc.referrer);
	} catch {
		throw new Error('Invalid referrer principal.');
	}

	if (!REFERRAL_CODE_REGEX.test(proposedDoc.code)) {
		throw new Error('Invalid referral code format.');
	}

	const codeDoc = getDocStore({
		collection: Collection.REFERRAL_CODES,
		key: proposedDoc.code,
		caller
	});

	if (isNullish(codeDoc)) {
		throw new Error('Unknown referral code.');
	}

	const { owner } = decodeDocData<ReferralCodeDoc>(codeDoc.data);

	if (owner !== proposedDoc.referrer) {
		throw new Error('Referrer does not match the referral code owner.');
	}
};

// ─── Payout hook ─────────────────────────────────────────────────────────

/**
 * Counts how many redemptions already credited the given referrer. This lifetime tally is the
 * authoritative prior-paid count that feeds {@link referrerRewardBaseUnits} (the diminishing reward
 * curve, whose final bracket encodes the {@link REFERRAL_MAX_PAID} hard cap). Every doc whose
 * `referrerPayout` is not `none` counts — anything in flight (`owed` / `processing` / `paid`)
 * consumes a slot so racing redemptions can't slip past the cap by being mid-transfer.
 *
 * Counts only redemptions that happened *before* the row being processed — `redeemedAtMs <
 * referenceMs`, tie-broken by key so equal timestamps are deterministic — and excludes the row
 * itself (`excludeKey`). The "prior only" ordering makes a given row's prior-paid count (and thus
 * its diminishing-curve reward) **stable regardless of when settlement runs**: a later redemption
 * can never retroactively inflate an earlier row's count and shrink its reward on a delayed retry.
 */
const countReferrerCredits = ({
	caller,
	referrer,
	excludeKey,
	referenceMs
}: {
	caller: Uint8Array;
	referrer: PrincipalText;
	excludeKey: string;
	referenceMs: number;
}): number => {
	const { items } = listDocsStore({
		collection: Collection.REFERRALS,
		caller,
		params: {}
	});

	return items.reduce<number>((acc, [key, item]) => {
		if (key === excludeKey) {
			return acc;
		}

		try {
			const doc = decodeDocData<ReferralDoc>(item.data);

			// Prior redemptions only — earlier in time, or same instant with a lower key. Keeps
			// each row's tier derivation stable across retries (see the doc comment above).
			const isPrior =
				doc.redeemedAtMs < referenceMs || (doc.redeemedAtMs === referenceMs && key < excludeKey);

			if (doc.referrer === referrer && doc.referrerPayout.status !== 'none' && isPrior) {
				return acc + 1;
			}
		} catch {
			// Ignore malformed rows for accounting purposes.
		}

		return acc;
	}, ZERO_COUNT);
};

const ZERO_COUNT = 0;

const persistReferral = ({
	caller,
	refereeKey,
	doc,
	version
}: {
	caller: Uint8Array;
	refereeKey: string;
	doc: ReferralDoc;
	version?: bigint;
}): void => {
	setDocStore({
		caller,
		collection: Collection.REFERRALS,
		key: refereeKey,
		doc: {
			data: encodeDocData<ReferralDoc>(doc),
			...(nonNullish(version) ? { version } : {})
		}
	});
};

const PERSIST_MAX_RETRIES = 3;

/**
 * Guarded parse of a doc-stored base-unit string into a non-negative `bigint`. The referrals
 * collection is user-writable, so a tampered `amountBaseUnits` could be a non-numeric string (which
 * would throw on `BigInt(...)` and take down the hook) or a negative value. Anything that does not
 * parse to a non-negative integer is treated as `ZERO` so the caller can safely clamp it against the
 * server-recomputed expected amount.
 */
const parseStoredAmount = (raw: string): bigint => {
	try {
		const parsed = BigInt(raw);

		return parsed > ZERO ? parsed : ZERO;
	} catch {
		return ZERO;
	}
};

/**
 * Guarded decode of a referral row. The `referrals` collection is user-writable, so a
 * tampered/malformed row could make `decodeDocData` throw. Returning `undefined` (logged) instead
 * of trapping keeps the payout path — including the auth-free `settleReferral` endpoint — robust.
 */
const decodeReferralRow = (data: Parameters<typeof decodeDocData>[0]): ReferralDoc | undefined => {
	try {
		return decodeDocData<ReferralDoc>(data);
	} catch (e: unknown) {
		const msg = e instanceof Error ? e.message : String(e);
		logError({ message: 'referral_decode_failed', detail: { error: msg } });
	}
};

/**
 * Drives one side's payout to completion (or records the error). The flow mirrors
 * `payOutMilestoneIfNeeded` in [`vxp-onboarding.services.ts`](./vxp-onboarding.services.ts):
 * lock the row by writing `processing` first, transfer, then retry the persist with a fresh read
 * so a concurrent doc update doesn't leave us "transferred but not recorded".
 */
const driveSidePayout = async ({
	ledger,
	caller,
	refereeKey,
	side,
	recipient,
	memoLabel,
	expectedAmount
}: {
	ledger: IcrcLedgerCanister;
	caller: Uint8Array;
	refereeKey: string;
	side: 'referee' | 'referrer';
	recipient: PrincipalText;
	memoLabel: string;
	expectedAmount: bigint;
}): Promise<void> => {
	const snapshot = getDocStore({
		collection: Collection.REFERRALS,
		key: refereeKey,
		caller
	});

	if (isNullish(snapshot)) {
		return;
	}

	const snapshotDoc = decodeDocData<ReferralDoc>(snapshot.data);
	const sideKey = side === 'referee' ? 'refereePayout' : 'referrerPayout';
	const sideState = snapshotDoc[sideKey];

	if (sideState.status !== 'owed') {
		return;
	}

	// SECURITY: the transferred amount is server-authoritative — it is `expectedAmount`, recomputed
	// by the caller from canonical sources (the flat constant for the referee; the diminishing curve
	// keyed on the authoritative prior-paid count for the referrer). The `amountBaseUnits` field on
	// the doc lives in a *user-writable* collection, so it is never trusted as the source of truth at
	// transfer time. We still read it (guarded — a malformed string must not throw the hook) purely to
	// clamp: the actual transfer can never exceed `expectedAmount`, even if a tampered doc claims a
	// larger figure. A clamp this way (rather than just ignoring the stored value) also means a doc
	// armed below the expected amount only ever pays the smaller, recorded number.
	const storedAmount = parseStoredAmount(sideState.amountBaseUnits);
	const amount = storedAmount < expectedAmount ? storedAmount : expectedAmount;

	try {
		persistReferral({
			caller,
			refereeKey,
			doc: {
				...snapshotDoc,
				[sideKey]: { ...sideState, status: 'processing' }
			},
			version: snapshot.version
		});
	} catch (e: unknown) {
		const msg = e instanceof Error ? e.message : String(e);
		logInfo({
			message: 'referral_payout_locked',
			detail: { referee: refereeKey, side, error: msg }
		});

		return;
	}

	const result = await transferWithBadFeeRetry({
		ledger,
		toOwner: Principal.fromText(recipient),
		amount,
		memo: `vxp:referral:${memoLabel}`
	});

	if (result.ok) {
		logInfo({
			message: 'referral_payout_ok',
			detail: {
				referee: refereeKey,
				side,
				recipient,
				amount,
				block_index: result.blockIndex,
				memo: memoLabel
			}
		});
	} else {
		logError({
			message: 'referral_payout_err',
			detail: {
				referee: refereeKey,
				side,
				recipient,
				amount,
				memo: memoLabel,
				error: result.error
			}
		});
	}

	const attemptPersist = async (attempt: number): Promise<void> => {
		if (attempt >= PERSIST_MAX_RETRIES) {
			return;
		}

		const latest = getDocStore({
			collection: Collection.REFERRALS,
			key: refereeKey,
			caller
		});

		if (isNullish(latest)) {
			return;
		}

		const latestDoc = decodeDocData<ReferralDoc>(latest.data);
		const curState = latestDoc[sideKey];

		if (curState.status !== 'owed' && curState.status !== 'processing') {
			return;
		}

		const updated: VxpMilestoneState = result.ok
			? {
					status: 'paid',
					amountBaseUnits: amount.toString(),
					blockIndex: result.blockIndex.toString()
				}
			: {
					...curState,
					status: 'owed',
					lastError: result.error
				};

		try {
			persistReferral({
				caller,
				refereeKey,
				doc: { ...latestDoc, [sideKey]: updated },
				version: latest.version
			});
		} catch (e: unknown) {
			if (attempt === PERSIST_MAX_RETRIES - 1) {
				const msg = e instanceof Error ? e.message : String(e);
				logError({
					message: 'referral_persist_failed',
					detail: {
						referee: refereeKey,
						side,
						transfer_ok: result.ok,
						error: msg
					}
				});
				throw new Error(
					`Failed to persist referral ${side} payout (referee=${refereeKey}, ok=${result.ok})`,
					{ cause: e }
				);
			}

			await attemptPersist(attempt + 1);
		}
	};

	await attemptPersist(0);
};

/**
 * Decides referrer cap on first run and arms the `referrerPayout` if within cap. Idempotent:
 * - First fire: referrerPayout is `none`; we count credits, write `owed` (or leave `none` if over
 *   the cap), then re-enter to drive the payout.
 * - Re-fire: referrerPayout is already `owed` / `processing` / `paid`; we skip the arming step.
 */
const armReferrerPayoutIfFirstFire = ({
	caller,
	refereeKey
}: {
	caller: Uint8Array;
	refereeKey: string;
}): void => {
	const snapshot = getDocStore({
		collection: Collection.REFERRALS,
		key: refereeKey,
		caller
	});

	if (isNullish(snapshot)) {
		return;
	}

	const snapshotDoc = decodeDocData<ReferralDoc>(snapshot.data);

	if (snapshotDoc.referrerPayout.status !== 'none') {
		return;
	}

	const lifetimeCount = countReferrerCredits({
		caller,
		referrer: snapshotDoc.referrer,
		excludeKey: refereeKey,
		referenceMs: snapshotDoc.redeemedAtMs
	});

	// Authoritative, server-computed reward for this redemption: the diminishing curve keyed on the
	// referrer's prior paid count. A zero reward encodes the lifetime hard cap (`> REFERRAL_MAX_PAID`)
	// — past that point the tier table yields ZERO, so being within the cap and a positive reward
	// coincide. The diminishing curve + this lifetime cap self-limit, so there is no separate
	// monthly cap.
	const rewardBaseUnits = referrerRewardBaseUnits(lifetimeCount);
	const withinCap = rewardBaseUnits > ZERO;

	if (!withinCap) {
		logInfo({
			message: 'referral_over_cap',
			detail: {
				referrer: snapshotDoc.referrer,
				referee: refereeKey,
				lifetime_count: lifetimeCount,
				lifetime_cap: REFERRAL_MAX_PAID
			}
		});

		try {
			persistReferral({
				caller,
				refereeKey,
				doc: { ...snapshotDoc, withinReferrerCap: false },
				version: snapshot.version
			});
		} catch (e: unknown) {
			const msg = e instanceof Error ? e.message : String(e);
			logInfo({
				message: 'referral_cap_persist_locked',
				detail: { referee: refereeKey, error: msg }
			});
		}

		return;
	}

	try {
		persistReferral({
			caller,
			refereeKey,
			doc: {
				...snapshotDoc,
				withinReferrerCap: true,
				referrerPayout: {
					status: 'owed',
					amountBaseUnits: rewardBaseUnits.toString()
				}
			},
			version: snapshot.version
		});
	} catch (e: unknown) {
		const msg = e instanceof Error ? e.message : String(e);
		logInfo({
			message: 'referral_arm_locked',
			detail: { referee: refereeKey, error: msg }
		});
	}
};

/**
 * Whether the referee has made at least one prediction. The referral bonus is gated on the referred
 * user's first prediction (a `trade` activity), so redeeming a code alone never pays — it only
 * records the `owed` row. Counts only the caller's own **trade** activity rows: `logActivity` keys
 * them `${user}#${timestamp}#${type}`, so a key ending in `#trade` is a prediction. Non-trade
 * activities (settlement / comment / follow / vote) must NOT satisfy the gate. Guarded: a count
 * failure reads as "not yet" rather than throwing the payout path.
 */
const refereeHasTraded = (caller: Uint8Array): boolean => {
	try {
		return (
			countDocsStore({
				collection: Collection.ACTIVITIES,
				caller,
				params: { owner: caller, matcher: { key: `#${ActivityType.TRADE}$` } }
			}) > ZERO
		);
	} catch {
		return false;
	}
};

/**
 * Drives both referral payouts to completion for a single referee row: arms the referrer reward
 * (first run only, within caps), then transfers the flat referee bonus and the curve-keyed referrer
 * reward. Reads and writes the row AS `caller`, which MUST be the referee principal so
 * `assertSetReferral`'s "only the referee may update their record" guard passes.
 *
 * Pays nothing until the referee has made their first prediction — both bonuses settle together on
 * that first trade (driven by {@link onTradeActivityForReferral}); a code redemption alone never
 * pays.
 *
 * Idempotent and retry-safe: every step short-circuits once its side is `paid` / `processing`, so
 * re-running only advances what is still `owed`. Never throws on a transfer failure — the failing
 * side is recorded back as `owed` with `lastError` for a later retry.
 *
 * Invoked from {@link onTradeActivityForReferral} (the `activities` post-write hook — its trigger
 * doc is client-written, so its `onSetDoc` genuinely fires) and from the `settleReferral` endpoint
 * (manual retry/backfill). NOT invoked from `redeemReferralCodeFn`, and NOT from a hook on the
 * referrals row itself — that row is written via serverless `setDocStore`, which never fires
 * `onSetDoc` (see `api/db.rs` calling `invoke_on_set_doc` vs `db/store.rs` which does not).
 */
const settleReferralPayout = async ({
	caller,
	refereeKey
}: {
	caller: Uint8Array;
	refereeKey: string;
}): Promise<void> => {
	const snapshot = getDocStore({
		collection: Collection.REFERRALS,
		key: refereeKey,
		caller
	});

	if (isNullish(snapshot)) {
		return;
	}

	const doc = decodeReferralRow(snapshot.data);

	if (isNullish(doc)) {
		return;
	}

	// Fast-exit once both sides have settled (paid / in-flight, or referrer skipped over the cap).
	const refereeSettled =
		doc.refereePayout.status === 'paid' || doc.refereePayout.status === 'processing';
	const referrerSettled =
		doc.referrerPayout.status === 'paid' ||
		doc.referrerPayout.status === 'processing' ||
		(doc.referrerPayout.status === 'none' && doc.withinReferrerCap === false);

	if (refereeSettled && referrerSettled) {
		return;
	}

	// Gate on the referee's first prediction: neither side pays until the referred user has actually
	// made a trade. Leaving the row `owed` here is the normal path right after redeem — the bonus is
	// driven later by `onTradeActivityForReferral` (or the `settleReferral` retry endpoint).
	if (!refereeHasTraded(caller)) {
		return;
	}

	armReferrerPayoutIfFirstFire({ caller, refereeKey });

	const ledger = new IcrcLedgerCanister({
		canisterId: Principal.fromText(VXP_LEDGER_CANISTER_ID)
	});

	// SECURITY: both expected amounts are recomputed server-side here and passed to the transfer
	// path — never read from the (user-writable) referral doc. The referee bonus is the flat
	// constant; the referrer reward is re-derived from the diminishing curve keyed on the *same*
	// authoritative prior-paid count that the arming step (`armReferrerPayoutIfFirstFire`) used.
	await driveSidePayout({
		ledger,
		caller,
		refereeKey,
		side: 'referee',
		recipient: refereeKey,
		memoLabel: 'referee',
		expectedAmount: REFERRAL_VXP_BONUS_BASE_UNITS
	});

	// Re-read after the referee transfer: the referrer side is only worth a (full-collection) scan +
	// transfer when it is actually `owed`. On retries where it is already paid / processing — or was
	// skipped over the cap (`none`) — bail before the scan. This bounds the cost of the auth-free
	// `settleReferral` endpoint to a cheap re-read once a row's referrer side is settled.
	const latest = getDocStore({ collection: Collection.REFERRALS, key: refereeKey, caller });
	const latestDoc = nonNullish(latest) ? decodeReferralRow(latest.data) : undefined;

	if (isNullish(latestDoc) || latestDoc.referrerPayout.status !== 'owed') {
		return;
	}

	const referrerPriorPaidCount = countReferrerCredits({
		caller,
		referrer: latestDoc.referrer,
		excludeKey: refereeKey,
		referenceMs: latestDoc.redeemedAtMs
	});

	await driveSidePayout({
		ledger,
		caller,
		refereeKey,
		side: 'referrer',
		recipient: latestDoc.referrer,
		memoLabel: 'referrer',
		expectedAmount: referrerRewardBaseUnits(referrerPriorPaidCount)
	});
};

/**
 * Post-write hook for the referrals collection. NOTE: in practice this never fires — the referral
 * row is created by the `redeemReferralCode` serverless endpoint via `setDocStore`, and Juno only
 * invokes `onSetDoc` for client `set_doc` writes. It stays wired (delegating to the same idempotent
 * {@link settleReferralPayout} the endpoint uses) purely as a safety net, in case a referral row is
 * ever written through the public datastore API.
 */
export const onReferralSetForVxpPayout = async (ctx: OnSetDocContext): Promise<void> => {
	const {
		caller,
		data: { collection, key }
	} = ctx;

	if (collection !== Collection.REFERRALS) {
		return;
	}

	try {
		await settleReferralPayout({ caller, refereeKey: key });
	} catch (e: unknown) {
		const msg = e instanceof Error ? e.message : String(e);
		logError({
			message: 'hook_error',
			detail: { hook: 'referral', referee: key, error: msg }
		});
		throw e;
	}
};

/**
 * Settles — or retries — the VXP payout for a single referral row, keyed by the referee principal.
 * Drives the same idempotent {@link settleReferralPayout} the `activities` hook uses, so it is safe
 * to call repeatedly: it only ever advances an `owed` side to `paid`, paying the server-computed
 * amount to the row's own referee / referrer (and only once the referee has actually traded). Used
 * by the FE to self-heal a payout whose triggering activity hook didn't complete, and for operator
 * backfills.
 *
 * Auth: intentionally NOT gated on `msgCaller`. Recipients and amounts come entirely from the
 * already-validated row plus server constants, and the per-side `processing` lock + version checks
 * block double-pay — so an arbitrary caller can at most complete a legitimate, one-time payout. The
 * row is read/written AS the referee so `assertSetReferral` accepts the update.
 */
export const settleReferralFn = async ({ referee }: { referee: string }): Promise<void> => {
	let refereeBytes: Uint8Array;

	try {
		refereeBytes = Principal.fromText(referee).toUint8Array();
	} catch {
		throw new Error('Invalid referee principal.');
	}

	await settleReferralPayout({ caller: refereeBytes, refereeKey: referee });
};

/**
 * Activity-collection hook: settles a referred user's bonus on their FIRST prediction. The referral
 * row is created (`owed`) at redeem time but never paid then — both sides settle here, the first
 * time the referee makes a trade. `activities` rows are written by the **client** (`set_doc`), so
 * this `onSetDoc` hook genuinely fires — unlike a hook on the serverless-written referrals row.
 *
 * Idempotent (each side pays once) and best-effort: a settle hiccup must NOT break the onboarding
 * payout composed in the same `ACTIVITIES` dispatch, so we log and swallow — the next prediction
 * retries, and {@link settleReferralFn} is the manual retry path.
 */
export const onTradeActivityForReferral = async (ctx: OnSetDocContext): Promise<void> => {
	const {
		caller,
		data: {
			collection,
			data: { before, after }
		}
	} = ctx;

	if (collection !== Collection.ACTIVITIES || nonNullish(before)) {
		return;
	}

	let activity: Activity;

	try {
		activity = decodeDocData<Activity>(after.data);
	} catch {
		// A malformed activity doc must not abort the hook — skip referral settlement for this event.
		return;
	}

	if (activity.type !== ActivityType.TRADE) {
		return;
	}

	let activityUser: Principal;

	try {
		activityUser = Principal.fromText(activity.user);
	} catch {
		return;
	}

	if (activityUser.compareTo(Principal.fromUint8Array(caller)) !== 'eq') {
		return;
	}

	try {
		await settleReferralPayout({ caller, refereeKey: activity.user });
	} catch (e: unknown) {
		const msg = e instanceof Error ? e.message : String(e);
		logError({
			message: 'hook_error',
			detail: { hook: 'referral_activity', referee: activity.user, error: msg }
		});
	}
};
