import type { ClearingDid } from '#declarations';
import { RESOLVED_RESULTS_RETENTION_MS } from '#lib/constants/app.constants.ts';
import { Collection } from '#lib/constants/collections.constants.ts';
import { ActivityType } from '#lib/enums/social.ts';
import { UserRole } from '#lib/enums/user.ts';
import type { ResolvedResult } from '#lib/types/social.ts';
import {
	controller,
	docBytes,
	hostNowMs,
	installSatelliteHost,
	storedDoc,
	type SatelliteHost
} from '#root/src/tests/mocks/satellite-host.mock.ts';
import {
	onActivitySetForResolvedResults,
	pruneResolvedResultsFn
} from '#satellite/services/resolved-results.services.ts';
import { candidMethod } from '#satellite/utils/candid.utils.ts';
import { Principal } from '@icp-sdk/core/principal';
import type { OnSetDocContext } from '@junobuild/functions';
import { getDocStore } from '@junobuild/functions/sdk';
import assert from 'node:assert/strict';
import { afterEach, beforeEach, describe, it } from 'node:test';

const settler = Principal.fromUint8Array(new Uint8Array([2, 2, 2]));
const participant = Principal.fromUint8Array(new Uint8Array([3, 3, 3]));

const seriesId = 'series-1';

const plan: ClearingDid.SettlementPlan = {
	status: { Finalised: null },
	idempotency_ns: { IcrcCreatedAtTimeNs: BigInt(1) },
	series_id: seriesId,
	fee_usd: BigInt(0),
	accounting_cursor: BigInt(0),
	insurance_fee_usd: BigInt(0),
	positions: [
		{
			user: participant,
			outcome_id: [],
			net_qty: BigInt(5),
			reserved_margin_usd: BigInt(0),
			cashflow_usd: BigInt(700)
		}
	],
	accounting_applied: true,
	balance_domain: { ViciXp: null },
	oracle_source: 'oracle',
	settlement: { Outcome: 'YES' }
};

/** The `onSetDoc` context of a settlement activity CREATE posted at `timestamp`. */
const settlementPosted = (timestamp: number): OnSetDocContext => {
	const activity = {
		user: settler.toText(),
		type: ActivityType.SETTLEMENT,
		marketId: seriesId,
		title: 'Market Resolved: YES',
		timestamp
	};

	return {
		caller: settler.toUint8Array(),
		data: {
			collection: Collection.ACTIVITIES,
			key: `${settler.toText()}#${timestamp}#${ActivityType.SETTLEMENT}`,
			data: {
				before: undefined,
				after: { ...storedDoc({ data: activity, owner: settler }), data: docBytes(activity) }
			}
		}
	};
};

describe('resolved-results.services', () => {
	let host: SatelliteHost;

	beforeEach(() => {
		host = installSatelliteHost();

		const { argTypes, result } = candidMethod({
			canister: 'clearing',
			method: 'get_settlement_plan'
		});

		host.onCall({ method: 'get_settlement_plan', argTypes, result, handler: () => [plan] });
	});

	afterEach(() => host.restore());

	describe('onActivitySetForResolvedResults', () => {
		const row = (): ResolvedResult | undefined =>
			host.readDoc<ResolvedResult>({
				collection: Collection.RESOLVED_RESULTS,
				key: `${participant.toText()}#${seriesId}`
			});

		const rowVersion = (): bigint | undefined =>
			getDocStore({
				collection: Collection.RESOLVED_RESULTS,
				key: `${participant.toText()}#${seriesId}`,
				caller: controller
			})?.version;

		it("keeps each participant's first resolution time and rewrites nothing when a settlement is posted again", async () => {
			await onActivitySetForResolvedResults(settlementPosted(hostNowMs));

			assert.equal(row()?.resolvedAtMs, hostNowMs);
			assert.equal(row()?.netVxp, 700);

			host.setNowMs(hostNowMs + 60_000);

			const versionBefore = rowVersion();

			await onActivitySetForResolvedResults(settlementPosted(hostNowMs + 60_000));

			assert.equal(row()?.resolvedAtMs, hostNowMs);
			assert.equal(rowVersion(), versionBefore);
		});
	});

	describe('pruneResolvedResultsFn', () => {
		const staleAtMs = hostNowMs - RESOLVED_RESULTS_RETENTION_MS - 1;

		const putRow = ({ marketId, resolvedAtMs }: { marketId: string; resolvedAtMs: number }) =>
			host.putDoc({
				collection: Collection.RESOLVED_RESULTS,
				key: `${participant.toText()}#${marketId}`,
				data: { owner: participant.toText(), marketId, resolvedAtMs },
				owner: controller
			});

		beforeEach(() => {
			host.putDoc({
				collection: Collection.ROLES,
				key: controller.toText(),
				data: { role: UserRole.ADMIN },
				owner: controller
			});

			for (let index = 0; index < 7; index++) {
				putRow({ marketId: `stale-${index}`, resolvedAtMs: staleAtMs });
			}

			putRow({ marketId: 'fresh-0', resolvedAtMs: hostNowMs });
			putRow({ marketId: 'fresh-1', resolvedAtMs: hostNowMs });
		});

		it('prunes stale rows a bounded batch per call until none is left', () => {
			assert.deepEqual(pruneResolvedResultsFn(), { pruned: 5 });
			assert.deepEqual(pruneResolvedResultsFn(), { pruned: 2 });
			assert.deepEqual(pruneResolvedResultsFn(), { pruned: 0 });
			assert.deepEqual(host.keys(Collection.RESOLVED_RESULTS).sort(), [
				`${participant.toText()}#fresh-0`,
				`${participant.toText()}#fresh-1`
			]);
		});

		it('refuses a caller who is not an admin', () => {
			host.setCaller(participant);

			assert.throws(() => pruneResolvedResultsFn(), /Only an admin/);
		});
	});
});
