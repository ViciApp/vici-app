// The cutover reassignment: the ROOT_SECRET guard, the result classification,
// the local Candid of admin_reassign_account, the plan over real legacy links
// with the engine faked at the actor provider, and execution against a fake
// controller surface that behaves like clearing (a refusal mutates nothing, a
// replay under the same id answers Ok), run twice to prove a re-run
// converges.

import { nonNullish } from '@dfinity/utils';
import { IDL } from '@icp-sdk/core/candid';
import { Ed25519KeyIdentity } from '@icp-sdk/core/identity';
import { Principal } from '@icp-sdk/core/principal';
import { afterEach, beforeAll, describe, expect, test } from 'bun:test';
import { executeReassignments } from '../scripts/cutover/reassign';
import {
	classifyReassignResult,
	reassignIdlFactory,
	reassignmentId,
	type ReassignAccountParams,
	type ReassignAccountResult,
	type ReassignTarget
} from '../scripts/cutover/reassign-call';
import {
	CutoverCheckError,
	loadReassignLinks,
	planReassignments,
	requireExplicitRootSecret,
	verifyTargets,
	type ReassignLink
} from '../scripts/cutover/reassign-plan';
import { query } from '../src/db/client';
import type { ClearingService } from '../src/declarations';
import { setEngineActorProvider, type IcrcLedgerActor } from '../src/engine/actors';
import { clearCache } from '../src/engine/cache';
import { ZERO } from '../src/lib/constants';
import { userIcPrincipalText } from '../src/lib/keys';
import { createTestUser, ensureMigrated, linkUnparseablePrincipal } from './helpers/auth';
import { dbAvailable } from './helpers/setup';

const newPrincipal = (): string => Ed25519KeyIdentity.generate().getPrincipal().toText();

const link = (overrides: Partial<ReassignLink> = {}): ReassignLink => ({
	principal: newPrincipal(),
	userId: crypto.randomUUID(),
	matchedVia: 'etl',
	claimPending: true,
	hardDeleted: false,
	adoptionConflict: false,
	custodyIcAddress: null,
	target: newPrincipal(),
	...overrides
});

describe('cutover reassign guards', () => {
	test('refuses to run without an explicit ROOT_SECRET', () => {
		expect(() => requireExplicitRootSecret(undefined)).toThrow(CutoverCheckError);
		expect(() => requireExplicitRootSecret('')).toThrow(CutoverCheckError);
		expect(() => requireExplicitRootSecret('set')).not.toThrow();
	});

	test('accepts targets that match every stored custody address', () => {
		const one = link();
		const two = link();

		expect(
			verifyTargets([
				{ ...one, custodyIcAddress: one.target },
				two,
				{ ...two, principal: newPrincipal() }
			])
		).toEqual({ checkedAccounts: 1 });
	});

	test('aborts on any derived target that differs from a stored custody address', () => {
		const good = link();

		expect(() =>
			verifyTargets([
				{ ...good, custodyIcAddress: good.target },
				link({ custodyIcAddress: newPrincipal() })
			])
		).toThrow('wrong ROOT_SECRET');
	});

	test('aborts when no account in scope has a custody address to check against', () => {
		expect(() => verifyTargets([link(), link()])).toThrow('No account in scope');
	});

	test('the reassignment id is fixed per old principal', () => {
		expect(reassignmentId('abc')).toBe('vici-cutover:abc');
	});
});

describe('cutover reassign outcomes', () => {
	const cases: Array<[ReassignAccountResult, string, string]> = [
		[{ Ok: null }, 'Ok', 'moved'],
		[{ Err: { AccountNotFound: null } }, 'AccountNotFound', 'nothing_to_move'],
		[{ Err: { InFlightPlansExist: null } }, 'InFlightPlansExist', 'replay'],
		[{ Err: { ReassignmentInProgress: null } }, 'ReassignmentInProgress', 'replay'],
		[
			{
				Err: {
					CustodyTransferFailed: { error: { TransferError: 'busy' }, asset_id: 'vxp' }
				}
			},
			'CustodyTransferFailed',
			'replay'
		],
		[{ Err: { TargetAccountNotEmpty: null } }, 'TargetAccountNotEmpty', 'manual'],
		[{ Err: { OpenOrdersExist: null } }, 'OpenOrdersExist', 'manual'],
		[{ Err: { PendingPositionTransfersExist: null } }, 'PendingPositionTransfersExist', 'manual'],
		[
			{ Err: { UnsupportedCustodyAsset: { asset_id: 'eth' } } },
			'UnsupportedCustodyAsset',
			'manual'
		],
		[{ Err: { ReassignmentIdReused: null } }, 'ReassignmentIdReused', 'manual'],
		[{ Err: { SameOwner: null } }, 'SameOwner', 'manual'],
		[{ Err: { AnonymousOwner: null } }, 'AnonymousOwner', 'manual'],
		[{ Err: { Common: { Unauthorized: null } } }, 'Common', 'error']
	];

	test.each(cases)('%j classifies', (result, kind, disposition) => {
		expect(classifyReassignResult(result)).toMatchObject({ kind, disposition });
	});

	test('a payload travels in the detail', () => {
		expect(
			classifyReassignResult({ Err: { UnsupportedCustodyAsset: { asset_id: 'eth' } } }).detail
		).toBe('{"asset_id":"eth"}');
	});

	test('the local Candid encodes and decodes every answer', () => {
		const service = reassignIdlFactory({ IDL });
		const func = Object.fromEntries(service._fields).admin_reassign_account;

		expect(func).toBeDefined();

		for (const [result] of cases) {
			const bytes = IDL.encode(func?.retTypes ?? [], [result]);

			expect<unknown>(IDL.decode(func?.retTypes ?? [], bytes)).toEqual([result]);
		}
	});
});

/** A clearing stand-in for the controller call: an account per principal,
 * plans keyed by (old owner, id), refusals that change nothing. */
const fakeController = ({
	accounts,
	nonEmptyTargets = new Set<string>(),
	answers = new Map<string, () => Promise<ReassignAccountResult>>()
}: {
	accounts: Set<string>;
	nonEmptyTargets?: Set<string>;
	answers?: Map<string, () => Promise<ReassignAccountResult>>;
}): { target: ReassignTarget; calls: ReassignAccountParams[] } => {
	const plans = new Map<string, string>();
	const calls: ReassignAccountParams[] = [];

	return {
		calls,
		target: {
			admin_reassign_account: (params) => {
				calls.push(params);

				const oldOwner = params.old_owner.toText();
				const newOwner = params.new_owner.toText();
				const answer = answers.get(oldOwner);

				if (nonNullish(answer)) {
					return answer();
				}

				const planned = plans.get(`${oldOwner}|${params.reassignment_id}`);

				if (nonNullish(planned)) {
					return Promise.resolve(
						planned === newOwner ? { Ok: null } : { Err: { ReassignmentIdReused: null } }
					);
				}

				if (!accounts.has(oldOwner)) {
					return Promise.resolve({ Err: { AccountNotFound: null } });
				}

				if (nonEmptyTargets.has(newOwner)) {
					return Promise.resolve({ Err: { TargetAccountNotEmpty: null } });
				}

				accounts.delete(oldOwner);
				nonEmptyTargets.add(newOwner);
				plans.set(`${oldOwner}|${params.reassignment_id}`, newOwner);

				return Promise.resolve({ Ok: null });
			}
		}
	};
};

describe.if(dbAvailable)('cutover reassign plan and execution', () => {
	let restore: (() => void) | undefined;

	beforeAll(async () => {
		await ensureMigrated();
	});

	afterEach(() => {
		restore?.();
		restore = undefined;
		clearCache();
	});

	const linkPrincipal = async (userId: string, principal: string): Promise<void> => {
		await query(
			`insert into legacy_principals (principal, user_id, matched_via) values ($1, $2, 'etl')`,
			[principal, userId]
		);
	};

	const giveCustodyRow = async (
		userId: string,
		address = userIcPrincipalText(userId)
	): Promise<void> => {
		await query(`insert into custody_accounts (user_id, chain, address) values ($1, 'ic', $2)`, [
			userId,
			address
		]);
	};

	/** The engine reads: resting orders by creator, settled counts by
	 * principal, wallet VXP by owner, and the targets holding state. */
	const installEngine = ({
		orders = [],
		settled = new Map<string, number>(),
		wallets = new Map<string, bigint>(),
		nonEmptyTargets = new Set<string>(),
		unreadableTargets = new Set<string>()
	}: {
		orders?: string[];
		settled?: Map<string, number>;
		wallets?: Map<string, bigint>;
		nonEmptyTargets?: Set<string>;
		unreadableTargets?: Set<string>;
	}): void => {
		restore = setEngineActorProvider({
			clearing: (identity) => {
				const caller = identity.getPrincipal().toText();
				const held = nonEmptyTargets.has(caller);

				return Promise.resolve({
					list_orders: () =>
						Promise.resolve(orders.map((creator) => ({ creator: Principal.fromText(creator) }))),
					aggregate_settlement_accuracy: ({ members }: { members: Principal[] }) =>
						Promise.resolve(
							members
								.filter((member) => settled.has(member.toText()))
								.map((member) => ({
									principal: member,
									settled_count: BigInt(settled.get(member.toText()) ?? 0),
									win_count: ZERO,
									realized_pnl: ZERO
								}))
						),
					get_account_state_query: () =>
						unreadableTargets.has(caller)
							? Promise.reject(new Error('replica unreachable'))
							: Promise.resolve(
									held
										? {
												Ok: {
													assets: [],
													state: {
														user: identity.getPrincipal(),
														reserved_margins_usd: [],
														cash_balances_usd: [],
														balances: [[{ ViciXp: null }, [['vxp', BigInt(5)]]]]
													},
													total_equity_usd: BigInt(5),
													available_margin_usd: BigInt(5)
												}
											}
										: { Err: { NoAccountStateFound: null } }
								),
					get_positions: () => Promise.resolve([]),
					get_orders: () => Promise.resolve([])
				} as unknown as ClearingService);
			},
			registry: () => Promise.reject(new Error('registry not faked')),
			ledger: () =>
				Promise.resolve({
					balance: ({ owner }: { owner: Principal }) =>
						Promise.resolve(wallets.get(owner.toText()) ?? ZERO)
				} as unknown as IcrcLedgerActor)
		});
	};

	test('plans every link: targets, facts, the order among one account principals, the checks', async () => {
		const two = await createTestUser();
		const busy = await createTestUser();
		const gone = await createTestUser();
		const [quiet, active, ordering, departed] = [
			newPrincipal(),
			newPrincipal(),
			newPrincipal(),
			newPrincipal()
		];

		await linkPrincipal(two, quiet);
		await linkPrincipal(two, active);
		await linkPrincipal(busy, ordering);
		await linkPrincipal(gone, departed);
		await giveCustodyRow(two);
		await query(`update users set hard_deleted_at = now() where id = $1`, [gone]);

		installEngine({
			orders: [ordering],
			settled: new Map([[active, 3]]),
			wallets: new Map([[quiet, BigInt(70_000)]]),
			nonEmptyTargets: new Set([userIcPrincipalText(busy)])
		});

		const links = await loadReassignLinks({ principals: [quiet, active, ordering, departed] });

		expect(verifyTargets(links)).toEqual({ checkedAccounts: 1 });

		const plan = await planReassignments(links);
		const byPrincipal = new Map(plan.map((entry) => [entry.principal, entry]));

		expect(byPrincipal.get(active)).toMatchObject({
			target: userIcPrincipalText(two),
			rank: 1,
			principalsOfUser: 2,
			settledCalls: 3,
			check: 'ready'
		});
		expect(byPrincipal.get(quiet)).toMatchObject({
			rank: 2,
			vxpWallet: BigInt(70_000),
			check: 'ready'
		});
		expect(byPrincipal.get(ordering)).toMatchObject({
			openOrders: 1,
			targetState: { empty: false, equityUsd: BigInt(5) },
			check: 'open_orders'
		});
		expect(byPrincipal.get(departed)).toMatchObject({
			targetState: null,
			check: 'user_hard_deleted'
		});
		// The account's principals run in rank order.
		expect(plan.findIndex(({ principal }) => principal === active)).toBeLessThan(
			plan.findIndex(({ principal }) => principal === quiet)
		);
	});

	test('a principal that does not parse is planned as manual and never called', async () => {
		const userId = await createTestUser();

		await linkUnparseablePrincipal(userId);
		installEngine({});

		const links = (await loadReassignLinks()).filter((entry) => entry.userId === userId);
		const plan = await planReassignments(links);
		const { target, calls } = fakeController({ accounts: new Set() });
		const [done] = await executeReassignments({ plan, target });

		expect(plan[0]?.check).toBe('invalid_principal');
		expect(done?.outcome).toMatchObject({ kind: 'invalid_principal', disposition: 'manual' });
		expect(calls).toHaveLength(0);
	});

	test('moves the first account, sends the second holder to manual, replays converge', async () => {
		const userId = await createTestUser();
		const [first, second, empty] = [newPrincipal(), newPrincipal(), newPrincipal()];

		for (const principal of [first, second, empty]) {
			await linkPrincipal(userId, principal);
		}

		await giveCustodyRow(userId);
		installEngine({
			settled: new Map([
				[first, 9],
				[second, 1]
			])
		});

		const plan = await planReassignments(
			await loadReassignLinks({ principals: [first, second, empty] })
		);
		const accounts = new Set([first, second]);
		const { target, calls } = fakeController({ accounts });
		const reported: string[] = [];

		const run = await executeReassignments({
			plan,
			target,
			onEntry: (entry) => reported.push(entry.principal)
		});
		const outcome = (principal: string): unknown =>
			run.find((entry) => entry.principal === principal)?.outcome;

		expect(outcome(first)).toEqual({ kind: 'Ok', disposition: 'moved' });
		expect(outcome(second)).toEqual({
			kind: 'TargetAccountNotEmpty',
			disposition: 'manual',
			detail: 'another principal of this account moved first: merge by hand'
		});
		expect(outcome(empty)).toEqual({ kind: 'AccountNotFound', disposition: 'nothing_to_move' });
		expect(reported).toEqual(run.map(({ principal }) => principal));
		expect(calls[0]).toMatchObject({ reassignment_id: reassignmentId(first) });
		expect(calls[0]?.new_owner.toText()).toBe(userIcPrincipalText(userId));

		const rerun = await executeReassignments({ plan, target });

		expect(rerun.map(({ outcome: o }) => o)).toEqual(run.map(({ outcome: o }) => o));
		expect([...accounts]).toEqual([second]);
	});

	/** One account with `principals` linked, ranked in the given order. */
	const rankedAccount = async (principals: string[]): Promise<string> => {
		const userId = await createTestUser();

		for (const principal of principals) {
			await linkPrincipal(userId, principal);
		}

		await giveCustodyRow(userId);

		return userId;
	};

	const descendingSettled = (principals: string[]): Map<string, number> =>
		new Map(principals.map((principal, i) => [principal, principals.length - i]));

	test('a thrown call is a replay and defers the account later principals', async () => {
		const [flaky, later] = [newPrincipal(), newPrincipal()];

		await rankedAccount([flaky, later]);
		installEngine({ settled: descendingSettled([flaky, later]) });

		const plan = await planReassignments(await loadReassignLinks({ principals: [flaky, later] }));
		const { target, calls } = fakeController({
			accounts: new Set([flaky, later]),
			answers: new Map([[flaky, () => Promise.reject(new Error('timeout'))]])
		});
		const run = await executeReassignments({ plan, target });

		expect(
			run.map(({ principal, outcome }) => [principal, outcome.kind, outcome.disposition])
		).toEqual([
			[flaky, 'call_failed', 'replay'],
			[later, 'deferred', 'replay']
		]);
		expect(run[1]?.outcome.detail).toContain(flaky);
		expect(calls).toHaveLength(1);
	});

	test('a replay answer or a refusal for the principal own state defers the rest', async () => {
		for (const answer of [
			{ Err: { InFlightPlansExist: null } },
			{ Err: { OpenOrdersExist: null } }
		] satisfies ReassignAccountResult[]) {
			const [first, second] = [newPrincipal(), newPrincipal()];

			await rankedAccount([first, second]);
			installEngine({ settled: descendingSettled([first, second]) });

			const plan = await planReassignments(
				await loadReassignLinks({ principals: [first, second] })
			);
			const { target, calls } = fakeController({
				accounts: new Set([first, second]),
				answers: new Map([[first, () => Promise.resolve(answer)]])
			});
			const run = await executeReassignments({ plan, target });

			expect(run[1]?.outcome.kind).toBe('deferred');
			expect(calls.map(({ old_owner }) => old_owner.toText())).toEqual([first]);

			restore?.();
			restore = undefined;
		}
	});

	test('Unauthorized stops the whole run', async () => {
		const [refused, other] = [newPrincipal(), newPrincipal()];

		await rankedAccount([refused]);
		await rankedAccount([other]);
		installEngine({});

		const plan = await planReassignments(await loadReassignLinks({ principals: [refused, other] }));
		const ordered = plan.map(({ principal }) => principal);
		const { target, calls } = fakeController({
			accounts: new Set([refused, other]),
			answers: new Map(
				ordered.map((principal) => [
					principal,
					() => Promise.resolve({ Err: { Common: { Unauthorized: null } } })
				])
			)
		});
		const run = await executeReassignments({ plan, target });

		expect(run.map(({ outcome }) => [outcome.kind, outcome.disposition])).toEqual([
			['Common', 'error'],
			['not_attempted', 'replay']
		]);
		expect(calls).toHaveLength(1);
	});

	test('an unreadable target blocks its principals and is never called', async () => {
		const principal = newPrincipal();
		const userId = await rankedAccount([principal]);

		installEngine({ unreadableTargets: new Set([userIcPrincipalText(userId)]) });

		const plan = await planReassignments(await loadReassignLinks({ principals: [principal] }));
		const { target, calls } = fakeController({ accounts: new Set([principal]) });
		const [done] = await executeReassignments({ plan, target });

		expect(plan[0]).toMatchObject({ targetState: null, check: 'target_unreadable' });
		expect(plan[0]?.readErrors[0]).toContain('target state');
		expect(done?.outcome).toEqual({ kind: 'target_unreadable', disposition: 'replay' });
		expect(calls).toHaveLength(0);
	});
});
