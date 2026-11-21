import {
	completeTournamentDraw,
	type TriggerTournamentDrawResult
} from '#lib/services/tournament.services.ts';
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

const monthAnchor = '2026-11';

/** A draw that answers each of `answers` in turn. */
const drawAnswering = (answers: TriggerTournamentDrawResult[]) => {
	const remaining = [...answers];

	return {
		draw: (): Promise<TriggerTournamentDrawResult> => {
			const answer = remaining.shift();
			assert.ok(answer, 'draw called after its last answer');

			return Promise.resolve(answer);
		},
		calls: () => answers.length - remaining.length
	};
};

const ok: TriggerTournamentDrawResult = { ok: true, tournamentId: monthAnchor };
const drawn: TriggerTournamentDrawResult = {
	ok: false,
	reason: 'already_drawn',
	tournamentId: monthAnchor
};

describe('completeTournamentDraw', () => {
	it('calls again until the bracket is complete and answers with the first result', async () => {
		const { draw, calls } = drawAnswering([ok, ok, ok, drawn]);

		assert.deepEqual(await completeTournamentDraw({ draw }), ok);
		assert.equal(calls(), 4);
	});

	it('answers a first refusal as is', async () => {
		const refusal: TriggerTournamentDrawResult = {
			ok: false,
			reason: 'insufficient_leagues',
			availableLeagues: 3
		};
		const { draw, calls } = drawAnswering([refusal]);

		assert.deepEqual(await completeTournamentDraw({ draw }), refusal);
		assert.equal(calls(), 1);
	});

	it('fails when a later call stops before the bracket is complete', async () => {
		const { draw } = drawAnswering([ok, ok, { ok: false, reason: 'invalid_input' }]);

		await assert.rejects(completeTournamentDraw({ draw }), /invalid_input/);
	});
});
