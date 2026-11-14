// Battle surface: propose / respond / kickoff / restart / resolve / retract
// plus the battle lists and the caller's bouts-won scalar. League battles
// resolve from settled clearing history server-side; duels resolve with
// manual scores and a derived winner.

import { isNullish } from '@dfinity/utils';
import { Elysia, t } from 'elysia';
import { requireUser, unauthenticated } from '../auth/guard';
import { readBattleLiveScore, resolveBattleFromSettlements } from '../leagues/battle-resolution';
import {
	acceptDuel,
	acceptLeagueBattle,
	BattleError,
	declineBattle,
	expireBattle,
	getBattle,
	getMyBattleStats,
	kickoffBattle,
	listLeagueBattles,
	listMyBattles,
	proposeBattle,
	resolveDuel,
	restartBattle,
	retractBattle
} from '../leagues/battles';
import { badRequest } from '../lib/http';

type BattleAction = (args: { battleId: string; callerId: string }) => Promise<unknown>;

export const battlesRoutes = new Elysia({ prefix: '/api/v1/battles' })
	.get('/mine', async ({ request, set }) => {
		const user = await requireUser(request);

		if (isNullish(user)) {
			return unauthenticated(set);
		}

		return { items: await listMyBattles(user.id) };
	})
	.get('/my-stats', async ({ request, set }) => {
		const user = await requireUser(request);

		if (isNullish(user)) {
			return unauthenticated(set);
		}

		return await getMyBattleStats(user.id);
	})
	.get('/league/:leagueId', async ({ request, set, params }) => {
		const user = await requireUser(request);

		if (isNullish(user)) {
			return unauthenticated(set);
		}

		return { items: await listLeagueBattles(params.leagueId) };
	})
	.get('/:battleId', async ({ request, set, params }) => {
		const user = await requireUser(request);

		if (isNullish(user)) {
			return unauthenticated(set);
		}

		const battle = await getBattle(params.battleId);

		if (isNullish(battle)) {
			set.status = 404;

			return { error: 'not found' };
		}

		return { battle };
	})
	.post(
		'/',
		async ({ request, set, body }) => {
			const user = await requireUser(request);

			if (isNullish(user)) {
				return unauthenticated(set);
			}

			try {
				const battle = await proposeBattle({
					id: body.id,
					kind: body.kind,
					sideA: body.sideA,
					sideB: body.sideB,
					proposerUserId: user.id,
					kickoffMs: body.kickoffMs,
					settleMs: body.settleMs,
					scope: body.scope,
					amount: body.amount ?? body.wager,
					trashTalk: body.trashTalk
				});

				set.status = 201;

				return { battle };
			} catch (err) {
				if (err instanceof BattleError) {
					return badRequest(set, err.message);
				}

				throw err;
			}
		},
		{
			body: t.Object({
				id: t.String({ minLength: 1, maxLength: 64 }),
				kind: t.Union([t.Literal('league'), t.Literal('duel')]),
				sideA: t.String(),
				sideB: t.String(),
				kickoffMs: t.Number(),
				settleMs: t.Number(),
				scope: t.Optional(t.String()),
				amount: t.Optional(t.Number()),
				// The field was called `wager` before; app bundles still cached on
				// devices send that name, so it is read when `amount` is absent.
				wager: t.Optional(t.Number()),
				trashTalk: t.Optional(t.String())
			})
		}
	);

// The response transitions share one route shape; registering them from a
// table keeps the guard/error handling uniform across all six.
const transitionRoutes: { path: string; action: BattleAction }[] = [
	{ path: '/:battleId/accept', action: acceptDuel },
	{ path: '/:battleId/accept-league', action: acceptLeagueBattle },
	{ path: '/:battleId/decline', action: declineBattle },
	{ path: '/:battleId/expire', action: expireBattle },
	{ path: '/:battleId/kickoff', action: kickoffBattle },
	{ path: '/:battleId/restart', action: restartBattle }
];

for (const { path, action } of transitionRoutes) {
	battlesRoutes.post(
		path,
		async ({ request, set, params }) => {
			const user = await requireUser(request);

			if (isNullish(user)) {
				return unauthenticated(set);
			}

			try {
				return { battle: await action({ battleId: params.battleId, callerId: user.id }) };
			} catch (err) {
				if (err instanceof BattleError) {
					return badRequest(set, err.message);
				}

				throw err;
			}
		},
		{ params: t.Object({ battleId: t.String() }) }
	);
}

battlesRoutes
	.post(
		'/:battleId/resolve-duel',
		async ({ request, set, params, body }) => {
			const user = await requireUser(request);

			if (isNullish(user)) {
				return unauthenticated(set);
			}

			try {
				return {
					battle: await resolveDuel({
						battleId: params.battleId,
						callerId: user.id,
						scoreA: body.scoreA,
						scoreB: body.scoreB
					})
				};
			} catch (err) {
				if (err instanceof BattleError) {
					return badRequest(set, err.message);
				}

				throw err;
			}
		},
		{ body: t.Object({ scoreA: t.Number(), scoreB: t.Number() }) }
	)
	.post('/:battleId/resolve', async ({ request, set, params }) => {
		const user = await requireUser(request);

		if (isNullish(user)) {
			return unauthenticated(set);
		}

		try {
			return {
				battle: await resolveBattleFromSettlements({
					battleId: params.battleId,
					callerId: user.id
				})
			};
		} catch (err) {
			if (err instanceof BattleError) {
				return badRequest(set, err.message);
			}

			throw err;
		}
	})
	.get('/:battleId/live-score', async ({ request, set, params }) => {
		const user = await requireUser(request);

		if (isNullish(user)) {
			return unauthenticated(set);
		}

		return { score: await readBattleLiveScore({ battleId: params.battleId, callerId: user.id }) };
	})
	.delete('/:battleId', async ({ request, set, params }) => {
		const user = await requireUser(request);

		if (isNullish(user)) {
			return unauthenticated(set);
		}

		try {
			return await retractBattle({ battleId: params.battleId, callerId: user.id });
		} catch (err) {
			if (err instanceof BattleError) {
				return badRequest(set, err.message);
			}

			throw err;
		}
	});
