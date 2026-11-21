import { Collection } from '#lib/constants/collections.constants.ts';
import { HOUR_IN_MS } from '#lib/constants/time.constants.ts';
import { LeaguePrivacy } from '#lib/enums/league.ts';
import { leagueMemberKey, type LeagueMemberDoc } from '#lib/types/league-member.ts';
import { LEAGUE_INVITE_CODE_LENGTH } from '#lib/types/league.ts';
import junoConfig from '#root/juno.config.ts';
import {
	hostNowMs,
	installSatelliteHost,
	type SatelliteHost
} from '#root/src/tests/mocks/satellite-host.mock.ts';
import { assertDeleteDoc, assertSetDoc } from '#satellite/index.ts';
import { hardDeleteAccountFn } from '#satellite/services/account.services.ts';
import { lookupLeagueByInviteFn } from '#satellite/services/cohort.services.ts';
import { LEAGUE_INVITE_MISSES_PER_HOUR } from '#satellite/services/league-invite-cap.services.ts';
import { recordLeagueInvite } from '#satellite/services/league-invite.services.ts';
import { createLeagueFn, joinLeagueByInviteFn } from '#satellite/services/league.services.ts';
import { Principal } from '@icp-sdk/core/principal';
import { IcrcLedgerIdl } from '@junobuild/functions/canisters/ledger/icrc';
import assert from 'node:assert/strict';
import { afterEach, beforeEach, describe, it } from 'node:test';

const owner = Principal.fromUint8Array(new Uint8Array([2, 2, 2]));
const joiner = Principal.fromUint8Array(new Uint8Array([3, 3, 3]));
const other = Principal.fromUint8Array(new Uint8Array([4, 4, 4]));

const leagueId = 'the-league-1700000000000';
const inviteCode = 'NEWCODE123';

/** A well-formed code no league holds; `index` keeps each one distinct. */
const wrongCode = (index: number): string => `WRONG${String(index).padStart(5, '0')}`;

describe('league invite attempts', () => {
	let host: SatelliteHost;

	const lookup = ({ principal, code }: { principal: Principal; code: string }) => {
		host.setCaller(principal);

		return lookupLeagueByInviteFn({ inviteCode: code });
	};

	const join = ({ principal, code }: { principal: Principal; code: string }) => {
		host.setCaller(principal);

		return joinLeagueByInviteFn({ inviteCode: code });
	};

	const membership = (member: Principal): LeagueMemberDoc | undefined =>
		host.readDoc<LeagueMemberDoc>({
			collection: Collection.LEAGUE_MEMBERS,
			key: leagueMemberKey({ leagueId, memberPrincipal: member.toText() })
		});

	const missUpToTheCap = (principal: Principal) => {
		for (let index = 0; index < LEAGUE_INVITE_MISSES_PER_HOUR; index++) {
			assert.equal(lookup({ principal, code: wrongCode(index) }).league, undefined);
		}
	};

	beforeEach(async () => {
		host = installSatelliteHost({
			asserts: { set: assertSetDoc.assert, remove: assertDeleteDoc.assert }
		});
		host.onCall({
			method: 'icrc1_transfer',
			argTypes: [IcrcLedgerIdl.TransferArg],
			result: IcrcLedgerIdl.TransferResult,
			handler: () => ({ Ok: BigInt(7) })
		});

		host.setCaller(owner);
		await createLeagueFn({
			id: leagueId,
			name: 'The League',
			privacy: LeaguePrivacy.PRIVATE,
			inviteCode
		});
	});

	afterEach(() => host.restore());

	describe('invite code length', () => {
		it('founds a league with a code of the new length', () => {
			assert.equal(inviteCode.length, LEAGUE_INVITE_CODE_LENGTH);
			assert.equal(lookup({ principal: joiner, code: inviteCode }).league?.id, leagueId);
		});

		it('refuses founding a league with a code of the older, shorter length', async () => {
			host.setCaller(owner);

			await assert.rejects(
				createLeagueFn({ id: 'short-1700000000001', name: 'Short', inviteCode: 'ABC123' }),
				/inviteCode/
			);
		});

		it('keeps the shorter code of an older league working', () => {
			const olderId = 'older-1600000000000';

			host.putDoc({
				collection: Collection.LEAGUES,
				key: olderId,
				data: { id: olderId, name: 'Older', owner: owner.toText(), createdAtMs: 1 },
				owner
			});
			recordLeagueInvite({ leagueId: olderId, inviteCode: 'ABC123' });

			assert.equal(lookup({ principal: joiner, code: 'ABC123' }).league?.id, olderId);
			assert.equal(join({ principal: joiner, code: 'ABC123' }).league?.id, olderId);
		});
	});

	describe('the cap on missed codes', () => {
		it('refuses a signed-out lookup', () => {
			assert.throws(
				() => lookup({ principal: Principal.anonymous(), code: inviteCode }),
				/Sign in/
			);
		});

		it('refuses lookups and joins once a caller has missed the cap within an hour', () => {
			missUpToTheCap(joiner);

			assert.deepEqual(lookup({ principal: joiner, code: inviteCode }), {
				reason: 'rate_limited'
			});
			assert.equal(join({ principal: joiner, code: inviteCode }).reason, 'rate_limited');
			assert.equal(membership(joiner), undefined);
		});

		it('counts the misses of lookups and joins together', () => {
			for (let index = 0; index < LEAGUE_INVITE_MISSES_PER_HOUR; index++) {
				const code = wrongCode(index);

				assert.equal(
					index % 2 === 0
						? lookup({ principal: joiner, code }).league
						: join({ principal: joiner, code }).league,
					undefined
				);
			}

			assert.equal(join({ principal: joiner, code: inviteCode }).reason, 'rate_limited');
		});

		it('counts only misses, and each caller on their own', () => {
			for (let index = 0; index < LEAGUE_INVITE_MISSES_PER_HOUR + 1; index++) {
				assert.equal(lookup({ principal: joiner, code: inviteCode }).league?.id, leagueId);
			}

			missUpToTheCap(other);

			assert.equal(join({ principal: joiner, code: inviteCode }).league?.id, leagueId);
			assert.equal(lookup({ principal: other, code: inviteCode }).reason, 'rate_limited');
		});

		it('lets the caller try again once the misses are an hour old', () => {
			missUpToTheCap(joiner);
			host.setNowMs(hostNowMs + HOUR_IN_MS + 1);

			assert.equal(join({ principal: joiner, code: inviteCode }).league?.id, leagueId);
		});

		it('keeps the attempts readable and writable by controllers only', () => {
			for (const mode of ['production', 'development']) {
				const rule = junoConfig({ mode }).satellite.collections?.datastore?.find(
					({ collection }) => collection === Collection.LEAGUE_INVITE_ATTEMPTS
				);

				assert.equal(rule?.read, 'controllers');
				assert.equal(rule?.write, 'controllers');
			}
		});

		it("drops the caller's attempts with the account", () => {
			missUpToTheCap(joiner);
			missUpToTheCap(other);

			hardDeleteAccountFn({ callerText: joiner.toText(), callerBytes: joiner.toUint8Array() });

			assert.deepEqual(host.keys(Collection.LEAGUE_INVITE_ATTEMPTS), [other.toText()]);
		});
	});
});
