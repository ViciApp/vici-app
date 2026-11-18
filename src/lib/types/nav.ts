import type { AppPath } from '#lib/constants/routes.constants.ts';
import type { MessageKey } from '#lib/utils/i18n.utils.ts';
import type { Briefcase, CircleUserRound, House, LayoutDashboard, Zap } from '@lucide/svelte/icons';

export interface NavItem {
	labelKey: MessageKey;
	path: AppPath;
	mobileIcon:
		typeof House | typeof Zap | typeof LayoutDashboard | typeof Briefcase | typeof CircleUserRound;
	icon?: typeof Zap;
}
