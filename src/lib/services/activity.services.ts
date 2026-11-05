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

export const getGlobalActivities = async ({
	limit = 50,
	certified = false
}: { limit?: number; certified?: boolean } = {}): Promise<Activity[]> => {
	if (limit <= 0) {
		return [];
	}

	// Fetch only the most-recent `limit` docs server-side instead of
	// downloading the entire ACTIVITIES collection and slicing in JS,
	// keeping the call flat as lifetime activity grows.
	//
	// Ordering is by the satellite's `created_at`, not the client-written
	// `data.timestamp` the old code sliced on — Juno can only order by
	// `created_at` / `updated_at` / `keys`, never an arbitrary data field.
	// The two diverge only when a client's clock is skewed or it backdates
	// `timestamp`, in which case the server-assigned `created_at` is the
	// more trustworthy recency signal anyway. The trailing `data.timestamp`
	// sort just stabilises ordering within the returned page. The HTTP list
	// is the same newest-first-by-insert-time window, so both transports
	// share that stabilising pass.
	const items = isWeb2Backend()
		? await listActivitiesWeb2({ limit })
		: await listActivities({
				certified,
				filter: { order: { field: 'created_at', desc: true }, paginate: { limit } }
			});

	return items.sort((a, b) => b.timestamp - a.timestamp).slice(0, limit);
};

/**
 * Most-recent SETTLEMENT activities, matched server-side on the
 * `${user}#${timestamp}#${type}` key suffix.
 *
 * Settlements are rare admin actions, so unlike {@link getGlobalActivities} —
 * whose any-type window flushes a settlement row out as soon as `limit` newer
 * trades / comments land — a single page here effectively covers the whole
 * catalog's outcome labels.
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
