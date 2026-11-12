/**
 * Admin-gated export of the principal ⇄ sign-in-identity mapping.
 *
 * One endpoint, wired in `src/satellite/index.ts`:
 *
 *   getAuthIdentities({ afterKey?, limit }) -> { rows, hasMore }
 *     · one row per `#user` doc: principal (doc key), provider, the persisted
 *       OpenID claims (email/name — present only for OpenID providers and only
 *       when the user consented to share them), and the best-effort address for
 *       the same principal from the owner-private `profile_private` doc (the
 *       public `profiles` doc no longer carries an email)
 *     · keyset-paged by KEY (the datastore's native indexed order — the same
 *       O(page) discipline as the analytics exports; ordering on `updated_at`
 *       would materialise the whole collection and blow the query budget)
 *     · NOT a drain: `#user` docs stay; callers re-walk to resync
 *
 * This deliberately exports addresses (PII) — it exists so an off-chain system
 * can match accounts to their sign-in identity (e.g. link a principal to the
 * same email/OpenID login elsewhere). Gated to ADMIN callers like the other
 * warehouse exports; the data never leaves the satellite for anyone else.
 */

import { ZERO } from '#lib/constants/app.constants.ts';
import { Collection } from '#lib/constants/collections.constants.ts';
import type { ProfilePrivate } from '#lib/types/profile.ts';
import { controllerCaller, isAdmin } from '#satellite/services/authz.services.ts';
import { logError } from '#satellite/utils/logger.utils.ts';
import { isNullish, notEmptyString } from '@dfinity/utils';
import { msgCaller } from '@junobuild/functions/ic-cdk';
import { decodeDocData, getDocStore, listDocsStore } from '@junobuild/functions/sdk';

/** Juno's reserved datastore collection holding one doc per signed-up user,
 * keyed by the user's principal text. Not part of `Collection` — it is a
 * system collection, not one this app configures. */
const JUNO_USER_COLLECTION = '#user';

/** Same page ceiling as the analytics exports: each row costs a decoded
 * `#user` doc plus a keyed `profile_private` lookup, so a page of 100 stays
 * well inside the ~5B-instruction query budget while keeping the walk O(page). */
const MAX_EXPORT_LIMIT = 100;

/** One flat export row — mirrors AuthIdentityExportRowSchema. */
interface AuthIdentityExportRow {
	key: string;
	createdAtNs: string;
	updatedAtNs: string;
	provider?: string;
	openidEmail?: string;
	openidName?: string;
	profileEmail?: string;
}

/**
 * The persisted `#user` doc payload, read defensively: docs written before the
 * `@junobuild/core` v5 auth migration may lack `providerData`, and future Juno
 * versions may add providers — so everything is optional and `provider` is a
 * plain string rather than the current union.
 */
interface StoredUserData {
	provider?: string;
	providerData?: {
		openid?: {
			email?: string;
			name?: string;
		};
	};
}

export const getAuthIdentitiesFn = ({
	afterKey,
	limit
}: {
	afterKey?: string;
	limit: number;
}): { rows: AuthIdentityExportRow[]; hasMore: boolean } => {
	const caller = msgCaller();

	if (!isAdmin({ caller })) {
		throw new Error('Auth-identity export is restricted to admins.');
	}

	const admin = controllerCaller('auth-identity export');

	const afterKeyText = afterKey?.trim() ?? '';
	const safeLimit = Number.isFinite(limit) ? Math.floor(limit) : MAX_EXPORT_LIMIT;
	const cap = Math.min(Math.max(1, safeLimit), MAX_EXPORT_LIMIT);

	const { items } = listDocsStore({
		collection: JUNO_USER_COLLECTION,
		caller: admin,
		params: {
			paginate: {
				limit: BigInt(cap),
				start_after: afterKeyText.length > 0 ? afterKeyText : undefined
			}
		}
	});

	const rows = items.map(([key, doc]): AuthIdentityExportRow => {
		const row: AuthIdentityExportRow = {
			key,
			createdAtNs: `${doc.created_at ?? ZERO}`,
			updatedAtNs: `${doc.updated_at ?? ZERO}`
		};

		// Decode defensively: a malformed or legacy-shaped `#user` payload must
		// not fail the page — the envelope row alone still maps the principal.
		try {
			const data = decodeDocData<StoredUserData>(doc.data);
			const openid = data.providerData?.openid;

			if (notEmptyString(data.provider)) {
				row.provider = data.provider;
			}

			if (notEmptyString(openid?.email)) {
				row.openidEmail = openid.email;
			}

			if (notEmptyString(openid?.name)) {
				row.openidName = openid.name;
			}
		} catch (err) {
			logError({
				message: 'auth-identity export: user doc decode failed',
				detail: { key, error: err instanceof Error ? err.message : `${err}` }
			});
		}

		// The address lives on the owner-private `profile_private` doc; the
		// admin access key reads it under the collection's `managed` rule.
		try {
			const privateDoc = getDocStore({
				collection: Collection.PROFILE_PRIVATE,
				key,
				caller: admin
			});

			if (!isNullish(privateDoc)) {
				const { email } = decodeDocData<ProfilePrivate>(privateDoc.data);

				if (notEmptyString(email)) {
					row.profileEmail = email;
				}
			}
		} catch (err) {
			logError({
				message: 'auth-identity export: private profile lookup failed',
				detail: { key, error: err instanceof Error ? err.message : `${err}` }
			});
		}

		return row;
	});

	// `start_after` already excluded the cursor's own key, so a full page means
	// there may be more (mirrors the analytics exports).
	return { rows, hasMore: items.length >= cap };
};
