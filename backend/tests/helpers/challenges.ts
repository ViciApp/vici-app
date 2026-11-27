// The fake engine and HTTP fixtures the challenge-link suites share: each
// principal's trade history, the registry's series, the series with a
// settlement plan, and players with a profile and a session.

import { isNullish } from '@dfinity/utils';
import { Principal } from '@icp-sdk/core/principal';
import { expect } from 'bun:test';
import { randomBytes } from 'node:crypto';
import { createSession } from '../../src/auth/sessions';
import { query } from '../../src/db/client';
import type { ClearingDid, ClearingService, RegistryService } from '../../src/declarations';
import { setEngineActorProvider } from '../../src/engine/actors';
import { app } from '../../src/index';
import { userIcPrincipalText } from '../../src/lib/keys';
import { DAY_IN_MS } from '../../src/lib/time';
import { friendRelationKey } from '../../src/social/relations';
import { createTestProfile } from './profiles';
import { stubVxpLedger, type LedgerStub } from './vxp';

export const NS_PER_MS = BigInt(1_000_000);

// The fake engine: each principal's trade history, the registry's series and
// the series with a settlement plan.
export const fills = new Map<string, ClearingDid.Event[]>();
const seriesById = new Map<
	string,
	{ expiryMs: number; binary: boolean; engineId: string; title: string }
>();
export const settledSeries = new Set<string>();
/** The series of each batched settlement read the fake engine answered. */
export const settlementReads: string[][] = [];
let nextEventId = 1;

const settlementView = (seriesId: string) => ({
	series_id: seriesId,
	status: { Planned: null },
	settlement: {
		Price: { decimal: { value: BigInt(1), decimals: 0 }, timestamp: [], oracle_id: [] }
	}
});

/** Installs the fake engine and a local VXP ledger (the trade trigger also
 * runs the award paths); `restore` puts both back. */
export const installChallengeEngine = (): { ledger: LedgerStub; restore: () => void } => {
	const ledger = stubVxpLedger();
	const restoreEngine = setEngineActorProvider({
		clearing: (identity) => {
			const principal = identity?.getPrincipal().toText();

			return Promise.resolve({
				get_trade_history: () =>
					Promise.resolve(fills.get(principal ?? '') ?? ([] as ClearingDid.Event[])),
				get_settlement_status: (seriesId: string) =>
					Promise.resolve(settledSeries.has(seriesId) ? [settlementView(seriesId)] : []),
				list_series_settlement_statuses: ({ series_ids }: { series_ids: string[] }) => {
					settlementReads.push(series_ids);

					return Promise.resolve(
						series_ids.map((seriesId) => ({
							series_id: seriesId,
							status: settledSeries.has(seriesId) ? [settlementView(seriesId)] : []
						}))
					);
				}
			} as unknown as ClearingService);
		},
		registry: () =>
			Promise.resolve({
				get_series: (seriesId: string) => {
					const series = seriesById.get(seriesId);

					return Promise.resolve(
						isNullish(series)
							? []
							: [
									{
										series_id: seriesId,
										title: series.title,
										engine_id: [series.engineId],
										payoff_type: series.binary ? { Binary: null } : { Linear: null },
										expiry_ns: BigInt(series.expiryMs) * NS_PER_MS
									}
								]
					);
				}
			} as unknown as RegistryService)
	});

	return {
		ledger,
		restore: () => {
			restoreEngine();
			ledger.restore();
		}
	};
};

export const newSeries = ({
	expiryMs = Date.now() + 30 * DAY_IN_MS,
	binary = true,
	engineId = 'eng_0',
	title = 'Will it happen?'
}: { expiryMs?: number; binary?: boolean; engineId?: string; title?: string } = {}): string => {
	const seriesId = `series-challenge-${randomBytes(6).toString('hex')}`;

	seriesById.set(seriesId, { expiryMs, binary, engineId, title });

	return seriesId;
};

/** An executed fill: positive qty buys YES at `priceCents`, negative takes
 * NO at one minus it. */
export const fill = ({
	userId,
	seriesId,
	qty,
	priceCents,
	atMs = Date.now()
}: {
	userId: string;
	seriesId: string;
	qty: number;
	priceCents: number;
	atMs?: number;
}): ClearingDid.Event => {
	const owner = userIcPrincipalText(userId);
	const event: ClearingDid.Event = {
		event_id: BigInt(nextEventId),
		series_id: seriesId,
		user: Principal.fromText(owner),
		clearing_id: Principal.anonymous(),
		qty: BigInt(qty),
		timestamp: BigInt(atMs) * NS_PER_MS,
		price: { timestamp: [], oracle_id: [], decimal: { value: BigInt(priceCents), decimals: 2 } },
		event_type: { Executed: null }
	};

	nextEventId += 1;
	fills.set(owner, [...(fills.get(owner) ?? []), event]);

	return event;
};

export const call = async ({
	method,
	path,
	token,
	body,
	ip
}: {
	method: 'GET' | 'POST' | 'PATCH' | 'DELETE';
	path: string;
	token?: string;
	body?: Record<string, unknown>;
	ip?: string;
}): Promise<Response> =>
	await app.handle(
		new Request(`http://localhost/api/v1/challenges${path}`, {
			method,
			headers: {
				...(isNullish(token) ? {} : { cookie: `vici_session=${token}` }),
				...(isNullish(body) ? {} : { 'content-type': 'application/json' }),
				...(isNullish(ip) ? {} : { 'fly-client-ip': ip })
			},
			...(isNullish(body) ? {} : { body: JSON.stringify(body) })
		})
	);

/** A unique client address per test, so the per-IP read window of one test
 * never meets another's. */
export const uniqueIp = (): string => `10.${[...randomBytes(3)].join('.')}`;

export interface Player {
	userId: string;
	token: string;
	handle: string;
}

export const player = async (): Promise<Player> => {
	const { userId, profile } = await createTestProfile();

	return { userId, token: await createSession(userId), handle: profile.nickname };
};

export interface OwnChallengeBody {
	id: string;
	seriesId: string;
	showIdentity: boolean;
	answerCount: number;
	position: { side: string; entryPriceBps: number; calledAtMs: number } | null;
	sideChanged: boolean;
	challenger: { handle: string } | null;
	marketOpen: boolean;
}

export const create = async ({
	who,
	seriesId,
	showIdentity = true
}: {
	who: Player;
	seriesId: string;
	showIdentity?: boolean;
}): Promise<OwnChallengeBody> => {
	const res = await call({
		method: 'POST',
		path: '/',
		token: who.token,
		body: { seriesId, showIdentity }
	});

	expect(res.status).toBe(200);

	return ((await res.json()) as { challenge: OwnChallengeBody }).challenge;
};

export const read = async (id: string): Promise<Response> =>
	await call({ method: 'GET', path: `/${id}`, ip: uniqueIp() });

export const readBody = async (id: string): Promise<Record<string, unknown>> => {
	const res = await read(id);

	expect(res.status).toBe(200);

	return ((await res.json()) as { challenge: Record<string, unknown> }).challenge;
};

export const relationOf = async (a: string, b: string): Promise<string | undefined> => {
	const rows = await query<{ state: string }>(`select state from relations where key = $1`, [
		friendRelationKey(a, b)
	]);

	return rows[0]?.state;
};

export const linkExists = async (id: string): Promise<boolean> =>
	(await query(`select 1 from challenge_links where id = $1`, [id])).length > 0;
