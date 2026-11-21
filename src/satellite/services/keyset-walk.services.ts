import { logInfo } from '#satellite/utils/logger.utils.ts';
import { isNullish, nonNullish, notEmptyString } from '@dfinity/utils';
import { listDocsStore } from '@junobuild/functions/sdk';
import { j } from '@junobuild/schema';

type ListDocsStoreParams = Parameters<typeof listDocsStore>[0];

type ListedDocEntry = ReturnType<typeof listDocsStore>['items'][number];

/**
 * The most docs one {@link walkKeysetPage} call reads, and the page it reads when the caller names
 * none: a read-only page of this size fits the query budget (see the bulk-rewrite budget note in
 * docs/ai/satellite/patterns.md), which leaves an update call room for its writes.
 */
export const KEYSET_WALK_MAX_LIMIT = 100;

/**
 * The arguments of an endpoint that walks a collection in rounds: the `nextAfterKey` the previous
 * call returned (none for the first call) and how many docs this call may read.
 */
export const KeysetWalkArgsSchema = j.strictObject({
	afterKey: j.optional(j.string()),
	limit: j.optional(j.number())
});

export type KeysetWalkArgs = j.infer<typeof KeysetWalkArgsSchema>;

/**
 * Where a {@link walkKeysetPage} call left off, part of the endpoint's result: `nextAfterKey` is the
 * `afterKey` of the next call (absent when it starts from the first doc), `done` whether the walk
 * has visited the collection's last doc. The operator calls again until `done`.
 */
export const KeysetWalkResultSchema = j.strictObject({
	nextAfterKey: j.optional(j.string()),
	done: j.boolean()
});

export type KeysetWalk = j.infer<typeof KeysetWalkResultSchema>;

/**
 * What the visitor of a {@link walkKeysetPage} did with one doc: `kept` it (the walk may resume after
 * it), `removed` it (it is gone, so the walk must not resume after its key) or `stop`ped before
 * touching it because the call's write budget is spent (the next call starts with this doc).
 * Stop only once something was written, or a walk can never move.
 */
export type KeysetWalkStep = 'kept' | 'removed' | 'stop';

/**
 * Visit one keyset page of a collection: at most `limit` docs (capped at
 * {@link KEYSET_WALK_MAX_LIMIT}) in key order after `afterKey`, the datastore's own order, so a call
 * reads a page instead of the whole collection and a repeated call resumes instead of rescanning.
 * The cursor it returns is always a key still stored: Juno answers an empty page when `start_after`
 * names a missing key, which would end a walk early, so a cursor removed in the meantime restarts
 * the walk from the first doc. Every admin endpoint that walks a collection in rounds pages through
 * this.
 */
export const walkKeysetPage = ({
	collection,
	caller,
	afterKey,
	limit,
	visit
}: KeysetWalkArgs & {
	collection: string;
	caller: ListDocsStoreParams['caller'];
	visit: (entry: ListedDocEntry) => KeysetWalkStep;
}): KeysetWalk => {
	const requested = limit ?? KEYSET_WALK_MAX_LIMIT;
	const pageLimit = Number.isFinite(requested)
		? Math.min(Math.max(1, Math.floor(requested)), KEYSET_WALK_MAX_LIMIT)
		: KEYSET_WALK_MAX_LIMIT;

	const listPage = (startAfter: string | undefined) =>
		listDocsStore({
			collection,
			caller,
			params: { paginate: { limit: BigInt(pageLimit), start_after: startAfter } }
		});

	let resumeAfter = notEmptyString(afterKey) ? afterKey : undefined;
	let page = listPage(resumeAfter);

	if (nonNullish(resumeAfter) && isNullish(page.items_page)) {
		logInfo({
			message: 'keyset_walk_cursor_missing',
			detail: { collection, afterKey: resumeAfter }
		});

		resumeAfter = undefined;
		page = listPage(resumeAfter);
	}

	for (const entry of page.items) {
		const step = visit(entry);

		if (step === 'stop') {
			return { nextAfterKey: resumeAfter, done: false };
		}

		if (step === 'kept') {
			[resumeAfter] = entry;
		}
	}

	return { nextAfterKey: resumeAfter, done: page.items.length < pageLimit };
};
