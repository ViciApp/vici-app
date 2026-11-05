import { ZERO } from '#lib/constants/app.constants.ts';
import { VXP_LEDGER_CANISTER_ID } from '#lib/constants/canisters.constants.ts';
import { Collection } from '#lib/constants/collections.constants.ts';
import {
	newUserVxpAmountMilestone1BaseUnits,
	newUserVxpAmountMilestone2BaseUnits,
	newUserVxpAmountMilestone3BaseUnits
} from '#lib/constants/vxp-onboarding.constants.ts';
import { ActivityType } from '#lib/enums/social.ts';
import type { Activity } from '#lib/types/social.ts';
import type {
	VxpMilestoneState,
	VxpNewUserMilestoneKey,
	VxpOnboardingDoc
} from '#lib/types/vxp-onboarding.ts';
import { logError, logInfo } from '$satellite/utils/logger.utils';
import { transferWithBadFeeRetry } from '$satellite/utils/vxp-payout.utils';
import { isNullish, nonNullish } from '@dfinity/utils';
import { Principal } from '@icp-sdk/core/principal';
import type { OnSetDocContext } from '@junobuild/functions';
import { IcrcLedgerCanister } from '@junobuild/functions/canisters/ledger/icrc';
import {
	countDocsStore,
	decodeDocData,
	encodeDocData,
	getDocStore,
	setDocStore
} from '@junobuild/functions/sdk';

const MILESTONE_KEYS: VxpNewUserMilestoneKey[] = ['m1', 'm2', 'm3'];

const emptyMilestones = (): VxpOnboardingDoc['milestones'] => ({
	m1: { status: 'none', amountBaseUnits: '0' },
	m2: { status: 'none', amountBaseUnits: '0' },
	m3: { status: 'none', amountBaseUnits: '0' }
});

const amountForMilestone = (key: VxpNewUserMilestoneKey): bigint => {
	switch (key) {
		case 'm1':
			return newUserVxpAmountMilestone1BaseUnits();
		case 'm2':
			return newUserVxpAmountMilestone2BaseUnits();
		case 'm3':
			return newUserVxpAmountMilestone3BaseUnits();

		default: {
			const _: never = key;

			return _;
		}
	}
};

const persistOnboarding = ({
	caller,
	key,
	doc,
	version
}: {
	caller: Uint8Array;
	key: string;
	doc: VxpOnboardingDoc;
	version?: bigint;
}): void => {
	logInfo({
		message: 'vxp_onboarding_write',
		detail: {
			collection: Collection.VXP_ONBOARDING,
			key,
			trade_count: doc.tradeCount,
			milestones: MILESTONE_KEYS.map((mk) => `${mk}:${doc.milestones[mk].status}`).join('|'),
			legacy_onboarding_synced: doc.legacyOnboardingSynced === true,
			doc_version: nonNullish(version) ? version.toString() : 'create'
		}
	});

	setDocStore({
		caller,
		collection: Collection.VXP_ONBOARDING,
		key,
		doc: {
			data: encodeDocData(doc),
			...(nonNullish(version) ? { version } : {})
		}
	});
};

/**
 * Count `activities` rows owned by `caller` whose key ends with `#trade` (see `logActivity`).
 */
const countUserTradeActivities = (caller: Uint8Array): bigint =>
	countDocsStore({
		collection: Collection.ACTIVITIES,
		caller,
		params: {
			owner: caller,
			order: { field: 'keys', desc: false }
		}
	});

const countUserTradeActivitiesSafe = (caller: Uint8Array): bigint => {
	try {
		return countUserTradeActivities(caller);
	} catch {
		return ZERO;
	}
};

/**
 * One-time backfill: users who registered or traded before this feature shipped
 * still get m1/m2/m3 based on existing `profiles` + `activities`.
 *
 * When `minimumTradeCount` is set (trade activity hook), the just-written trade always counts
 * even if `listDocsStore` lags or `owner` filtering returns stale/empty on some replicas.
 */
const reconcileLegacyOnboardingState = ({
	caller,
	userKey,
	base,
	version,
	minimumTradeCount
}: {
	caller: Uint8Array;
	userKey: string;
	base: VxpOnboardingDoc;
	version?: bigint;
	minimumTradeCount?: number;
}): void => {
	const historicalTrades = countUserTradeActivitiesSafe(caller);
	const profileDoc = getDocStore({
		collection: Collection.PROFILES,
		key: userKey,
		caller
	});
	const hasProfile = nonNullish(profileDoc);

	// TODO: consider using bigint. Found this https://stackoverflow.com/a/61324746/5404186 to find max value.
	const tradeCount = Math.max(base.tradeCount, Number(historicalTrades), minimumTradeCount ?? 0);

	const milestoneEligibility: Array<{ mk: VxpNewUserMilestoneKey; eligible: boolean }> = [
		{ mk: 'm1', eligible: hasProfile },
		{ mk: 'm2', eligible: tradeCount >= 1 },
		{ mk: 'm3', eligible: tradeCount >= 5 }
	];

	const milestones = milestoneEligibility.reduce<VxpOnboardingDoc['milestones']>(
		(acc, { mk, eligible }) =>
			acc[mk].status === 'none' && eligible
				? {
						...acc,
						[mk]: {
							status: 'owed',
							amountBaseUnits: amountForMilestone(mk).toString()
						}
					}
				: acc,
		{ ...base.milestones }
	);

	const doc: VxpOnboardingDoc = {
		...base,
		tradeCount,
		milestones,
		legacyOnboardingSynced: true
	};

	persistOnboarding({ caller, key: userKey, doc, version });
};

/**
 * If the user traded before `profiles` existed in Juno, legacy sync can set `legacyOnboardingSynced`
 * with m1 still `none`. Any later profile write fixes m1.
 */
const ensureRegistrationMilestoneIfEligible = ({
	caller,
	userKey
}: {
	caller: Uint8Array;
	userKey: string;
}): void => {
	const profileDoc = getDocStore({
		collection: Collection.PROFILES,
		key: userKey,
		caller
	});

	if (isNullish(profileDoc)) {
		return;
	}

	const existing = getDocStore({
		collection: Collection.VXP_ONBOARDING,
		key: userKey,
		caller
	});

	if (isNullish(existing)) {
		return;
	}

	const doc = decodeDocData<VxpOnboardingDoc>(existing.data);

	if (doc.milestones.m1.status !== 'none') {
		return;
	}

	const milestones = {
		...doc.milestones,
		m1: {
			status: 'owed' as const,
			amountBaseUnits: amountForMilestone('m1').toString()
		}
	};

	persistOnboarding({
		caller,
		key: userKey,
		doc: { ...doc, milestones },
		version: existing.version
	});
};

const PERSIST_MAX_RETRIES = 3;

/**
 * Determines the transfer needed for a single milestone:
 * - `owed` → transfer the current expected amount (ignores stale owed values from old constants).
 * - `paid` but below current expected → top-up the difference.
 * - otherwise → nothing to do.
 */
const milestoneTransferNeeded = ({
	ms,
	mk
}: {
	ms: VxpMilestoneState;
	mk: VxpNewUserMilestoneKey;
}): { transferAmount: bigint; memoLabel: string } | undefined => {
	const expectedAmount = amountForMilestone(mk);

	if (ms.status === 'owed') {
		return { transferAmount: expectedAmount, memoLabel: mk };
	}

	if (ms.status === 'paid') {
		const paidSoFar = BigInt(ms.amountBaseUnits);

		if (paidSoFar < expectedAmount) {
			return { transferAmount: expectedAmount - paidSoFar, memoLabel: `${mk}:topup` };
		}
	}
};

const payOutMilestoneIfNeeded = async ({
	ledger,
	caller,
	userKey,
	mk
}: {
	ledger: IcrcLedgerCanister;
	caller: Uint8Array;
	userKey: string;
	mk: VxpNewUserMilestoneKey;
}): Promise<void> => {
	const snapshot = getDocStore({
		collection: Collection.VXP_ONBOARDING,
		key: userKey,
		caller
	});

	if (isNullish(snapshot)) {
		return;
	}

	const snapshotDoc = decodeDocData<VxpOnboardingDoc>(snapshot.data);
	const needed = milestoneTransferNeeded({ ms: snapshotDoc.milestones[mk], mk });

	if (isNullish(needed) || needed.transferAmount <= ZERO) {
		return;
	}

	const expectedAmount = amountForMilestone(mk);

	try {
		persistOnboarding({
			caller,
			key: userKey,
			doc: {
				...snapshotDoc,
				milestones: {
					...snapshotDoc.milestones,
					[mk]: {
						...snapshotDoc.milestones[mk],
						status: 'processing'
					}
				}
			},
			version: snapshot.version
		});
	} catch (e: unknown) {
		const msg = e instanceof Error ? e.message : String(e);

		logInfo({
			message: 'payout_locked',
			detail: {
				user: userKey,
				milestone: mk,
				error: msg
			}
		});

		return;
	}

	const result = await transferWithBadFeeRetry({
		ledger,
		toOwner: Principal.fromText(userKey),
		amount: needed.transferAmount,
		memo: `vxp:new-user:${needed.memoLabel}`
	});

	if (result.ok) {
		logInfo({
			message: 'payout_ok',
			detail: {
				user: userKey,
				milestone: mk,
				amount: needed.transferAmount,
				block_index: result.blockIndex,
				memo: needed.memoLabel
			}
		});
	} else {
		logError({
			message: 'payout_err',
			detail: {
				user: userKey,
				milestone: mk,
				amount: needed.transferAmount,
				memo: needed.memoLabel,
				error: result.error
			}
		});
	}

	const attemptPersist = async (attempt: number): Promise<void> => {
		if (attempt >= PERSIST_MAX_RETRIES) {
			return;
		}

		const latest = getDocStore({
			collection: Collection.VXP_ONBOARDING,
			key: userKey,
			caller
		});

		if (isNullish(latest)) {
			return;
		}

		const latestDoc = decodeDocData<VxpOnboardingDoc>(latest.data);
		const curMs = latestDoc.milestones[mk];

		const needsUpdate =
			curMs.status === 'owed' ||
			curMs.status === 'processing' ||
			(curMs.status === 'paid' && BigInt(curMs.amountBaseUnits) < expectedAmount);

		if (!needsUpdate) {
			return;
		}

		const updatedMilestone: VxpMilestoneState = result.ok
			? {
					status: 'paid',
					amountBaseUnits: expectedAmount.toString(),
					blockIndex: result.blockIndex.toString()
				}
			: {
					...curMs,
					status: curMs.status === 'processing' ? 'owed' : curMs.status,
					lastError: result.error
				};

		try {
			persistOnboarding({
				caller,
				key: userKey,
				doc: {
					...latestDoc,
					milestones: {
						...latestDoc.milestones,
						[mk]: updatedMilestone
					}
				},
				version: latest.version
			});
		} catch (e: unknown) {
			if (attempt === PERSIST_MAX_RETRIES - 1) {
				const msg = e instanceof Error ? e.message : String(e);
				logError({
					message: 'persist_failed',
					detail: {
						user: userKey,
						milestone: mk,
						transfer_ok: result.ok,
						error: msg
					}
				});
				throw new Error(
					`Failed to persist ${mk} after transfer (user=${userKey}, ok=${result.ok})`,
					{ cause: e }
				);
			}

			await attemptPersist(attempt + 1);
		}
	};

	await attemptPersist(0);
};

/**
 * Try to transfer every milestone that is `owed` or `paid` below the current expected
 * amount (order m1 → m3). After each transfer the persist is retried with a fresh read
 * so a concurrent doc write does not leave a "transferred but not recorded" state.
 */
const payOutOwedMilestones = async ({
	caller,
	userKey
}: {
	caller: Uint8Array;
	userKey: string;
}): Promise<void> => {
	const ledger = new IcrcLedgerCanister({
		canisterId: Principal.fromText(VXP_LEDGER_CANISTER_ID)
	});

	for (const mk of MILESTONE_KEYS) {
		await payOutMilestoneIfNeeded({ ledger, caller, userKey, mk });
	}
};

/**
 * Registration grant (milestone 1); runs on profile create and updates so legacy users are covered.
 */
export const onProfileSetForVxpOnboarding = async (ctx: OnSetDocContext): Promise<void> => {
	const {
		caller,
		data: {
			collection,
			key,
			data: { before: _before }
		}
	} = ctx;

	try {
		if (collection !== Collection.PROFILES) {
			return;
		}

		const callerText = Principal.fromUint8Array(caller).toText();

		if (key !== callerText) {
			return;
		}

		const userKey = key;

		const existing = getDocStore({
			collection: Collection.VXP_ONBOARDING,
			key: userKey,
			caller
		});

		const prev: VxpOnboardingDoc | undefined = nonNullish(existing)
			? decodeDocData<VxpOnboardingDoc>(existing.data)
			: undefined;

		const base: VxpOnboardingDoc = prev ?? {
			version: 1,
			tradeCount: 0,
			milestones: emptyMilestones()
		};

		if (base.legacyOnboardingSynced !== true) {
			reconcileLegacyOnboardingState({
				caller,
				userKey,
				base,
				version: existing?.version
			});
		} else {
			ensureRegistrationMilestoneIfEligible({ caller, userKey });
		}

		await payOutOwedMilestones({ caller, userKey });
	} catch (e: unknown) {
		const msg = e instanceof Error ? e.message : String(e);
		const user =
			collection === Collection.PROFILES ? key : Principal.fromUint8Array(caller).toText();
		logError({ message: 'hook_error', detail: { hook: 'profile', user, error: msg } });
		throw e;
	}
};

/**
 * Milestone 2 after the first call; milestone 3 after five calls; retries any `owed` payouts.
 */
export const onTradeActivityForVxpOnboarding = async (ctx: OnSetDocContext): Promise<void> => {
	const {
		caller,
		data: {
			collection,
			data: { before, after }
		}
	} = ctx;

	const parsePrincipalText = (text: string): Principal | undefined => {
		try {
			return Principal.fromText(text);
		} catch {
			// A malformed principal on an activity doc must not abort the hook; skip onboarding for this event instead.
		}
	};

	const resolveUserKey = (): string | undefined => {
		if (collection !== Collection.ACTIVITIES || nonNullish(before)) {
			return;
		}

		const activity = decodeDocData<Activity>(after.data);

		if (activity.type !== ActivityType.TRADE) {
			return;
		}

		const activityUserPrincipal = parsePrincipalText(activity.user);

		if (
			isNullish(activityUserPrincipal) ||
			activityUserPrincipal.compareTo(Principal.fromUint8Array(caller)) !== 'eq'
		) {
			return;
		}

		return activity.user;
	};

	const userKey = resolveUserKey();

	if (isNullish(userKey)) {
		return;
	}

	try {
		const existing = getDocStore({
			collection: Collection.VXP_ONBOARDING,
			key: userKey,
			caller
		});

		const prev: VxpOnboardingDoc | undefined = nonNullish(existing)
			? decodeDocData<VxpOnboardingDoc>(existing.data)
			: undefined;

		const base: VxpOnboardingDoc = prev ?? {
			version: 1,
			tradeCount: 0,
			milestones: emptyMilestones()
		};

		if (base.legacyOnboardingSynced !== true) {
			reconcileLegacyOnboardingState({
				caller,
				userKey,
				base,
				version: existing?.version,
				minimumTradeCount: base.tradeCount + 1
			});
			await payOutOwedMilestones({ caller, userKey });

			return;
		}

		const tradeCount = base.tradeCount + 1;

		const milestoneUpdates: Array<{ mk: VxpNewUserMilestoneKey; eligible: boolean }> = [
			{ mk: 'm2', eligible: tradeCount === 1 },
			{ mk: 'm3', eligible: tradeCount === 5 }
		];

		const milestones = milestoneUpdates.reduce<VxpOnboardingDoc['milestones']>(
			(acc, { mk, eligible }) =>
				eligible && acc[mk].status === 'none'
					? {
							...acc,
							[mk]: {
								status: 'owed',
								amountBaseUnits: amountForMilestone(mk).toString()
							}
						}
					: acc,
			{ ...base.milestones }
		);

		persistOnboarding({
			caller,
			key: userKey,
			doc: {
				...base,
				tradeCount,
				milestones,
				legacyOnboardingSynced: true
			},
			version: existing?.version
		});

		await payOutOwedMilestones({ caller, userKey });
	} catch (e: unknown) {
		const msg = e instanceof Error ? e.message : String(e);
		logError({
			message: 'hook_error',
			detail: { hook: 'trade', user: userKey, error: msg }
		});
		throw e;
	}
};
