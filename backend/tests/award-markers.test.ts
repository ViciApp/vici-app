// One-time awards across an account's hard delete: the purge leaves an
// anonymous marker per one-time award the account was paid, so the same
// sign-in identity, provisioned again as a new account, cannot collect any of
// them a second time. A different identity is untouched, repeatable awards
// leave no marker, and a marker holds no personal data.

import { Principal } from '@icp-sdk/core/principal';
import { afterEach, beforeAll, describe, expect, test } from 'bun:test';
import { hardDeleteAccount } from '../src/account/lifecycle';
import { getOrAssignReferralCode, redeemReferralCode } from '../src/account/referrals';
import { resolveIdentity, type Provider } from '../src/auth/identity';
import { query } from '../src/db/client';
import type { ClearingDid, ClearingService, RegistryService } from '../src/declarations';
import { setEngineActorProvider } from '../src/engine/actors';
import { upsertMyProfile } from '../src/profiles/profile-write';
import { grantAward } from '../src/vxp/awards';
import {
	parseVxp,
	referrerRewardBaseUnits,
	VXP_LEAGUE_FOUNDER_MAX_AWARDS
} from '../src/vxp/constants';
import { grantLeagueFounderAward } from '../src/vxp/founder';
import { runOnboardingProfileTrigger } from '../src/vxp/onboarding';
import { recordReferralRedemption, settleReferralPayout } from '../src/vxp/referral';
import { ensureMigrated, uniqueEmail } from './helpers/auth';
import { uniqueNickname } from './helpers/profiles';
import { readAwardRow, stubVxpLedger, type LedgerStub } from './helpers/vxp';

let stub: LedgerStub | undefined;
let restoreEngine: (() => void) | undefined;

beforeAll(async () => {
	await ensureMigrated();
});

afterEach(() => {
	stub?.restore();
	stub = undefined;
	restoreEngine?.();
	restoreEngine = undefined;
});

const signIn = ({
	email,
	provider = 'email',
	subject = email
}: {
	email: string;
	provider?: Provider;
	subject?: string;
}): Promise<string> => resolveIdentity({ provider, subject, email });

const markerRows = async (): Promise<
	{ identity_digest: string; award_type: string; award_key: string }[]
> =>
	await query<{ identity_digest: string; award_type: string; award_key: string }>(
		`select identity_digest, award_type, award_key from vxp_award_markers`
	);

describe('a deleted account cannot collect its one-time awards again', () => {
	test('the registration grant pays the same email address once, across a re-sign-up', async () => {
		stub = stubVxpLedger();
		const email = uniqueEmail();
		const first = await signIn({ email });

		await runOnboardingProfileTrigger({ userId: first });
		await hardDeleteAccount(first);

		const again = await signIn({ email });

		expect(again).not.toBe(first);

		await runOnboardingProfileTrigger({ userId: again });

		expect(stub.transfers).toHaveLength(1);
		expect(
			await readAwardRow({ userId: again, awardType: 'onboarding', awardKey: 'm1' })
		).toBeUndefined();
	});

	test('an OAuth account re-created under the same subject, or the same address by email, is refused', async () => {
		stub = stubVxpLedger();
		const email = uniqueEmail();
		const subject = `sub-${crypto.randomUUID()}`;
		const first = await signIn({ email, provider: 'google', subject });

		await runOnboardingProfileTrigger({ userId: first });
		await hardDeleteAccount(first);

		const sameSubject = await signIn({ email: uniqueEmail(), provider: 'google', subject });

		await runOnboardingProfileTrigger({ userId: sameSubject });
		await hardDeleteAccount(sameSubject);

		const sameAddress = await signIn({ email });

		await runOnboardingProfileTrigger({ userId: sameAddress });

		expect(stub.transfers).toHaveLength(1);
	});

	test('the referee bonus, keyed by the account itself, is not paid to the identity again', async () => {
		stub = stubVxpLedger();
		const email = uniqueEmail();
		const first = await signIn({ email });

		await grantAward({
			userId: first,
			awardType: 'referral',
			awardKey: first,
			amountBaseUnits: parseVxp(100)
		});
		await hardDeleteAccount(first);

		const again = await signIn({ email });
		const outcome = await grantAward({
			userId: again,
			awardType: 'referral',
			awardKey: again,
			amountBaseUnits: parseVxp(100)
		});

		expect(outcome).toEqual({ outcome: 'already' });
		expect(stub.transfers).toHaveLength(1);
	});

	test('a re-created account cannot redeem a referral code again', async () => {
		stub = stubVxpLedger();
		const referrer = await signIn({ email: uniqueEmail() });
		const code = await getOrAssignReferralCode(referrer);
		const email = uniqueEmail();
		const first = await signIn({ email });

		await grantAward({
			userId: first,
			awardType: 'referral',
			awardKey: first,
			amountBaseUnits: parseVxp(100)
		});
		await hardDeleteAccount(first);

		const again = await signIn({ email });

		await upsertMyProfile({ userId: again, body: { nickname: uniqueNickname() } });

		await expect(redeemReferralCode({ userId: again, code })).rejects.toThrow(
			'You have already redeemed a referral code.'
		);
	});

	test('the league-founder lifetime cap counts the awards of the deleted account', async () => {
		stub = stubVxpLedger();
		const email = uniqueEmail();
		const first = await signIn({ email });

		await query(
			`insert into vxp_awards (user_id, award_type, award_key, amount_base_units, status, earned_at_ms, paid_at_ms, block_index)
			 select $1, 'league_founder', 'lg-founded-' || n, '1', 'paid', 1, 1, n::text
			 from generate_series(1, $2::int) as n`,
			[first, VXP_LEAGUE_FOUNDER_MAX_AWARDS]
		);
		await hardDeleteAccount(first);

		const again = await signIn({ email });

		expect(
			await grantLeagueFounderAward({ userId: again, leagueId: `lg-${crypto.randomUUID()}` })
		).toBe('capped');
		expect(stub.transfers).toHaveLength(0);
	});

	test('a referrer re-created under the same identity keeps the tier its conversions reached', async () => {
		stub = stubVxpLedger();
		const fill: ClearingDid.Event = {
			event_id: BigInt(1),
			series_id: 'series-award-markers',
			user: Principal.anonymous(),
			clearing_id: Principal.anonymous(),
			qty: BigInt(10),
			timestamp: BigInt(Date.now()) * BigInt(1_000_000),
			price: { timestamp: [], oracle_id: [], decimal: { value: BigInt(50), decimals: 2 } },
			event_type: { Executed: null }
		};
		restoreEngine = setEngineActorProvider({
			clearing: () =>
				Promise.resolve({
					get_trade_history: () => Promise.resolve([fill])
				} as unknown as ClearingService),
			registry: () => Promise.resolve({} as unknown as RegistryService)
		});
		const email = uniqueEmail();
		const referrer = await signIn({ email });

		// Five paid conversions: the referrer's next one pays the second tier.
		await query(
			`insert into vxp_awards (user_id, award_type, award_key, amount_base_units, status, earned_at_ms, paid_at_ms, block_index)
			 select $1, 'referral', gen_random_uuid()::text, '1', 'paid', 1, 1, n::text
			 from generate_series(1, 5) as n`,
			[referrer]
		);
		await hardDeleteAccount(referrer);

		const again = await signIn({ email });
		const referee = await signIn({ email: uniqueEmail() });

		await recordReferralRedemption({
			refereeUserId: referee,
			referrerUserId: again,
			code: 'CODE0AMK',
			redeemedAtMs: Date.now()
		});
		await settleReferralPayout({ refereeUserId: referee });

		expect(
			(await readAwardRow({ userId: again, awardType: 'referral', awardKey: referee }))
				?.amount_base_units
		).toBe(referrerRewardBaseUnits(5).toString());
	});

	test('another identity collects the same award as usual', async () => {
		stub = stubVxpLedger();
		const first = await signIn({ email: uniqueEmail() });

		await runOnboardingProfileTrigger({ userId: first });
		await hardDeleteAccount(first);

		const other = await signIn({ email: uniqueEmail() });

		await runOnboardingProfileTrigger({ userId: other });

		expect(stub.transfers).toHaveLength(2);
		expect(
			(await readAwardRow({ userId: other, awardType: 'onboarding', awardKey: 'm1' }))?.status
		).toBe('paid');
	});

	test('a repeatable award leaves no marker, and an unpaid one-time award is still owed', async () => {
		stub = stubVxpLedger();
		const email = uniqueEmail();
		const first = await signIn({ email });
		const dayKey = '2026-11-02';

		await grantAward({
			userId: first,
			awardType: 'flow_overtime',
			awardKey: dayKey,
			amountBaseUnits: parseVxp(10)
		});
		await query(
			`insert into vxp_awards (user_id, award_type, award_key, amount_base_units, status, earned_at_ms, error_message)
			 values ($1, 'comeback', 'restore', '1', 'failed', 1, 'rejected')`,
			[first]
		);
		await hardDeleteAccount(first);

		const again = await signIn({ email });

		expect(
			await grantAward({
				userId: again,
				awardType: 'flow_overtime',
				awardKey: dayKey,
				amountBaseUnits: parseVxp(10)
			})
		).toMatchObject({ outcome: 'paid' });
		expect(
			await grantAward({
				userId: again,
				awardType: 'comeback',
				awardKey: 'restore',
				amountBaseUnits: parseVxp(10)
			})
		).toMatchObject({ outcome: 'paid' });
	});

	test('a marker holds a digest, the award type and key, nothing personal, and is written once', async () => {
		stub = stubVxpLedger();
		const email = uniqueEmail();
		const first = await signIn({ email });

		await runOnboardingProfileTrigger({ userId: first });
		await hardDeleteAccount(first);

		const written = await markerRows();

		await hardDeleteAccount(first);

		expect((await markerRows()).length).toBe(written.length);
		expect(written.some(({ award_type }) => award_type === 'onboarding')).toBe(true);
		expect(JSON.stringify(written)).not.toContain(email);
		expect(JSON.stringify(written)).not.toContain(first);

		for (const { identity_digest } of written) {
			expect(identity_digest).toMatch(/^[0-9a-f]{64}$/);
		}
	});
});
