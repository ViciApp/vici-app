// Settlement activities through the HTTP route: only a settling role may
// post one, the resolved-results fan-out it triggers takes every title from
// the registry and keeps the first resolution time on a replay, and the
// title and details are bounded.

import { toNullable } from '@dfinity/utils';
import { Principal } from '@icp-sdk/core/principal';
import { afterEach, beforeAll, describe, expect, setSystemTime, test } from 'bun:test';
import { randomUUID } from 'node:crypto';
import { createSession } from '../src/auth/sessions';
import { query } from '../src/db/client';
import type { ClearingDid, ClearingService, RegistryService } from '../src/declarations';
import { setEngineActorProvider } from '../src/engine/actors';
import { clearCache } from '../src/engine/cache';
import { app } from '../src/index';
import { ZERO } from '../src/lib/constants';
import { userIcPrincipalText } from '../src/lib/keys';
import { HOUR_IN_MS } from '../src/lib/time';
import { ACTIVITY_DETAILS_MAX_LENGTH, ACTIVITY_TITLE_MAX_LENGTH } from '../src/social/activities';
import { createTestUser, ensureMigrated } from './helpers/auth';
import { dbAvailable } from './helpers/setup';

let restore: (() => void) | undefined;

afterEach(() => {
	restore?.();
	restore = undefined;
	clearCache();
	setSystemTime();
});

/** A user with a custodial ic account, so the fan-out can map the on-chain
 * participant back to them. */
const createParticipant = async (): Promise<string> => {
	const userId = await createTestUser();

	await query(`insert into custody_accounts (user_id, chain, address) values ($1, 'ic', $2)`, [
		userId,
		userIcPrincipalText(userId)
	]);

	return userId;
};

const createUserWithRole = async (role: 'user' | 'admin' | 'solver'): Promise<string> => {
	const userId = await createTestUser();

	await query(`update users set role = $2 where id = $1`, [userId, role]);

	return userId;
};

const settlementPlan = ({
	marketId,
	participants
}: {
	marketId: string;
	participants: string[];
}): ClearingDid.SettlementPlan => ({
	status: { Finalised: null },
	idempotency_ns: { IcrcCreatedAtTimeNs: ZERO },
	series_id: marketId,
	fee_usd: ZERO,
	accounting_cursor: ZERO,
	insurance_fee_usd: ZERO,
	positions: participants.map((userId) => ({
		user: Principal.fromText(userIcPrincipalText(userId)),
		outcome_id: [],
		net_qty: 10n,
		reserved_margin_usd: ZERO,
		cashflow_usd: 25n
	})),
	accounting_applied: true,
	balance_domain: { ViciXp: null },
	oracle_source: 'VICI_ORACLE_V1',
	settlement: { Outcome: 'yes' }
});

const mockEngine = ({
	marketId,
	participants,
	seriesTitle
}: {
	marketId: string;
	participants: string[];
	seriesTitle: () => string | Error;
}): void => {
	restore = setEngineActorProvider({
		clearing: () =>
			Promise.resolve({
				get_settlement_plan: (seriesId: string) =>
					Promise.resolve(
						toNullable(
							seriesId === marketId ? settlementPlan({ marketId, participants }) : undefined
						)
					)
			} as unknown as ClearingService),
		registry: () =>
			Promise.resolve({
				get_series: () => {
					const title = seriesTitle();

					return title instanceof Error
						? Promise.reject(title)
						: Promise.resolve(toNullable({ title }));
				}
			} as unknown as RegistryService)
	});
};

const postActivity = async ({
	userId,
	body
}: {
	userId: string;
	body: Record<string, unknown>;
}): Promise<Response> => {
	const token = await createSession(userId);

	return await app.handle(
		new Request('http://localhost/api/v1/social/activities', {
			method: 'POST',
			headers: { cookie: `vici_session=${token}`, 'content-type': 'application/json' },
			body: JSON.stringify(body)
		})
	);
};

const postSettlement = async ({
	userId,
	marketId,
	title = 'Market Resolved: YES'
}: {
	userId: string;
	marketId: string;
	title?: string;
}): Promise<Response> =>
	await postActivity({
		userId,
		body: {
			type: 'settlement',
			marketId,
			title,
			details: JSON.stringify({ outcome: 'YES', price: '100' }),
			timestamp: Date.now()
		}
	});

interface Row {
	user_id: string;
	title: string;
	resolved_at_ms: string;
}

const rowsFor = async (marketId: string): Promise<Row[]> =>
	await query<Row>(
		`select user_id, title, resolved_at_ms::text from resolved_results
		 where market_id = $1 order by user_id`,
		[marketId]
	);

// The fan-out is detached from the activity write, so the rows land shortly
// after the response.
const waitForRows = async ({
	marketId,
	until
}: {
	marketId: string;
	until: (rows: Row[]) => boolean;
}): Promise<Row[]> => {
	const deadline = Date.now() + 5_000;

	for (;;) {
		const rows = await rowsFor(marketId);

		if (until(rows) || Date.now() > deadline) {
			return rows;
		}

		await Bun.sleep(25);
	}
};

// Long enough for a detached fan-out against the in-memory mocks to finish,
// so the absence of rows means none was written.
const FAN_OUT_SETTLE_MS = 500;

describe.if(dbAvailable)('settlement activities', () => {
	beforeAll(async () => {
		await ensureMigrated();
	});

	const uniqueMarketId = (): string => `srs_settle_${randomUUID()}`;

	test('a settling role records the settlement and fans out a row per participant', async () => {
		const marketId = uniqueMarketId();
		const participants = [await createParticipant(), await createParticipant()];

		mockEngine({ marketId, participants, seriesTitle: () => 'Will it rain?' });

		for (const role of ['admin', 'solver'] as const) {
			const res = await postSettlement({ userId: await createUserWithRole(role), marketId });

			expect(res.status).toBe(201);
		}

		const rows = await waitForRows({ marketId, until: (found) => found.length === 2 });

		expect(rows.map((row) => row.user_id)).toEqual([...participants].sort());
		expect(rows.every((row) => row.title === 'Will it rain?')).toBe(true);
	});

	test('a user without a settling role cannot post a settlement', async () => {
		const marketId = uniqueMarketId();
		const participant = await createParticipant();

		mockEngine({ marketId, participants: [participant], seriesTitle: () => 'Will it rain?' });

		for (const userId of [await createUserWithRole('user'), participant]) {
			const res = await postSettlement({ userId, marketId });

			expect(res.status).toBe(403);
		}

		await Bun.sleep(FAN_OUT_SETTLE_MS);

		expect(await rowsFor(marketId)).toEqual([]);

		const activities = await query<{ key: string }>(
			`select key from activities where market_id = $1`,
			[marketId]
		);

		expect(activities).toEqual([]);
	});

	test('a second settlement post keeps every resolution time', async () => {
		const marketId = uniqueMarketId();
		const participants = [await createParticipant(), await createParticipant()];
		const admin = await createUserWithRole('admin');
		let seriesTitle = 'First title';

		mockEngine({ marketId, participants, seriesTitle: () => seriesTitle });

		expect((await postSettlement({ userId: admin, marketId })).status).toBe(201);

		const first = await waitForRows({ marketId, until: (found) => found.length === 2 });

		expect(first).toHaveLength(2);

		// A distinct title tells the second fan-out's rows apart from the
		// first, and the clock moves so a re-stamp would show.
		seriesTitle = 'Second title';
		clearCache();
		setSystemTime(new Date(Date.now() + HOUR_IN_MS));

		expect((await postSettlement({ userId: admin, marketId })).status).toBe(201);

		const second = await waitForRows({
			marketId,
			until: (found) => found.every((row) => row.title === 'Second title')
		});

		expect(second.map((row) => row.title)).toEqual(['Second title', 'Second title']);
		expect(second.map((row) => row.resolved_at_ms)).toEqual(first.map((row) => row.resolved_at_ms));
	});

	test('a failed series lookup writes no row rather than the posted title', async () => {
		const marketId = uniqueMarketId();
		const participant = await createParticipant();

		mockEngine({
			marketId,
			participants: [participant],
			seriesTitle: () => new Error('registry unavailable')
		});

		const res = await postSettlement({
			userId: await createUserWithRole('admin'),
			marketId,
			title: 'Client supplied title'
		});

		expect(res.status).toBe(201);

		await Bun.sleep(FAN_OUT_SETTLE_MS);

		expect(await rowsFor(marketId)).toEqual([]);
	});

	test('an overlong title or details is refused', async () => {
		const userId = await createTestUser();
		const base = { type: 'comment', title: 'c', timestamp: Date.now() };

		const longTitle = await postActivity({
			userId,
			body: { ...base, title: 'x'.repeat(ACTIVITY_TITLE_MAX_LENGTH + 1) }
		});

		expect(longTitle.status).toBe(400);

		const longDetails = await postActivity({
			userId,
			body: { ...base, details: 'x'.repeat(ACTIVITY_DETAILS_MAX_LENGTH + 1) }
		});

		expect(longDetails.status).toBe(400);

		const atLimit = await postActivity({
			userId,
			body: {
				...base,
				title: 'x'.repeat(ACTIVITY_TITLE_MAX_LENGTH),
				details: 'x'.repeat(ACTIVITY_DETAILS_MAX_LENGTH)
			}
		});

		expect(atLimit.status).toBe(201);
	});
});
