import { Collection } from '#lib/constants/collections.constants.ts';
import { LEADERBOARD_QUALIFY_MIN } from '#lib/constants/standings.constants.ts';
import { DAY_IN_MS } from '#lib/constants/time.constants.ts';
import {
	LEADERBOARD_RANKING_KEY,
	type LeaderboardRankingDoc
} from '#lib/types/leaderboard-ranking.ts';
import {
	answerSettlementAccuracy,
	hostNowMs,
	installSatelliteHost,
	type MockSettlement,
	type SatelliteHost
} from '#root/src/tests/mocks/satellite-host.mock.ts';
import { assertDeleteDoc, assertSetDoc } from '#satellite/index.ts';
import {
	getMyRivalFn,
	getUserRankAndCountFn,
	LEADERBOARD_RANKING_TTL_MS,
	listLeaderboard,
	refreshLeaderboardRankingFn
} from '#satellite/services/leaderboard.services.ts';
import { Principal } from '@icp-sdk/core/principal';
import assert from 'node:assert/strict';
import { afterEach, beforeEach, describe, it } from 'node:test';

const principal = (n: number): Principal => Principal.fromUint8Array(new Uint8Array([7, n]));

// Far past what any real total reaches: a ranking that read points would put
// these profiles first.
const HUGE_POINTS = 900_000_000;

describe('leaderboard.services', () => {
	const first = principal(1);
	const second = principal(2);
	const third = principal(3);
	const pointsOnly = principal(4);
	const belowGate = principal(5);
	const hidden = principal(6);

	let host: SatelliteHost;
	let settlements: MockSettlement[];

	const putProfile = ({ owner, extra = {} }: { owner: Principal; extra?: object }): void => {
		host.putDoc({
			collection: Collection.PROFILES,
			key: owner.toText(),
			data: { owner: owner.toText(), nickname: `p${owner.toText().slice(0, 5)}`, ...extra },
			owner
		});
	};

	const settle = ({
		owner,
		calls,
		wins
	}: {
		owner: Principal;
		calls: number;
		wins: number;
	}): void => {
		settlements.push({ principal: owner, atMs: hostNowMs - DAY_IN_MS, calls, wins });
	};

	const stored = (): LeaderboardRankingDoc | undefined =>
		host.readDoc<LeaderboardRankingDoc>({
			collection: Collection.LEADERBOARD_RANKING,
			key: LEADERBOARD_RANKING_KEY
		});

	beforeEach(() => {
		settlements = [];
		// The real asserts run on every serverless write, as on the satellite.
		host = installSatelliteHost({
			asserts: { set: assertSetDoc.assert, remove: assertDeleteDoc.assert }
		});
		host.setCaller(second);
		answerSettlementAccuracy({ host, settlements });

		putProfile({ owner: first });
		putProfile({ owner: second });
		// 10/11 is a higher raw rate than 45/50 but a thinner record: the
		// confidence-adjusted score ranks it below.
		putProfile({ owner: third, extra: { points: HUGE_POINTS } });
		putProfile({ owner: pointsOnly, extra: { points: HUGE_POINTS } });
		putProfile({ owner: belowGate, extra: { points: HUGE_POINTS } });
		putProfile({ owner: hidden, extra: { deletedAtMs: hostNowMs - DAY_IN_MS } });

		settle({ owner: first, calls: 200, wins: 190 });
		settle({ owner: second, calls: 50, wins: 45 });
		settle({ owner: third, calls: 11, wins: 10 });
		settle({
			owner: belowGate,
			calls: LEADERBOARD_QUALIFY_MIN - 1,
			wins: LEADERBOARD_QUALIFY_MIN - 1
		});
		settle({ owner: hidden, calls: 100, wins: 99 });
	});

	afterEach(() => {
		host.restore();
	});

	it('ranks nobody before the first refresh', () => {
		assert.deepEqual(listLeaderboard(), []);
		assert.deepEqual(getUserRankAndCountFn({ principal: first.toText() }), {
			rank: undefined,
			count: 0
		});
		assert.deepEqual(getMyRivalFn(), { rival: undefined, rivalIsTrailing: false });
	});

	it('stores a ranking from settled history: points, a thin record and hidden profiles do not count', async () => {
		assert.deepEqual(await refreshLeaderboardRankingFn(), { refreshed: true, ranked: 3 });
		assert.deepEqual(stored()?.owners, [first.toText(), second.toText(), third.toText()]);
		assert.deepEqual(
			listLeaderboard().map(({ owner }) => owner),
			[first.toText(), second.toText(), third.toText()]
		);
	});

	it('answers rank, count and rival from the stored ranking', async () => {
		await refreshLeaderboardRankingFn();

		assert.deepEqual(getUserRankAndCountFn({ principal: second.toText() }), { rank: 2, count: 3 });

		for (const unranked of [pointsOnly, belowGate, hidden]) {
			assert.deepEqual(getUserRankAndCountFn({ principal: unranked.toText() }), {
				rank: undefined,
				count: 3
			});
		}

		const { rival, rivalIsTrailing } = getMyRivalFn();

		assert.equal(rival?.owner, first.toText());
		assert.equal(rivalIsTrailing, false);

		host.setCaller(first);

		assert.equal(getMyRivalFn().rival?.owner, second.toText());
		assert.equal(getMyRivalFn().rivalIsTrailing, true);
	});

	it('breaks an equal score by settled calls, then by principal', async () => {
		const moreCalls = principal(10);
		const fewerCalls = principal(11);
		const [twinLow, twinHigh] = [principal(13), principal(12)].sort((a, b) =>
			a.toText() < b.toText() ? -1 : 1
		);

		for (const owner of [moreCalls, fewerCalls, twinLow, twinHigh]) {
			putProfile({ owner });
		}

		// Against a weight-20 prior at 0.5, 30 wins in 40 calls and 10 in 10
		// both score exactly 2/3.
		settle({ owner: moreCalls, calls: 40, wins: 30 });
		settle({ owner: fewerCalls, calls: 10, wins: 10 });
		settle({ owner: twinHigh, calls: 12, wins: 6 });
		settle({ owner: twinLow, calls: 12, wins: 6 });

		await refreshLeaderboardRankingFn();

		const owners = stored()?.owners ?? [];

		assert.equal(owners.indexOf(moreCalls.toText()) + 1, owners.indexOf(fewerCalls.toText()));
		assert.deepEqual(owners.slice(-2), [twinLow?.toText(), twinHigh?.toText()]);
	});

	it('serves the stored ranking until it is older than the TTL', async () => {
		await refreshLeaderboardRankingFn();

		const reads = (): number =>
			host.calls().filter((method) => method === 'aggregate_settlement_accuracy').length;

		settle({ owner: pointsOnly, calls: 500, wins: 500 });
		host.setNowMs(hostNowMs + LEADERBOARD_RANKING_TTL_MS - 1);

		assert.deepEqual(await refreshLeaderboardRankingFn(), { refreshed: false, ranked: 3 });
		assert.equal(reads(), 1);

		host.setNowMs(hostNowMs + LEADERBOARD_RANKING_TTL_MS);

		assert.deepEqual(await refreshLeaderboardRankingFn(), { refreshed: true, ranked: 4 });
		assert.equal(reads(), 2);
		assert.equal(stored()?.owners[0], pointsOnly.toText());
	});

	it('drops a profile hidden since the ranking was stored from the list', async () => {
		await refreshLeaderboardRankingFn();
		putProfile({ owner: first, extra: { hibernatedAtMs: hostNowMs } });

		assert.deepEqual(
			listLeaderboard().map(({ owner }) => owner),
			[second.toText(), third.toText()]
		);
	});
});
