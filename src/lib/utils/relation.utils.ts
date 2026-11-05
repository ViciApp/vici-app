import type { AppLocale } from '#lib/constants/locale.constants.ts';
import { RelationCategory } from '#lib/enums/relation.ts';
import type { NotificationType } from '#lib/stores/notification.store.ts';
import type { FriendRequestOutcome } from '#lib/types/relation.ts';
import { formatRelativeUntilFromMs } from '#lib/utils/format.utils.ts';
import { t } from '#lib/utils/i18n.utils.ts';
import type { PrincipalText } from '@junobuild/schema';

export const toRelationId = ({
	sender,
	target
}: {
	sender: PrincipalText;
	target: PrincipalText;
}): string => `${RelationCategory.FOLLOW}#${sender}#${target}`;

/**
 * Maps a `sendFriendRequest` outcome to the toast the calling surface
 * shows (Arena add-friend sheet, leaderboard mini-profile). `sent` is
 * the silent success path — no notice. The friendship rules behind the
 * statuses live in docs/ai/PRODUCT.md § Friendship rules.
 */
export const friendRequestOutcomeNotice = ({
	outcome,
	locale
}: {
	outcome: FriendRequestOutcome;
	locale: AppLocale;
}): { message: string; type: NotificationType } | undefined => {
	switch (outcome.status) {
		case 'auto_accepted':
			return {
				message: t({ locale, key: 'arena.friends.add.auto_accepted' }),
				type: 'success'
			};
		case 'already_friends':
			return {
				message: t({ locale, key: 'arena.friends.error.already_friends' }),
				type: 'info'
			};
		case 'already_pending':
			return {
				message: t({ locale, key: 'arena.friends.error.already_pending' }),
				type: 'info'
			};
		case 'rejected_cooldown':
			return {
				message: t({
					locale,
					key: 'arena.friends.error.rejected_cooldown',
					params: {
						when: formatRelativeUntilFromMs({
							targetMs: outcome.retryAtMs ?? Date.now(),
							locale
						})
					}
				}),
				type: 'warning'
			};
	}
};
