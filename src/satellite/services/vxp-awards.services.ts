import { Collection } from '#lib/constants/collections.constants.ts';
import { vxpAwardKey, type VxpAwardDoc, type VxpAwardType } from '#lib/types/vxp-award.ts';
import { isNullish, nonNullish } from '@dfinity/utils';
import { Principal } from '@icp-sdk/core/principal';
import type { AssertSetDocContext } from '@junobuild/functions';
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
 *  2. **Recipient binds caller.** A user can only write awards keyed
 *     to themselves. (The satellite itself signs writes when running
 *     hook code, but those writes still go through this assert with
 *     the recipient as the writing principal.)
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
 * The streak / calibration / referral / Worlds-podium paths create
 * these docs; this assert is the safety net those paths rely on.
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

	// 2. Recipient binds caller. Caller arrives as the raw principal bytes:
	//    compare against the recipient field's text form. The satellite's
	//    own writes satisfy this because the hook caller wiring signs as
	//    the recipient's principal on its behalf (same pattern as
	//    `assertSetReferral`).
	const callerText = Principal.fromUint8Array(caller).toText();

	if (proposedDoc.recipient !== callerText) {
		throw new Error('vxp_awards recipient must match the caller principal.');
	}

	// Creation path: nothing more to check beyond shape; status must
	// start at `pending`.
	if (isNullish(current)) {
		if (proposedDoc.status !== 'pending') {
			throw new Error('New vxp_awards docs must start with status="pending".');
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
 * Creates the `pending` award doc. Carries no `version`, so a second write
 * for the same key traps on the existing doc: callers catch that as the
 * concurrent-firing case and stop before any ledger call.
 */
export const persistAward = ({
	caller,
	recipient,
	awardType,
	awardKey,
	doc
}: {
	caller: Uint8Array;
	recipient: string;
	awardType: VxpAwardType;
	awardKey: string;
	doc: VxpAwardDoc;
}): void => {
	setDocStore({
		caller,
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
	caller,
	recipient,
	awardType,
	awardKey,
	patch
}: {
	caller: Uint8Array;
	recipient: string;
	awardType: VxpAwardType;
	awardKey: string;
	patch: Partial<VxpAwardDoc> & Pick<VxpAwardDoc, 'status'>;
}): void => {
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
