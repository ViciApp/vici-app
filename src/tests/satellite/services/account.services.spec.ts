import { ACCOUNT_RECOVERY_WINDOW_MS } from '#lib/constants/app.constants.ts';
import { Collection } from '#lib/constants/collections.constants.ts';
import { DAY_IN_MS } from '#lib/constants/time.constants.ts';
import { UserRole } from '#lib/enums/user.ts';
import type { ExitSignalDoc } from '#lib/types/exit-signal.ts';
import junoConfig from '#root/juno.config.ts';
import {
	controller,
	hostNowMs,
	installSatelliteHost,
	setContext,
	type SatelliteHost
} from '#root/src/tests/mocks/satellite-host.mock.ts';
import { assertDeleteDoc, assertSetDoc } from '#satellite/index.ts';
import {
	deleteMyAccountFn,
	hardDeleteAccountFn,
	hibernateMyAccountFn,
	recoverMyAccountFn,
	resumeMyAccountFn,
	sweepExpiredDeletionsFn
} from '#satellite/services/account.services.ts';
import { assertSetExitSignal } from '#satellite/services/exit-signal.services.ts';
import { nonNullish } from '@dfinity/utils';
import { Principal } from '@icp-sdk/core/principal';
import type { Doc } from '@junobuild/functions';
import { time } from '@junobuild/functions/ic-cdk';
import { decodeDocData, listDocsStore } from '@junobuild/functions/sdk';
import assert from 'node:assert/strict';
import { afterEach, beforeEach, describe, it } from 'node:test';

const purged = Principal.fromUint8Array(new Uint8Array([2, 2, 2]));
const other = Principal.fromUint8Array(new Uint8Array([3, 3, 3]));

const purgedText = purged.toText();
const otherText = other.toText();

const otherActivityKey = `${otherText}#1700000000000#trade`;
const ownActivityKey = `${purgedText}#1700000000001#trade`;

describe('account.services', () => {
	let host: SatelliteHost;

	beforeEach(() => {
		host = installSatelliteHost();

		const put = ({ collection, key, data }: { collection: string; key: string; data: object }) =>
			host.putDoc({ collection, key, data, owner: controller });

		for (const text of [purgedText, otherText]) {
			put({ collection: Collection.PROFILES, key: text, data: { owner: text, nickname: 'n' } });
			put({ collection: Collection.USER_STATS, key: text, data: { owner: text } });
			put({
				collection: Collection.USER_MONTHLY_STATS,
				key: `${text}/2026-10`,
				data: { owner: text }
			});
			put({
				collection: Collection.RESOLVED_RESULTS,
				key: `${text}#market-1`,
				data: { owner: text }
			});
			put({ collection: Collection.SCHOOL_SUBMISSIONS, key: `${text}/1`, data: { email: text } });
		}

		for (const [activityKey, liker] of [
			[otherActivityKey, purgedText],
			[otherActivityKey, otherText],
			[ownActivityKey, otherText]
		]) {
			put({
				collection: Collection.ACTIVITY_REACTIONS,
				key: `${activityKey}#${liker}`,
				data: { activityKey }
			});
		}

		put({
			collection: Collection.ACTIVITY_REACTION_COUNTS,
			key: otherActivityKey,
			data: { activityKey: otherActivityKey, count: 2, updatedAtMs: 1 }
		});
	});

	afterEach(() => host.restore());

	describe('hardDeleteAccountFn', () => {
		it("removes the account's stats, results, school submissions and reactions, and only those", () => {
			hardDeleteAccountFn({ callerText: purgedText, callerBytes: purged.toUint8Array() });

			assert.deepEqual(host.keys(Collection.USER_STATS), [otherText]);
			assert.deepEqual(host.keys(Collection.USER_MONTHLY_STATS), [`${otherText}/2026-10`]);
			assert.deepEqual(host.keys(Collection.RESOLVED_RESULTS), [`${otherText}#market-1`]);
			assert.deepEqual(host.keys(Collection.SCHOOL_SUBMISSIONS), [`${otherText}/1`]);
			assert.deepEqual(
				host.keys(Collection.ACTIVITY_REACTIONS).sort(),
				[`${otherActivityKey}#${otherText}`, `${ownActivityKey}#${otherText}`].sort()
			);
			assert.equal(
				host.readDoc<{ count: number }>({
					collection: Collection.ACTIVITY_REACTION_COUNTS,
					key: otherActivityKey
				})?.count,
				1
			);
		});

		it("removes the account's referral code, and only that", () => {
			for (const [code, owner] of [
				['PURGED22', purgedText],
				['OTHER234', otherText]
			]) {
				host.putDoc({
					collection: Collection.REFERRAL_CODES,
					key: code,
					data: { owner },
					owner: controller
				});
			}

			hardDeleteAccountFn({ callerText: purgedText, callerBytes: purged.toUint8Array() });

			assert.deepEqual(host.keys(Collection.REFERRAL_CODES), ['OTHER234']);
		});

		it('changes nothing when run twice', () => {
			const args = { callerText: purgedText, callerBytes: purged.toUint8Array() };

			hardDeleteAccountFn(args);

			assert.equal(hardDeleteAccountFn(args), 0);
			assert.equal(
				host.readDoc<{ count: number }>({
					collection: Collection.ACTIVITY_REACTION_COUNTS,
					key: otherActivityKey
				})?.count,
				1
			);
		});
	});

	describe('deleteMyAccountFn', () => {
		const exitSignals = (): Doc[] =>
			listDocsStore({
				collection: Collection.EXIT_SIGNALS,
				caller: controller,
				params: {}
			}).items.map(([, doc]) => doc);

		it('writes an exit signal nothing public ties to the account', () => {
			host.setNowMs(hostNowMs + 12_345);
			host.setCaller(purged);

			assert.deepEqual(deleteMyAccountFn({ reason: 'privacy', note: 'too many emails' }), {
				ok: true,
				softDeleted: true
			});

			const deletedAtMs = host.readDoc<{ deletedAtMs: number }>({
				collection: Collection.PROFILES,
				key: purgedText
			})?.deletedAtMs;
			const [signal] = exitSignals();
			const [signalKey] = host.keys(Collection.EXIT_SIGNALS);

			assert.ok(nonNullish(signal) && nonNullish(signalKey) && nonNullish(deletedAtMs));

			const { createdAtMs } = decodeDocData<ExitSignalDoc>(signal.data);

			assert.equal(createdAtMs % DAY_IN_MS, 0);
			assert.equal(createdAtMs, deletedAtMs - (deletedAtMs % DAY_IN_MS));
			assert.equal(Principal.fromUint8Array(signal.owner).toText(), controller.toText());
			assert.doesNotMatch(signalKey, new RegExp(time().toString(36)));
		});

		it('refuses an exit signal written by anyone but a controller', () => {
			const write = (caller: Principal) =>
				setContext({
					caller,
					collection: Collection.EXIT_SIGNALS,
					key: 'k',
					proposed: { reason: 'privacy', note: '', createdAtMs: DAY_IN_MS }
				});

			assert.throws(() => assertSetExitSignal(write(purged)), /only the satellite writes/);
			assert.doesNotThrow(() => assertSetExitSignal(write(controller)));
		});

		it('keeps exit signals readable by controllers only', () => {
			for (const mode of ['production', 'development']) {
				const rule = junoConfig({ mode }).satellite.collections?.datastore?.find(
					({ collection }) => collection === Collection.EXIT_SIGNALS
				);

				assert.equal(rule?.read, 'controllers');
			}
		});
	});

	describe('sweepExpiredDeletionsFn', () => {
		const third = Principal.fromUint8Array(new Uint8Array([4, 4, 4])).toText();
		const expiredAtMs = hostNowMs - ACCOUNT_RECOVERY_WINDOW_MS - DAY_IN_MS;

		beforeEach(() => {
			host.putDoc({
				collection: Collection.ROLES,
				key: controller.toText(),
				data: { role: UserRole.ADMIN },
				owner: controller
			});

			for (const text of [purgedText, otherText]) {
				host.putDoc({
					collection: Collection.PROFILES,
					key: text,
					data: { owner: text, nickname: 'n', deletedAtMs: expiredAtMs },
					owner: controller
				});
			}

			host.putDoc({
				collection: Collection.PROFILES,
				key: third,
				data: { owner: third, nickname: 'n', deletedAtMs: hostNowMs - DAY_IN_MS },
				owner: controller
			});
		});

		it('purges one expired account per call until none is left', () => {
			assert.deepEqual(sweepExpiredDeletionsFn(), { swept: 1 });
			assert.equal(host.keys(Collection.PROFILES).length, 2);

			assert.deepEqual(sweepExpiredDeletionsFn(), { swept: 1 });
			assert.deepEqual(host.keys(Collection.PROFILES), [third]);

			assert.deepEqual(sweepExpiredDeletionsFn(), { swept: 0 });
			assert.deepEqual(host.keys(Collection.PROFILES), [third]);
			assert.deepEqual(host.keys(Collection.USER_STATS), []);
		});

		it('refuses a caller who is not an admin', () => {
			host.setCaller(other);

			assert.throws(() => sweepExpiredDeletionsFn(), /not an admin/);
		});
	});

	describe('account state through the real asserts', () => {
		const stored = () =>
			host.readDoc<{ deletedAtMs?: number; hibernatedAtMs?: number }>({
				collection: Collection.PROFILES,
				key: purgedText
			});

		beforeEach(() => {
			host.restore();
			// The real asserts run on every serverless write, as on the satellite.
			host = installSatelliteHost({
				asserts: { set: assertSetDoc.assert, remove: assertDeleteDoc.assert }
			});
			host.putDoc({
				collection: Collection.PROFILES,
				key: purgedText,
				data: { owner: purgedText, nickname: 'n' },
				owner: purged
			});
			host.setCaller(purged);
		});

		it('soft-deletes and recovers the account', () => {
			assert.equal(deleteMyAccountFn({ reason: 'privacy', note: '' }).ok, true);
			assert.equal(stored()?.deletedAtMs, hostNowMs);

			assert.deepEqual(recoverMyAccountFn(), { ok: true, recovered: true });
			assert.equal(stored()?.deletedAtMs, undefined);
		});

		it('pauses and resumes the account', () => {
			assert.deepEqual(hibernateMyAccountFn(), { ok: true });
			assert.equal(stored()?.hibernatedAtMs, hostNowMs);

			assert.deepEqual(resumeMyAccountFn(), { ok: true, resumed: true });
			assert.equal(stored()?.hibernatedAtMs, undefined);
		});
	});
});
