// Shared fixtures for the profile / social suites.

import { randomBytes } from 'node:crypto';
import { query } from '../../src/db/client';
import type { Profile } from '../../src/profiles/profile';
import { upsertMyProfile } from '../../src/profiles/profile-write';
import { createTestUser } from './auth';

/** A unique, rule-conform nickname so suites never collide on the fold. */
export const uniqueNickname = (): string => `n${randomBytes(5).toString('hex')}`;

/** A user with a minimal valid profile; extra doc fields override defaults. */
export const createTestProfile = async (
	overrides: Record<string, unknown> = {}
): Promise<{ userId: string; profile: Profile }> => {
	const userId = await createTestUser();
	const profile = await upsertMyProfile({
		userId,
		body: { nickname: uniqueNickname(), ...overrides }
	});

	return { userId, profile };
};

/** Marks a profile soft-deleted directly (the account-lifecycle endpoints
 * that set the marker land with their own phase). */
export const softDeleteProfile = async (userId: string): Promise<void> => {
	await query(`update profiles set deleted_at_ms = $2 where user_id = $1`, [userId, Date.now()]);
};

/** Marks a profile hibernated directly. */
export const hibernateProfile = async (userId: string): Promise<void> => {
	await query(`update profiles set hibernated_at_ms = $2 where user_id = $1`, [userId, Date.now()]);
};
