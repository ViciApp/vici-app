import { Collection } from '#lib/constants/collections.constants.ts';
import {
	REPEATABLE_VXP_AWARD_TYPES,
	type VxpAwardDoc,
	type VxpAwardStatus
} from '#lib/types/vxp-award.ts';
import type { VxpMilestonePayoutStatus, VxpOnboardingDoc } from '#lib/types/vxp-onboarding.ts';
import { controllerCaller } from '#satellite/services/authz.services.ts';
import {
	vxpAwardMarkerKey,
	vxpAwardMarkerPrefix,
	type VxpAwardMarkerType
} from '#satellite/utils/award-marker.utils.ts';
import { isNullish, nonNullish } from '@dfinity/utils';
import {
	countDocsStore,
	decodeDocData,
	encodeDocData,
	getDocStore,
	listDocsStore,
	setDocStore
} from '@junobuild/functions/sdk';

/**
 * Anonymous markers of the one-time awards a purged account was paid. The purge deletes the
 * account's `vxp_awards` and `vxp_onboarding` docs, and the same principal can sign up again, so a
 * marker is what keeps it from collecting a one-time award twice. A marker is a doc keyed by a
 * digest of the principal plus the award type and key ({@link vxpAwardMarkerKey}), with no data.
 */

const MARKER_PURPOSE = 'vxp award markers';

/** Award docs that may have moved VXP: paid, or pending, whose transfer may have landed before its
 * outcome was written. A failed award moved nothing and leaves no marker. */
const PAID_AWARD_STATUSES: readonly VxpAwardStatus[] = ['paid', 'pending'];

/** Onboarding milestones that may have moved VXP, for the same reason. */
const PAID_MILESTONE_STATUSES: readonly VxpMilestonePayoutStatus[] = ['paid', 'processing'];

const isOneTimeAwardType = (awardType: VxpAwardMarkerType): boolean =>
	!REPEATABLE_VXP_AWARD_TYPES.some((repeatable) => repeatable === awardType);

/**
 * Whether `principalText` was already paid this one-time award under an account it deleted. Always
 * false for a repeatable type.
 */
export const hasAwardMarker = ({
	principalText,
	awardType,
	awardKey
}: {
	principalText: string;
	awardType: VxpAwardMarkerType;
	awardKey: string;
}): boolean =>
	isOneTimeAwardType(awardType) &&
	nonNullish(
		getDocStore({
			collection: Collection.VXP_AWARD_MARKERS,
			key: vxpAwardMarkerKey({ principalText, awardType, awardKey }),
			caller: controllerCaller(MARKER_PURPOSE)
		})
	);

/**
 * How many awards of one type `principalText` was paid under accounts it deleted: the share of a
 * lifetime cap those accounts already used up.
 */
export const countAwardMarkers = ({
	principalText,
	awardType
}: {
	principalText: string;
	awardType: VxpAwardMarkerType;
}): number =>
	Number(
		countDocsStore({
			collection: Collection.VXP_AWARD_MARKERS,
			caller: controllerCaller(MARKER_PURPOSE),
			params: { matcher: { key: `^${vxpAwardMarkerPrefix({ principalText, awardType })}` } }
		})
	);

/** The marker key of one award, or nothing for a repeatable type. */
const oneTimeMarkerKey = ({
	principalText,
	awardType,
	awardKey
}: {
	principalText: string;
	awardType: VxpAwardMarkerType;
	awardKey: string;
}): string | undefined =>
	isOneTimeAwardType(awardType)
		? vxpAwardMarkerKey({ principalText, awardType, awardKey })
		: undefined;

/**
 * The account purge's first phase, before the award docs go: the key of every marker still to
 * write, one per one-time award the account was paid, from its `vxp_awards` docs and its onboarding
 * ladder. A marker already stored is left out, so a purge that runs again writes nothing new. Reads
 * as `writer`, a satellite controller; the purge writes each key with {@link recordAwardMarker}, a
 * bounded batch per call.
 */
export const missingAccountAwardMarkers = ({
	callerText,
	writer
}: {
	callerText: string;
	writer: Uint8Array;
}): string[] => {
	const keys = new Set<string>();

	const { items } = listDocsStore({
		collection: Collection.VXP_AWARDS,
		caller: writer,
		params: { matcher: { key: `^${callerText}/` } }
	});

	for (const [, item] of items) {
		const { recipient, awardType, awardKey, status } = decodeDocData<VxpAwardDoc>(item.data);
		const key = oneTimeMarkerKey({ principalText: callerText, awardType, awardKey });

		if (recipient === callerText && PAID_AWARD_STATUSES.includes(status) && nonNullish(key)) {
			keys.add(key);
		}
	}

	const onboarding = getDocStore({
		collection: Collection.VXP_ONBOARDING,
		key: callerText,
		caller: writer
	});

	if (nonNullish(onboarding)) {
		const { milestones } = decodeDocData<VxpOnboardingDoc>(onboarding.data);

		for (const [milestone, { status }] of Object.entries(milestones)) {
			const key = oneTimeMarkerKey({
				principalText: callerText,
				awardType: 'onboarding',
				awardKey: milestone
			});

			if (PAID_MILESTONE_STATUSES.includes(status) && nonNullish(key)) {
				keys.add(key);
			}
		}
	}

	return [...keys].filter((key) =>
		isNullish(getDocStore({ collection: Collection.VXP_AWARD_MARKERS, key, caller: writer }))
	);
};

/** Writes one marker {@link missingAccountAwardMarkers} named, as `writer`. */
export const recordAwardMarker = ({ key, writer }: { key: string; writer: Uint8Array }): void => {
	setDocStore({
		collection: Collection.VXP_AWARD_MARKERS,
		key,
		caller: writer,
		doc: { data: encodeDocData({}) }
	});
};
