import { Collection } from '#lib/constants/collections.constants.ts';
import { ActivityType } from '#lib/enums/social.ts';
import type { Activity } from '#lib/types/social.ts';
import { Principal } from '@icp-sdk/core/principal';
import type { AssertSetDocContext } from '@junobuild/functions';
import { decodeDocData } from '@junobuild/functions/sdk';

const ACTIVITY_TYPES: readonly string[] = Object.values(ActivityType);

/**
 * Write-time guard for the `activities` collection. The collection is public-write (it's the social
 * feed), and several server flows now read it: the onboarding milestones and the referral
 * first-prediction payout both key off a caller's `trade` activity. Without a guard a client could
 * `set_doc` an activity attributed to **another** principal (feed spoofing) or under a malformed
 * key. This assert binds every activity to its writer:
 *
 *  - `data.user` (the actor) MUST equal the caller; no writing activity as someone else.
 *  - `type` must be a known {@link ActivityType}.
 *  - the doc key must be `${caller}#${timestamp}#${type}` (the shape `logActivity` writes), so the
 *    owner-scoped reads + the `#trade`-suffix matcher used by the payout gates stay trustworthy.
 *
 * NOTE: this stops impersonation, not a user self-faking their *own* `trade` to trigger their own
 * reward: that requires verifying an authoritative cleared trade on the engine (tracked in #543).
 */
export const assertSetActivity = ({
	caller,
	data: {
		collection,
		key,
		data: { proposed }
	}
}: AssertSetDocContext): void => {
	if (collection !== Collection.ACTIVITIES) {
		return;
	}

	const callerText = Principal.fromUint8Array(caller).toText();

	let activity: Activity;

	try {
		activity = decodeDocData<Activity>(proposed.data);
	} catch {
		throw new Error('Invalid activity payload.');
	}

	if (!ACTIVITY_TYPES.includes(activity.type)) {
		throw new Error('Unknown activity type.');
	}

	if (activity.user !== callerText) {
		throw new Error('Activity user must match the caller.');
	}

	// `logActivity` keys every row `${user}#${timestamp}#${type}`. Principals / numeric timestamps /
	// type tokens never contain `#`, so the split is exactly three parts.
	const parts = key.split('#');

	if (
		parts.length !== 3 ||
		parts[0] !== callerText ||
		parts[2] !== activity.type ||
		!/^\d+$/.test(parts[1])
	) {
		throw new Error('Activity key must be `${caller}#${timestamp}#${type}`.');
	}

	// `timestamp` drives UI rendering (`new Date(...)`) and client-side ordering, so reject a
	// malformed value (string / NaN / Infinity). It must be a safe integer and equal the key's
	// timestamp segment: the shape `logActivity` writes (`Date.now()` in both places).
	if (!Number.isSafeInteger(activity.timestamp) || `${activity.timestamp}` !== parts[1]) {
		throw new Error('Activity timestamp must be a safe integer matching the key.');
	}
};
