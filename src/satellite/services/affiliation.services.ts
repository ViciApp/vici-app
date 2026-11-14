import { DAY_IN_MS, MINUTE_IN_MS } from '#lib/constants/app.constants.ts';
import { Collection } from '#lib/constants/collections.constants.ts';
import {
	AFFILIATION_KINDS,
	AFFILIATION_LOCK_MS,
	affiliationKey,
	type AffiliationDoc
} from '#lib/types/affiliation.ts';
import { captureServerEvents } from '#satellite/services/analytics.services.ts';
import { logError } from '#satellite/utils/logger.utils.ts';
import { timeMs } from '#satellite/utils/time.utils.ts';
import { isNullish, nonNullish } from '@dfinity/utils';
import { Principal } from '@icp-sdk/core/principal';
import type {
	AssertDeleteDocContext,
	AssertSetDocContext,
	OnDeleteDocContext,
	OnSetDocContext
} from '@junobuild/functions';
import { decodeDocData } from '@junobuild/functions/sdk';

/**
 * Pre-write guard for `affiliations`. Enforces the Worlds
 * 90-day affiliation lock:
 *
 *  1. **Key shape.** `${member}/${kind}/${affiliationIdentifier}`. Drift
 *     between key and embedded fields is rejected.
 *  2. **Member binds caller.** A user can only write their own
 *     affiliation rows.
 *  3. **Kind validation.** Must be 'university' or 'country'.
 *  4. **Server-computed lock.** `lockedUntilMs` must equal
 *     `joinedAtMs + AFFILIATION_LOCK_MS`. The user can't extend or
 *     shorten the window: the server arithmetic is the source of
 *     truth.
 *  5. **joinedAtMs sanity.** Must be within ±10 minutes of the
 *     satellite's clock to defend against pre-/post-dated writes
 *     that would short-circuit the lock.
 *  6. **Identity fields immutable on edits.** `member`, `kind`,
 *     `affiliationIdentifier`, `joinedAtMs`, `lockedUntilMs` are write-once.
 *     A row that exists is the affiliation; switching requires
 *     delete (gated by the lock) then re-create.
 */
export const assertSetAffiliation = ({
	caller,
	data: {
		collection,
		key,
		data: { current, proposed }
	}
}: AssertSetDocContext): void => {
	if (collection !== Collection.AFFILIATIONS) {
		return;
	}

	const proposedDoc = decodeDocData<AffiliationDoc>(proposed.data);

	// 1. Key shape.
	const expectedKey = affiliationKey({
		memberPrincipal: proposedDoc.member,
		kind: proposedDoc.kind,
		affiliationIdentifier: proposedDoc.affiliationIdentifier
	});

	if (key !== expectedKey) {
		throw new Error(
			`affiliations key mismatch: expected ${expectedKey}, got ${key} (member/kind/affiliationIdentifier must match the doc body).`
		);
	}

	// 3. Kind validation.
	if (!AFFILIATION_KINDS.has(proposedDoc.kind)) {
		throw new Error(
			`affiliations kind must be one of ${[...AFFILIATION_KINDS].join(' | ')} (got "${proposedDoc.kind}").`
		);
	}

	// 2. Member binds caller.
	try {
		Principal.fromText(proposedDoc.member);
	} catch {
		throw new Error('affiliations member must be a valid principal text.');
	}

	const callerText = Principal.fromUint8Array(caller).toText();

	if (proposedDoc.member !== callerText) {
		throw new Error('affiliations member must match the caller principal.');
	}

	// 4. Server-computed lock.
	const expectedLockedUntil = proposedDoc.joinedAtMs + AFFILIATION_LOCK_MS;

	if (proposedDoc.lockedUntilMs !== expectedLockedUntil) {
		throw new Error(
			`affiliations lockedUntilMs must equal joinedAtMs + ${AFFILIATION_LOCK_MS}ms (90d); the server computes it.`
		);
	}

	// 5. joinedAtMs sanity: within ±10 minutes of the satellite clock.
	const nowMs = timeMs();
	const driftMs = Math.abs(nowMs - proposedDoc.joinedAtMs);
	const TEN_MINUTES_MS = 10 * MINUTE_IN_MS;

	if (driftMs > TEN_MINUTES_MS) {
		throw new Error('affiliations joinedAtMs must be within ±10 minutes of the satellite clock.');
	}

	// Creation path: done.
	if (isNullish(current)) {
		return;
	}

	// 6. Identity fields immutable on edits.
	const currentDoc = decodeDocData<AffiliationDoc>(current.data);

	if (
		currentDoc.member !== proposedDoc.member ||
		currentDoc.kind !== proposedDoc.kind ||
		currentDoc.affiliationIdentifier !== proposedDoc.affiliationIdentifier ||
		currentDoc.joinedAtMs !== proposedDoc.joinedAtMs ||
		currentDoc.lockedUntilMs !== proposedDoc.lockedUntilMs
	) {
		throw new Error(
			'affiliations identity fields are immutable (member, kind, affiliationIdentifier, joinedAtMs, lockedUntilMs).'
		);
	}
};

/**
 * Pre-delete guard for `affiliations`. Closes the lock-protected
 * leave path:
 *
 *  1. **Caller binds member.** Only the affiliation's owner can
 *     remove their row: admins / staff don't get a kick path on
 *     Worlds slots: the user owns their identity.
 *  2. **Lock enforced.** The delete is rejected if
 *     `Date.now() < currentDoc.lockedUntilMs`. After the lock
 *     expires, the user can leave (or switch by deleting then
 *     creating a new row).
 */
export const assertDeleteAffiliation = ({
	caller,
	data: {
		collection,
		data: { current }
	}
}: AssertDeleteDocContext): void => {
	if (collection !== Collection.AFFILIATIONS) {
		return;
	}

	if (isNullish(current)) {
		return;
	}

	const currentDoc = decodeDocData<AffiliationDoc>(current.data);

	// 1. Caller binds member.
	const callerText = Principal.fromUint8Array(caller).toText();

	if (currentDoc.member !== callerText) {
		throw new Error('affiliations may only be removed by the member themselves.');
	}

	// 2. Lock enforced.
	const nowMs = timeMs();

	if (nowMs < currentDoc.lockedUntilMs) {
		const daysLeft = Math.ceil((currentDoc.lockedUntilMs - nowMs) / DAY_IN_MS);
		throw new Error(`affiliations lock active: cannot leave for another ${daysLeft} day(s).`);
	}
};

/**
 * `affiliations` post-write analytics: emit `affiliation_set` on the CREATE
 * of a row (the client `setDoc` in the Worlds join flow). Updates are
 * skipped: the identity fields are immutable (see `assertSetAffiliation`
 * rule 6), so a re-set of an existing key carries no new affiliation and
 * must not double-count. `source` carries the kind (`university | country`),
 * `label` the affiliation identifier (a school slug / ISO country code:
 * behavioural, never PII). Best-effort: a capture failure is logged and
 * swallowed so analytics can never break the join.
 */
export const onAffiliationSetForAnalytics = (ctx: OnSetDocContext): void => {
	try {
		const {
			data: {
				collection,
				data: { before, after }
			}
		} = ctx;

		if (collection !== Collection.AFFILIATIONS || nonNullish(before)) {
			return;
		}

		const doc = decodeDocData<AffiliationDoc>(after.data);

		captureServerEvents({
			events: [
				{
					name: 'affiliation_set',
					principal: doc.member,
					props: { source: doc.kind, label: doc.affiliationIdentifier }
				}
			]
		});
	} catch (err) {
		logError({
			message: 'affiliation analytics capture failed (join still committed)',
			detail: { error: err instanceof Error ? err.message : `${err}` }
		});
	}
};

/**
 * `affiliations` post-delete analytics: emit `affiliation_removed` on the
 * client `deleteDoc` leave path (only reachable after the 90-day lock:
 * `assertDeleteAffiliation` vetoes earlier). Dimensions are parsed from the
 * doc key (`${member}/${kind}/${affiliationIdentifier}`, defended by
 * `assertSetAffiliation` rule 1) so no decode of the deleted body is
 * needed. The account-deletion cascade drops affiliation rows via the
 * serverless `deleteDocStore`, which never fires hooks, so a departing
 * account does not spray `affiliation_removed` events. Best-effort.
 */
export const onAffiliationDeleteForAnalytics = (ctx: OnDeleteDocContext): void => {
	try {
		const {
			data: { collection, key }
		} = ctx;

		if (collection !== Collection.AFFILIATIONS) {
			return;
		}

		// `split` yields (possibly empty) strings, never nullish: require
		// exactly three non-empty segments so a malformed key can't emit an
		// event with an empty principal or dimension.
		const segments = key.split('/');

		if (segments.length !== 3 || segments.some((segment) => segment.length === 0)) {
			return;
		}

		const [member, kind, affiliationIdentifier] = segments;

		captureServerEvents({
			events: [
				{
					name: 'affiliation_removed',
					principal: member,
					props: { source: kind, label: affiliationIdentifier }
				}
			]
		});
	} catch (err) {
		logError({
			message: 'affiliation analytics capture failed (leave still committed)',
			detail: { error: err instanceof Error ? err.message : `${err}` }
		});
	}
};
