import { Collection } from '#lib/constants/collections.constants.ts';
import { DAY_IN_MS } from '#lib/constants/time.constants.ts';
import type { AffiliationDoc, AffiliationKind } from '#lib/types/affiliation.ts';
import type { UserMonthlyStatsDoc } from '#lib/types/user-monthly-stats.ts';
import { vxpAwardKey, type VxpAwardDoc } from '#lib/types/vxp-award.ts';
import {
	answerSettlementAccuracy,
	installSatelliteHost,
	type MockSettlement,
	type SatelliteHost
} from '#root/src/tests/mocks/satellite-host.mock.ts';
import { assertDeleteDoc, assertSetDoc } from '#satellite/index.ts';
import { claimWorldsPodiumPrizeFn } from '#satellite/services/vxp-worlds-podium.services.ts';
import { Principal } from '@icp-sdk/core/principal';
import { IcrcLedgerIdl, type IcrcLedgerDid } from '@junobuild/functions/canisters/ledger/icrc';
import assert from 'node:assert/strict';
import { afterEach, beforeEach, describe, it } from 'node:test';

const member = Principal.fromUint8Array(new Uint8Array([2, 2, 2]));
const rival = Principal.fromUint8Array(new Uint8Array([3, 3, 3]));
const latecomer = Principal.fromUint8Array(new Uint8Array([4, 4, 4]));

const monthAnchor = '2026-10';
const monthStartMs = Date.UTC(2026, 9, 1);
const monthCloseMs = Date.UTC(2026, 10, 1);
const claimMs = Date.UTC(2026, 10, 15);

const goldKey = ({
	recipient,
	kind = 'university'
}: {
	recipient: Principal;
	kind?: AffiliationKind;
}): string =>
	vxpAwardKey({
		recipient: recipient.toText(),
		awardType: 'worlds_podium',
		awardKey: `${monthAnchor}_${kind}_gold`
	});

describe('claimWorldsPodiumPrizeFn', () => {
	let host: SatelliteHost;
	let settlements: MockSettlement[];

	const join = ({
		principal,
		affiliationIdentifier,
		joinedAtMs,
		kind = 'university'
	}: {
		principal: Principal;
		affiliationIdentifier: string;
		joinedAtMs: number;
		kind?: AffiliationKind;
	}): void => {
		const doc: AffiliationDoc = {
			member: principal.toText(),
			kind,
			affiliationIdentifier,
			joinedAtMs,
			lockedUntilMs: joinedAtMs + 90 * DAY_IN_MS
		};

		host.putDoc({
			collection: Collection.AFFILIATIONS,
			key: `${principal.toText()}/${kind}/${affiliationIdentifier}`,
			data: doc,
			owner: principal,
			createdAtMs: joinedAtMs
		});
	};

	const writeMonthlyStats = ({ principal, calls }: { principal: Principal; calls: number }) => {
		const doc: UserMonthlyStatsDoc = {
			owner: principal.toText(),
			monthAnchor,
			monthCalls: calls,
			monthWins: calls,
			monthConsensus: [0.5],
			updatedAtMs: claimMs
		};

		host.putDoc({
			collection: Collection.USER_MONTHLY_STATS,
			key: `${principal.toText()}/${monthAnchor}`,
			data: doc,
			owner: principal
		});
	};

	// Claims again while the month is still being frozen, as the FE does.
	const claimAs = async (principal: Principal) => {
		host.setCaller(principal);

		let result = await claimWorldsPodiumPrizeFn({ monthAnchor });

		while (result.freezePending === true) {
			result = await claimWorldsPodiumPrizeFn({ monthAnchor });
		}

		return result;
	};

	const snapshotKeys = (): string[] =>
		host.keys(Collection.AFFILIATION_STATS).filter((key) => key.split('/').length === 3);

	beforeEach(() => {
		settlements = [];
		// The real asserts run on every serverless write, as on the satellite.
		host = installSatelliteHost({
			asserts: { set: assertSetDoc.assert, remove: assertDeleteDoc.assert }
		});
		host.setNowMs(claimMs);

		answerSettlementAccuracy({ host, settlements });

		host.onCall({
			method: 'icrc1_transfer',
			argTypes: [IcrcLedgerIdl.TransferArg],
			result: IcrcLedgerIdl.TransferResult,
			handler: () => ({ Ok: BigInt(7) })
		});
	});

	afterEach(() => {
		host.restore();
	});

	it('pays nothing for monthly stats with no settled history behind them', async () => {
		join({ principal: member, affiliationIdentifier: 'forged-u', joinedAtMs: monthStartMs });
		writeMonthlyStats({ principal: member, calls: 1_000 });

		const result = await claimAs(member);

		assert.equal(result.notEligible, true);
		assert.equal(result.awardsCreated, 0);
		assert.ok(!host.calls().includes('icrc1_transfer'));
		assert.deepEqual(host.keys(Collection.VXP_AWARDS), []);
		assert.deepEqual(snapshotKeys(), []);
	});

	it('freezes a large ranking a bounded batch per claim and pays once it is complete', async () => {
		for (let i = 0; i < 10; i += 1) {
			const principal = Principal.fromUint8Array(new Uint8Array([8, 8, i]));

			join({ principal, affiliationIdentifier: `uni-${i}`, joinedAtMs: monthStartMs });
			settlements.push({ principal, atMs: monthStartMs + DAY_IN_MS, calls: 60, wins: 59 - i });
		}

		const top = Principal.fromUint8Array(new Uint8Array([8, 8, 0]));

		host.setCaller(top);

		const snapshotsPerCall: number[] = [];
		let result = await claimWorldsPodiumPrizeFn({ monthAnchor });

		while (result.freezePending === true) {
			assert.deepEqual(host.keys(Collection.VXP_AWARDS), []);
			snapshotsPerCall.push(snapshotKeys().length);
			result = await claimWorldsPodiumPrizeFn({ monthAnchor });
		}

		// The ranking is recorded first, then written out four snapshots a call
		// beside the freeze doc's own writes; the empty country month takes one.
		assert.deepEqual(snapshotsPerCall, [0, 4, 8, 10, 10]);
		assert.equal(result.awardsCreated, 1);
		assert.equal(
			host.readDoc<VxpAwardDoc>({ collection: Collection.VXP_AWARDS, key: goldKey(top) })?.status,
			'paid'
		);
	});

	it('ranks the podium from settled history, whatever the monthly stats say', async () => {
		join({ principal: member, affiliationIdentifier: 'honest-u', joinedAtMs: monthStartMs });
		join({ principal: rival, affiliationIdentifier: 'inflated-u', joinedAtMs: monthStartMs });
		settlements.push({ principal: member, atMs: monthStartMs + DAY_IN_MS, calls: 60, wins: 50 });
		settlements.push({ principal: rival, atMs: monthStartMs + DAY_IN_MS, calls: 60, wins: 30 });
		writeMonthlyStats({ principal: rival, calls: 1_000 });

		const rivalResult = await claimAs(rival);
		const result = await claimAs(member);

		assert.equal(rivalResult.awardsCreated, 1);
		assert.equal(
			host.readDoc({ collection: Collection.VXP_AWARDS, key: goldKey({ recipient: rival }) }),
			undefined
		);
		assert.equal(result.awardsCreated, 1);
		assert.equal(
			host.readDoc<VxpAwardDoc>({
				collection: Collection.VXP_AWARDS,
				key: goldKey({ recipient: member })
			})?.status,
			'paid'
		);
	});

	it('counts only settlements inside the closed month', async () => {
		join({ principal: member, affiliationIdentifier: 'edges-u', joinedAtMs: monthStartMs });
		settlements.push({ principal: member, atMs: monthStartMs - 1, calls: 60, wins: 60 });
		settlements.push({ principal: member, atMs: monthCloseMs, calls: 60, wins: 60 });

		const result = await claimAs(member);

		assert.equal(result.notEligible, true);
		assert.ok(!host.calls().includes('icrc1_transfer'));
	});

	it('does not let a slot joined after close lift the ranking', async () => {
		join({ principal: member, affiliationIdentifier: 'boosted-u', joinedAtMs: monthStartMs });
		join({ principal: latecomer, affiliationIdentifier: 'boosted-u', joinedAtMs: claimMs });
		settlements.push({ principal: member, atMs: monthStartMs + DAY_IN_MS, calls: 10, wins: 9 });
		settlements.push({ principal: latecomer, atMs: monthStartMs + DAY_IN_MS, calls: 60, wins: 60 });

		const result = await claimAs(member);

		assert.equal(result.notEligible, true);
		assert.ok(!host.calls().includes('icrc1_transfer'));
	});

	it('ranks and pays a member holding two slots of a kind for the one taken first', async () => {
		join({ principal: member, affiliationIdentifier: 'first-u', joinedAtMs: monthStartMs });
		join({ principal: member, affiliationIdentifier: 'second-u', joinedAtMs: monthStartMs + 1 });
		settlements.push({ principal: member, atMs: monthStartMs + DAY_IN_MS, calls: 60, wins: 50 });

		const result = await claimAs(member);

		assert.equal(result.awardsCreated, 1);
		assert.equal(
			host.readDoc<VxpAwardDoc>({
				collection: Collection.VXP_AWARDS,
				key: goldKey({ recipient: member })
			})?.status,
			'paid'
		);
	});

	it('sends a failed prize again on the next claim, and a paid one never', async () => {
		let answer: IcrcLedgerDid.TransferResult = {
			Err: { InsufficientFunds: { balance: BigInt(0) } }
		};

		host.onCall({
			method: 'icrc1_transfer',
			argTypes: [IcrcLedgerIdl.TransferArg],
			result: IcrcLedgerIdl.TransferResult,
			handler: () => answer
		});
		join({ principal: member, affiliationIdentifier: 'retry-u', joinedAtMs: monthStartMs });
		settlements.push({ principal: member, atMs: monthStartMs + DAY_IN_MS, calls: 60, wins: 50 });

		await claimAs(member);

		const gold = () =>
			host.readDoc<VxpAwardDoc>({
				collection: Collection.VXP_AWARDS,
				key: goldKey({ recipient: member })
			});

		assert.equal(gold()?.status, 'failed');

		answer = { Ok: BigInt(8) };

		const retried = await claimAs(member);
		const again = await claimAs(member);

		assert.equal(retried.awardsCreated, 1);
		assert.equal(gold()?.status, 'paid');
		assert.equal(gold()?.blockIndex, '8');
		assert.equal(again.awardsAlreadyClaimed, 1);
		assert.equal(host.calls().filter((method) => method === 'icrc1_transfer').length, 2);
	});

	it('pays a university and a country finish of the same month once each', async () => {
		join({ principal: member, affiliationIdentifier: 'twice-u', joinedAtMs: monthStartMs });
		join({
			principal: member,
			affiliationIdentifier: 'twice-c',
			joinedAtMs: monthStartMs,
			kind: 'country'
		});
		settlements.push({ principal: member, atMs: monthStartMs + DAY_IN_MS, calls: 60, wins: 50 });

		const first = await claimAs(member);
		const again = await claimAs(member);

		assert.equal(first.awardsCreated, 2);
		assert.equal(again.awardsCreated, 0);
		assert.equal(again.awardsAlreadyClaimed, 2);
		assert.equal(host.calls().filter((method) => method === 'icrc1_transfer').length, 2);

		for (const kind of ['university', 'country'] as const) {
			assert.equal(
				host.readDoc<VxpAwardDoc>({
					collection: Collection.VXP_AWARDS,
					key: goldKey({ recipient: member, kind })
				})?.status,
				'paid'
			);
		}
	});

	it('pays a place no more for a month already paid under the key without the kind', async () => {
		const unkindedAwardKey = `${monthAnchor}_gold`;
		const paid: VxpAwardDoc = {
			recipient: member.toText(),
			awardType: 'worlds_podium',
			awardKey: unkindedAwardKey,
			amountBaseUnits: '4000000',
			status: 'paid',
			earnedAtMs: monthCloseMs
		};

		host.putDoc({
			collection: Collection.VXP_AWARDS,
			key: vxpAwardKey({
				recipient: member.toText(),
				awardType: 'worlds_podium',
				awardKey: unkindedAwardKey
			}),
			data: paid,
			owner: member
		});
		join({ principal: member, affiliationIdentifier: 'paid-u', joinedAtMs: monthStartMs });
		join({
			principal: member,
			affiliationIdentifier: 'paid-c',
			joinedAtMs: monthStartMs,
			kind: 'country'
		});
		settlements.push({ principal: member, atMs: monthStartMs + DAY_IN_MS, calls: 60, wins: 50 });

		const result = await claimAs(member);

		assert.equal(result.awardsCreated, 0);
		assert.equal(result.awardsAlreadyClaimed, 2);
		assert.ok(!host.calls().includes('icrc1_transfer'));
	});

	it('pays a place whose payout under the key without the kind failed', async () => {
		const unkindedAwardKey = `${monthAnchor}_gold`;
		const failed: VxpAwardDoc = {
			recipient: member.toText(),
			awardType: 'worlds_podium',
			awardKey: unkindedAwardKey,
			amountBaseUnits: '4000000',
			status: 'failed',
			earnedAtMs: monthCloseMs
		};

		host.putDoc({
			collection: Collection.VXP_AWARDS,
			key: vxpAwardKey({
				recipient: member.toText(),
				awardType: 'worlds_podium',
				awardKey: unkindedAwardKey
			}),
			data: failed,
			owner: member
		});
		join({ principal: member, affiliationIdentifier: 'unpaid-u', joinedAtMs: monthStartMs });
		settlements.push({ principal: member, atMs: monthStartMs + DAY_IN_MS, calls: 60, wins: 50 });

		const result = await claimAs(member);

		assert.equal(result.awardsCreated, 1);
		assert.equal(
			host.readDoc<VxpAwardDoc>({
				collection: Collection.VXP_AWARDS,
				key: goldKey({ recipient: member })
			})?.status,
			'paid'
		);
	});
});
