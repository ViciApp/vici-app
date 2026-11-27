import type {
	NicknameSchema,
	ProfilePrivateSchema,
	UserProfileSchema
} from '#lib/schema/profile.schema.ts';
import type * as z from 'zod';

export type Nickname = z.infer<typeof NicknameSchema>;

export type UserProfile = z.infer<typeof UserProfileSchema>;

export type ProfilePrivate = z.infer<typeof ProfilePrivateSchema>;
