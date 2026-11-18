import { Collection } from '#lib/constants/collections.constants.ts';
import { vxpAwardKey, type VxpAwardDoc, type VxpAwardType } from '#lib/types/vxp-award.ts';
import {
	assertControllerCaller,
	controllerCaller,
	isControllerText
} from '#satellite/services/authz.services.ts';
import { hasAwardMarker } from '#satellite/services/vxp-award-markers.services.ts';
import { isTournamentPrizeAwardKey } from '#satellite/utils/tournament-prize.utils.ts';
import { isNullish, nonNullish } from '@dfinity/utils';
import { Principal } from '@icp-sdk/core/principal';
import type { AssertDeleteDocContext, AssertSetDocContext } from '@junobuild/functions';
import { decodeDocData, encodeDocData, getDocStore, setDocStore } from '@junobuild/functions/sdk';

/**
 * Pre-write guard for `vxp_awards`. The collection holds server-fired
 * payouts (streak milestones, calibration rewards, referral payouts,
 * Worlds podium), so the rules here protect the economy from forgery and
 * accidental double-credit.
 *
 *  1. **Key shape.** The doc key must equal
 *     `${recipient}/${awardType}/${awardKey}`. Drift between key and
 *     embedded fields is the most common path to a duplicate award
 *     slipping through; this assertion makes it impossible.
 *
 *  2. **Server-only.** Only a satellite controller writes these docs:
 *     the payout trusts their status (a `pending` doc blocks a second
 *     payout, `paid` records the transfer), so a client that could write
 *     one could invent an award, mark it paid with a made-up block, or
 *     fail its own in-flight payout. Every award path writes through
 *     {@link persistAward} / {@link updateAward}, which sign as a
 *     controller.
 *
 *  3. **Immutable history.** Once a doc reaches `status: 'paid'`, the
 *     `paidAtMs` and `blockIndex` are frozen; any further write that
 *     touches them throws.
 *
 *  4. **Forward-only status.** Status transitions are
 *     `pending → paid | failed` only. `paid → anything` is rejected so a
 *     buggy retry can't quietly demote a successful payout.
 *
 *  5. **Identity fields are immutable.** `awardType`, `awardKey`,
 *     `amountBaseUnits`, `earnedAtMs`, `recipient` are write-once.
 *
 *  6. **One tournament prize per tournament.** A new `tournament_prize`
 *     doc must be keyed on the tournament alone
 *     (`isTournamentPrizeAwardKey`), never per place, so two places of
 *     one tournament collide on the same key. Docs written under the
 *     earlier per-place keys still settle through the edit path.
 *
 *  7. **One-time across a purge.** A new doc for a one-time award the
 *     recipient was paid under an account it deleted is refused: the
 *     purge leaves a marker of it (`hasAwardMarker`), since it deletes
 *     the award docs that would otherwise collide.
 *
 * The award paths create these docs; this assert, with
 * {@link assertDeleteVxpAward}, is the safety net those paths rely on.
 */
export const assertSetVxpAward = ({
	caller,
	data: {
		collection,
		key,
		data: { current, proposed }
	}
}: AssertSetDocContext): void => {
	if (collection !== Collection.VXP_AWARDS) {
		return;
	}

	assertControllerCaller({ caller, collection });

	const proposedDoc = decodeDocData<VxpAwardDoc>(proposed.data);

	// 1. Key shape: must match the canonical builder.
	const expectedKey = vxpAwardKey({
		recipient: proposedDoc.recipient,
		awardType: proposedDoc.awardType,
		awardKey: proposedDoc.awardKey
	});

	if (key !== expectedKey) {
		throw new Error(
			`vxp_awards key mismatch: expected ${expectedKey}, got ${key} (recipient/type/key must match the doc body).`
		);
	}

	// Creation path: nothing more to check beyond shape; status must
	// start at `pending`.
	if (isNullish(current)) {
		if (proposedDoc.status !== 'pending') {
			throw new Error('New vxp_awards docs must start with status="pending".');
		}

		if (
			proposedDoc.awardType === 'tournament_prize' &&
			!isTournamentPrizeAwardKey(proposedDoc.awardKey)
		) {
			throw new Error('New tournament_prize awards must be keyed on the tournament id alone.');
		}

		if (
			hasAwardMarker({
				principalText: proposedDoc.recipient,
				awardType: proposedDoc.awardType,
				awardKey: proposedDoc.awardKey
			})
		) {
			throw new Error('vxp_awards: this one-time award was already paid to the principal.');
		}

		return;
	}

	// Edit path: enforce immutability + forward-only status.
	const currentDoc = decodeDocData<VxpAwardDoc>(current.data);

	if (
		currentDoc.recipient !== proposedDoc.recipient ||
		currentDoc.awardType !== proposedDoc.awardType ||
		currentDoc.awardKey !== proposedDoc.awardKey ||
		currentDoc.amountBaseUnits !== proposedDoc.amountBaseUnits ||
		currentDoc.earnedAtMs !== proposedDoc.earnedAtMs
	) {
		throw new Error(
			'vxp_awards identity fields are immutable (recipient, awardType, awardKey, amountBaseUnits, earnedAtMs).'
		);
	}

	// Forward-only status: `paid` and `failed` are terminal.
	if (currentDoc.status === 'paid' || currentDoc.status === 'failed') {
		throw new Error(
			`vxp_awards doc is terminal (${currentDoc.status}); no further writes allowed.`
		);
	}

	// From `pending`, only `paid` or `failed` are valid.
	if (proposedDoc.status !== 'paid' && proposedDoc.status !== 'failed') {
		throw new Error('vxp_awards status may only transition pending → paid | failed.');
	}

	// `paid` requires the payout metadata to be present.
	if (
		proposedDoc.status === 'paid' &&
		(isNullish(proposedDoc.paidAtMs) || isNullish(proposedDoc.blockIndex))
	) {
		throw new Error('vxp_awards status="paid" requires paidAtMs and blockIndex.');
	}

	// `failed` requires an errorMessage so a follow-up retry / audit
	// has something to read.
	if (
		proposedDoc.status === 'failed' &&
		(isNullish(proposedDoc.errorMessage) || proposedDoc.errorMessage.length === 0)
	) {
		throw new Error('vxp_awards status="failed" requires a non-empty errorMessage.');
	}

	// Defensive: a `failed` doc should not carry payout metadata, since
	// no transfer succeeded. Cheap belt-and-braces check.
	if (
		proposedDoc.status === 'failed' &&
		(nonNullish(proposedDoc.paidAtMs) || nonNullish(proposedDoc.blockIndex))
	) {
		throw new Error('vxp_awards status="failed" cannot carry paidAtMs / blockIndex.');
	}
};

/**
 * Pre-delete guard for `vxp_awards`. The award doc IS the idempotency
 * record, so removing it would let the same award be claimed and paid
 * again. The collection is `write: 'public'` and the recipient owns the
 * doc, so without this guard any client could delete it. Only the
 * satellite's own controller writes may remove one (the account purge,
 * see `hardDeleteAccountFn`).
 */
export const assertDeleteVxpAward = ({
	caller,
	data: { collection }
}: AssertDeleteDocContext): void => {
	if (collection !== Collection.VXP_AWARDS) {
		return;
	}

	if (isControllerText(Principal.fromUint8Array(caller).toText())) {
		return;
	}

	throw new Error('vxp_awards docs are permanent records and cannot be deleted.');
};

/** The caller every award write signs with: {@link assertSetVxpAward} admits only a controller. */
const awardWriter = (): Uint8Array => controllerCaller(Collection.VXP_AWARDS);

/**
 * Creates the `pending` award doc. Carries no `version`, so a second write
 * for the same key traps on the existing doc: callers catch that as the
 * concurrent-firing case and stop before any ledger call.
 */
export const persistAward = ({
	recipient,
	awardType,
	awardKey,
	doc
}: {
	recipient: string;
	awardType: VxpAwardType;
	awardKey: string;
	doc: VxpAwardDoc;
}): void => {
	setDocStore({
		caller: awardWriter(),
		collection: Collection.VXP_AWARDS,
		key: vxpAwardKey({ recipient, awardType, awardKey }),
		doc: { data: encodeDocData(doc) }
	});
};

/**
 * Records the payout outcome on an existing award doc, writing at the
 * version just read so the update cannot overwrite a newer one. A missing
 * doc is a no-op: there is no pending record to settle.
 */
export const updateAward = ({
	recipient,
	awardType,
	awardKey,
	patch
}: {
	recipient: string;
	awardType: VxpAwardType;
	awardKey: string;
	patch: Partial<VxpAwardDoc> & Pick<VxpAwardDoc, 'status'>;
}): void => {
	const caller = awardWriter();
	const key = vxpAwardKey({ recipient, awardType, awardKey });
	const existing = getDocStore({ collection: Collection.VXP_AWARDS, key, caller });

	if (isNullish(existing)) {
		return;
	}

	const existingDoc = decodeDocData<VxpAwardDoc>(existing.data);

	setDocStore({
		caller,
		collection: Collection.VXP_AWARDS,
		key,
		doc: {
			data: encodeDocData<VxpAwardDoc>({ ...existingDoc, ...patch }),
			version: existing.version
		}
	});
};
