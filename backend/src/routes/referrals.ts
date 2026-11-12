// Referral surface: the caller's own code (assigned on first read), the
// public code lookup for invite landings, redemption, the friendship-only
// claim, and the caller's referral list. Payout settlement stays on the VXP
// surface (/api/v1/vxp/referral/settle).

import { isNullish } from '@dfinity/utils';
import { Elysia, t } from 'elysia';
import {
	claimReferralFriendship,
	getOrAssignReferralCode,
	listMyReferrals,
	lookupReferralCode,
	redeemReferralCode,
	ReferralError
} from '../account/referrals';
import { requireUser, unauthenticated } from '../auth/guard';
import { badRequest } from '../lib/http';

export const referralsRoutes = new Elysia({ prefix: '/api/v1/referrals' })
	.get('/code', async ({ request, set }) => {
		const user = await requireUser(request);

		if (isNullish(user)) {
			return unauthenticated(set);
		}

		return { code: await getOrAssignReferralCode(user.id) };
	})
	// Public: invite landings resolve the code before the visitor signs in.
	.get(
		'/lookup',
		async ({ query: params }) => ({ owner: (await lookupReferralCode(params.code)) ?? null }),
		{ query: t.Object({ code: t.String() }) }
	)
	.post(
		'/redeem',
		async ({ request, set, body }) => {
			const user = await requireUser(request);

			if (isNullish(user)) {
				return unauthenticated(set);
			}

			try {
				await redeemReferralCode({ userId: user.id, code: body.code });

				return { ok: true };
			} catch (err) {
				if (err instanceof ReferralError) {
					return badRequest(set, err.message);
				}

				throw err;
			}
		},
		{ body: t.Object({ code: t.String() }) }
	)
	.post(
		'/claim-friendship',
		async ({ request, set, body }) => {
			const user = await requireUser(request);

			if (isNullish(user)) {
				return unauthenticated(set);
			}

			try {
				await claimReferralFriendship({ userId: user.id, code: body.code });

				return { ok: true };
			} catch (err) {
				if (err instanceof ReferralError) {
					return badRequest(set, err.message);
				}

				throw err;
			}
		},
		{ body: t.Object({ code: t.String() }) }
	)
	.get('/mine', async ({ request, set }) => {
		const user = await requireUser(request);

		if (isNullish(user)) {
			return unauthenticated(set);
		}

		return { items: await listMyReferrals(user.id) };
	});
