import { Collection } from '#lib/constants/collections.constants.ts';
import { ActivityType } from '#lib/enums/social.ts';
import type { Activity } from '#lib/types/social.ts';
import { isWeb2Backend } from '#lib/web2/backend-mode.ts';
import {
	createActivity as createActivityWeb2,
	listActivities as listActivitiesWeb2
} from '#lib/web2/client.ts';
import { listDocs, setDoc, type ListParams } from '@junobuild/core';

export const logActivity = async (activity: Omit<Activity, 'timestamp'>): Promise<void> => {
	const timestamp = Date.now();

	// The HTTP route stamps the author from the session (the passed `user` is
	// that same account id) and runs the trade-activity award triggers
	// (onboarding call-count milestones, referral settlement) after the write,
	// so award parity with the satellite's post-write hooks holds without any
	// extra client call.
	if (isWeb2Backend()) {
		await createActivityWeb2({
			type: activity.type,
			targetUser: activity.targetUser,
			marketId: activity.marketId,
			title: activity.title,
			details: activity.details,
			timestamp
		});

		return;
	}

	const key = `${activity.user}#${timestamp}#${activity.type}`;

	await setDoc({
		collection: Collection.ACTIVITIES,
		doc: {
			key,
			data: {
				...activity,
				timestamp
			}
		}
	});
};

const listActivities = async ({
	certified = false,
	filter
}: { certified?: boolean; filter?: ListParams } = {}): Promise<Activity[]> => {
	const { items } = await listDocs<Activity>({
		collection: Collection.ACTIVITIES,
		filter,
		options: { certified }
	});

	return items.map(({ data }) => data);
};

/**
 * Most-recent SETTLEMENT activities, matched server-side on the
 * `${user}#${timestamp}#${type}` key suffix.
 *
 * Settlements are rare admin actions, so unlike an any-type window, which
 * flushes a settlement row out as soon as `limit` newer trades / comments
 * land, a single page here effectively covers the whole catalog's outcome
 * labels.
 */
export const getSettlementActivities = async ({
	limit = 200,
	certified = false
}: { limit?: number; certified?: boolean } = {}): Promise<Activity[]> => {
	if (limit <= 0) {
		return [];
	}

	// The HTTP list filters by type server-side, replacing the key-suffix
	// matcher the satellite scan needs.
	if (isWeb2Backend()) {
		return await listActivitiesWeb2({ limit, type: ActivityType.SETTLEMENT });
	}

	return await listActivities({
		certified,
		filter: {
			matcher: { key: `#${ActivityType.SETTLEMENT}$` },
			order: { field: 'created_at', desc: true },
			paginate: { limit }
		}
	});
};
