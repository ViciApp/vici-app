import type { VxpAwardType } from '#lib/types/vxp-award.ts';
import { Principal } from '@icp-sdk/core/principal';

/** What a marker records: a `vxp_awards` type, or an onboarding milestone, which the
 * `vxp_onboarding` ladder tracks instead. */
export type VxpAwardMarkerType = VxpAwardType | 'onboarding';

/**
 * A one-way digest of an account principal, for the award markers that outlive the account. The
 * satellite runtime has no crypto API; this is the SHA-224 digest `@icp-sdk/core` already computes
 * for a self-authenticating principal, so it needs no new dependency. It is unkeyed, since the
 * satellite holds no secret: whoever knows a principal can recompute its digest. What it does is
 * keep the principal itself out of the marker.
 */
export const identityDigest = (principalText: string): string =>
	Principal.selfAuthenticating(new TextEncoder().encode(`vici-award-marker:${principalText}`))
		.toHex()
		.toLowerCase();

/** The key prefix of every marker of one award type for one principal. */
export const vxpAwardMarkerPrefix = ({
	principalText,
	awardType
}: {
	principalText: string;
	awardType: VxpAwardMarkerType;
}): string => `${identityDigest(principalText)}/${awardType}/`;

/** `${identityDigest(principal)}/${awardType}/${awardKey}`: one marker per award. */
export const vxpAwardMarkerKey = ({
	principalText,
	awardType,
	awardKey
}: {
	principalText: string;
	awardType: VxpAwardMarkerType;
	awardKey: string;
}): string => `${vxpAwardMarkerPrefix({ principalText, awardType })}${awardKey}`;
