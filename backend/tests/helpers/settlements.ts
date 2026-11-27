// A recording clearing stub for the suites that score settled history (the
// Worlds podium, tournament matches): `aggregate_settlement_accuracy`
// answers from the settlements a test records, honouring the requested
// members and the half-open [from_ts, to_ts) window the way clearing does,
// so a score outside the window or for a principal nobody asked for never
// counts.

import { isNullish } from '@dfinity/utils';
import { Principal } from '@icp-sdk/core/principal';
import type { ClearingDid, ClearingService, RegistryService } from '../../src/declarations';
import { setEngineActorProvider } from '../../src/engine/actors';
import { userIcPrincipalText } from '../../src/lib/keys';
import { msToNs } from '../../src/lib/time';

interface RecordedSettlement {
	principal: string;
	atMs: number;
	calls: number;
	wins: number;
}

export interface SettledHistoryStub {
	/** Record `calls` settled positions (`wins` of them net positive) for a
	 * user's custodial principal at `atMs`. */
	settle: (settlement: { userId: string; atMs: number; calls: number; wins: number }) => void;
	/** Record settled positions for any principal, such as a linked legacy one. */
	settlePrincipal: (settlement: RecordedSettlement) => void;
	/** Make every accuracy read that asks for this user's principal fail, the
	 * way an unreachable or trapping clearing canister answers. */
	failReadsFor: (userId: string) => void;
	/** How many accuracy reads clearing answered. */
	reads: () => number;
	restore: () => void;
}

export const stubSettledHistory = (): SettledHistoryStub => {
	const settlements: RecordedSettlement[] = [];
	const failingPrincipals = new Set<string>();
	let readCount = 0;

	const aggregate = (
		params: ClearingDid.AggregateSettlementAccuracyParams
	): ClearingDid.SettlementAccuracyEntry[] => {
		readCount += 1;

		const wanted = new Set(params.members.map((member) => member.toText()));

		if ([...wanted].some((principal) => failingPrincipals.has(principal))) {
			throw new Error('clearing unavailable');
		}

		const [fromNs] = params.from_ts;
		const [toNs] = params.to_ts;
		const byPrincipal = new Map<string, { calls: number; wins: number }>();

		for (const { principal, atMs, calls, wins } of settlements) {
			const atNs = msToNs(atMs);
			const inWindow = (isNullish(fromNs) || atNs >= fromNs) && (isNullish(toNs) || atNs < toNs);

			if (wanted.has(principal) && inWindow) {
				const previous = byPrincipal.get(principal) ?? { calls: 0, wins: 0 };

				byPrincipal.set(principal, {
					calls: previous.calls + calls,
					wins: previous.wins + wins
				});
			}
		}

		return [...byPrincipal].map(([principal, { calls, wins }]) => ({
			principal: Principal.fromText(principal),
			realized_pnl: BigInt(0),
			settled_count: BigInt(calls),
			win_count: BigInt(wins)
		}));
	};

	const restore = setEngineActorProvider({
		clearing: () =>
			Promise.resolve({
				aggregate_settlement_accuracy: (params: ClearingDid.AggregateSettlementAccuracyParams) =>
					Promise.resolve(aggregate(params))
			} as unknown as ClearingService),
		registry: () => Promise.resolve({} as unknown as RegistryService)
	});

	return {
		settle: ({ userId, atMs, calls, wins }) => {
			settlements.push({ principal: userIcPrincipalText(userId), atMs, calls, wins });
		},
		settlePrincipal: (settlement) => {
			settlements.push(settlement);
		},
		failReadsFor: (userId) => {
			failingPrincipals.add(userIcPrincipalText(userId));
		},
		reads: () => readCount,
		restore
	};
};
