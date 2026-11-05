import { Collection } from '#lib/constants/collections.constants.ts';
import type { ProfilePrivate } from '#lib/types/profile.ts';
import { Principal } from '@icp-sdk/core/principal';
import type { AssertSetDocContext } from '@junobuild/functions';
import { decodeDocData } from '@junobuild/functions/sdk';

/**
 * Upper bound for a stored address — the RFC 5321 path limit. The doc is
 * owner-written, so this is a bloat guard, not format validation (the FE
 * and the OpenID provider own that).
 */
const MAX_EMAIL_LENGTH = 320;

/**
 * Set-doc assertion for the `profile_private` collection. The collection
 * is `managed` (owner + controllers), but `managed` still lets any
 * authenticated user CREATE a doc under an arbitrary free key — so
 * without this guard a third party could squat another user's principal
 * key before their first write, blocking (or forging) the email the
 * server-side consumers read by key. Bind both the doc key and the
 * embedded `owner` to the caller: a private profile doc can only ever
 * live under its own principal.
 */
export const assertSetProfilePrivate = ({
	caller,
	data: {
		collection,
		key,
		data: { proposed }
	}
}: AssertSetDocContext): void => {
	if (collection !== Collection.PROFILE_PRIVATE) {
		return;
	}

	const callerText = Principal.fromUint8Array(caller).toText();

	if (key !== callerText) {
		throw new Error('A private profile doc can only be written under the caller principal.');
	}

	const data = decodeDocData<ProfilePrivate>(proposed.data);

	if (data.owner !== callerText) {
		throw new Error('Private profile owner must match the caller.');
	}

	if (typeof data.email !== 'string' || data.email.length > MAX_EMAIL_LENGTH) {
		throw new Error(`Private profile email must be a string of at most ${MAX_EMAIL_LENGTH} chars.`);
	}
};
