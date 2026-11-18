import type {
	NicknameSchema,
	ProfilePrivateSchema,
	UserProfileSchema
} from '#lib/schema/profile.schema.ts';
import type { j } from '@junobuild/schema';

export type Nickname = j.infer<typeof NicknameSchema>;

export type UserProfile = j.infer<typeof UserProfileSchema>;

export type ProfilePrivate = j.infer<typeof ProfilePrivateSchema>;
