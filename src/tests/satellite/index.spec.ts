import { Collection } from '#lib/constants/collections.constants.ts';
import junoConfig from '#root/juno.config.ts';
import {
	controller,
	deleteContext,
	installSatelliteHost,
	setContext,
	type SatelliteHost
} from '#root/src/tests/mocks/satellite-host.mock.ts';
import { assertDeleteDoc, assertSetDoc } from '#satellite/index.ts';
import { Principal } from '@icp-sdk/core/principal';
import assert from 'node:assert/strict';
import { afterEach, beforeEach, describe, it } from 'node:test';

const owner = Principal.fromUint8Array(new Uint8Array([2, 2, 2]));
const stranger = Principal.fromUint8Array(new Uint8Array([3, 3, 3]));

// Juno does no owner check on a `write: 'public'` collection, so the
// satellite asserts are the only guard on who updates or deletes its docs.
const publicWriteCollections = (): string[] => {
	const modes = ['production', 'development'];

	return [
		...new Set(
			modes.flatMap((mode) =>
				(junoConfig({ mode }).satellite.collections?.datastore ?? [])
					.filter(({ write }) => write === 'public')
					.map(({ collection }) => collection)
			)
		)
	];
};

describe('satellite index', () => {
	it('guards every write of a public-write collection with a set assert', () => {
		const guarded: readonly string[] = assertSetDoc.collections;

		assert.deepEqual(
			publicWriteCollections().filter((collection) => !guarded.includes(collection)),
			['vxp_onboarding']
		);
	});

	it('guards every delete of a public-write collection with a delete assert', () => {
		const guarded: readonly string[] = assertDeleteDoc.collections;

		assert.deepEqual(
			publicWriteCollections().filter((collection) => !guarded.includes(collection)),
			['vxp_onboarding']
		);
	});

	describe('server-owned collections', () => {
		let host: SatelliteHost;

		beforeEach(() => {
			host = installSatelliteHost();
		});

		afterEach(() => host.restore());

		const serverWritten = [
			Collection.CHATS,
			Collection.COMMENTS,
			Collection.MARKET_METADATA,
			Collection.MARKET_TRANSLATIONS
		];

		for (const collection of serverWritten) {
			it(`lets only a satellite controller write ${collection}`, () => {
				const write = (caller: Principal) =>
					setContext({ caller, collection, key: 'series-1', proposed: { seriesId: 'series-1' } });

				assert.throws(() => assertSetDoc.assert(write(owner)), /only the satellite writes/);
				assert.doesNotThrow(() => assertSetDoc.assert(write(controller)));
			});
		}

		const serverDeleted = [
			...serverWritten,
			Collection.LEAGUE_STATS,
			Collection.EXIT_SIGNALS,
			Collection.USER_STATS
		];

		for (const collection of serverDeleted) {
			it(`lets only a satellite controller delete ${collection}`, () => {
				const remove = (caller: Principal) =>
					deleteContext({
						caller,
						collection,
						key: owner.toText(),
						current: { owner: owner.toText() },
						currentOwner: owner
					});

				assert.throws(() => assertDeleteDoc.assert(remove(owner)), /only the satellite writes/);
				assert.doesNotThrow(() => assertDeleteDoc.assert(remove(controller)));
			});
		}
	});

	describe('owner-held collections', () => {
		let host: SatelliteHost;

		beforeEach(() => {
			host = installSatelliteHost();
		});

		afterEach(() => host.restore());

		it("rejects deleting another user's monthly stats", () => {
			const remove = (caller: Principal) =>
				deleteContext({
					caller,
					collection: Collection.USER_MONTHLY_STATS,
					key: `${owner.toText()}/2026-10`,
					current: { owner: owner.toText(), monthAnchor: '2026-10' },
					currentOwner: owner
				});

			assert.throws(
				() => assertDeleteDoc.assert(remove(stranger)),
				/only the owner or the satellite/
			);
			assert.doesNotThrow(() => assertDeleteDoc.assert(remove(owner)));
			assert.doesNotThrow(() => assertDeleteDoc.assert(remove(controller)));
		});

		it('lets a satellite controller remove a locked affiliation', () => {
			const remove = (caller: Principal) =>
				deleteContext({
					caller,
					collection: Collection.AFFILIATIONS,
					key: `${owner.toText()}/country/br`,
					current: {
						member: owner.toText(),
						kind: 'country',
						affiliationIdentifier: 'br',
						joinedAtMs: 1,
						lockedUntilMs: Number.MAX_SAFE_INTEGER
					},
					currentOwner: owner
				});

			assert.throws(() => assertDeleteDoc.assert(remove(stranger)), /member themselves/);
			assert.doesNotThrow(() => assertDeleteDoc.assert(remove(controller)));
		});
	});
});
