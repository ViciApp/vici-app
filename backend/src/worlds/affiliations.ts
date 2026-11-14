// Worlds affiliations: a user's self-selected university and/or country slot
// with the signature 90-day switch lock. The lock window is computed
// server-side at join and enforced on the leave path, so a member cannot
// chase the Worlds leaderboard by hopping between schools or nations
// mid-season.

import { isNullish, nonNullish } from '@dfinity/utils';
import { query, tx } from '../db/client';
import { DAY_IN_MS } from '../lib/time';

export class AffiliationError extends Error {}

export type AffiliationKind = 'university' | 'country';

export const AFFILIATION_KINDS: readonly AffiliationKind[] = ['university', 'country'];

/** Lock window: 90 days. */
export const AFFILIATION_LOCK_MS = 90 * DAY_IN_MS;

export interface Affiliation {
	memberUserId: string;
	kind: AffiliationKind;
	affiliationIdentifier: string;
	joinedAtMs: number;
	lockedUntilMs: number;
}

interface AffiliationRow {
	member_user_id: string;
	kind: AffiliationKind;
	affiliation_identifier: string;
	joined_at_ms: string;
	locked_until_ms: string;
}

const AFFILIATION_COLUMNS = `member_user_id, kind, affiliation_identifier,
	joined_at_ms::text, locked_until_ms::text`;

const shapeAffiliation = (row: AffiliationRow): Affiliation => ({
	memberUserId: row.member_user_id,
	kind: row.kind,
	affiliationIdentifier: row.affiliation_identifier,
	joinedAtMs: Number(row.joined_at_ms),
	lockedUntilMs: Number(row.locked_until_ms)
});

export const isAffiliationKind = (value: string): value is AffiliationKind =>
	(AFFILIATION_KINDS as readonly string[]).includes(value);

/**
 * Join a Worlds slot. `lockedUntilMs` is server arithmetic
 * (joinedAtMs + 90 days), never client input. Re-joining the identical slot
 * is an idempotent no-op that preserves the original lock; switching to a
 * different identifier of the same kind is a leave-then-join, so the current
 * slot's lock must have expired first.
 */
export const setAffiliation = async ({
	userId,
	kind,
	affiliationIdentifier,
	nowMs = Date.now()
}: {
	userId: string;
	kind: AffiliationKind;
	affiliationIdentifier: string;
	nowMs?: number;
}): Promise<Affiliation> => {
	if (!isAffiliationKind(kind)) {
		throw new AffiliationError(
			`affiliations kind must be one of ${AFFILIATION_KINDS.join(' | ')} (got "${kind}").`
		);
	}

	if (affiliationIdentifier.length === 0) {
		throw new AffiliationError('affiliations identifier must be non-empty.');
	}

	return await tx(async (q) => {
		const existing = await q<AffiliationRow>(
			`select ${AFFILIATION_COLUMNS} from affiliations
			 where member_user_id = $1 and kind = $2
			 for update`,
			[userId, kind]
		);
		const [current] = existing;

		if (nonNullish(current)) {
			if (current.affiliation_identifier === affiliationIdentifier) {
				return shapeAffiliation(current);
			}

			// Switching = implicit leave of the held slot, which the lock gates
			// exactly like an explicit leave.
			if (nowMs < Number(current.locked_until_ms)) {
				const daysLeft = Math.ceil((Number(current.locked_until_ms) - nowMs) / DAY_IN_MS);

				throw new AffiliationError(
					`affiliations lock active: cannot switch for another ${daysLeft} day(s).`
				);
			}

			await q(`delete from affiliations where member_user_id = $1 and kind = $2`, [userId, kind]);
		}

		const rows = await q<AffiliationRow>(
			`insert into affiliations (member_user_id, kind, affiliation_identifier, joined_at_ms, locked_until_ms)
			 values ($1, $2, $3, $4, $5)
			 returning ${AFFILIATION_COLUMNS}`,
			[userId, kind, affiliationIdentifier, nowMs, nowMs + AFFILIATION_LOCK_MS]
		);
		const [row] = rows;

		if (isNullish(row)) {
			throw new AffiliationError('affiliation insert returned no row.');
		}

		return shapeAffiliation(row);
	});
};

/**
 * Leave a Worlds slot. Only the member themselves, and only after the
 * 90-day lock expires; staff get no kick path on Worlds slots.
 */
export const removeAffiliation = async ({
	userId,
	kind,
	affiliationIdentifier,
	nowMs = Date.now()
}: {
	userId: string;
	kind: AffiliationKind;
	affiliationIdentifier: string;
	nowMs?: number;
}): Promise<{ ok: boolean }> =>
	await tx(async (q) => {
		const rows = await q<AffiliationRow>(
			`select ${AFFILIATION_COLUMNS} from affiliations
			 where member_user_id = $1 and kind = $2 and affiliation_identifier = $3
			 for update`,
			[userId, kind, affiliationIdentifier]
		);
		const [current] = rows;

		if (isNullish(current)) {
			return { ok: true };
		}

		if (nowMs < Number(current.locked_until_ms)) {
			const daysLeft = Math.ceil((Number(current.locked_until_ms) - nowMs) / DAY_IN_MS);

			throw new AffiliationError(
				`affiliations lock active: cannot leave for another ${daysLeft} day(s).`
			);
		}

		await q(
			`delete from affiliations
			 where member_user_id = $1 and kind = $2 and affiliation_identifier = $3`,
			[userId, kind, affiliationIdentifier]
		);

		return { ok: true };
	});

/** The caller's current slots: at most one university + one country. */
export const listMyAffiliations = async (
	userId: string
): Promise<{ university?: Affiliation; country?: Affiliation }> => {
	const rows = await query<AffiliationRow>(
		`select ${AFFILIATION_COLUMNS} from affiliations where member_user_id = $1`,
		[userId]
	);

	let university: Affiliation | undefined;
	let country: Affiliation | undefined;

	for (const row of rows) {
		if (row.kind === 'university') {
			university = shapeAffiliation(row);
		} else {
			country = shapeAffiliation(row);
		}
	}

	return { university, country };
};

/** The caller's current slot of one kind, if held. */
export const getMyAffiliation = async ({
	userId,
	kind
}: {
	userId: string;
	kind: AffiliationKind;
}): Promise<Affiliation | undefined> => {
	const rows = await query<AffiliationRow>(
		`select ${AFFILIATION_COLUMNS} from affiliations where member_user_id = $1 and kind = $2`,
		[userId, kind]
	);

	return nonNullish(rows[0]) ? shapeAffiliation(rows[0]) : undefined;
};

/** Roster of a Worlds slot, earliest joiner first. */
export const listWorldsRoster = async ({
	kind,
	affiliationIdentifier
}: {
	kind: AffiliationKind;
	affiliationIdentifier: string;
}): Promise<Affiliation[]> => {
	const rows = await query<AffiliationRow>(
		`select ${AFFILIATION_COLUMNS} from affiliations
		 where kind = $1 and affiliation_identifier = $2
		 order by joined_at_ms asc`,
		[kind, affiliationIdentifier]
	);

	return rows.map(shapeAffiliation);
};

export interface AffiliationMemberCount {
	affiliationIdentifier: string;
	kind: AffiliationKind;
	memberCount: number;
}

/** Member tally per affiliation of a kind, biggest first; affiliations with
 * no members simply do not appear. */
export const listWorldsMemberCounts = async (
	kind: AffiliationKind
): Promise<AffiliationMemberCount[]> => {
	const rows = await query<{ affiliation_identifier: string; member_count: string }>(
		`select affiliation_identifier, count(*)::text as member_count
		 from affiliations where kind = $1
		 group by affiliation_identifier
		 order by count(*) desc, affiliation_identifier asc`,
		[kind]
	);

	return rows.map((row) => ({
		affiliationIdentifier: row.affiliation_identifier,
		kind,
		memberCount: Number(row.member_count)
	}));
};
