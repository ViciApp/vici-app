import { Collection } from '#lib/constants/collections.constants.ts';
import type { SchoolSubmissionDoc } from '#lib/types/school-submission.ts';
import {
	SCHOOL_VERIFIED_PUBLIC_THRESHOLD,
	schoolKey,
	type SchoolDoc,
	type SchoolStatus
} from '#lib/types/school.ts';
import { isDomainOf } from '#lib/utils/school-picker.utils.ts';
import { escapeRegex } from '#satellite/utils/regex.utils.ts';
import { timeMs } from '#satellite/utils/time.utils.ts';
import { isNullish, nonNullish } from '@dfinity/utils';
import {
	decodeDocData,
	encodeDocData,
	getDocStore,
	listDocsStore,
	setDocStore
} from '@junobuild/functions/sdk';

/**
 * The `schools` registry the school-email verification
 * (`school.services.ts`) keeps: a member's verification creates a missing
 * row and recounts its verified members, and never rewrites the row's
 * name, country, domains or a status an admin set. Every caller passes a
 * satellite controller: the collection is controllers-scoped.
 */

/**
 * Whether a brand-new school may take this id: free in the registry, or held
 * by a row whose domains cover the address. The row's domains are the
 * registry's (seeded by an admin or by the first verified member), never the
 * typed name, so a second school with the same name cannot join it.
 */
export const registryAdmits = ({
	caller,
	schoolId,
	domains
}: {
	caller: Uint8Array;
	schoolId: string;
	domains: string[];
}): boolean => {
	const row = getDocStore({ collection: Collection.SCHOOLS, key: schoolKey(schoolId), caller });

	if (isNullish(row)) {
		return true;
	}

	const { domains: known } = decodeDocData<SchoolDoc>(row.data);

	return domains.every((domain) =>
		known.some((knownDomain) => isDomainOf({ domain, known: knownDomain }))
	);
};

/**
 * Creates the registry row from the submission when the school has none
 * yet, and keeps an existing row as it is.
 */
export const claimSchoolRegistry = ({
	caller,
	resolved
}: {
	caller: Uint8Array;
	resolved: Pick<SchoolDoc, 'schoolId' | 'name' | 'country' | 'domains'>;
}): void => {
	const key = schoolKey(resolved.schoolId);

	if (nonNullish(getDocStore({ collection: Collection.SCHOOLS, key, caller }))) {
		return;
	}

	const now = timeMs();

	setDocStore({
		collection: Collection.SCHOOLS,
		key,
		caller,
		doc: {
			data: encodeDocData<SchoolDoc>({
				...resolved,
				verifiedMemberCount: 0,
				status: 'pending',
				createdAtMs: now,
				updatedAtMs: now
			})
		}
	});
};

/**
 * Recompute a school's verified-member count from the verified
 * submissions for its id (distinct members) and persist it on the
 * `schools` row, flipping the row public when this count crosses the
 * threshold. Recomputing from source (vs incrementing) keeps it
 * idempotent + concurrency-safe: re-running, or two members verifying at
 * once, can't double-count or undercount. A member's verification never
 * rewrites the row's name, country, domains or a status an admin set: the
 * flip fires only on the crossing, so a school held back past the
 * threshold stays held back. The scan is bounded server-side to this
 * school's rows via the `key` matcher (`/${schoolId}/` is the middle key
 * segment; the JS check re-confirms `schoolId` exactly so an over-broad
 * regex match can't miscount).
 */
export const recountSchoolRegistry = ({
	caller,
	schoolId
}: {
	caller: Uint8Array;
	schoolId: string;
}): SchoolStatus => {
	const { items } = listDocsStore({
		collection: Collection.SCHOOL_SUBMISSIONS,
		caller,
		params: { matcher: { key: `/${escapeRegex(schoolId)}/` } }
	});

	const verifiedMembers = new Set<string>();

	for (const [, item] of items) {
		try {
			const doc = decodeDocData<SchoolSubmissionDoc>(item.data);

			if (doc.status === 'verified' && doc.schoolId === schoolId) {
				verifiedMembers.add(doc.member);
			}
		} catch {
			// Skip malformed rows.
		}
	}

	const verifiedMemberCount = verifiedMembers.size;
	const key = schoolKey(schoolId);
	const existing = getDocStore({ collection: Collection.SCHOOLS, key, caller });

	if (isNullish(existing)) {
		throw new Error(`School registry row ${schoolId} missing after its claim.`);
	}

	const row = decodeDocData<SchoolDoc>(existing.data);
	const crossesThreshold =
		row.verifiedMemberCount < SCHOOL_VERIFIED_PUBLIC_THRESHOLD &&
		verifiedMemberCount >= SCHOOL_VERIFIED_PUBLIC_THRESHOLD;
	const status: SchoolStatus = crossesThreshold ? 'public' : row.status;

	setDocStore({
		collection: Collection.SCHOOLS,
		key,
		caller,
		doc: {
			version: existing.version,
			data: encodeDocData<SchoolDoc>({
				...row,
				verifiedMemberCount,
				status,
				updatedAtMs: timeMs()
			})
		}
	});

	return status;
};
