// Account claim endpoint: a signed-in caller posts the signed handoff blob
// minted by the legacy on-chain app; a verified blob links the proven
// principal to the calling account (matched_via = 'claim'). Idempotent for
// the same account, a stable 409 when the principal belongs to another one.

import { isNullish } from '@dfinity/utils';
import { Elysia, t } from 'elysia';
import { verifyClaimBlob, type ClaimRejectReason } from '../auth/claim';
import { requireUser, unauthenticated } from '../auth/guard';
import { query } from '../db/client';
import { clientIp } from '../lib/http';
import { enforceLimit } from '../lib/rate-limit';

const TEN_MIN_MS = 10 * 60 * 1000;

/** Generous ceiling for a delegation chain with a canister-signature
 * certificate; anything larger is garbage not worth parsing. */
const MAX_BLOB_LENGTH = 64 * 1024;

const reasonToCode = (reason: ClaimRejectReason): string => {
	switch (reason) {
		case 'stale_issued_at':
			return 'stale_claim';
		case 'expired_delegation':
			return 'expired_delegation';
		default:
			return 'invalid_claim';
	}
};

export const claimRoutes = new Elysia({ prefix: '/api/v1' }).post(
	'/claim',
	async ({ body, request, set }) => {
		const user = await requireUser(request);

		if (isNullish(user)) {
			return unauthenticated(set);
		}

		const limited = enforceLimit({
			set,
			name: 'claim',
			ip: clientIp(request),
			limit: 10,
			windowMs: TEN_MIN_MS
		});

		if (limited) {
			return limited;
		}

		if (body.blob.length === 0 || body.blob.length > MAX_BLOB_LENGTH) {
			set.status = 400;

			return { error: 'invalid_claim' };
		}

		const verdict = await verifyClaimBlob({ blob: body.blob });

		if (!verdict.ok) {
			set.status = 400;

			return { error: reasonToCode(verdict.reason) };
		}

		// `on conflict do nothing` keeps an existing link (whoever owns it)
		// untouched; an empty returning set means the link pre-existed and the
		// follow-up read decides between the idempotent success and the 409.
		const inserted = await query<{ principal: string }>(
			`insert into legacy_principals (principal, user_id, matched_via)
			 values ($1, $2, 'claim')
			 on conflict (principal) do nothing
			 returning principal`,
			[verdict.principal, user.id]
		);
		const alreadyLinked = inserted.length === 0;

		if (alreadyLinked) {
			const rows = await query<{ user_id: string }>(
				`select user_id from legacy_principals where principal = $1`,
				[verdict.principal]
			);

			if (rows[0]?.user_id !== user.id) {
				set.status = 409;

				return { error: 'principal_already_linked' };
			}
		}

		set.headers['cache-control'] = 'no-store';

		return { ok: true, principal: verdict.principal, alreadyLinked };
	},
	{ body: t.Object({ blob: t.String() }) }
);
