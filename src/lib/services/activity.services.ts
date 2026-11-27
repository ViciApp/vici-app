import {
	createActivity as createActivityApi,
	listActivities as listActivitiesApi
} from '#lib/api-client/client.ts';
import { ActivityType } from '#lib/enums/social.ts';
import type { Activity } from '#lib/types/social.ts';

export const logActivity = async (activity: Omit<Activity, 'timestamp'>): Promise<void> => {
	// The HTTP route stamps the author from the session (the passed `user` is
	// that same account id) and runs the trade-activity award triggers
	// (onboarding call-count milestones, referral settlement) after the write,
	// so no extra client call is needed for those awards.
	await createActivityApi({
		type: activity.type,
		targetUser: activity.targetUser,
		marketId: activity.marketId,
		title: activity.title,
		details: activity.details,
		timestamp: Date.now()
	});
};

/**
 * Most-recent SETTLEMENT activities, filtered by type server-side.
 *
 * Settlements are rare admin actions, so unlike an any-type window, which
 * flushes a settlement row out as soon as `limit` newer trades / comments
 * land, a single page here effectively covers the whole catalog's outcome
 * labels.
 */
export const getSettlementActivities = async ({ limit = 200 }: { limit?: number } = {}): Promise<
	Activity[]
> => {
	if (limit <= 0) {
		return [];
	}

	return await listActivitiesApi({ limit, type: ActivityType.SETTLEMENT });
};
