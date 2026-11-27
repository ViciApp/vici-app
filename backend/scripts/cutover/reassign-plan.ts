// What the cutover reassignment would do, before anything is called: the
// legacy links in scope with their targets, the ROOT_SECRET check against the
// stored custody addresses, and the read-only engine facts that order and
// check each principal. See reassign.ts for the flow.

import { isNullish, nonNullish } from '@dfinity/utils';
import { parsedPrincipal } from '../../src/auth/identity';
import { icAdapter } from '../../src/chains/ic/adapter';
import { getAssetBySymbol } from '../../src/custody/assets';
import { query, type TxQuery } from '../../src/db/client';
import {
	getAccountStateQuery,
	getOrders,
	getPositions,
	listSeriesOrders,
	settledTotalsByPrincipal
} from '../../src/engine/clearing';
import { ZERO } from '../../src/lib/constants';
import { userIcPrincipalText, type Chain } from '../../src/lib/keys';

// ---------------------------------------------------------------------------
// Scope and the ROOT_SECRET check

export class CutoverCheckError extends Error {}

/** The env fallback secret derives principals nobody can sign for, so the
 * operator must name the real one. */
export const requireExplicitRootSecret = (value: string | undefined): void => {
	if (isNullish(value) || value === '') {
		throw new CutoverCheckError(
			'ROOT_SECRET is not set: without it the custodial principals derive from the public dev secret. Set the production ROOT_SECRET.'
		);
	}
};

export interface ReassignLink {
	principal: string;
	userId: string;
	matchedVia: string;
	claimPending: boolean;
	hardDeleted: boolean;
	/** The principal sits in the admin queue of legacy_adoption_conflicts. */
	adoptionConflict: boolean;
	/** The account's stored ic custody address, when it has one. */
	custodyIcAddress: string | null;
	/** The account's custodial principal: where the clearing account goes. */
	target: string;
}

const CUSTODY_CHAIN: Chain = 'ic';

/** Every legacy link in scope (all of them, or only `principals`), with the
 * target each one moves to. */
export const loadReassignLinks = async ({
	principals,
	q = query
}: {
	principals?: readonly string[];
	q?: TxQuery;
} = {}): Promise<ReassignLink[]> => {
	const rows = await q<{
		principal: string;
		user_id: string;
		matched_via: string;
		claim_pending: boolean;
		hard_deleted: boolean;
		adoption_conflict: boolean;
		custody_ic_address: string | null;
	}>(
		`select lp.principal, lp.user_id, lp.matched_via, u.claim_pending,
		        u.hard_deleted_at is not null as hard_deleted,
		        exists (select 1 from legacy_adoption_conflicts c where c.principal = lp.principal)
		          as adoption_conflict,
		        ca.address as custody_ic_address
		 from legacy_principals lp
		 join users u on u.id = lp.user_id
		 left join custody_accounts ca on ca.user_id = lp.user_id and ca.chain = $2
		 where $1::text[] is null or lp.principal = any($1::text[])
		 order by lp.user_id, lp.principal`,
		[nonNullish(principals) ? [...principals] : null, CUSTODY_CHAIN]
	);
	const targets = new Map<string, string>();

	const targetOf = (userId: string): string => {
		const known = targets.get(userId);

		if (nonNullish(known)) {
			return known;
		}

		const derived = userIcPrincipalText(userId);

		targets.set(userId, derived);

		return derived;
	};

	return rows.map((row) => ({
		principal: row.principal,
		userId: row.user_id,
		matchedVia: row.matched_via,
		claimPending: row.claim_pending,
		hardDeleted: row.hard_deleted,
		adoptionConflict: row.adoption_conflict,
		custodyIcAddress: row.custody_ic_address,
		target: targetOf(row.user_id)
	}));
};

/** Aborts unless the derived targets equal every stored ic custody address in
 * scope, and at least one account in scope has one to compare: a wrong
 * ROOT_SECRET would move every account to a principal nobody can sign for. */
export const verifyTargets = (links: readonly ReassignLink[]): { checkedAccounts: number } => {
	const checked = new Map<string, { address: string; target: string }>();

	for (const link of links) {
		if (nonNullish(link.custodyIcAddress)) {
			checked.set(link.userId, { address: link.custodyIcAddress, target: link.target });
		}
	}

	const mismatched = [...checked].filter(([, { address, target }]) => address !== target);

	if (mismatched.length > 0) {
		throw new CutoverCheckError(
			`ROOT_SECRET does not derive the stored ic custody address of ${mismatched.length} account(s) (${mismatched
				.slice(0, 5)
				.map(([userId]) => userId)
				.join(', ')}): wrong ROOT_SECRET. Nothing was called.`
		);
	}

	if (checked.size === 0) {
		throw new CutoverCheckError(
			'No account in scope has an ic custody address to check ROOT_SECRET against. Widen the scope (add a --principal whose account has used its wallet).'
		);
	}

	return { checkedAccounts: checked.size };
};

// ---------------------------------------------------------------------------
// Read-only facts and the plan

export interface TargetState {
	empty: boolean;
	equityUsd: bigint;
	positions: number;
	orders: number;
}

export type PlanCheck =
	| 'ready'
	| 'invalid_principal'
	| 'user_hard_deleted'
	| 'target_unreadable'
	| 'open_orders'
	| 'target_not_empty';

export interface PlanEntry extends ReassignLink {
	/** Order among the user's principals, 1 first. */
	rank: number;
	principalsOfUser: number;
	openOrders: number;
	settledCalls: number;
	/** VXP (base units) left in the old principal's own ledger wallet: not
	 * part of the clearing account, so it stays where it is. */
	vxpWallet: bigint | null;
	targetState: TargetState | null;
	readErrors: string[];
	check: PlanCheck;
}

const READ_BATCH = 10;

const mapInBatches = async <T, R>(
	items: readonly T[],
	fn: (item: T) => Promise<R>
): Promise<R[]> => {
	const results: R[] = [];

	for (let start = 0; start < items.length; start += READ_BATCH) {
		results.push(...(await Promise.all(items.slice(start, start + READ_BATCH).map(fn))));
	}

	return results;
};

/** A per-row read: its value, or why it failed. */
interface Read<T> {
	value?: T;
	error?: string;
}

export const errorText = (err: unknown): string =>
	err instanceof Error ? err.message : String(err);

/** The target's clearing state as clearing's own TargetAccountNotEmpty check
 * sees it: any balance, cash, reserved margin, position or resting order. */
const readTargetState = async (userId: string): Promise<TargetState> => {
	const [account, positions, orders] = await Promise.all([
		getAccountStateQuery({ userId }),
		getPositions({ userId }),
		getOrders({ userId })
	]);
	const { balances, cash_balances_usd, reserved_margins_usd } = account.state;

	return {
		empty:
			balances.length === 0 &&
			cash_balances_usd.length === 0 &&
			reserved_margins_usd.length === 0 &&
			positions.length === 0 &&
			orders.length === 0,
		equityUsd: account.total_equity_usd,
		positions: positions.length,
		orders: orders.length
	};
};

const checkOf = (entry: Omit<PlanEntry, 'check'>): PlanCheck => {
	if (isNullish(parsedPrincipal(entry.principal))) {
		return 'invalid_principal';
	}

	if (entry.hardDeleted) {
		return 'user_hard_deleted';
	}

	// Fails closed: an unread target may already hold state, and clearing
	// would then refuse or, worse, the run would act on a guess.
	if (isNullish(entry.targetState)) {
		return 'target_unreadable';
	}

	if (entry.openOrders > 0) {
		return 'open_orders';
	}

	if (entry.targetState?.empty === false) {
		return 'target_not_empty';
	}

	return 'ready';
};

const descending = (a: bigint, b: bigint): number => (a > b ? -1 : a < b ? 1 : 0);

/** The principal most likely to hold the account first: a heuristic, since
 * an old principal's clearing state is readable only by its owner. */
const byStateEvidence = (
	a: Omit<PlanEntry, 'check' | 'rank'>,
	b: Omit<PlanEntry, 'check' | 'rank'>
): number =>
	b.settledCalls - a.settledCalls ||
	b.openOrders - a.openOrders ||
	descending(a.vxpWallet ?? ZERO, b.vxpWallet ?? ZERO) ||
	a.principal.localeCompare(b.principal);

/** Reads the facts of every link and orders each user's principals. Global
 * reads (the order book, the settled history) fail the run; a per-principal
 * or per-account read that fails is recorded on its row instead. */
export const planReassignments = async (links: readonly ReassignLink[]): Promise<PlanEntry[]> => {
	const parsed = links.map((link) => parsedPrincipal(link.principal)).filter(nonNullish);
	const [orders, settled, vxpAsset] = await Promise.all([
		listSeriesOrders({ fresh: true }),
		settledTotalsByPrincipal({ members: parsed, fromMs: 0, toMs: Date.now() }),
		getAssetBySymbol({ chain: 'ic', symbol: 'VXP' })
	]);
	const ordersByCreator = new Map<string, number>();

	for (const order of orders) {
		const creator = order.creator.toText();

		ordersByCreator.set(creator, (ordersByCreator.get(creator) ?? 0) + 1);
	}

	const wallets = await mapInBatches(links, async (link): Promise<Read<bigint>> => {
		if (isNullish(vxpAsset)) {
			return { error: 'vxp wallet: VXP asset not seeded' };
		}

		if (isNullish(parsedPrincipal(link.principal))) {
			return {};
		}

		try {
			return { value: await icAdapter.getBalance({ address: link.principal, asset: vxpAsset }) };
		} catch (err: unknown) {
			return { error: `vxp wallet: ${errorText(err)}` };
		}
	});

	const userIds = [...new Set(links.filter((l) => !l.hardDeleted).map((l) => l.userId))];
	const targetStates = new Map(
		await mapInBatches(userIds, async (userId): Promise<[string, Read<TargetState>]> => {
			try {
				return [userId, { value: await readTargetState(userId) }];
			} catch (err: unknown) {
				return [userId, { error: `target state: ${errorText(err)}` }];
			}
		})
	);

	const principalsPerUser = new Map<string, number>();

	for (const { userId } of links) {
		principalsPerUser.set(userId, (principalsPerUser.get(userId) ?? 0) + 1);
	}

	const unranked = links.map((link, i): Omit<PlanEntry, 'check' | 'rank'> => {
		const wallet = wallets[i];
		const target = targetStates.get(link.userId);

		return {
			...link,
			principalsOfUser: principalsPerUser.get(link.userId) ?? 1,
			openOrders: ordersByCreator.get(link.principal) ?? 0,
			settledCalls: settled.get(link.principal)?.calls ?? 0,
			vxpWallet: wallet?.value ?? null,
			targetState: target?.value ?? null,
			readErrors: [wallet?.error, target?.error].filter(nonNullish)
		};
	});

	const byUser = new Map<string, typeof unranked>();

	for (const entry of unranked) {
		byUser.set(entry.userId, [...(byUser.get(entry.userId) ?? []), entry]);
	}

	return [...byUser.values()].flatMap((group) =>
		[...group].sort(byStateEvidence).map((entry, i) => {
			const ranked = { ...entry, rank: i + 1 };

			return { ...ranked, check: checkOf(ranked) };
		})
	);
};
