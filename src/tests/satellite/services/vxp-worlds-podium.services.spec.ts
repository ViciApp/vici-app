import { Collection } from '#lib/constants/collections.constants.ts';
import { DAY_IN_MS } from '#lib/constants/time.constants.ts';
import type { AffiliationDoc } from '#lib/types/affiliation.ts';
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
import { IcrcLedgerIdl } from '@junobuild/functions/canisters/ledger/icrc';
import assert from 'node:assert/strict';
import { afterEach, beforeEach, describe, it } from 'node:test';

const member = Principal.fromUint8Array(new Uint8Array([2, 2, 2]));
const rival = Principal.fromUint8Array(new Uint8Array([3, 3, 3]));
const latecomer = Principal.fromUint8Array(new Uint8Array([4, 4, 4]));

const monthAnchor = '2026-10';
const monthStartMs = Date.UTC(2026, 9, 1);
const monthCloseMs = Date.UTC(2026, 10, 1);
const claimMs = Date.UTC(2026, 10, 15);

const goldKey = (recipient: Principal): string =>
	vxpAwardKey({
		recipient: recipient.toText(),
		awardType: 'worlds_podium',
		awardKey: `${monthAnchor}_gold`
	});

describe('claimWorldsPodiumPrizeFn', () => {
	let host: SatelliteHost;
	let settlements: MockSettlement[];

	const join = ({
		principal,
		affiliationIdentifier,
		joinedAtMs
	}: {
		principal: Principal;
		affiliationIdentifier: string;
		joinedAtMs: number;
	}): void => {
		const doc: AffiliationDoc = {
			member: principal.toText(),
			kind: 'university',
			affiliationIdentifier,
			joinedAtMs,
			lockedUntilMs: joinedAtMs + 90 * DAY_IN_MS
		};

		host.putDoc({
			collection: Collection.AFFILIATIONS,
			key: `${principal.toText()}/university/${affiliationIdentifier}`,
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

	const claimAs = async (principal: Principal) => {
		host.setCaller(principal);

		return await claimWorldsPodiumPrizeFn({ monthAnchor });
	};

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
		assert.deepEqual(host.keys(Collection.AFFILIATION_STATS), []);
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
			host.readDoc({ collection: Collection.VXP_AWARDS, key: goldKey(rival) }),
			undefined
		);
		assert.equal(result.awardsCreated, 1);
		assert.equal(
			host.readDoc<VxpAwardDoc>({ collection: Collection.VXP_AWARDS, key: goldKey(member) })
				?.status,
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
			host.readDoc<VxpAwardDoc>({ collection: Collection.VXP_AWARDS, key: goldKey(member) })
				?.status,
			'paid'
		);
	});
});
