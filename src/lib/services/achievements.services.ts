// Side-effecting glue around the pure `achievements.utils.ts` evaluator.
//
// Owns the one-shot toast (locale-aware) fired when a sync detects a
// newly-unlocked achievement. Lives in `services/` so the only places
// that depend on `notificationsStore` from a non-component context
// stay narrow and discoverable.

import { ACHIEVEMENT_MAP } from '#lib/constants/achievements.constants.ts';
import { localeStore } from '#lib/stores/locale.store.ts';
import { notificationsStore } from '#lib/stores/notification.store.ts';
import type { AchievementEvaluation } from '#lib/utils/achievements.utils.ts';
import { t } from '#lib/utils/i18n.utils.ts';
import { get } from 'svelte/store';

/**
 * Fires one success toast per newly-unlocked achievement. No-op on
 * empty input. Locale is sampled at call time from `localeStore`.
 */
export const notifyAchievementsUnlocked = (
	newlyUnlocked: readonly AchievementEvaluation[]
): void => {
	if (newlyUnlocked.length === 0) {
		return;
	}

	const locale = get(localeStore);
	const title = t({ locale, key: 'achievement.toast.title' });

	for (const { id, def } of newlyUnlocked) {
		const named = ACHIEVEMENT_MAP.get(id) ?? def;
		const name = t({ locale, key: named.nameKey });
		const message = t({
			locale,
			key: 'achievement.toast.message',
			params: { name, xp: named.xp }
		});

		notificationsStore.add({ title, message, type: 'success' });
	}
};
