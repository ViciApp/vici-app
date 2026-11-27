// Moves each legacy principal's clearing account (collateral in every balance
// domain, cash, reserved margin, open positions, and the custody funds clearing
// holds for it) to the custodial principal of the account that principal is
// linked to, `userIcPrincipalText(user_id)`, through clearing's
// controller-only `admin_reassign_account`. The user id of a provisional
// account survives its adoption (a login adopts in place, a claim folds the
// caller into it), so a still-provisional account can be moved before its
// owner arrives.
//
// One row per legacy_principals link. Before anything is called:
//   - ROOT_SECRET must be set explicitly (outside NODE_ENV=production the env
//     falls back to a public dev secret, which derives principals nobody can
//     sign for) and must derive the stored ic custody address of every account
//     in scope that has one, with at least one such account: any mismatch
//     aborts the run, dry run included;
//   - the read-only facts are gathered: open orders resting under the old
//     principal (clearing refuses to move those, and only the owner can cancel
//     them), its settled history, the VXP left in its own ledger wallet (not
//     part of the clearing account, and not movable by us: reported only), and
//     the target's clearing state read with the custodial identity (clearing
//     reassigns, never merges).
// A user with several principals gets them in order of settled history, then
// open orders, then wallet VXP: the first one holding an account moves, any
// later one holding an account comes back TargetAccountNotEmpty for a manual
// merge, and one holding none answers AccountNotFound.
//
// --execute calls the method signed by CUTOVER_CONTROLLER_PEM with
// `reassignment_id = vici-cutover:<old principal>`: clearing resumes a pending
// reassignment under the same id and answers Ok for a finished one, so the
// whole run replays safely.
//
// Usage: bun run cutover:reassign [--execute] [--principal <p> ...] [--report <out.jsonl>]
// Env: DATABASE_URL, ROOT_SECRET, CUTOVER_CONTROLLER_PEM (--execute only),
//      IC_HOST and CLEARING_CANISTER_ID (mainnet defaults).

import { isNullish, nonNullish } from '@dfinity/utils';
import { Principal } from '@icp-sdk/core/principal';
import { appendFileSync, writeFileSync } from 'node:fs';
import { pool } from '../../src/db/client';
import { toJson } from '../../src/engine/serialize';
import { env } from '../../src/env';
import { ZERO } from '../../src/lib/constants';
import { printTable } from '../etl/lib';
import { flagValues, hasFlag } from './lib';
import {
	classifyReassignResult,
	controllerTarget,
	isUnauthorized,
	reassignmentId,
	type ReassignOutcome,
	type ReassignTarget
} from './reassign-call';
import {
	CutoverCheckError,
	errorText,
	loadReassignLinks,
	planReassignments,
	requireExplicitRootSecret,
	verifyTargets,
	type PlanEntry
} from './reassign-plan';

// ---------------------------------------------------------------------------
// Execution

export interface ExecutedEntry extends PlanEntry {
	outcome: ReassignOutcome;
}

/** Calls the reassignment for every entry, in plan order, one at a time.
 * Entries no call can fix are recorded as manual without a call; a thrown
 * call (network, agent) is a replay, since the same id resumes or confirms.
 * An Unauthorized answer stops the run: the rest are left for a replay. */
/** One controller call and what it means. A thrown call is a replay: the
 * same id resumes the reassignment or confirms it finished. */
const callReassign = async ({
	entry,
	target
}: {
	entry: PlanEntry;
	target: ReassignTarget;
}): Promise<{ outcome: ReassignOutcome; unauthorized: boolean }> => {
	try {
		const result = await target.admin_reassign_account({
			old_owner: Principal.fromText(entry.principal),
			new_owner: Principal.fromText(entry.target),
			reassignment_id: reassignmentId(entry.principal)
		});

		return { outcome: classifyReassignResult(result), unauthorized: isUnauthorized(result) };
	} catch (err: unknown) {
		return {
			outcome: { kind: 'call_failed', disposition: 'replay', detail: errorText(err) },
			unauthorized: false
		};
	}
};

const NOT_ATTEMPTED: ReassignOutcome = {
	kind: 'not_attempted',
	disposition: 'replay',
	detail: 'run stopped on Unauthorized'
};

const MERGE_BY_HAND = 'another principal of this account moved first: merge by hand';

/** Calls the reassignment for every entry, in plan order, one at a time.
 * Entries no call can fix (a principal that does not parse, a hard-deleted
 * account) are recorded as manual without a call. An Unauthorized answer
 * stops the run: the rest are left for a replay. */
export const executeReassignments = async ({
	plan,
	target,
	onEntry = () => undefined
}: {
	plan: readonly PlanEntry[];
	target: ReassignTarget;
	onEntry?: (entry: ExecutedEntry) => void;
}): Promise<ExecutedEntry[]> => {
	const executed: ExecutedEntry[] = [];
	const movedUsers = new Set<string>();
	let stopped = false;

	const outcomeOf = async (entry: PlanEntry): Promise<ReassignOutcome> => {
		if (stopped) {
			return NOT_ATTEMPTED;
		}

		if (entry.check === 'invalid_principal' || entry.check === 'user_hard_deleted') {
			return { kind: entry.check, disposition: 'manual' };
		}

		const { outcome, unauthorized } = await callReassign({ entry, target });

		stopped = unauthorized;

		return outcome.kind === 'TargetAccountNotEmpty' && movedUsers.has(entry.userId)
			? { ...outcome, detail: MERGE_BY_HAND }
			: outcome;
	};

	for (const entry of plan) {
		const done = { ...entry, outcome: await outcomeOf(entry) };

		if (done.outcome.disposition === 'moved') {
			movedUsers.add(entry.userId);
		}

		executed.push(done);
		onEntry(done);
	}

	return executed;
};

// ---------------------------------------------------------------------------
// Report

const reportLine = (entry: PlanEntry | ExecutedEntry): string =>
	`${JSON.stringify(toJson({ ...entry, reassignmentId: reassignmentId(entry.principal) }))}\n`;

const countBy = (values: readonly string[]): string[][] => {
	const counts = new Map<string, number>();

	for (const value of values) {
		counts.set(value, (counts.get(value) ?? 0) + 1);
	}

	return [...counts].map(([value, n]) => [value, n.toString()]);
};

const printSummary = ({
	entries,
	executed
}: {
	entries: readonly PlanEntry[];
	executed?: readonly ExecutedEntry[];
}): void => {
	printTable([
		[isNullish(executed) ? 'check' : 'disposition', 'principals'],
		...countBy(
			isNullish(executed)
				? entries.map(({ check }) => check)
				: executed.map(({ outcome }) => outcome.disposition)
		)
	]);

	const attention = isNullish(executed)
		? entries
				.filter(({ check }) => check !== 'ready')
				.map((e) => [e.principal, e.userId, e.check, ''])
		: executed
				.filter(
					({ outcome }) =>
						outcome.disposition !== 'moved' && outcome.disposition !== 'nothing_to_move'
				)
				.map((e) => [
					e.principal,
					e.userId,
					`${e.outcome.disposition}: ${e.outcome.kind}`,
					e.outcome.detail ?? ''
				]);

	if (attention.length > 0) {
		console.log('');
		printTable([['principal', 'user_id', 'why', 'detail'], ...attention]);
	}

	const wallets = entries.filter(({ vxpWallet }) => nonNullish(vxpWallet) && vxpWallet > ZERO);
	const total = wallets.reduce((sum, { vxpWallet }) => sum + (vxpWallet ?? ZERO), ZERO);
	const shared = new Set(entries.filter((e) => e.principalsOfUser > 1).map((e) => e.userId)).size;
	const readErrors = entries.filter(({ readErrors }) => readErrors.length > 0).length;

	console.log('');
	printTable([
		[
			'VXP left in old wallets (base units, not moved)',
			'wallets',
			'accounts with several principals',
			'rows with read errors'
		],
		[total.toString(), wallets.length.toString(), shared.toString(), readErrors.toString()]
	]);
};

const requireControllerPem = (): string => {
	const path = process.env.CUTOVER_CONTROLLER_PEM ?? '';

	if (path === '') {
		throw new CutoverCheckError(
			'CUTOVER_CONTROLLER_PEM is not set: --execute needs the path to a clearing controller key.'
		);
	}

	return path;
};

const runDryRun = ({ plan, reportPath }: { plan: PlanEntry[]; reportPath: string }): void => {
	for (const entry of plan) {
		appendFileSync(reportPath, reportLine(entry));
	}

	printSummary({ entries: plan });
	console.log(`\nDry run: nothing called. Report: ${reportPath}`);
};

const runExecute = async ({
	plan,
	reportPath,
	pemPath
}: {
	plan: PlanEntry[];
	reportPath: string;
	pemPath: string;
}): Promise<void> => {
	const { target, caller } = await controllerTarget(pemPath);

	console.log(`Calling admin_reassign_account as ${caller} for ${plan.length} principal(s).`);

	const executed = await executeReassignments({
		plan,
		target,
		onEntry: (entry) => appendFileSync(reportPath, reportLine(entry))
	});

	printSummary({ entries: plan, executed });
	console.log(`\nReport: ${reportPath}. Re-run the same command for the replay rows.`);
};

const run = async (argv: readonly string[]): Promise<void> => {
	const execute = hasFlag({ argv, flag: '--execute' });
	const principals = flagValues({ argv, flag: '--principal' });
	const reportPath =
		flagValues({ argv, flag: '--report' })[0] ??
		`cutover-reassign-${execute ? 'execute' : 'dry-run'}-${new Date().toISOString().replaceAll(':', '-')}.jsonl`;

	requireExplicitRootSecret(process.env.ROOT_SECRET);

	const pemPath = execute ? requireControllerPem() : undefined;
	const links = await loadReassignLinks(principals.length > 0 ? { principals } : {});

	if (links.length === 0) {
		console.log('No legacy principal in scope.');

		return;
	}

	const { checkedAccounts } = verifyTargets(links);

	console.log(
		`ROOT_SECRET verified against ${checkedAccounts} stored ic custody address(es). Clearing ${env.ic.clearingCanisterId} on ${env.ic.host}.`
	);

	const plan = await planReassignments(links);

	writeFileSync(reportPath, '');

	if (isNullish(pemPath)) {
		runDryRun({ plan, reportPath });
	} else {
		await runExecute({ plan, reportPath, pemPath });
	}
};

if (import.meta.main) {
	try {
		await run(process.argv.slice(2));
	} catch (err: unknown) {
		if (!(err instanceof CutoverCheckError)) {
			throw err;
		}

		console.error(err.message);
		process.exitCode = 1;
	} finally {
		await pool.end();
	}
}
