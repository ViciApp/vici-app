// Challenge links: a short, unguessable link for a user's real call on one
// binary market. The link holds the position the engine says its challenger
// holds now (refreshed by the trade trigger, `challenge-upkeep.ts`), and its
// public read answers only what the server can vouch for. This module issues,
// reads, switches and revokes links; the referral credit and the answers of
// the friends a link reaches are in `challenge-answers.ts`.

import { isNullish, nonNullish } from '@dfinity/utils';
import { randomInt } from 'node:crypto';
import { REFERRAL_CODE_ALPHABET } from '../account/referrals';
import { captureServerEvents, type ServerEventInput } from '../analytics/events';
import { query, type TxQuery } from '../db/client';
import { getSettlementStatus, getTradeHistory, listSettlementStatuses } from '../engine/clearing';
import { getSeries, VICI_ENGINE_ID } from '../engine/registry';
import { logger } from '../lib/logger';
import { nsToMs } from '../lib/time';
import { PUBLICLY_VISIBLE_PROFILE_SQL } from '../profiles/profile';
import type { CallSide } from '../vxp/calibration';
import { heldBinaryPosition, type HeldBinaryPosition } from '../vxp/predictions';

/** 16 characters over the 32-character referral alphabet: 80 bits, so a
 * guess hits a live link with negligible probability at any rate the read
 * limit allows. The id carries no user, handle or series. */
export const CHALLENGE_ID_LENGTH = 16;

/** Crockford base32, the referral code alphabet. Ids are stored uppercase;
 * input is normalised before the format check. */
export const CHALLENGE_ID_ALPHABET = REFERRAL_CODE_ALPHABET;

export const CHALLENGE_ID_REGEX = new RegExp(
	`^[${CHALLENGE_ID_ALPHABET}]{${CHALLENGE_ID_LENGTH}}$`
);

/** Bound of the owner's link list. A user has at most one active link per
 * series, so it is bounded by the markets they hold anyway. */
export const MY_CHALLENGES_LIST_LIMIT = 200;

/** The engine's settlement read takes at most this many series per call. */
const SETTLEMENT_READ_CHUNK = 100;

const ID_GENERATION_MAX_RETRIES = 4;

const BPS_PER_UNIT = 10_000;
const MIN_ENTRY_PRICE_BPS = 1;
const MAX_ENTRY_PRICE_BPS = BPS_PER_UNIT - 1;

/** A refusal the routes answer with its stable wire code. */
export class ChallengeError extends Error {
	readonly code: string;

	constructor(code: string) {
		super(code);

		this.code = code;
	}
}

/** Unknown, malformed, revoked, pruned, or its challenger hidden: one answer
 * for all, so the read is no oracle for which. */
export class ChallengeNotFoundError extends ChallengeError {
	constructor() {
		super('challenge_not_found');
	}
}

export class ChallengeNoPositionError extends ChallengeError {
	constructor() {
		super('no_position');
	}
}

export class ChallengeMarketClosedError extends ChallengeError {
	constructor() {
		super('market_closed');
	}
}

export class ChallengeUnknownSeriesError extends ChallengeError {
	constructor() {
		super('unknown_series');
	}
}

export class ChallengeUnsupportedSeriesError extends ChallengeError {
	constructor() {
		super('unsupported_series');
	}
}

export class ChallengeSelfError extends ChallengeError {
	constructor() {
		super('self_challenge');
	}
}

/** The redeem ran before the caller's profile exists; retrying after the
 * profile write can still credit. */
export class ChallengeProfileRequiredError extends ChallengeError {
	constructor() {
		super('profile_required');
	}
}

export interface ChallengePosition {
	side: CallSide;
	/** Side-framed probability of the held contracts' average entry. */
	entryPriceBps: number;
	/** Engine time of the fill that opened the held run. */
	calledAtMs: number;
}

export interface ChallengeIdentity {
	handle: string;
	avatar: string;
	avatarParts: string;
}

/** The public read: no account id, email, balance or call size. */
export interface ChallengeView {
	seriesId: string;
	position: ChallengePosition | null;
	sideChanged: boolean;
	challenger: ChallengeIdentity | null;
	marketOpen: boolean;
}

/** The owner's read of their own link: the public view plus what only the
 * owner may see about it. */
export interface OwnChallenge extends ChallengeView {
	id: string;
	showIdentity: boolean;
	createdAtMs: number;
	answerCount: number;
}

export interface ChallengeLinkRow {
	id: string;
	challenger_user_id: string;
	series_id: string;
	series_expiry_ms: string;
	created_side: CallSide;
	side: CallSide | null;
	entry_price_bps: number | null;
	called_at_ms: string | null;
	show_identity: boolean;
	created_at_ms: string;
	nickname: string | null;
	avatar: string | null;
	avatar_parts: string | null;
	answer_count: string;
}

const LINK_COLUMNS = `l.id, l.challenger_user_id, l.series_id, l.series_expiry_ms::text,
	l.created_side, l.side, l.entry_price_bps, l.called_at_ms::text, l.show_identity,
	l.created_at_ms::text, p.nickname, p.avatar, p.avatar_parts,
	(select count(*) from challenge_answers a where a.challenge_id = l.id)::text as answer_count`;

/** The id in its stored form, or undefined when it cannot be one: a
 * malformed id never reaches SQL. */
export const normalizeChallengeId = (raw: string): string | undefined => {
	const normalized = raw.trim().toUpperCase();

	return CHALLENGE_ID_REGEX.test(normalized) ? normalized : undefined;
};

const generateChallengeId = (): string => {
	let id = '';

	// randomInt rejection-samples, so the draw stays uniform.
	for (let i = 0; i < CHALLENGE_ID_LENGTH; i++) {
		id += CHALLENGE_ID_ALPHABET.charAt(randomInt(CHALLENGE_ID_ALPHABET.length));
	}

	return id;
};

export const toEntryPriceBps = (entryPrice: number): number =>
	Math.min(
		MAX_ENTRY_PRICE_BPS,
		Math.max(MIN_ENTRY_PRICE_BPS, Math.round(entryPrice * BPS_PER_UNIT))
	);

export interface StoredPosition {
	side: CallSide | null;
	entryPriceBps: number | null;
	calledAtMs: number | null;
}

export const toStoredPosition = (held: HeldBinaryPosition | undefined): StoredPosition =>
	isNullish(held)
		? { side: null, entryPriceBps: null, calledAtMs: null }
		: {
				side: held.side,
				entryPriceBps: toEntryPriceBps(held.entryPrice),
				calledAtMs: nsToMs(held.openedAtNs)
			};

export const positionOf = (
	row: Pick<ChallengeLinkRow, 'side' | 'entry_price_bps' | 'called_at_ms'>
): ChallengePosition | null =>
	isNullish(row.side) || isNullish(row.entry_price_bps) || isNullish(row.called_at_ms)
		? null
		: { side: row.side, entryPriceBps: row.entry_price_bps, calledAtMs: Number(row.called_at_ms) };

const identityOf = (
	row: Pick<ChallengeLinkRow, 'nickname' | 'avatar' | 'avatar_parts'>
): ChallengeIdentity | null =>
	isNullish(row.nickname)
		? null
		: { handle: row.nickname, avatar: row.avatar ?? '', avatarParts: row.avatar_parts ?? '' };

/** Closed for predictions: past expiry or settled (any settlement plan). The
 * expiry test runs first so a closed market costs no engine read; the
 * settlement read is the cached public one. */
const isMarketOpen = async ({
	seriesId,
	expiryMs
}: {
	seriesId: string;
	expiryMs: number;
}): Promise<boolean> => Date.now() < expiryMs && isNullish(await getSettlementStatus(seriesId));

/** The series of a batch that are still open, one settlement read per
 * chunk of the unexpired ones. */
export const openSeriesIds = async (
	series: readonly { seriesId: string; expiryMs: number }[]
): Promise<Set<string>> => {
	const nowMs = Date.now();
	const unexpired = [
		...new Set(series.filter(({ expiryMs }) => nowMs < expiryMs).map(({ seriesId }) => seriesId))
	];
	const settled = new Set<string>();

	for (let i = 0; i < unexpired.length; i += SETTLEMENT_READ_CHUNK) {
		const views = await listSettlementStatuses(unexpired.slice(i, i + SETTLEMENT_READ_CHUNK));

		for (const { series_id } of views) {
			settled.add(series_id);
		}
	}

	return new Set(unexpired.filter((seriesId) => !settled.has(seriesId)));
};

const toView = ({
	row,
	marketOpen
}: {
	row: ChallengeLinkRow;
	marketOpen: boolean;
}): ChallengeView => {
	const position = positionOf(row);

	return {
		seriesId: row.series_id,
		position,
		sideChanged: nonNullish(position) && position.side !== row.created_side,
		challenger: row.show_identity ? identityOf(row) : null,
		marketOpen
	};
};

const toOwnChallenge = ({
	row,
	marketOpen
}: {
	row: ChallengeLinkRow;
	marketOpen: boolean;
}): OwnChallenge => ({
	...toView({ row, marketOpen }),
	id: row.id,
	showIdentity: row.show_identity,
	createdAtMs: Number(row.created_at_ms),
	answerCount: Number(row.answer_count)
});

const ownChallengeOfRow = async (row: ChallengeLinkRow): Promise<OwnChallenge> =>
	toOwnChallenge({
		row,
		marketOpen: await isMarketOpen({
			seriesId: row.series_id,
			expiryMs: Number(row.series_expiry_ms)
		})
	});

/** An active link whose challenger is publicly visible, or undefined. */
export const findPublicLink = async (id: string): Promise<ChallengeLinkRow | undefined> => {
	const rows = await query<ChallengeLinkRow>(
		`select ${LINK_COLUMNS}
		 from challenge_links l
		 join profiles p on p.user_id = l.challenger_user_id
		 where l.id = $1 and l.status = 'active' and ${PUBLICLY_VISIBLE_PROFILE_SQL}`,
		[id]
	);

	return rows[0];
};

const findOwnLink = async ({
	userId,
	id,
	q = query
}: {
	userId: string;
	id: string;
	q?: TxQuery;
}): Promise<ChallengeLinkRow | undefined> => {
	const rows = await q<ChallengeLinkRow>(
		`select ${LINK_COLUMNS}
		 from challenge_links l
		 left join profiles p on p.user_id = l.challenger_user_id
		 where l.id = $1 and l.challenger_user_id = $2 and l.status = 'active'`,
		[id, userId]
	);

	return rows[0];
};

export const requireChallengeId = (raw: string): string => {
	const id = normalizeChallengeId(raw);

	if (isNullish(id)) {
		throw new ChallengeNotFoundError();
	}

	return id;
};

/** A Vici binary series that is still open for predictions, with its expiry. */
const challengeableSeries = async (seriesId: string): Promise<{ expiryMs: number }> => {
	const series = await getSeries(seriesId);

	if (isNullish(series) || series.engine_id[0] !== VICI_ENGINE_ID) {
		throw new ChallengeUnknownSeriesError();
	}

	if (!('Binary' in series.payoff_type)) {
		throw new ChallengeUnsupportedSeriesError();
	}

	const expiryMs = nsToMs(series.expiry_ns);

	if (!(await isMarketOpen({ seriesId, expiryMs }))) {
		throw new ChallengeMarketClosedError();
	}

	return { expiryMs };
};

export const captureChallengeEvent = async (event: ServerEventInput): Promise<void> => {
	try {
		await captureServerEvents({ events: [event] });
	} catch (err) {
		logger.error(`challenge analytics capture failed (${event.name}):`, err);
	}
};

const isUniqueViolation = (err: unknown, constraint: string): boolean =>
	typeof err === 'object' &&
	nonNullish(err) &&
	'code' in err &&
	err.code === '23505' &&
	'constraint' in err &&
	err.constraint === constraint;

/** Inserts a fresh link, or refreshes the caller's active one for the series
 * with the current position and the consent just sent; `created_side` and
 * the id stay as they were. */
const upsertLink = async ({
	userId,
	seriesId,
	expiryMs,
	held,
	showIdentity
}: {
	userId: string;
	seriesId: string;
	expiryMs: number;
	held: HeldBinaryPosition;
	showIdentity: boolean;
}): Promise<{ id: string; inserted: boolean }> => {
	const position = toStoredPosition(held);

	for (let attempt = 0; attempt < ID_GENERATION_MAX_RETRIES; attempt++) {
		const nowMs = Date.now();

		try {
			const rows = await query<{ id: string; inserted: boolean }>(
				`insert into challenge_links (id, challenger_user_id, series_id, series_expiry_ms,
				   created_side, side, entry_price_bps, called_at_ms, show_identity,
				   position_synced_at_ms, created_at_ms)
				 values ($1, $2, $3, $4, $5, $5, $6, $7, $8, $9, $9)
				 on conflict (challenger_user_id, series_id) where status = 'active'
				 do update set side = excluded.side,
				   entry_price_bps = excluded.entry_price_bps,
				   called_at_ms = excluded.called_at_ms,
				   show_identity = excluded.show_identity,
				   position_synced_at_ms = excluded.position_synced_at_ms
				 returning id, (xmax = 0) as inserted`,
				[
					generateChallengeId(),
					userId,
					seriesId,
					expiryMs,
					held.side,
					position.entryPriceBps,
					position.calledAtMs,
					showIdentity,
					nowMs
				]
			);
			const [row] = rows;

			if (nonNullish(row)) {
				return row;
			}
		} catch (err) {
			// Only a fresh id colliding with an existing one is retried; the
			// (user, series) conflict is the upsert above.
			if (!isUniqueViolation(err, 'challenge_links_pkey')) {
				throw err;
			}
		}
	}

	throw new Error(`challenge id generation exhausted after ${ID_GENERATION_MAX_RETRIES} tries`);
};

/**
 * Issues the caller's link for a series, or returns their active one (same
 * id), refreshed with the position the engine holds now and the consent flag
 * just sent. The position comes from the caller's trade history only.
 */
export const createChallenge = async ({
	userId,
	seriesId,
	showIdentity
}: {
	userId: string;
	seriesId: string;
	showIdentity: boolean;
}): Promise<OwnChallenge> => {
	const { expiryMs } = await challengeableSeries(seriesId);
	const held = heldBinaryPosition({ events: await getTradeHistory({ userId }), seriesId });

	if (isNullish(held)) {
		throw new ChallengeNoPositionError();
	}

	const { id, inserted } = await upsertLink({ userId, seriesId, expiryMs, held, showIdentity });

	await captureChallengeEvent({
		name: 'challenge_created',
		userId,
		props: { marketId: seriesId, label: inserted ? 'new' : 'existing', ok: showIdentity }
	});

	const row = await findOwnLink({ userId, id });

	if (isNullish(row)) {
		throw new ChallengeNotFoundError();
	}

	return toOwnChallenge({ row, marketOpen: true });
};

/** The public read of a link. No engine call beyond the cached settlement
 * read, and none at all once the market is past expiry. */
export const getChallengeView = async (rawId: string): Promise<ChallengeView> => {
	const row = await findPublicLink(requireChallengeId(rawId));

	if (isNullish(row)) {
		throw new ChallengeNotFoundError();
	}

	return toView({
		row,
		marketOpen: await isMarketOpen({
			seriesId: row.series_id,
			expiryMs: Number(row.series_expiry_ms)
		})
	});
};

/** The owner turns the identity on the public read on or off. Anyone else
 * reads the link as not found. */
export const setChallengeConsent = async ({
	userId,
	id: rawId,
	showIdentity
}: {
	userId: string;
	id: string;
	showIdentity: boolean;
}): Promise<OwnChallenge> => {
	const id = requireChallengeId(rawId);
	const updated = await query<{ id: string }>(
		`update challenge_links set show_identity = $3
		 where id = $1 and challenger_user_id = $2 and status = 'active'
		 returning id`,
		[id, userId, showIdentity]
	);
	const row = isNullish(updated[0]) ? undefined : await findOwnLink({ userId, id });

	if (isNullish(row)) {
		throw new ChallengeNotFoundError();
	}

	return await ownChallengeOfRow(row);
};

/** The owner turns the link off: it reads as not found from then on. */
export const revokeChallenge = async ({
	userId,
	id: rawId
}: {
	userId: string;
	id: string;
}): Promise<void> => {
	const id = requireChallengeId(rawId);
	const rows = await query<{ id: string }>(
		`update challenge_links set status = 'revoked', status_changed_at_ms = $3
		 where id = $1 and challenger_user_id = $2 and status = 'active'
		 returning id`,
		[id, userId, Date.now()]
	);

	if (isNullish(rows[0])) {
		throw new ChallengeNotFoundError();
	}
};

/** The caller's active links, newest first, with their answer counts. */
export const listMyChallenges = async (userId: string): Promise<OwnChallenge[]> => {
	const rows = await query<ChallengeLinkRow>(
		`select ${LINK_COLUMNS}
		 from challenge_links l
		 left join profiles p on p.user_id = l.challenger_user_id
		 where l.challenger_user_id = $1 and l.status = 'active'
		 order by l.created_at_ms desc
		 limit $2`,
		[userId, MY_CHALLENGES_LIST_LIMIT]
	);
	const open = await openSeriesIds(
		rows.map((row) => ({ seriesId: row.series_id, expiryMs: Number(row.series_expiry_ms) }))
	);

	return rows.map((row) => toOwnChallenge({ row, marketOpen: open.has(row.series_id) }));
};
