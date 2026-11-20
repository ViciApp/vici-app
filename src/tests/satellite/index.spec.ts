import { Collection } from '#lib/constants/collections.constants.ts';
import {
	LEAGUE_IMAGE_CONTENT_TYPE,
	LEAGUE_IMAGES_COLLECTION,
	leagueImageFullPath
} from '#lib/types/league.ts';
import junoConfig from '#root/juno.config.ts';
import {
	controller,
	deleteAssetContext,
	deleteContext,
	installSatelliteHost,
	setContext,
	uploadAssetContext,
	type SatelliteHost
} from '#root/src/tests/mocks/satellite-host.mock.ts';
import {
	assertDeleteAsset,
	assertDeleteDoc,
	assertSetDoc,
	assertUploadAsset
} from '#satellite/index.ts';
import { isNullish } from '@dfinity/utils';
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

// Juno does no owner check on a public-write Storage collection either: any
// caller may upload over or delete any asset of it.
const publicWriteStorageCollections = (): string[] => [
	...new Set(
		['production', 'development'].flatMap((mode) =>
			(junoConfig({ mode }).satellite.collections?.storage ?? [])
				.filter(({ write }) => write === 'public')
				.map(({ collection }) => collection)
		)
	)
];

describe('satellite index', () => {
	it('guards every write of a public-write collection with a set assert', () => {
		const guarded: readonly string[] = assertSetDoc.collections;

		assert.deepEqual(
			publicWriteCollections().filter((collection) => !guarded.includes(collection)),
			[]
		);
	});

	it('guards every delete of a public-write collection with a delete assert', () => {
		const guarded: readonly string[] = assertDeleteDoc.collections;

		assert.deepEqual(
			publicWriteCollections().filter((collection) => !guarded.includes(collection)),
			[]
		);
	});

	it('guards every upload to a public-write storage collection with an upload assert', () => {
		const guarded: readonly string[] = assertUploadAsset.collections;

		assert.deepEqual(
			publicWriteStorageCollections().filter((collection) => !guarded.includes(collection)),
			[]
		);
	});

	it('guards every delete in a public-write storage collection with a delete assert', () => {
		const guarded: readonly string[] = assertDeleteAsset.collections;

		assert.deepEqual(
			publicWriteStorageCollections().filter((collection) => !guarded.includes(collection)),
			[]
		);
	});

	it('caps the size of every asset in a public-write storage collection', () => {
		for (const mode of ['production', 'development']) {
			const uncapped = (junoConfig({ mode }).satellite.collections?.storage ?? [])
				.filter(({ write, maxSize }) => write === 'public' && isNullish(maxSize))
				.map(({ collection }) => collection);

			assert.deepEqual(uncapped, []);
		}
	});

	describe('league images', () => {
		let host: SatelliteHost;

		const leagueId = 'my-league-1700000000000';
		const fullPath = leagueImageFullPath({ leagueId, uploadedAtMs: 1_700_000_000_001 });

		beforeEach(() => {
			host = installSatelliteHost({
				docs: { [Collection.LEAGUES]: { [leagueId]: { id: leagueId, owner: owner.toText() } } }
			});
		});

		afterEach(() => host.restore());

		const upload = ({
			caller,
			path = fullPath,
			contentType = LEAGUE_IMAGE_CONTENT_TYPE,
			currentOwner
		}: {
			caller: Principal;
			path?: string;
			contentType?: string;
			currentOwner?: Principal;
		}) =>
			assertUploadAsset.assert(
				uploadAssetContext({
					caller,
					collection: LEAGUE_IMAGES_COLLECTION,
					fullPath: path,
					contentType,
					currentOwner
				})
			);

		const remove = ({ caller, uploader = owner }: { caller: Principal; uploader?: Principal }) =>
			assertDeleteAsset.assert(
				deleteAssetContext({
					caller,
					collection: LEAGUE_IMAGES_COLLECTION,
					fullPath,
					owner: uploader
				})
			);

		it("lets the league's owner or a controller upload its cover", () => {
			assert.doesNotThrow(() => upload({ caller: owner }));
			assert.doesNotThrow(() => upload({ caller: controller }));
		});

		it("rejects anyone else uploading or overwriting a league's cover", () => {
			assert.throws(() => upload({ caller: stranger }), /only the league owner/);
			assert.throws(
				() => upload({ caller: stranger, currentOwner: owner }),
				/only the league owner/
			);
		});

		it('rejects an upload whose path names no league', () => {
			assert.throws(
				() =>
					upload({
						caller: owner,
						path: leagueImageFullPath({ leagueId: 'nope-1', uploadedAtMs: 2 })
					}),
				/no league/
			);
			assert.throws(
				() => upload({ caller: owner, path: `/${LEAGUE_IMAGES_COLLECTION}/page.html` }),
				/league cover path/
			);
		});

		it('rejects an upload that is not a cover image', () => {
			assert.throws(() => upload({ caller: owner, contentType: 'text/html' }), /content type/);
			assert.throws(
				() => upload({ caller: controller, contentType: 'image/svg+xml' }),
				/content type/
			);
		});

		it("lets only the league's owner or a controller delete its cover", () => {
			assert.throws(() => remove({ caller: stranger }), /only the league owner/);
			assert.throws(
				() => remove({ caller: stranger, uploader: stranger }),
				/only the league owner/
			);
			assert.doesNotThrow(() => remove({ caller: owner }));
			assert.doesNotThrow(() => remove({ caller: controller }));
		});
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
			Collection.MARKET_TRANSLATIONS,
			Collection.VXP_ONBOARDING
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
			Collection.REFERRAL_CODES,
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
