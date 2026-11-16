import type { TournamentMatchDoc } from '#lib/types/tournament.ts';
import {
	decideTournamentPrize,
	isTournamentPrizeAwardKey,
	tournamentPodium,
	type TournamentPodium,
	type TournamentPrizeMembership
} from '#satellite/utils/tournament-prize.utils.ts';
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

const TOURNAMENT_ID = '2026-10';
const DRAWN_AT_NS = 1_000n;

const PODIUM: TournamentPodium = {
	placeOneLeague: 'gold',
	placeTwoLeague: 'silver',
	semifinalLosers: ['bronze-a', 'bronze-b']
};

const match = (overrides: Partial<TournamentMatchDoc>): TournamentMatchDoc => ({
	tournamentId: TOURNAMENT_ID,
	round: 'final',
	index: 0,
	fromLeagueId: null,
	toLeagueId: null,
	fromStartCalls: null,
	fromStartWins: null,
	toStartCalls: null,
	toStartWins: null,
	fromAcc: null,
	toAcc: null,
	winnerLeagueId: null,
	startMs: 0,
	endMs: 1,
	...overrides
});

const decide = ({
	memberships,
	held = []
}: {
	memberships: TournamentPrizeMembership[];
	held?: string[];
}) =>
	decideTournamentPrize({
		tournamentId: TOURNAMENT_ID,
		podium: PODIUM,
		memberships,
		drawnAtNs: DRAWN_AT_NS,
		isHeld: (awardKey) => held.includes(awardKey)
	});

describe('tournament-prize.utils', () => {
	describe('tournamentPodium', () => {
		it('is undefined until the final has a winner', () => {
			assert.equal(tournamentPodium([]), undefined);
			assert.equal(
				tournamentPodium([match({ fromLeagueId: 'gold', toLeagueId: 'silver' })]),
				undefined
			);
		});

		it('reads both finalists and both semifinal losers', () => {
			assert.deepEqual(
				tournamentPodium([
					match({ fromLeagueId: 'silver', toLeagueId: 'gold', winnerLeagueId: 'gold' }),
					match({
						round: 'semifinal',
						index: 0,
						fromLeagueId: 'gold',
						toLeagueId: 'bronze-a',
						winnerLeagueId: 'gold'
					}),
					match({
						round: 'semifinal',
						index: 1,
						fromLeagueId: 'bronze-b',
						toLeagueId: 'silver',
						winnerLeagueId: 'silver'
					})
				]),
				PODIUM
			);
		});
	});

	describe('decideTournamentPrize', () => {
		it('grants the place of a membership stored before the draw, keyed on the tournament', () => {
			assert.deepEqual(decide({ memberships: [{ leagueId: 'silver', joinedAtNs: 10n }] }), {
				outcome: 'grant',
				place: 2,
				awardKey: TOURNAMENT_ID
			});
		});

		it('counts a membership stored at the draw itself', () => {
			assert.deepEqual(decide({ memberships: [{ leagueId: 'gold', joinedAtNs: DRAWN_AT_NS }] }), {
				outcome: 'grant',
				place: 1,
				awardKey: TOURNAMENT_ID
			});
		});

		it('refuses a league joined after the draw, even once the tournament has closed', () => {
			assert.deepEqual(
				decide({ memberships: [{ leagueId: 'gold', joinedAtNs: DRAWN_AT_NS + 1n }] }),
				{ outcome: 'not_placed' }
			);
		});

		it('ignores a late join and keeps the place of the membership held at the draw', () => {
			assert.deepEqual(
				decide({
					memberships: [
						{ leagueId: 'gold', joinedAtNs: DRAWN_AT_NS + 5n },
						{ leagueId: 'bronze-b', joinedAtNs: 1n }
					]
				}),
				{ outcome: 'grant', place: 3, awardKey: TOURNAMENT_ID }
			);
		});

		it('offers the highest place to a member of several podium leagues', () => {
			assert.deepEqual(
				decide({
					memberships: [
						{ leagueId: 'bronze-a', joinedAtNs: 1n },
						{ leagueId: 'gold', joinedAtNs: 2n }
					]
				}),
				{ outcome: 'grant', place: 1, awardKey: TOURNAMENT_ID }
			);
		});

		it('refuses a caller with no podium membership', () => {
			assert.deepEqual(decide({ memberships: [{ leagueId: 'elsewhere', joinedAtNs: 1n }] }), {
				outcome: 'not_placed'
			});
		});

		it('refuses a second place once a first place has been claimed', () => {
			const first = decide({ memberships: [{ leagueId: 'gold', joinedAtNs: 1n }] });

			assert.ok(first.outcome === 'grant');

			assert.deepEqual(
				decide({
					memberships: [{ leagueId: 'silver', joinedAtNs: 1n }],
					held: [first.awardKey]
				}),
				{ outcome: 'already_claimed' }
			);
		});

		it('refuses a claim when any per-place key of an earlier claim is held', () => {
			for (const legacyKey of [
				`${TOURNAMENT_ID}_place_1`,
				`${TOURNAMENT_ID}_place_2`,
				`${TOURNAMENT_ID}_place_3`
			]) {
				assert.deepEqual(
					decide({ memberships: [{ leagueId: 'silver', joinedAtNs: 1n }], held: [legacyKey] }),
					{ outcome: 'already_claimed' }
				);
			}
		});

		it('is not blocked by a prize of another tournament', () => {
			assert.deepEqual(
				decide({
					memberships: [{ leagueId: 'gold', joinedAtNs: 1n }],
					held: ['2026-09', '2026-09_place_1']
				}),
				{ outcome: 'grant', place: 1, awardKey: TOURNAMENT_ID }
			);
		});
	});

	describe('isTournamentPrizeAwardKey', () => {
		it('accepts the key a grant is written under', () => {
			const decision = decide({ memberships: [{ leagueId: 'gold', joinedAtNs: 1n }] });

			assert.ok(decision.outcome === 'grant');
			assert.equal(isTournamentPrizeAwardKey(decision.awardKey), true);
		});

		it('rejects a per-place key', () => {
			assert.equal(isTournamentPrizeAwardKey(`${TOURNAMENT_ID}_place_1`), false);
		});
	});
});
