// VXP economy surface: the caller's own award history, the calibration
// claim, the manual referral settle (self-heal / operator retry), the admin
// reconciliation + streak-backfill operations the worker also runs, and the
// admin treasury status the minter reserve setup is driven from.

import { isNullish, nonNullish } from '@dfinity/utils';
import { Elysia, t } from 'elysia';
import { forbidden, requireAdmin, requireUser, unauthenticated } from '../auth/guard';
import { treasuryIcPrincipalText } from '../lib/keys';
import { logger } from '../lib/logger';
import {
	getTreasuryBacklog,
	isVxpTreasuryDisabled,
	listUserAwards,
	reconcileUnpaidAwards,
	type VxpAwardType
} from '../vxp/awards';
import { claimCalibrationReward } from '../vxp/calibration';
import { getTreasuryVxpBalance } from '../vxp/payout';
import { settleReferralPayout } from '../vxp/referral';
import { backfillStreakUnderpayments } from '../vxp/streak';

const AWARD_TYPES: readonly VxpAwardType[] = [
	'onboarding',
	'streak',
	'calibration',
	'referral',
	'worlds_podium',
	'tournament_prize',
	'achievement',
	'comeback',
	'flow_milestone',
	'flow_overtime',
	'league_founder'
];

const isAwardType = (value: string): value is VxpAwardType =>
	(AWARD_TYPES as readonly string[]).includes(value);

export const vxpRoutes = new Elysia({ prefix: '/api/v1/vxp' })
	.get(
		'/awards',
		async ({ request, set, query: params }) => {
			const user = await requireUser(request);

			if (isNullish(user)) {
				return unauthenticated(set);
			}

			const { type } = params;

			if (nonNullish(type) && !isAwardType(type)) {
				set.status = 400;

				return { error: 'unknown_award_type' };
			}

			return {
				items: await listUserAwards({
					userId: user.id,
					awardType: nonNullish(type) && isAwardType(type) ? type : undefined
				})
			};
		},
		{ query: t.Object({ type: t.Optional(t.String()) }) }
	)
	.post(
		'/calibration/claim',
		async ({ request, set, body }) => {
			const user = await requireUser(request);

			if (isNullish(user)) {
				return unauthenticated(set);
			}

			return await claimCalibrationReward({
				userId: user.id,
				seriesId: body.seriesId,
				chosenSide: body.chosenSide
			});
		},
		{
			body: t.Object({
				seriesId: t.String(),
				chosenSide: t.Union([t.Literal('YES'), t.Literal('NO')])
			})
		}
	)
	// Manual retry path for a referral settlement whose triggering activity
	// did not complete. Recipients and amounts come entirely from the stored
	// row plus server constants, and every step is idempotent, so a caller can
	// at most complete a legitimate, one-time payout. Still scoped: the
	// result reveals whether a user has a referral and has traded, so a
	// non-admin may only target their own referee row; admins keep the
	// operator-backfill reach.
	.post(
		'/referral/settle',
		async ({ request, set, body }) => {
			const user = await requireUser(request);

			if (isNullish(user)) {
				return unauthenticated(set);
			}

			const refereeUserId = body.refereeUserId ?? user.id;

			if (refereeUserId !== user.id && user.role !== 'admin') {
				return forbidden(set);
			}

			return await settleReferralPayout({ refereeUserId });
		},
		{ body: t.Object({ refereeUserId: t.Optional(t.String({ format: 'uuid' })) }) }
	)
	// The treasury principal is public (it is the reserve account the minter
	// registers); the balance read is best-effort so a ledger hiccup still
	// returns the principal and the backlog.
	.get('/admin/treasury', async ({ request, set }) => {
		const user = await requireUser(request);

		if (isNullish(user)) {
			return unauthenticated(set);
		}

		const admin = await requireAdmin(request);

		if (isNullish(admin)) {
			return forbidden(set);
		}

		let balanceBaseUnits: string | null = null;

		try {
			balanceBaseUnits = (await getTreasuryVxpBalance()).toString();
		} catch (err) {
			logger.error('vxp treasury balance read failed:', err);
		}

		return {
			principal: treasuryIcPrincipalText(),
			recordOnly: isVxpTreasuryDisabled(),
			balanceBaseUnits,
			backlog: await getTreasuryBacklog()
		};
	})
	.post('/admin/reconcile', async ({ request, set }) => {
		const user = await requireUser(request);

		if (isNullish(user)) {
			return unauthenticated(set);
		}

		const admin = await requireAdmin(request);

		if (isNullish(admin)) {
			return forbidden(set);
		}

		return await reconcileUnpaidAwards({ graceMs: 0 });
	})
	.post(
		'/admin/streak-backfill',
		async ({ request, set, body }) => {
			const user = await requireUser(request);

			if (isNullish(user)) {
				return unauthenticated(set);
			}

			const admin = await requireAdmin(request);

			if (isNullish(admin)) {
				return forbidden(set);
			}

			return await backfillStreakUnderpayments({ dryRun: body?.dryRun ?? true });
		},
		{ body: t.Optional(t.Object({ dryRun: t.Optional(t.Boolean()) })) }
	);
