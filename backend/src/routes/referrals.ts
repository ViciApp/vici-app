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
import { badRequest, clientIp } from '../lib/http';
import { enforceLimit } from '../lib/rate-limit';
import { HOUR_IN_MS } from '../lib/time';

// The lookup is public and maps a code to its owner, so it is limited per
// client IP against enumeration. The budget leaves room for a class on one
// school network opening the same invite link.
const REFERRAL_LOOKUP_LIMIT_PER_HOUR = 120;

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
		async ({ request, set, query: params }) => {
			const limited = enforceLimit({
				set,
				name: 'referral_lookup',
				ip: clientIp(request),
				limit: REFERRAL_LOOKUP_LIMIT_PER_HOUR,
				windowMs: HOUR_IN_MS
			});

			if (limited) {
				return limited;
			}

			return { owner: (await lookupReferralCode(params.code)) ?? null };
		},
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
