// League ids are client-minted, so a disbanded league's id can come back: the
// cover a gone league left in storage is never served under it, and an id
// that battles or a tournament bracket still name stays taken.

import { beforeAll, describe, expect, test } from 'bun:test';
import { randomBytes } from 'node:crypto';
import { existsSync } from 'node:fs';
import sharp from 'sharp';
import { createSession } from '../src/auth/sessions';
import { query } from '../src/db/client';
import { app } from '../src/index';
import { proposeBattle } from '../src/leagues/battles';
import { locateLeagueImage, uploadLeagueImage } from '../src/leagues/images';
import { createLeague, deleteLeague } from '../src/leagues/leagues';
import { createTestUser, ensureMigrated } from './helpers/auth';
import { dbAvailable } from './helpers/setup';

const DAY_MS = 24 * 60 * 60 * 1000;

// A month no real draw ever uses, so the seeded bracket cannot meet a
// tournament another suite draws; the test removes it again.
const RESERVED_TOURNAMENT_ID = '1970-01';

const uniqueLeagueId = (): string => `reuse-${randomBytes(6).toString('hex')}`;

const samplePng = (): Promise<Buffer> =>
	sharp({
		create: { width: 300, height: 300, channels: 3, background: { r: 200, g: 40, b: 40 } }
	})
		.png()
		.toBuffer();

const postLeague = async ({ ownerId, id }: { ownerId: string; id: string }): Promise<Response> =>
	await app.handle(
		new Request('http://localhost/api/v1/leagues/', {
			method: 'POST',
			headers: {
				cookie: `vici_session=${await createSession(ownerId)}`,
				'content-type': 'application/json'
			},
			body: JSON.stringify({ id, name: 'Reused League' })
		})
	);

const disbandedLeagueId = async (ownerId: string): Promise<string> => {
	const league = await createLeague({ id: uniqueLeagueId(), name: 'First', ownerUserId: ownerId });

	await deleteLeague({ leagueId: league.id, callerId: ownerId });

	return league.id;
};

describe.if(dbAvailable)('league id reuse after a disband', () => {
	beforeAll(async () => {
		await ensureMigrated();
	});

	test('a cover left in storage by a gone league is not served, not even to a new league under its id', async () => {
		const ownerId = await createTestUser();
		const league = await createLeague({
			id: uniqueLeagueId(),
			name: 'Covered',
			ownerUserId: ownerId
		});

		await uploadLeagueImage({ leagueId: league.id, callerId: ownerId, bytes: await samplePng() });

		const stored = await locateLeagueImage(league.id);

		if (stored.kind !== 'file') {
			throw new Error('cover not stored');
		}

		await deleteLeague({ leagueId: league.id, callerId: ownerId });

		expect(existsSync(stored.path)).toBe(true);
		expect((await locateLeagueImage(league.id)).kind).toBe('missing');

		const res = await postLeague({ ownerId: await createTestUser(), id: league.id });

		expect(res.status).toBe(201);
		expect((await locateLeagueImage(league.id)).kind).toBe('missing');
		expect(
			(await app.handle(new Request(`http://localhost/api/v1/leagues/${league.id}/image`))).status
		).toBe(404);
	});

	test('a cover the league row no longer carries is not served', async () => {
		const ownerId = await createTestUser();
		const league = await createLeague({
			id: uniqueLeagueId(),
			name: 'Cleared',
			ownerUserId: ownerId
		});

		await uploadLeagueImage({ leagueId: league.id, callerId: ownerId, bytes: await samplePng() });

		// What a cover delete whose storage call failed leaves behind: the row
		// is cleared, the object is still there.
		await query(`update leagues set image_url = null where id = $1`, [league.id]);

		expect((await locateLeagueImage(league.id)).kind).toBe('missing');
	});

	test('an id a battle still names stays taken', async () => {
		const ownerId = await createTestUser();
		const sideA = await createLeague({
			id: uniqueLeagueId(),
			name: 'Side A',
			ownerUserId: ownerId
		});
		const sideB = await createLeague({
			id: uniqueLeagueId(),
			name: 'Side B',
			ownerUserId: await createTestUser(),
			privacy: 'open'
		});
		const nowMs = Date.now();

		await proposeBattle({
			id: `battle-${randomBytes(6).toString('hex')}`,
			kind: 'league',
			sideA: sideA.id,
			sideB: sideB.id,
			proposerUserId: ownerId,
			kickoffMs: nowMs + DAY_MS,
			settleMs: nowMs + 2 * DAY_MS
		});
		await deleteLeague({ leagueId: sideB.id, callerId: sideB.ownerUserId });

		await expect(
			createLeague({ id: sideB.id, name: 'Impostor', ownerUserId: await createTestUser() })
		).rejects.toThrow('already exists');

		const res = await postLeague({ ownerId: await createTestUser(), id: sideB.id });

		expect(res.status).toBe(400);
	});

	test('an id a tournament bracket still names stays taken', async () => {
		const ownerId = await createTestUser();
		const leagueId = await disbandedLeagueId(ownerId);

		await query(
			`insert into tournaments (id, month_start_ms, month_end_ms, bracket_size, state,
			   seeded_league_ids, created_at_ms)
			 values ($1, 0, 1, 8, 'concluded', '[]', 0)`,
			[RESERVED_TOURNAMENT_ID]
		);
		await query(
			`insert into tournament_matches (tournament_id, round, index, from_league_id, start_ms, end_ms)
			 values ($1, 'r1', 0, $2, 0, 1)`,
			[RESERVED_TOURNAMENT_ID, leagueId]
		);

		try {
			await expect(
				createLeague({ id: leagueId, name: 'Again', ownerUserId: ownerId })
			).rejects.toThrow('already exists');
		} finally {
			await query(`delete from tournaments where id = $1`, [RESERVED_TOURNAMENT_ID]);
		}
	});

	test('an id nothing else names can be founded again', async () => {
		const ownerId = await createTestUser();
		const leagueId = await disbandedLeagueId(ownerId);

		const league = await createLeague({ id: leagueId, name: 'Again', ownerUserId: ownerId });

		expect(league.id).toBe(leagueId);
	});
});
