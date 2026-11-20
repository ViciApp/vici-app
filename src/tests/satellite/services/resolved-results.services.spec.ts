import type { ClearingDid } from '#declarations';
import { Collection } from '#lib/constants/collections.constants.ts';
import { RelationCategory, RelationState } from '#lib/enums/relation.ts';
import { ActivityType } from '#lib/enums/social.ts';
import type { ResolvedResult } from '#lib/types/social.ts';
import junoConfig from '#root/juno.config.ts';
import {
	controller,
	docBytes,
	hostNowMs,
	installSatelliteHost,
	storedDoc,
	type SatelliteHost
} from '#root/src/tests/mocks/satellite-host.mock.ts';
import {
	listFriendResolvedResultsFn,
	onActivitySetForResolvedResults
} from '#satellite/services/resolved-results.services.ts';
import { candidMethod } from '#satellite/utils/candid.utils.ts';
import { Principal } from '@icp-sdk/core/principal';
import type { OnSetDocContext } from '@junobuild/functions';
import { getDocStore } from '@junobuild/functions/sdk';
import assert from 'node:assert/strict';
import { afterEach, beforeEach, describe, it } from 'node:test';

const settler = Principal.fromUint8Array(new Uint8Array([2, 2, 2]));
const participant = Principal.fromUint8Array(new Uint8Array([3, 3, 3]));

const viewer = Principal.fromUint8Array(new Uint8Array([4, 4, 4]));
const friend = Principal.fromUint8Array(new Uint8Array([5, 5, 5]));
const hibernatedFriend = Principal.fromUint8Array(new Uint8Array([6, 6, 6]));
const deletedFriend = Principal.fromUint8Array(new Uint8Array([7, 7, 7]));
const pendingFriend = Principal.fromUint8Array(new Uint8Array([8, 8, 8]));
const stranger = Principal.fromUint8Array(new Uint8Array([9, 9, 9]));

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

	describe('listFriendResolvedResultsFn', () => {
		const everyone = [viewer, friend, hibernatedFriend, deletedFriend, pendingFriend, stranger];

		const befriend = ({ other, state }: { other: Principal; state: RelationState }) =>
			host.putDoc({
				collection: Collection.RELATIONS,
				key: [viewer.toText(), other.toText()].sort().join('#'),
				data: {
					category: RelationCategory.FRIEND,
					state,
					participants: [viewer.toText(), other.toText()]
				},
				owner: controller
			});

		const owners = (requested: Principal[]): string[] => {
			host.setCaller(viewer);

			return listFriendResolvedResultsFn({ friends: requested.map((p) => p.toText()) })
				.map(({ owner }) => owner)
				.sort();
		};

		beforeEach(() => {
			for (const principal of everyone) {
				const owner = principal.toText();
				const hidden =
					principal === hibernatedFriend
						? { hibernatedAtMs: hostNowMs }
						: principal === deletedFriend
							? { deletedAtMs: hostNowMs }
							: {};

				host.putDoc({
					collection: Collection.PROFILES,
					key: owner,
					data: { owner, ...hidden },
					owner: principal
				});
				host.putDoc({
					collection: Collection.RESOLVED_RESULTS,
					key: `${owner}#${seriesId}`,
					data: {
						owner,
						marketId: seriesId,
						title: 'Market',
						side: 'YES',
						outcome: 'win',
						netVxp: 1,
						resolvedAtMs: hostNowMs
					},
					owner: controller
				});
			}

			for (const other of [friend, hibernatedFriend, deletedFriend]) {
				befriend({ other, state: RelationState.ACTIVE });
			}

			befriend({ other: pendingFriend, state: RelationState.PENDING });
		});

		it("answers the caller's own rows and those of their active, visible friends only", () => {
			assert.deepEqual(owners(everyone), [viewer.toText(), friend.toText()].sort());
		});

		it('answers nothing for an account that is not an active friend', () => {
			assert.deepEqual(owners([stranger, pendingFriend]), []);
		});

		it('answers nothing for a hibernated or deleted friend', () => {
			assert.deepEqual(owners([hibernatedFriend, deletedFriend]), []);
		});

		it('keeps resolved results readable by controllers only', () => {
			for (const mode of ['production', 'development']) {
				const rule = junoConfig({ mode }).satellite.collections?.datastore?.find(
					({ collection }) => collection === Collection.RESOLVED_RESULTS
				);

				assert.equal(rule?.read, 'controllers');
			}
		});
	});
});
