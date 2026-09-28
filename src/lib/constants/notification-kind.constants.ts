import { AppPath } from '$lib/constants/routes.constants';
import type { InboxNotificationKind } from '$lib/types/inbox';
import { nonNullish } from '@dfinity/utils';
import type { LucideIcon } from '@lucide/svelte';
import {
	Bell,
	Check,
	Flame,
	Sparkles,
	Swords,
	Target,
	UserPlus,
	Users
} from '@lucide/svelte/icons';

/**
 * Single source of truth for every notification kind. Maps a kind to its
 * icon, default tap destination, and a taxonomy label. The bell toast, the
 * list rows, and the tap router all read from here, so adding a new kind only
 * needs one entry — no more drifting switch statements duplicating the icon /
 * destination per surface.
 *
 * `dest` is the kind's home surface, used when a notification carries no
 * market id to deep-link to (see `notificationDestination`). The Arena tab
 * hosts the social / challenge surfaces, so those kinds route there.
 *
 * `label` is a developer-facing taxonomy name for the kind (not rendered to
 * users today — the list groups by read-state, not by kind), kept here so the
 * config is the single inspectable description of every kind.
 */
export interface NotificationKindConfig {
	icon: LucideIcon;
	dest: AppPath;
	label: string;
}

export const NOTIFICATION_KIND_CONFIG: Record<InboxNotificationKind, NotificationKindConfig> = {
	resolve: { icon: Check, dest: AppPath.Dash, label: 'Resolution' },
	streak: { icon: Flame, dest: AppPath.Flow, label: 'Streak' },
	social: { icon: Users, dest: AppPath.Arena, label: 'Social' },
	challenge: { icon: Swords, dest: AppPath.Arena, label: 'Challenge' },
	level: { icon: Sparkles, dest: AppPath.Profile, label: 'Level' },
	market: { icon: Target, dest: AppPath.Markets, label: 'Market' },
	friend_request: { icon: UserPlus, dest: AppPath.Arena, label: 'Friend request' },
	battle_incoming: { icon: Swords, dest: AppPath.Arena, label: 'Battle challenge' },
	battle_accepted: { icon: Swords, dest: AppPath.Arena, label: 'Battle accepted' },
	battle_declined: { icon: Swords, dest: AppPath.Arena, label: 'Battle declined' }
};

/**
 * Fallback used when a kind is missing from the config (defensive — every
 * member of the {@link InboxNotificationKind} union is covered above).
 */
const NOTIFICATION_KIND_FALLBACK: NotificationKindConfig = {
	icon: Bell,
	dest: AppPath.Dash,
	label: 'Alert'
};

export const notificationKindConfig = (kind: InboxNotificationKind): NotificationKindConfig =>
	NOTIFICATION_KIND_CONFIG[kind] ?? NOTIFICATION_KIND_FALLBACK;

/**
 * Resolves a notification's tap destination. Deep-links to the market detail
 * when the notification carries a market id (`mid`); otherwise falls back to
 * the kind's home surface. An explicit `href` (already a full path) always
 * wins.
 */
export const notificationDestination = ({
	kind,
	mid,
	href
}: {
	kind: InboxNotificationKind;
	mid?: string;
	href?: string;
}): string => {
	if (nonNullish(href)) {
		return href;
	}

	if (nonNullish(mid) && mid !== '') {
		return `${AppPath.Markets}/${mid}`;
	}

	return notificationKindConfig(kind).dest;
};
