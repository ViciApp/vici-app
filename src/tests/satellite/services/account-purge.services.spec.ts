import { ACCOUNT_RECOVERY_WINDOW_MS } from '#lib/constants/app.constants.ts';
import { Collection } from '#lib/constants/collections.constants.ts';
import { DAY_IN_MS } from '#lib/constants/time.constants.ts';
import {
	controller,
	hostNowMs,
	installSatelliteHost,
	type HostWrite,
	type SatelliteHost
} from '#root/src/tests/mocks/satellite-host.mock.ts';
import {
	hardDeleteAccountFn,
	recoverMyAccountFn,
	type RecoverMyAccountResult
} from '#satellite/services/account.services.ts';
import { nonNullish } from '@dfinity/utils';
import { Principal } from '@icp-sdk/core/principal';
import assert from 'node:assert/strict';
import { afterEach, beforeEach, describe, it } from 'node:test';

const purged = Principal.fromUint8Array(new Uint8Array([2, 2, 2]));
const other = Principal.fromUint8Array(new Uint8Array([3, 3, 3]));

const purgedText = purged.toText();
const otherText = other.toText();

const otherActivityKey = `${otherText}#1700000000000#trade`;
const paidAwardKeys = Array.from({ length: 4 }, (_, i) => `achievement-${i}`);

/** More docs than one purge call writes: awards (each with a marker), months, a like, an affiliation. */
describe('hardDeleteAccountFn in bounded calls', () => {
	let host: SatelliteHost;

	const put = ({
		collection,
		key,
		data,
		owner = controller
	}: {
		collection: string;
		key: string;
		data: object;
		owner?: Principal;
	}) => host.putDoc({ collection, key, data, owner });

	beforeEach(() => {
		host = installSatelliteHost();

		for (const text of [purgedText, otherText]) {
			put({ collection: Collection.PROFILES, key: text, data: { owner: text, nickname: 'n' } });
			put({ collection: Collection.USER_STATS, key: text, data: { owner: text } });
		}

		put({
			collection: Collection.USER_MONTHLY_STATS,
			key: `${otherText}/2026-10`,
			data: { owner: otherText }
		});

		for (let month = 1; month <= 9; month += 1) {
			put({
				collection: Collection.USER_MONTHLY_STATS,
				key: `${purgedText}/2026-0${month}`,
				data: { owner: purgedText }
			});
		}

		for (const awardKey of paidAwardKeys) {
			put({
				collection: Collection.VXP_AWARDS,
				key: `${purgedText}/achievement/${awardKey}`,
				data: { recipient: purgedText, awardType: 'achievement', awardKey, status: 'paid' }
			});
		}

		put({
			collection: Collection.ACTIVITY_REACTIONS,
			key: `${otherActivityKey}#${purgedText}`,
			data: { activityKey: otherActivityKey }
		});
		put({
			collection: Collection.ACTIVITY_REACTION_COUNTS,
			key: otherActivityKey,
			data: { activityKey: otherActivityKey, count: 1, updatedAtMs: 1 }
		});
		put({
			collection: Collection.AFFILIATIONS,
			key: `${purgedText}/school/s-1`,
			data: { member: purgedText },
			owner: purged
		});
	});

	afterEach(() => host.restore());

	const purgeArgs = { callerText: purgedText, callerBytes: purged.toUint8Array() };

	/** Runs the purge call after call until it reports done; returns the writes of each call. */
	const purgeUntilDone = (): HostWrite[][] => {
		const perCall: HostWrite[][] = [];
		let pending = true;

		while (pending) {
			assert.ok(perCall.length < 50, 'the purge ends');

			const before = host.writes().length;

			({ pending } = hardDeleteAccountFn(purgeArgs));
			perCall.push(host.writes().slice(before));
		}

		return perCall;
	};

	it('purges the account over several calls, a bounded batch of writes each', () => {
		const perCall = purgeUntilDone();

		assert.ok(perCall.length > 2);
		assert.ok(perCall.every((writes) => writes.length <= 5));
		assert.deepEqual(host.keys(Collection.VXP_AWARDS), []);
		assert.deepEqual(host.keys(Collection.USER_STATS), [otherText]);
		assert.deepEqual(host.keys(Collection.USER_MONTHLY_STATS), [`${otherText}/2026-10`]);
		assert.deepEqual(host.keys(Collection.ACTIVITY_REACTIONS), []);
		assert.deepEqual(host.keys(Collection.AFFILIATIONS), []);
		assert.deepEqual(host.keys(Collection.PROFILES), [otherText]);
		assert.equal(
			host.readDoc<{ count: number }>({
				collection: Collection.ACTIVITY_REACTION_COUNTS,
				key: otherActivityKey
			})?.count,
			0
		);
	});

	it('writes every award marker before the first award doc goes', () => {
		const writes = purgeUntilDone().flat();
		const markerWrites = writes.flatMap(({ collection }, index) =>
			collection === Collection.VXP_AWARD_MARKERS ? [index] : []
		);
		const firstAwardDelete = writes.findIndex(
			({ op, collection }) => op === 'delete' && collection === Collection.VXP_AWARDS
		);

		assert.equal(markerWrites.length, paidAwardKeys.length);
		assert.ok(markerWrites.every((index) => index < firstAwardDelete));
	});

	it('deletes the profile last, so the account stays findable until the purge is done', () => {
		const perCall = purgeUntilDone();

		assert.deepEqual(perCall.flat().at(-1), {
			op: 'delete',
			collection: Collection.PROFILES,
			key: purgedText
		});

		for (const writesOfCall of perCall.slice(0, -1)) {
			assert.ok(!writesOfCall.some(({ collection }) => collection === Collection.PROFILES));
		}
	});

	it('changes nothing when run again once done', () => {
		purgeUntilDone();

		const before = host.writes().length;

		assert.deepEqual(hardDeleteAccountFn(purgeArgs), { deleted: 0, pending: false });
		assert.equal(host.writes().length, before);
	});

	it('carries the purge on through a recovery past the window until it is done', () => {
		put({
			collection: Collection.PROFILES,
			key: purgedText,
			data: {
				owner: purgedText,
				nickname: 'n',
				deletedAtMs: hostNowMs - ACCOUNT_RECOVERY_WINDOW_MS - DAY_IN_MS
			}
		});
		host.setCaller(purged);

		const purgePending = (answer?: RecoverMyAccountResult): boolean =>
			nonNullish(answer) && !answer.ok && answer.pending;
		const answers = [recoverMyAccountFn()];

		while (purgePending(answers.at(-1))) {
			assert.ok(answers.length < 50, 'the purge ends');
			assert.deepEqual(host.keys(Collection.PROFILES).sort(), [purgedText, otherText].sort());

			answers.push(recoverMyAccountFn());
		}

		assert.ok(answers.length > 2);
		assert.deepEqual(answers.at(-1), { ok: false, reason: 'expired', pending: false });
		assert.deepEqual(host.keys(Collection.PROFILES), [otherText]);
		assert.deepEqual(recoverMyAccountFn(), { ok: true, recovered: false });
	});

	it('deletes an owned league left empty and hands one with members to the first of them', () => {
		const member = ({
			leagueId,
			principal,
			role
		}: {
			leagueId: string;
			principal: string;
			role: string;
		}) =>
			put({
				collection: Collection.LEAGUE_MEMBERS,
				key: `${leagueId}/${principal}`,
				data: { leagueId, member: principal, role, joinedAtMs: 1 }
			});

		for (const leagueId of ['alone', 'shared']) {
			put({
				collection: Collection.LEAGUES,
				key: leagueId,
				data: { id: leagueId, name: leagueId, owner: purgedText, createdAtMs: 1 },
				owner: purged
			});
			put({ collection: Collection.LEAGUE_INVITES, key: leagueId, data: { code: leagueId } });
			member({ leagueId, principal: purgedText, role: 'owner' });
		}

		member({ leagueId: 'shared', principal: otherText, role: 'member' });
		member({ leagueId: 'joined', principal: purgedText, role: 'member' });

		purgeUntilDone();

		assert.deepEqual(host.keys(Collection.LEAGUES), ['shared']);
		assert.deepEqual(host.keys(Collection.LEAGUE_INVITES), ['shared']);
		assert.equal(
			host.readDoc<{ owner: string }>({ collection: Collection.LEAGUES, key: 'shared' })?.owner,
			otherText
		);
		assert.deepEqual(host.keys(Collection.LEAGUE_MEMBERS), [`shared/${otherText}`]);
		assert.equal(
			host.readDoc<{ role: string }>({
				collection: Collection.LEAGUE_MEMBERS,
				key: `shared/${otherText}`
			})?.role,
			'owner'
		);
	});
});
