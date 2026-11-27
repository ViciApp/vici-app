// The prize claim's payout rules: one prize per tournament, kept across the
// earlier per-place award keys, a failed payout sent again at its recorded
// amount, and nothing paid before the tournament concludes.

import { Collection } from '#lib/constants/collections.constants.ts';
import { DAY_IN_MS } from '#lib/constants/time.constants.ts';
import type { LeagueMemberDoc } from '#lib/types/league-member.ts';
import {
	roundWindow,
	TOURNAMENT_BRACKET_SIZE,
	TOURNAMENT_ROUND_DURATION_MS,
	tournamentMatchKey,
	type TournamentDoc,
	type TournamentMatchDoc,
	type TournamentRound
} from '#lib/types/tournament.ts';
import { vxpAwardKey, type VxpAwardDoc } from '#lib/types/vxp-award.ts';
import { vxpBaseUnits } from '#lib/utils/vxp-amount.utils.ts';
import {
	answerSettlementAccuracy,
	controller,
	installSatelliteHost,
	type MockSettlement,
	type SatelliteHost
} from '#root/src/tests/mocks/satellite-host.mock.ts';
import { assertDeleteDoc, assertSetDoc } from '#satellite/index.ts';
import { claimTournamentPrizeFn } from '#satellite/services/tournament.services.ts';
import { Principal } from '@icp-sdk/core/principal';
import { IcrcLedgerIdl, type IcrcLedgerDid } from '@junobuild/functions/canisters/ledger/icrc';
import assert from 'node:assert/strict';
import { afterEach, beforeEach, describe, it } from 'node:test';

const tournamentId = '2026-11';
const monthStartMs = Date.UTC(2026, 10, 1);

const tournament: TournamentDoc = {
	id: tournamentId,
	monthStartMs,
	monthEndMs: monthStartMs + 4 * TOURNAMENT_ROUND_DURATION_MS,
	bracketSize: TOURNAMENT_BRACKET_SIZE,
	state: 'concluded',
	seededLeagueIds: Array.from({ length: TOURNAMENT_BRACKET_SIZE }, (_, i) => `league-${i}`),
	createdAtMs: monthStartMs + 1_000
};

const finalWindow = roundWindow({ tournamentMonthStartMs: monthStartMs, round: 'final' });

const finalMatch: TournamentMatchDoc = {
	tournamentId,
	round: 'final',
	index: 0,
	fromLeagueId: 'league-0',
	toLeagueId: 'league-1',
	fromStartCalls: null,
	fromStartWins: null,
	toStartCalls: null,
	toStartWins: null,
	fromAcc: null,
	toAcc: null,
	winnerLeagueId: null,
	startMs: finalWindow.startMs,
	endMs: finalWindow.endMs
};

const finalMatchKey = tournamentMatchKey({ tournamentId, round: 'final', index: 0 });

describe('claimTournamentPrizeFn', () => {
	const drawnAtMs = tournament.createdAtMs;
	const winner = Principal.fromUint8Array(new Uint8Array([7, 7, 1]));
	const awardKey = (key: string): string =>
		vxpAwardKey({ recipient: winner, awardType: 'tournament_prize', awardKey: key });

	let host: SatelliteHost;
	let settlements: MockSettlement[];
	let transfers: { amount: bigint; memo: string }[];
	let rejectTransfers: boolean;

	const award = (key = tournamentId) =>
		host.readDoc<VxpAwardDoc>({ collection: Collection.VXP_AWARDS, key: awardKey(key) });

	const join = ({ leagueId, member }: { leagueId: string; member: Principal }) => {
		const doc: LeagueMemberDoc = {
			leagueId,
			member: member.toText(),
			role: 'member',
			joinedAtMs: drawnAtMs - 1
		};

		host.putDoc({
			collection: Collection.LEAGUE_MEMBERS,
			key: `${leagueId}/${member.toText()}`,
			data: doc,
			owner: member,
			createdAtMs: drawnAtMs - 1
		});
		settlements.push({ principal: member, atMs: monthStartMs + DAY_IN_MS, calls: 1, wins: 1 });
	};

	const putMatch = ({
		round,
		index,
		fromLeagueId,
		toLeagueId
	}: {
		round: TournamentRound;
		index: number;
		fromLeagueId: string;
		toLeagueId: string;
	}) => {
		const window = roundWindow({ tournamentMonthStartMs: monthStartMs, round });

		host.putDoc({
			collection: Collection.TOURNAMENT_MATCHES,
			key: tournamentMatchKey({ tournamentId, round, index }),
			data: {
				...finalMatch,
				round,
				index,
				fromLeagueId,
				toLeagueId,
				fromAcc: 0.6,
				toAcc: 0.5,
				winnerLeagueId: fromLeagueId,
				startMs: window.startMs,
				endMs: window.endMs
			},
			owner: controller,
			createdAtMs: drawnAtMs
		});
	};

	const putTournament = (state: TournamentDoc['state']) =>
		host.putDoc({
			collection: Collection.TOURNAMENTS,
			key: tournamentId,
			data: { ...tournament, state },
			owner: controller,
			createdAtMs: drawnAtMs
		});

	/** A payout record as an earlier claim left it, written past the asserts. */
	const putAward = ({ key, status }: { key: string; status: VxpAwardDoc['status'] }) =>
		host.putDoc({
			collection: Collection.VXP_AWARDS,
			key: awardKey(key),
			data: {
				recipient: winner.toText(),
				awardType: 'tournament_prize',
				awardKey: key,
				amountBaseUnits: vxpBaseUnits(2500).toString(),
				status,
				earnedAtMs: drawnAtMs
			} satisfies VxpAwardDoc,
			owner: controller
		});

	const credited = (vxp: number) => ({
		ok: true,
		awardsCreated: 1,
		awardsAlreadyClaimed: 0,
		totalVxpCredited: vxp
	});

	const alreadyClaimed = {
		ok: true,
		awardsCreated: 0,
		awardsAlreadyClaimed: 1,
		totalVxpCredited: 0
	};

	beforeEach(() => {
		settlements = [];
		transfers = [];
		rejectTransfers = false;
		// The real asserts run on every serverless write, as on the satellite.
		host = installSatelliteHost({
			asserts: { set: assertSetDoc.assert, remove: assertDeleteDoc.assert }
		});
		host.setCaller(winner);
		host.setNowMs(tournament.monthEndMs + DAY_IN_MS);
		answerSettlementAccuracy({ host, settlements });
		host.onCall({
			method: 'icrc1_transfer',
			argTypes: [IcrcLedgerIdl.TransferArg],
			result: IcrcLedgerIdl.TransferResult,
			handler: (args) => {
				const [{ amount, memo }] = args as [IcrcLedgerDid.TransferArg];

				transfers.push({ amount, memo: new TextDecoder().decode(Uint8Array.from(memo[0] ?? [])) });

				return rejectTransfers
					? { Err: { InsufficientFunds: { balance: BigInt(0) } } }
					: { Ok: BigInt(transfers.length) };
			}
		});

		// league-0 beat league-1 in the final; league-2 and league-3 lost the semifinals.
		putTournament('concluded');
		putMatch({ round: 'semifinal', index: 0, fromLeagueId: 'league-0', toLeagueId: 'league-2' });
		putMatch({ round: 'semifinal', index: 1, fromLeagueId: 'league-1', toLeagueId: 'league-3' });
		putMatch({ round: 'final', index: 0, fromLeagueId: 'league-0', toLeagueId: 'league-1' });
		join({ leagueId: 'league-0', member: winner });
	});

	afterEach(() => host.restore());

	it('pays a winner member once, and a second claim sends nothing', async () => {
		assert.deepEqual(await claimTournamentPrizeFn({ tournamentId }), credited(5000));
		assert.deepEqual(await claimTournamentPrizeFn({ tournamentId }), alreadyClaimed);

		assert.deepEqual(transfers, [
			{ amount: vxpBaseUnits(5000), memo: `vxp:tournament_prize:${tournamentId}` }
		]);
		assert.equal(award()?.status, 'paid');
		assert.equal(award()?.blockIndex, '1');
	});

	it('pays the runner-up and a semifinal loser their own tier', async () => {
		const runnerUp = Principal.fromUint8Array(new Uint8Array([7, 7, 2]));
		const semifinalist = Principal.fromUint8Array(new Uint8Array([7, 7, 3]));

		join({ leagueId: 'league-1', member: runnerUp });
		join({ leagueId: 'league-3', member: semifinalist });

		host.setCaller(runnerUp);
		assert.deepEqual(await claimTournamentPrizeFn({ tournamentId }), credited(2500));

		host.setCaller(semifinalist);
		assert.deepEqual(await claimTournamentPrizeFn({ tournamentId }), credited(1000));

		assert.deepEqual(
			transfers.map(({ amount }) => amount),
			[vxpBaseUnits(2500), vxpBaseUnits(1000)]
		);
	});

	it('pays nothing when a prize under a per-place key of an earlier claim is held', async () => {
		putAward({ key: `${tournamentId}_place_2`, status: 'paid' });

		assert.deepEqual(await claimTournamentPrizeFn({ tournamentId }), alreadyClaimed);
		assert.deepEqual(transfers, []);
		assert.equal(award(), undefined);
	});

	it('never sends a payout still pending again', async () => {
		putAward({ key: tournamentId, status: 'pending' });

		assert.deepEqual(await claimTournamentPrizeFn({ tournamentId }), alreadyClaimed);
		assert.deepEqual(transfers, []);
		assert.equal(award()?.status, 'pending');
	});

	it('sends a failed payout again at its recorded amount, not the current tier', async () => {
		putAward({ key: tournamentId, status: 'failed' });

		assert.deepEqual(await claimTournamentPrizeFn({ tournamentId }), credited(2500));
		assert.deepEqual(transfers, [
			{ amount: vxpBaseUnits(2500), memo: `vxp:tournament_prize:${tournamentId}` }
		]);
		assert.equal(award()?.status, 'paid');
	});

	it('sends a payout the ledger rejected again on the next claim, once', async () => {
		rejectTransfers = true;

		assert.deepEqual(await claimTournamentPrizeFn({ tournamentId }), {
			ok: true,
			awardsCreated: 0,
			awardsAlreadyClaimed: 0,
			totalVxpCredited: 0
		});
		assert.equal(award()?.status, 'failed');

		rejectTransfers = false;

		assert.deepEqual(await claimTournamentPrizeFn({ tournamentId }), credited(5000));
		assert.deepEqual(await claimTournamentPrizeFn({ tournamentId }), alreadyClaimed);

		assert.deepEqual(
			transfers.map(({ amount }) => amount),
			[vxpBaseUnits(5000), vxpBaseUnits(5000)]
		);
		assert.equal(award()?.status, 'paid');
		assert.equal(award()?.amountBaseUnits, vxpBaseUnits(5000).toString());
	});

	it('refuses a tournament still in flight, reading no settled history', async () => {
		putTournament('in_flight');

		assert.deepEqual(await claimTournamentPrizeFn({ tournamentId }), {
			ok: false,
			reason: 'tournament_not_concluded'
		});
		assert.deepEqual(host.calls(), []);
		assert.deepEqual(host.keys(Collection.VXP_AWARDS), []);
	});

	it('refuses a concluded tournament whose final has no winner', async () => {
		host.putDoc({
			collection: Collection.TOURNAMENT_MATCHES,
			key: finalMatchKey,
			data: finalMatch,
			owner: controller,
			createdAtMs: drawnAtMs
		});

		assert.deepEqual(await claimTournamentPrizeFn({ tournamentId }), {
			ok: false,
			reason: 'tournament_not_concluded'
		});
		assert.deepEqual(host.calls(), []);
	});

	it('refuses a tournament that was never drawn', async () => {
		assert.deepEqual(await claimTournamentPrizeFn({ tournamentId: '2026-09' }), {
			ok: false,
			reason: 'tournament_not_found'
		});
		assert.deepEqual(host.calls(), []);
	});
});
