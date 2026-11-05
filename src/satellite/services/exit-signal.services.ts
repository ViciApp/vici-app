import { Collection } from '#lib/constants/collections.constants.ts';
import {
	EXIT_SIGNAL_NOTE_MAX_LENGTH,
	EXIT_SIGNAL_REASONS,
	type ExitSignalDoc
} from '#lib/types/exit-signal.ts';
import { isNullish } from '@dfinity/utils';
import type { AssertSetDocContext } from '@junobuild/functions';
import { decodeDocData } from '@junobuild/functions/sdk';

/**
 * Pre-write guard for `exit_signals`. The collection is an anonymous
 * append-only churn-feedback log written by `deleteMyAccount` right
 * before the cascade hard-deletes the caller's identity. The shape
 * rules here:
 *
 *  1. **Append-only.** `current` must be null. A doc is written
 *     once and never touched again — there's no edit flow, and a
 *     blocked edit attempt is a clearer error than a silent data race.
 *  2. **Shape.** `reason` must be one of the six picker buckets the
 *     UI exposes (mirrored in `EXIT_SIGNAL_REASONS`).
 *     `note` must be a string ≤ {@link EXIT_SIGNAL_NOTE_MAX_LENGTH}.
 *     `createdAtMs` must be finite + positive.
 *  3. **Anonymous shape.** We don't validate any principal field — the
 *     doc body has none. The key (random UUID, chosen by the caller)
 *     is opaque to the assert; we just guarantee it's a non-empty
 *     string so we don't store an empty-keyed row by accident.
 *
 * Anyone authenticated can write. The endpoint that drives the
 * write (`deleteMyAccount`) is the only legitimate path, but if a
 * curious user pokes the datastore directly the worst they can do
 * is bloat the log — there's no PII or principal to leak.
 */
export const assertSetExitSignal = ({
	data: {
		collection,
		key,
		data: { current, proposed }
	}
}: AssertSetDocContext): void => {
	if (collection !== Collection.EXIT_SIGNALS) {
		return;
	}

	if (key.length === 0) {
		throw new Error('exit_signals key must be a non-empty string.');
	}

	if (!isNullish(current)) {
		throw new Error('exit_signals docs are append-only; edits are not allowed.');
	}

	const proposedDoc = decodeDocData<ExitSignalDoc>(proposed.data);

	if (!EXIT_SIGNAL_REASONS.includes(proposedDoc.reason)) {
		throw new Error(
			`exit_signals reason "${proposedDoc.reason}" is not one of the allowed buckets.`
		);
	}

	if (
		typeof proposedDoc.note !== 'string' ||
		proposedDoc.note.length > EXIT_SIGNAL_NOTE_MAX_LENGTH
	) {
		throw new Error(
			`exit_signals note must be a string of at most ${EXIT_SIGNAL_NOTE_MAX_LENGTH} characters.`
		);
	}

	if (!Number.isFinite(proposedDoc.createdAtMs) || proposedDoc.createdAtMs <= 0) {
		throw new Error('exit_signals createdAtMs must be a positive finite number.');
	}
};
