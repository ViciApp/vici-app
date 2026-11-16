// The propose route's input contract: numbers bound for the integer columns
// are refused as a 400 before they reach Postgres, and a replayed id answers
// a 409 that leaves the first proposal untouched.

import { beforeAll, describe, expect, test } from 'bun:test';
import { randomUUID } from 'node:crypto';
import { createSession } from '../src/auth/sessions';
import { app } from '../src/index';
import { getBattle } from '../src/leagues/battles';
import { createLeague } from '../src/leagues/leagues';
import { createTestUser, ensureMigrated } from './helpers/auth';
import { dbAvailable } from './helpers/setup';

const DAY_MS = 24 * 60 * 60 * 1000;

const postProposal = async ({
	cookie,
	body
}: {
	cookie: string;
	body: Record<string, unknown>;
}): Promise<Response> =>
	await app.handle(
		new Request('http://localhost/api/v1/battles/', {
			method: 'POST',
			headers: { cookie, 'content-type': 'application/json' },
			body: JSON.stringify(body)
		})
	);

const seedProposal = async (): Promise<{ cookie: string; body: Record<string, unknown> }> => {
	const ownerId = await createTestUser();
	const sideA = await createLeague({ id: randomUUID(), name: 'Side A', ownerUserId: ownerId });
	const sideB = await createLeague({
		id: randomUUID(),
		name: 'Side B',
		ownerUserId: await createTestUser(),
		privacy: 'open'
	});
	const nowMs = Date.now();

	return {
		cookie: `vici_session=${await createSession(ownerId)}`,
		body: {
			kind: 'league',
			sideA: sideA.id,
			sideB: sideB.id,
			kickoffMs: nowMs + DAY_MS,
			settleMs: nowMs + 2 * DAY_MS
		}
	};
};

describe.if(dbAvailable)('battle propose route input', () => {
	beforeAll(async () => {
		await ensureMigrated();
	});

	test('answers 400 for a fractional or unsafe number and writes nothing', async () => {
		const { cookie, body } = await seedProposal();
		const kickoffMs = Number(body.kickoffMs);
		const settleMs = Number(body.settleMs);

		for (const override of [
			{ amount: 1.5 },
			{ wager: 2.5 },
			{ amount: 501 },
			{ kickoffMs: kickoffMs + 0.5 },
			{ settleMs: settleMs + 0.5 },
			{ kickoffMs: 1e300, settleMs: 2e300 }
		]) {
			const id = randomUUID();
			const res = await postProposal({ cookie, body: { ...body, ...override, id } });

			expect(res.status).toBe(400);
			expect(await getBattle(id)).toBeUndefined();
		}
	});

	test('answers 409 for an id already taken and keeps the first battle', async () => {
		const { cookie, body } = await seedProposal();
		const id = randomUUID();

		expect((await postProposal({ cookie, body: { ...body, id, amount: 100 } })).status).toBe(201);

		const replay = await postProposal({ cookie, body: { ...body, id, amount: 200 } });

		expect(replay.status).toBe(409);
		expect(await replay.json()).toEqual({ error: 'battle_exists' });
		expect((await getBattle(id))?.amount).toBe(100);
	});
});
