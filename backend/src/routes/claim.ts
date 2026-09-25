// Account claim endpoint: a signed-in caller posts the signed handoff blob
// minted by the legacy on-chain app; a verified blob links the proven
// principal to the calling account (matched_via = 'claim'). A principal the
// data migration parked on a provisional account is adopted instead: the
// caller's still-empty account folds into it and the same session cookie now
// resolves to the adopted account (`adopted: true`, the client re-reads /me).
// Idempotent for the same account; stable 409s when the principal belongs to
// another account (`principal_already_linked`) or when adopting would mean
// merging two populated accounts (`account_not_empty`, left for an admin).

import { isNullish } from '@dfinity/utils';
import { Elysia, t } from 'elysia';
import { claimPrincipal } from '../auth/adoption';
import { verifyClaimBlob, type ClaimRejectReason } from '../auth/claim';
import { requireUser, unauthenticated } from '../auth/guard';
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

		const outcome = await claimPrincipal({
			principal: verdict.principal,
			callerUserId: user.id
		});

		if (outcome.kind === 'conflict') {
			set.status = 409;

			return { error: 'principal_already_linked' };
		}

		if (outcome.kind === 'account_not_empty') {
			set.status = 409;

			return { error: 'account_not_empty' };
		}

		set.headers['cache-control'] = 'no-store';

		return {
			ok: true,
			principal: verdict.principal,
			alreadyLinked: outcome.kind === 'already_linked',
			adopted: outcome.kind === 'adopted'
		};
	},
	{ body: t.Object({ blob: t.String() }) }
);
