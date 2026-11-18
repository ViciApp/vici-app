import { Collection } from '#lib/constants/collections.constants.ts';
import { MILLISECOND_IN_NANOSECONDS } from '#lib/constants/time.constants.ts';
import {
	AFFILIATION_LOCK_MS,
	affiliationKey,
	type AffiliationDoc,
	type AffiliationKind
} from '#lib/types/affiliation.ts';
import {
	hostNowMs,
	installSatelliteHost,
	setContext,
	type SatelliteHost
} from '#root/src/tests/mocks/satellite-host.mock.ts';
import { assertSetAffiliation } from '#satellite/services/affiliation.services.ts';
import {
	listMyAffiliationsFn,
	listWorldsMemberCountsFn,
	listWorldsRosterFn
} from '#satellite/services/cohort.services.ts';
import { Principal } from '@icp-sdk/core/principal';
import assert from 'node:assert/strict';
import { afterEach, describe, it } from 'node:test';

const member = Principal.fromUint8Array(new Uint8Array([2, 2, 2]));

const affiliation = ({
	kind = 'university',
	affiliationIdentifier,
	joinedAtMs = hostNowMs
}: {
	kind?: AffiliationKind;
	affiliationIdentifier: string;
	joinedAtMs?: number;
}): AffiliationDoc => ({
	member: member.toText(),
	kind,
	affiliationIdentifier,
	joinedAtMs,
	lockedUntilMs: joinedAtMs + AFFILIATION_LOCK_MS
});

const keyOf = (doc: AffiliationDoc): string =>
	affiliationKey({
		memberPrincipal: doc.member,
		kind: doc.kind,
		affiliationIdentifier: doc.affiliationIdentifier
	});

/** A member holding `docs`, stored in that order, each a day after the previous. */
const holding = (docs: AffiliationDoc[]): SatelliteHost => {
	const host = installSatelliteHost({
		docs: { [Collection.AFFILIATIONS]: Object.fromEntries(docs.map((doc) => [keyOf(doc), doc])) },
		createdAtNs: {
			[Collection.AFFILIATIONS]: Object.fromEntries(
				docs.map((doc, index) => [
					keyOf(doc),
					BigInt(hostNowMs - (docs.length - index) * 86_400_000) * MILLISECOND_IN_NANOSECONDS
				])
			)
		}
	});

	host.setCaller(member);

	return host;
};

describe('affiliation.services', () => {
	let host: SatelliteHost | undefined;

	afterEach(() => host?.restore());

	const create = (doc: AffiliationDoc) =>
		assertSetAffiliation(
			setContext({
				caller: member,
				collection: Collection.AFFILIATIONS,
				key: keyOf(doc),
				proposed: doc
			})
		);

	it('rejects a second affiliation of a kind the member already holds', () => {
		host = holding([affiliation({ affiliationIdentifier: 'school-a' })]);

		assert.throws(() => create(affiliation({ affiliationIdentifier: 'school-b' })), /one /);
		assert.doesNotThrow(() =>
			create(affiliation({ kind: 'country', affiliationIdentifier: 'br' }))
		);
	});

	it('lets a member take a kind they hold none of', () => {
		host = holding([]);

		assert.doesNotThrow(() => create(affiliation({ affiliationIdentifier: 'school-b' })));
	});

	it('counts a member once, for the affiliation they took first, in every reader', () => {
		host = holding([
			affiliation({ affiliationIdentifier: 'school-a' }),
			affiliation({ affiliationIdentifier: 'school-b' })
		]);

		assert.equal(listMyAffiliationsFn().university?.affiliationIdentifier, 'school-a');
		assert.deepEqual(
			listWorldsMemberCountsFn({ kind: 'university' }).map(
				({ affiliationIdentifier, memberCount }) => [affiliationIdentifier, memberCount]
			),
			[['school-a', 1]]
		);
		assert.deepEqual(
			listWorldsRosterFn({ kind: 'university', affiliationIdentifier: 'school-b' }),
			[]
		);
	});
});
