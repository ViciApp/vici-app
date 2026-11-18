import { AppPath } from '#lib/constants/routes.constants.ts';
import type { NavItem } from '#lib/types/nav.ts';
import { CircleUserRound, House, LayoutDashboard, Users, Zap } from '@lucide/svelte/icons';

/**
 * Bottom-nav structure. The five visible tabs map 1:1 onto the design
 * pill-nav (Markets · Dash · Flow · Arena · Profile) with
 * Flow centered and styled as the primary action.
 *
 * Routes that don't have their own nav slot cascade active state to a
 * parent tab via `MobileNav.svelte`'s alias table:
 *
 *  - Markets ← /markets/[id]
 *  - Dash    ← /portfolio
 *  - Arena   ← /arena/* (leagues · worlds · battles · tournament · leaderboard)
 *  - Profile ← /wallet, /settings, /notifications
 */
export const navItems: NavItem[] = [
	{ labelKey: 'nav.markets', path: AppPath.Home, mobileIcon: House },
	{ labelKey: 'nav.dash', path: AppPath.Dash, mobileIcon: LayoutDashboard },
	{ labelKey: 'nav.flow', path: AppPath.Flow, mobileIcon: Zap, icon: Zap },
	{ labelKey: 'nav.arena', path: AppPath.Arena, mobileIcon: Users },
	{ labelKey: 'nav.profile', path: AppPath.Profile, mobileIcon: CircleUserRound }
];
