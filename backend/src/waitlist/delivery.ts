// Once-only delivery for the waitlist emails a worker job sends. A stamp
// written before the send loses the email for good when the process dies
// between the commit and the provider call; a stamp written after it sends
// twice when the process dies between the call and the commit. So a run:
//
//   1. claims the delivery key with a lease (a run that died before the send
//      leaves a lease that expires, and a later run claims it again);
//   2. sends with the key as the provider's idempotency key (a run that died
//      after the provider accepted the email re-sends with the same key, and
//      the provider drops the duplicate);
//   3. stamps after the send, with the caller's own column in the same
//      transaction. A send that fails deletes its own unsent claim (never a
//      newer run's), so the next run retries at once.
//
// What an email says is built from the claim's `created_at`, which a
// re-claim does not move, so a retry sends the same content (the provider
// refuses a reused key with a different body).

import { isNullish } from '@dfinity/utils';
import { query, tx, type TxQuery } from '../db/client';
import { sendEmail, type EmailMessage } from '../lib/email';
import { DAY_IN_MS, TEN_MINUTES_IN_MS } from '../lib/time';

/** How long a claim stays another run's: far longer than one send, far
 * shorter than the provider's 24-hour idempotency window. */
export const WAITLIST_EMAIL_LEASE_MS = TEN_MINUTES_IN_MS;

/** How long a sent delivery row is kept before the prune removes it. */
export const WAITLIST_DELIVERY_RETENTION_MS = 7 * DAY_IN_MS;

export type DeliveryOutcome = 'sent' | 'skipped';

/**
 * Sends the email `build` returns at most once for `key`. `build` receives
 * the claim's first-creation time; `stamp` writes the caller's own column in
 * the transaction that marks the delivery sent.
 */
export const deliverOnce = async ({
	key,
	build,
	stamp
}: {
	key: string;
	build: (createdAt: Date) => EmailMessage;
	stamp?: (q: TxQuery) => Promise<void>;
}): Promise<DeliveryOutcome> => {
	const [claim] = await query<{ created_at: Date; claim: string }>(
		`insert into waitlist_email_deliveries (delivery_key, claimed_at)
		 values ($1, now())
		 on conflict (delivery_key) do update set claimed_at = now()
		 where waitlist_email_deliveries.sent_at is null
		   and waitlist_email_deliveries.claimed_at
		     < now() - make_interval(secs => $2::double precision / 1000)
		 returning created_at, claimed_at::text as claim`,
		[key, WAITLIST_EMAIL_LEASE_MS]
	);

	if (isNullish(claim)) {
		return 'skipped';
	}

	try {
		await sendEmail({ ...build(claim.created_at), idempotencyKey: key });
	} catch (err) {
		// Only this run's claim, matched at full precision (text, since a JS
		// Date drops the microseconds): a run that outlived its lease may have
		// been overtaken, and the newer claim is not this run's to release.
		await query(
			`delete from waitlist_email_deliveries
			 where delivery_key = $1 and sent_at is null and claimed_at = $2::timestamptz`,
			[key, claim.claim]
		);
		throw err;
	}

	await tx(async (q) => {
		await q(`update waitlist_email_deliveries set sent_at = now() where delivery_key = $1`, [key]);
		await stamp?.(q);
	});

	return 'sent';
};

/** Deletes sent delivery rows past retention; the number removed. */
export const pruneWaitlistDeliveries = async (): Promise<number> => {
	const rows = await query<{ delivery_key: string }>(
		`delete from waitlist_email_deliveries
		 where sent_at is not null
		   and sent_at < now() - make_interval(secs => $1::double precision / 1000)
		 returning delivery_key`,
		[WAITLIST_DELIVERY_RETENTION_MS]
	);

	return rows.length;
};
