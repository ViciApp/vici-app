import { Collection } from '#lib/constants/collections.constants.ts';
import {
	VXP_LEAGUE_FOUNDER_MAX_AWARDS,
	VXP_LEAGUE_FOUNDER_REWARD_BASE_UNITS
} from '#lib/constants/vxp-economy.constants.ts';
import type { LeagueMemberDoc } from '#lib/types/league-member.ts';
import type { LeagueDoc } from '#lib/types/league.ts';
import { vxpAwardKey, type VxpAwardDoc } from '#lib/types/vxp-award.ts';
import {
	docBytes,
	installSatelliteHost,
	type SatelliteHost
} from '#root/src/tests/mocks/satellite-host.mock.ts';
import { assertDeleteDoc, assertSetDoc } from '#satellite/index.ts';
import {
	onLeagueSetForFounderVxpPayout,
	settleFounderAwardsFn
} from '#satellite/services/vxp-league-founder-awards.services.ts';
import { Principal } from '@icp-sdk/core/principal';
import type { OnSetDocContext } from '@junobuild/functions';
import { IcrcLedgerIdl } from '@junobuild/functions/canisters/ledger/icrc';
import assert from 'node:assert/strict';
import { afterEach, beforeEach, describe, it } from 'node:test';

const founder = Principal.fromUint8Array(new Uint8Array([2, 2, 2]));
const other = Principal.fromUint8Array(new Uint8Array([3, 3, 3]));

const league = ({ id, owner = founder }: { id: string; owner?: Principal }): LeagueDoc => ({
	id,
	name: id,
	owner: owner.toText(),
	createdAtMs: 1
});

const hookDoc = (data: object) => ({
	owner: founder.toUint8Array(),
	data: docBytes(data),
	created_at: 1n,
	updated_at: 1n,
	version: 1n
});

const leagueWrite = ({
	doc,
	caller = founder,
	before
}: {
	doc: LeagueDoc;
	caller?: Principal;
	before?: LeagueDoc;
}): OnSetDocContext => ({
	caller: caller.toUint8Array(),
	data: {
		collection: Collection.LEAGUES,
		key: doc.id,
		data: { before: before && hookDoc(before), after: hookDoc(doc) }
	}
});

const founderAwardKey = (leagueId: string): string =>
	vxpAwardKey({ recipient: founder.toText(), awardType: 'league_founder', awardKey: leagueId });

describe('vxp-league-founder-awards.services', () => {
	let host: SatelliteHost;
	let transferResult: object;

	const transfers = (): number =>
		host.calls().filter((method) => method === 'icrc1_transfer').length;

	const readAward = (leagueId: string): VxpAwardDoc | undefined =>
		host.readDoc<VxpAwardDoc>({
			collection: Collection.VXP_AWARDS,
			key: founderAwardKey(leagueId)
		});

	beforeEach(() => {
		// The real asserts run on every serverless write, as on the satellite.
		host = installSatelliteHost({
			asserts: { set: assertSetDoc.assert, remove: assertDeleteDoc.assert }
		});
		transferResult = { Ok: BigInt(7) };
		host.onCall({
			method: 'icrc1_transfer',
			argTypes: [IcrcLedgerIdl.TransferArg],
			result: IcrcLedgerIdl.TransferResult,
			handler: () => transferResult
		});
	});

	afterEach(() => host.restore());

	describe('onLeagueSetForFounderVxpPayout', () => {
		it('pays the founder once for the league they create', async () => {
			await onLeagueSetForFounderVxpPayout(leagueWrite({ doc: league({ id: 'alpha' }) }));

			const award = readAward('alpha');

			assert.equal(transfers(), 1);
			assert.equal(award?.status, 'paid');
			assert.equal(award?.blockIndex, '7');
			assert.equal(award?.amountBaseUnits, VXP_LEAGUE_FOUNDER_REWARD_BASE_UNITS.toString());
		});

		it('pays nothing more when the creation write is seen twice', async () => {
			const write = leagueWrite({ doc: league({ id: 'alpha' }) });

			await onLeagueSetForFounderVxpPayout(write);
			await onLeagueSetForFounderVxpPayout(write);

			assert.equal(transfers(), 1);
			assert.equal(readAward('alpha')?.status, 'paid');
		});

		it('pays nothing for an edit of an existing league', async () => {
			const doc = league({ id: 'alpha' });

			await onLeagueSetForFounderVxpPayout(leagueWrite({ doc, before: doc }));

			assert.equal(transfers(), 0);
			assert.deepEqual(host.keys(Collection.VXP_AWARDS), []);
		});

		it('pays nothing when the writer is not the league owner', async () => {
			await onLeagueSetForFounderVxpPayout(
				leagueWrite({ doc: league({ id: 'alpha', owner: other }), caller: founder })
			);

			assert.equal(transfers(), 0);
			assert.deepEqual(host.keys(Collection.VXP_AWARDS), []);
		});

		it('pays nothing once the account has reached the lifetime cap', async () => {
			for (let i = 0; i < VXP_LEAGUE_FOUNDER_MAX_AWARDS; i++) {
				const leagueId = `paid-${i}`;
				const paid: VxpAwardDoc = {
					recipient: founder.toText(),
					awardType: 'league_founder',
					awardKey: leagueId,
					amountBaseUnits: VXP_LEAGUE_FOUNDER_REWARD_BASE_UNITS.toString(),
					status: 'paid',
					earnedAtMs: 1,
					paidAtMs: 1,
					blockIndex: '1'
				};

				host.putDoc({
					collection: Collection.VXP_AWARDS,
					key: founderAwardKey(leagueId),
					data: paid,
					owner: founder
				});
			}

			await onLeagueSetForFounderVxpPayout(leagueWrite({ doc: league({ id: 'one-too-many' }) }));

			assert.equal(transfers(), 0);
			assert.equal(readAward('one-too-many'), undefined);
		});

		it('records a refused transfer as failed, with the ledger error', async () => {
			transferResult = { Err: { TemporarilyUnavailable: null } };

			await onLeagueSetForFounderVxpPayout(leagueWrite({ doc: league({ id: 'alpha' }) }));

			const award = readAward('alpha');

			assert.equal(award?.status, 'failed');
			assert.match(award?.errorMessage ?? '', /TemporarilyUnavailable/);
			assert.equal(award?.blockIndex, undefined);
		});
	});

	describe('settleFounderAwardsFn', () => {
		const own = (leagueId: string): void => {
			host.putDoc({
				collection: Collection.LEAGUES,
				key: leagueId,
				data: league({ id: leagueId }),
				owner: founder
			});

			const member: LeagueMemberDoc = {
				leagueId,
				member: founder.toText(),
				joinedAtMs: 1,
				role: 'owner'
			};

			host.putDoc({
				collection: Collection.LEAGUE_MEMBERS,
				key: `${leagueId}/${founder.toText()}`,
				data: member,
				owner: founder
			});
		};

		it('pays every owned league that has no founder award yet, once', async () => {
			own('alpha');
			own('beta');
			host.setCaller(founder);

			assert.deepEqual(await settleFounderAwardsFn(), { settled: 2 });
			assert.deepEqual(await settleFounderAwardsFn(), { settled: 0 });

			assert.equal(transfers(), 2);
			assert.equal(readAward('alpha')?.status, 'paid');
			assert.equal(readAward('beta')?.status, 'paid');
		});

		it('skips a league the hook already paid', async () => {
			own('alpha');
			await onLeagueSetForFounderVxpPayout(leagueWrite({ doc: league({ id: 'alpha' }) }));
			host.setCaller(founder);

			assert.deepEqual(await settleFounderAwardsFn(), { settled: 0 });
			assert.equal(transfers(), 1);
		});

		it('pays nothing to an anonymous caller', async () => {
			own('alpha');
			host.setCaller(Principal.anonymous());

			assert.deepEqual(await settleFounderAwardsFn(), { settled: 0 });
			assert.equal(transfers(), 0);
		});
	});
});
