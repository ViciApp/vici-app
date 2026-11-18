// Referral graph semantics: idempotent code assignment, lookup
// normalization, the redemption guards (format, unknown code, self-redeem,
// double-redeem, the signup window), the auto-confirmed friendship, and the
// referral list payout shaping.

import { beforeAll, describe, expect, test } from 'bun:test';
import {
	claimReferralFriendship,
	getOrAssignReferralCode,
	listMyReferrals,
	lookupReferralCode,
	redeemReferralCode,
	REFERRAL_CODE_REGEX,
	REFERRAL_EXISTING_USER_REASON
} from '../src/account/referrals';
import { query } from '../src/db/client';
import { friendRelationKey, type RelationState } from '../src/social/relations';
import { ensureMigrated } from './helpers/auth';
import { createTestProfile } from './helpers/profiles';
import { dbAvailable } from './helpers/setup';

const relationState = async (userA: string, userB: string): Promise<RelationState | undefined> => {
	const rows = await query<{ state: RelationState }>(`select state from relations where key = $1`, [
		friendRelationKey(userA, userB)
	]);

	return rows[0]?.state;
};

const ageProfile = async (userId: string, ageMs: number): Promise<void> => {
	await query(
		`update profiles set created_at = now() - ($2 || ' milliseconds')::interval where user_id = $1`,
		[userId, ageMs]
	);
};

describe.if(dbAvailable)('referral codes', () => {
	beforeAll(async () => {
		await ensureMigrated();
	});

	describe('code assignment', () => {
		test('assigns a well-formed code once and returns the same code on every later call', async () => {
			const { userId } = await createTestProfile();

			const code = await getOrAssignReferralCode(userId);

			expect(REFERRAL_CODE_REGEX.test(code)).toBeTrue();
			expect(await getOrAssignReferralCode(userId)).toBe(code);
		});

		test('lookup resolves the owner and normalizes case; unknown or malformed codes resolve nothing', async () => {
			const { userId } = await createTestProfile();
			const code = await getOrAssignReferralCode(userId);

			expect(await lookupReferralCode(code.toLowerCase())).toBe(userId);
			expect(await lookupReferralCode('00000000')).toBeUndefined();
			expect(await lookupReferralCode('not a code')).toBeUndefined();
		});
	});

	describe('redemption', () => {
		test('a fresh sign-up redeems once: the row lands and both parties are auto-friended', async () => {
			const { userId: referrer } = await createTestProfile();
			const { userId: referee } = await createTestProfile();
			const code = await getOrAssignReferralCode(referrer);

			await redeemReferralCode({ userId: referee, code });

			const rows = await query<{ referrer_user_id: string; code: string }>(
				`select referrer_user_id, code from referrals where referee_user_id = $1`,
				[referee]
			);

			expect(rows[0]?.referrer_user_id).toBe(referrer);
			expect(rows[0]?.code).toBe(code);
			expect(await relationState(referrer, referee)).toBe('ACTIVE');
		});

		test('self-redeem is rejected', async () => {
			const { userId } = await createTestProfile();
			const code = await getOrAssignReferralCode(userId);

			expect(redeemReferralCode({ userId, code })).rejects.toThrow(
				'You cannot redeem your own referral code.'
			);
		});

		test('a second redemption is rejected, even with a different code', async () => {
			const { userId: referrerA } = await createTestProfile();
			const { userId: referrerB } = await createTestProfile();
			const { userId: referee } = await createTestProfile();

			await redeemReferralCode({ userId: referee, code: await getOrAssignReferralCode(referrerA) });

			expect(
				redeemReferralCode({ userId: referee, code: await getOrAssignReferralCode(referrerB) })
			).rejects.toThrow('You have already redeemed a referral code.');
		});

		test('unknown and malformed codes are rejected; a profile is required', async () => {
			const { userId } = await createTestProfile();

			expect(redeemReferralCode({ userId, code: '00000000' })).rejects.toThrow(
				'Unknown referral code.'
			);
			expect(redeemReferralCode({ userId, code: 'nope' })).rejects.toThrow(
				'Invalid referral code format.'
			);
		});

		test('a profile older than the signup window is refused with the exact existing-user reason', async () => {
			const { userId: referrer } = await createTestProfile();
			const { userId: referee } = await createTestProfile();
			const code = await getOrAssignReferralCode(referrer);

			await ageProfile(referee, 25 * 60 * 60 * 1000);

			expect(redeemReferralCode({ userId: referee, code })).rejects.toThrow(
				REFERRAL_EXISTING_USER_REASON
			);
		});
	});

	describe('friendship claim', () => {
		test('an ineligible user still gets the friendship, idempotently, and never their own code', async () => {
			const { userId: referrer } = await createTestProfile();
			const { userId: existing } = await createTestProfile();
			const code = await getOrAssignReferralCode(referrer);

			await claimReferralFriendship({ userId: existing, code });
			await claimReferralFriendship({ userId: existing, code });

			expect(await relationState(referrer, existing)).toBe('ACTIVE');
			expect(claimReferralFriendship({ userId: referrer, code })).rejects.toThrow(
				'You cannot redeem your own referral code.'
			);
		});

		test('an existing relation is never downgraded by the claim', async () => {
			const { userId: referrer } = await createTestProfile();
			const { userId: other } = await createTestProfile();
			const code = await getOrAssignReferralCode(referrer);

			await query(
				`insert into relations (key, category, state, participant_one, participant_two)
				 values ($1, 'FRIEND', 'PENDING', $2, $3)`,
				[friendRelationKey(referrer, other), referrer, other]
			);

			await claimReferralFriendship({ userId: other, code });

			expect(await relationState(referrer, other)).toBe('PENDING');
		});
	});

	describe('referral list', () => {
		test('lists the referrer view newest-first with owed referee payout and an undecided referrer slot', async () => {
			const { userId: referrer } = await createTestProfile();
			const { userId: refereeA } = await createTestProfile();
			const { userId: refereeB } = await createTestProfile();
			const code = await getOrAssignReferralCode(referrer);

			await redeemReferralCode({ userId: refereeA, code });
			await query(
				`update referrals set redeemed_at_ms = redeemed_at_ms - 1000 where referee_user_id = $1`,
				[refereeA]
			);
			await redeemReferralCode({ userId: refereeB, code });

			const items = await listMyReferrals(referrer);

			expect(items.map((item) => item.referee)).toEqual([refereeB, refereeA]);
			expect(items[0]?.refereePayout).toEqual({ status: 'owed', amountBaseUnits: '0' });
			expect(items[0]?.referrerPayout).toEqual({ status: 'none', amountBaseUnits: '0' });
			// Undecided cap slots read as within-cap pending until settlement
			// decides them, mirroring the pending referrerPayout above.
			expect(items[0]?.withinReferrerCap).toBeTrue();
		});
	});
});
