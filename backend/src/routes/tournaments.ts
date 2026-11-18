// Tournament surface: the current bracket read, the fire-and-forget draw and
// round-resolve triggers (both idempotent, so the client can call them on
// every page mount alongside the worker's scheduled ticks), and the per-user
// prize claim.

import { isNullish } from '@dfinity/utils';
import { Elysia, t } from 'elysia';
import { requireUser, unauthenticated } from '../auth/guard';
import {
	claimTournamentPrize,
	getCurrentTournament,
	resolveTournamentRound,
	triggerTournamentDraw
} from '../tournaments/tournaments';

export const tournamentsRoutes = new Elysia({ prefix: '/api/v1/tournaments' })
	.get('/current', async ({ request, set }) => {
		const user = await requireUser(request);

		if (isNullish(user)) {
			return unauthenticated(set);
		}

		return await getCurrentTournament();
	})
	.post(
		'/draw',
		async ({ request, set, body }) => {
			const user = await requireUser(request);

			if (isNullish(user)) {
				return unauthenticated(set);
			}

			return await triggerTournamentDraw({ monthAnchor: body.monthAnchor });
		},
		{ body: t.Object({ monthAnchor: t.String() }) }
	)
	.post(
		'/:tournamentId/resolve',
		async ({ request, set, params, body }) => {
			const user = await requireUser(request);

			if (isNullish(user)) {
				return unauthenticated(set);
			}

			return await resolveTournamentRound({
				tournamentId: params.tournamentId,
				round: body.round
			});
		},
		{ body: t.Object({ round: t.String() }) }
	)
	.post('/:tournamentId/claim', async ({ request, set, params }) => {
		const user = await requireUser(request);

		if (isNullish(user)) {
			return unauthenticated(set);
		}

		return await claimTournamentPrize({ tournamentId: params.tournamentId, userId: user.id });
	});
