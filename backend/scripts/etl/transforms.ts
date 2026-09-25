// Per-collection transforms from exported satellite docs into the relational
// tables, plus the principal-to-user mapping every transform shares. One
// registry entry per satellite collection: either an importer (run inside one
// transaction per collection, upsert semantics keyed on the stable legacy
// identifiers so the cutover delta pass converges instead of duplicating) or
// a documented skip.
//
// Mapping decisions that are not 1:1 column renames:
//   - Principals resolve through legacy_principals; an unknown principal gets
//     a provisional claim_pending user plus an 'etl' provenance link, adopted
//     later by a matching first login or the claim flow (src/auth/adoption.ts).
//   - roles updates users.role only while it is still 'user' (a role granted
//     on this stack is never clobbered); 'controller' is infrastructure, not
//     a grantable role, and is skipped.
//   - vxp_awards preserves the exported status verbatim; on re-import an
//     existing row only moves while still 'pending', so a payout recorded on
//     either side is never demoted and never double-fires.
//   - vxp_onboarding has no table of its own: each non-'none' milestone
//     becomes a vxp_awards row ('onboarding', m1|m2|m3) so the onboarding
//     trigger's idempotency key collides instead of re-granting.
//   - referrals synthesizes the two payout-side vxp_awards rows ('referral',
//     key = referee user id) from the doc's payout states for the same
//     reason: the settlement path dedupes on exactly that key.
//   - school_submissions is skipped: rows are ephemeral verification codes
//     (salted digests + TTL); the durable outcome lives in schools counts
//     and profiles.school_status.
//   - events / event_rollups are skipped: the behavioural history was already
//     drained to the warehouse through the analytics export contract.
//   - chats / comments are skipped: dormant surfaces with no target tables.

import { isNullish, nonNullish } from '@dfinity/utils';
import { createHash } from 'node:crypto';
import { tx, type TxQuery } from '../../src/db/client';
import { ZERO } from '../../src/lib/constants';
import { nicknameUniqueKey } from '../../src/profiles/nickname';
import { activityKey as webActivityKey } from '../../src/social/activities';
import { followRelationKey, friendRelationKey } from '../../src/social/relations';
import { msFromNs, type ExportedDoc, type SatelliteCollection } from './lib';

// ---------------------------------------------------------------------------
// Loose readers: exported doc payloads are historical JSON, so every field is
// read defensively with the same defaults the satellite schemas applied.

const rec = (v: unknown): Record<string, unknown> =>
	typeof v === 'object' && nonNullish(v) && !Array.isArray(v) ? (v as Record<string, unknown>) : {};

const str = (v: unknown, fallback = ''): string => (typeof v === 'string' ? v : fallback);

const optStr = (v: unknown): string | null => (typeof v === 'string' ? v : null);

const num = (v: unknown, fallback = 0): number =>
	typeof v === 'number' && Number.isFinite(v) ? v : fallback;

const optNum = (v: unknown): number | null =>
	typeof v === 'number' && Number.isFinite(v) ? v : null;

const bool = (v: unknown, fallback = false): boolean => (typeof v === 'boolean' ? v : fallback);

const arr = (v: unknown): unknown[] => (Array.isArray(v) ? v : []);

const strArr = (v: unknown): string[] => arr(v).filter((e): e is string => typeof e === 'string');

/** Epoch ms for a timestamptz parameter (passed as ISO string). */
const isoFromMs = (ms: number): string => new Date(ms).toISOString();

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// ---------------------------------------------------------------------------
// Principal mapping

export class PrincipalMapper {
	private readonly cache = new Map<string, string>();
	createdCount = 0;

	constructor(private readonly q: TxQuery) {}

	async load(): Promise<void> {
		const rows = await this.q<{ principal: string; user_id: string }>(
			`select principal, user_id from legacy_principals`
		);

		for (const row of rows) {
			this.cache.set(row.principal, row.user_id);
		}
	}

	/** Read-only probe: the mapped user id, or undefined when unlinked. */
	lookup(principal: string): string | undefined {
		return this.cache.get(principal);
	}

	/** The user id owning this principal, creating a provisional
	 * claim_pending account (plus the 'etl' link) when none exists yet. */
	async userIdFor(principal: string): Promise<string> {
		// Fail fast: a blank principal would silently funnel every malformed
		// doc onto one shared provisional account.
		if (principal.trim() === '') {
			throw new Error('userIdFor called with an empty principal');
		}

		const cached = this.cache.get(principal);

		if (nonNullish(cached)) {
			return cached;
		}

		const rows = await this.q<{ id: string }>(
			`insert into users (claim_pending) values (true) returning id`
		);
		const userId = rows[0]?.id;

		if (isNullish(userId)) {
			throw new Error('provisional user insert returned no row');
		}

		await this.q(
			`insert into legacy_principals (principal, user_id, matched_via) values ($1, $2, 'etl')`,
			[principal, userId]
		);

		this.cache.set(principal, userId);
		this.createdCount += 1;

		return userId;
	}
}

// ---------------------------------------------------------------------------
// Registry types

export interface ImportStats {
	imported: number;
	skipped: number;
	createdUsers: number;
	warnings: string[];
}

export interface ImportContext {
	q: TxQuery;
	mapper: PrincipalMapper;
	nowMs: number;
	stats: ImportStats;
}

type ImporterRun = (docs: ExportedDoc[], ctx: ImportContext) => Promise<void>;

/** Lift a per-doc handler into the run shape: a true return counts the doc
 * as imported, false as skipped. */
const perDoc =
	(handler: (doc: ExportedDoc, ctx: ImportContext) => Promise<boolean>): ImporterRun =>
	async (docs, ctx) => {
		for (const doc of docs) {
			if (await handler(doc, ctx)) {
				ctx.stats.imported += 1;
			} else {
				ctx.stats.skipped += 1;
			}
		}
	};

export interface CollectionImporter {
	collection: SatelliteCollection;
	mode: 'import' | 'skip';
	skipReason?: string;
	run?: ImporterRun;
	/** Row count of the target table(s) for the parity report. */
	pgCount?: (q: TxQuery) => Promise<number>;
	/** Spot check: does this exported doc's target row exist? Read-only. */
	exists?: (doc: ExportedDoc, ctx: { q: TxQuery; mapper: PrincipalMapper }) => Promise<boolean>;
}

const countSql = async (q: TxQuery, sql: string): Promise<number> => {
	const rows = await q<{ count: string }>(sql);

	return Number(rows[0]?.count ?? 0);
};

const rowExists = async (q: TxQuery, sql: string, params: unknown[]): Promise<boolean> => {
	const rows = await q<{ one: number }>(sql, params);

	return nonNullish(rows[0]);
};

// ---------------------------------------------------------------------------
// profiles

const PROFILE_VISIBILITIES = new Set(['public', 'friends_and_followers', 'friends_only']);

const importProfiles: ImporterRun = async (docs, { q, mapper, nowMs, stats }) => {
	const claimedFolds = new Map<string, string>();

	for (const doc of docs) {
		const d = rec(doc.data);
		const principal = str(d.owner, doc.key);
		const userId = await mapper.userIdFor(principal);
		const nickname = str(d.nickname);
		let nicknameKey = nicknameUniqueKey(nickname);

		if (nicknameKey !== '') {
			const conflictRows = await q<{ user_id: string }>(
				`select user_id from profiles where nickname_key = $1 and user_id <> $2`,
				[nicknameKey, userId]
			);
			const batchOwner = claimedFolds.get(nicknameKey);

			if (nonNullish(conflictRows[0]) || (nonNullish(batchOwner) && batchOwner !== userId)) {
				stats.warnings.push(
					`profiles: nickname fold conflict for ${principal} ("${nickname}"); imported without a reserved handle`
				);
				nicknameKey = '';
			} else {
				claimedFolds.set(nicknameKey, userId);
			}
		}

		const visibilityRaw = str(d.visibility, 'friends_only');
		const preferences = rec(d.preferences);

		await q(
			`insert into profiles (
			   user_id, nickname, nickname_key, avatar, avatar_parts, email, pnl, visibility,
			   total_trades, win_rate, daily_streak, longest_streak, daily_goal_done,
			   daily_goal_date, streak, accuracy, points, level, archetype, interests,
			   last_active_day, deleted_at_ms, hibernated_at_ms, unlocked_achievements,
			   contrarian_wins, best_upset_consensus, on_fire_streak, comebacks,
			   winning_categories, leagues_joined, bouts_won, leagues_founded,
			   top_decile_streak, last_top_decile_day, sharpest_eye_best_tier, school_status,
			   earned_menagerie, handle_last_change_ms, preferences, created_at, updated_at
			 ) values (
			   $1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18,
			   $19, $20, $21, $22, $23, $24, $25, $26, $27, $28, $29, $30, $31, $32, $33, $34,
			   $35, $36, $37, $38, $39, $40, $41
			 )
			 on conflict (user_id) do update set
			   nickname = excluded.nickname,
			   nickname_key = excluded.nickname_key,
			   avatar = excluded.avatar,
			   avatar_parts = excluded.avatar_parts,
			   email = excluded.email,
			   pnl = excluded.pnl,
			   visibility = excluded.visibility,
			   total_trades = excluded.total_trades,
			   win_rate = excluded.win_rate,
			   daily_streak = excluded.daily_streak,
			   longest_streak = excluded.longest_streak,
			   daily_goal_done = excluded.daily_goal_done,
			   daily_goal_date = excluded.daily_goal_date,
			   streak = excluded.streak,
			   accuracy = excluded.accuracy,
			   points = excluded.points,
			   level = excluded.level,
			   archetype = excluded.archetype,
			   interests = excluded.interests,
			   last_active_day = excluded.last_active_day,
			   deleted_at_ms = excluded.deleted_at_ms,
			   hibernated_at_ms = excluded.hibernated_at_ms,
			   unlocked_achievements = excluded.unlocked_achievements,
			   contrarian_wins = excluded.contrarian_wins,
			   best_upset_consensus = excluded.best_upset_consensus,
			   on_fire_streak = excluded.on_fire_streak,
			   comebacks = excluded.comebacks,
			   winning_categories = excluded.winning_categories,
			   leagues_joined = excluded.leagues_joined,
			   bouts_won = excluded.bouts_won,
			   leagues_founded = excluded.leagues_founded,
			   top_decile_streak = excluded.top_decile_streak,
			   last_top_decile_day = excluded.last_top_decile_day,
			   sharpest_eye_best_tier = excluded.sharpest_eye_best_tier,
			   school_status = excluded.school_status,
			   earned_menagerie = excluded.earned_menagerie,
			   handle_last_change_ms = excluded.handle_last_change_ms,
			   preferences = excluded.preferences,
			   updated_at = excluded.updated_at`,
			[
				userId,
				nickname,
				nicknameKey,
				str(d.avatar),
				str(d.avatarParts),
				str(d.email),
				num(d.pnl),
				PROFILE_VISIBILITIES.has(visibilityRaw) ? visibilityRaw : 'friends_only',
				num(d.totalTrades),
				num(d.winRate),
				num(d.dailyStreak),
				num(d.longestStreak),
				Math.max(0, num(d.dailyGoalDone)),
				optStr(d.dailyGoalDate),
				num(d.streak),
				num(d.accuracy),
				num(d.points),
				num(d.level, 1),
				str(d.archetype),
				JSON.stringify(strArr(d.interests)),
				optStr(d.lastActiveDay),
				optNum(d.deletedAtMs),
				optNum(d.hibernatedAtMs),
				JSON.stringify(strArr(d.unlockedAchievements)),
				num(d.contrarianWins),
				optNum(d.bestUpsetConsensus),
				num(d.onFireStreak),
				num(d.comebacks),
				num(d.winningCategories),
				num(d.leaguesJoined),
				num(d.boutsWon),
				num(d.leaguesFounded),
				num(d.topDecileStreak),
				optStr(d.lastTopDecileDay),
				optStr(d.sharpestEyeBestTier),
				optStr(d.schoolStatus),
				Array.isArray(d.earnedMenagerie) ? JSON.stringify(strArr(d.earnedMenagerie)) : null,
				optNum(d.handleLastChangeMs),
				JSON.stringify(preferences),
				isoFromMs(msFromNs(doc.createdAtNs) ?? nowMs),
				isoFromMs(msFromNs(doc.updatedAtNs) ?? nowMs)
			]
		);

		stats.imported += 1;
	}
};

// ---------------------------------------------------------------------------
// user_stats + user_monthly_stats

const importUserStats: ImporterRun = perDoc(async (doc, { q, mapper, nowMs }) => {
	const d = rec(doc.data);
	const userId = await mapper.userIdFor(str(d.owner, doc.key));

	await q(
		`insert into user_stats (user_id, category_stats, recent_settlements, computed_at_ms, updated_at)
		 values ($1, $2, $3, $4, $5)
		 on conflict (user_id) do update set
		   category_stats = excluded.category_stats,
		   recent_settlements = excluded.recent_settlements,
		   computed_at_ms = excluded.computed_at_ms,
		   updated_at = excluded.updated_at`,
		[
			userId,
			JSON.stringify(rec(d.categoryStats)),
			JSON.stringify(arr(d.recentSettlements)),
			num(d.computedAtMs),
			isoFromMs(msFromNs(doc.updatedAtNs) ?? nowMs)
		]
	);

	return true;
});

const MONTH_ANCHOR_RE = /^\d{4}-(0[1-9]|1[0-2])$/;

const importUserMonthlyStats: ImporterRun = perDoc(async (doc, { q, mapper, stats }) => {
	const d = rec(doc.data);
	const monthAnchor = str(d.monthAnchor);

	if (!MONTH_ANCHOR_RE.test(monthAnchor)) {
		stats.warnings.push(`user_monthly_stats: invalid month anchor on ${doc.key}; skipped`);

		return false;
	}

	const userId = await mapper.userIdFor(str(d.owner, doc.key.split('/')[0] ?? ''));
	const monthCalls = Math.max(0, num(d.monthCalls));
	const monthWins = Math.min(monthCalls, Math.max(0, num(d.monthWins)));

	if (monthWins !== num(d.monthWins)) {
		stats.warnings.push(`user_monthly_stats: clamped wins for ${doc.key}`);
	}

	await q(
		`insert into user_monthly_stats (user_id, month_anchor, month_calls, month_wins, month_consensus, updated_at_ms)
		 values ($1, $2, $3, $4, $5, $6)
		 on conflict (user_id, month_anchor) do update set
		   month_calls = excluded.month_calls,
		   month_wins = excluded.month_wins,
		   month_consensus = excluded.month_consensus,
		   updated_at_ms = excluded.updated_at_ms`,
		[
			userId,
			monthAnchor,
			monthCalls,
			monthWins,
			JSON.stringify(arr(d.monthConsensus).filter((v) => typeof v === 'number')),
			num(d.updatedAtMs)
		]
	);

	return true;
});

// ---------------------------------------------------------------------------
// roles

const GRANTABLE_ROLES = new Set(['admin', 'solver', 'creator']);

const importRoles: ImporterRun = perDoc(async (doc, { q, mapper }) => {
	const role = str(rec(doc.data).role);

	if (!GRANTABLE_ROLES.has(role)) {
		return false;
	}

	const userId = await mapper.userIdFor(doc.key);

	await q(`update users set role = $2 where id = $1 and role = 'user'`, [userId, role]);

	return true;
});

// ---------------------------------------------------------------------------
// relations

const RELATION_STATES = new Set(['PENDING', 'ACTIVE', 'REJECTED', 'BLOCKED']);

const importRelations: ImporterRun = perDoc(async (doc, { q, mapper, nowMs, stats }) => {
	const d = rec(doc.data);
	const category = str(d.category);
	const state = str(d.state);
	const participants = strArr(d.participants);

	if (
		!RELATION_STATES.has(state) ||
		participants.length !== 2 ||
		(category !== 'FRIEND' && category !== 'follow')
	) {
		stats.warnings.push(`relations: unsupported shape on ${doc.key}; skipped`);

		return false;
	}

	const [senderPrincipal, targetPrincipal] = participants as [string, string];
	const sender = await mapper.userIdFor(senderPrincipal);
	const target = await mapper.userIdFor(targetPrincipal);
	const key =
		category === 'FRIEND'
			? friendRelationKey(sender, target)
			: followRelationKey({ sender, target });

	await q(
		`insert into relations (key, category, state, participant_one, participant_two, created_at, updated_at)
		 values ($1, $2, $3, $4, $5, $6, $7)
		 on conflict (key) do update set
		   state = excluded.state,
		   updated_at = excluded.updated_at`,
		[
			key,
			category,
			state,
			sender,
			target,
			isoFromMs(msFromNs(doc.createdAtNs) ?? nowMs),
			isoFromMs(msFromNs(doc.updatedAtNs) ?? nowMs)
		]
	);

	return true;
});

// ---------------------------------------------------------------------------
// activities + reactions + counts

const ACTIVITY_TYPES = new Set(['trade', 'settlement', 'comment', 'follow', 'upvote', 'downvote']);

const importActivities: ImporterRun = perDoc(async (doc, { q, mapper, nowMs, stats }) => {
	const d = rec(doc.data);
	const type = str(d.type);
	const timestamp = num(d.timestamp);

	if (!ACTIVITY_TYPES.has(type) || timestamp <= 0) {
		stats.warnings.push(`activities: unsupported shape on ${doc.key}; skipped`);

		return false;
	}

	const userId = await mapper.userIdFor(str(d.user, doc.key.split('#')[0] ?? ''));
	const targetPrincipal = optStr(d.targetUser);
	const targetUser = nonNullish(targetPrincipal) ? await mapper.userIdFor(targetPrincipal) : null;

	await q(
		`insert into activities (key, user_id, type, target_user, market_id, title, details, timestamp_ms, created_at)
		 values ($1, $2, $3, $4, $5, $6, $7, $8, $9)
		 on conflict (key) do nothing`,
		[
			webActivityKey({ userId, timestamp, type: type as never }),
			userId,
			type,
			targetUser,
			optStr(d.marketId),
			str(d.title),
			optStr(d.details),
			timestamp,
			isoFromMs(msFromNs(doc.createdAtNs) ?? nowMs)
		]
	);

	return true;
});

/** Rewrite a legacy `${principal}#${ts}#${type}` activity key onto the mapped
 * user id, preserving the other segments. */
const mapActivityDocKey = async ({
	legacyKey,
	mapper
}: {
	legacyKey: string;
	mapper: PrincipalMapper;
}): Promise<string | undefined> => {
	const parts = legacyKey.split('#');

	if (parts.length !== 3) {
		return;
	}

	const [actor, ts, type] = parts as [string, string, string];

	if (actor === '' || !ACTIVITY_TYPES.has(type)) {
		return;
	}

	return `${await mapper.userIdFor(actor)}#${ts}#${type}`;
};

const REACTION_TITLE_MAX_LENGTH = 500;

const importActivityReactions: ImporterRun = perDoc(async (doc, { q, mapper, nowMs, stats }) => {
	const d = rec(doc.data);
	const activityKey = await mapActivityDocKey({ legacyKey: str(d.activityKey), mapper });
	const likerPrincipal = str(d.liker);

	if (isNullish(activityKey) || likerPrincipal === '') {
		stats.warnings.push(`activity_reactions: unsupported shape on ${doc.key}; skipped`);

		return false;
	}

	await q(
		`insert into activity_reactions (activity_key, liker, timestamp_ms, activity_title, market_id, created_at)
		 values ($1, $2, $3, $4, $5, $6)
		 on conflict (activity_key, liker) do nothing`,
		[
			activityKey,
			await mapper.userIdFor(likerPrincipal),
			num(d.timestamp),
			str(d.activityTitle).slice(0, REACTION_TITLE_MAX_LENGTH),
			optStr(d.marketId),
			isoFromMs(msFromNs(doc.createdAtNs) ?? nowMs)
		]
	);

	return true;
});

const importActivityReactionCounts: ImporterRun = perDoc(async (doc, { q, mapper, stats }) => {
	const d = rec(doc.data);
	const activityKey = await mapActivityDocKey({ legacyKey: str(d.activityKey, doc.key), mapper });

	if (isNullish(activityKey)) {
		stats.warnings.push(`activity_reaction_counts: unsupported key on ${doc.key}; skipped`);

		return false;
	}

	await q(
		`insert into activity_reaction_counts (activity_key, count, updated_at_ms)
		 values ($1, $2, $3)
		 on conflict (activity_key) do update set
		   count = excluded.count,
		   updated_at_ms = excluded.updated_at_ms`,
		[activityKey, Math.max(0, num(d.count)), num(d.updatedAtMs)]
	);

	return true;
});

// ---------------------------------------------------------------------------
// resolved_results

const importResolvedResults: ImporterRun = perDoc(async (doc, { q, mapper, stats }) => {
	const d = rec(doc.data);
	const outcome = str(d.outcome);
	const marketId = str(d.marketId);

	if ((outcome !== 'win' && outcome !== 'loss') || marketId === '') {
		stats.warnings.push(`resolved_results: unsupported shape on ${doc.key}; skipped`);

		return false;
	}

	await q(
		`insert into resolved_results (user_id, market_id, title, side, outcome, net_vxp, resolved_at_ms)
		 values ($1, $2, $3, $4, $5, $6, $7)
		 on conflict (user_id, market_id) do update set
		   title = excluded.title,
		   side = excluded.side,
		   outcome = excluded.outcome,
		   net_vxp = excluded.net_vxp,
		   resolved_at_ms = excluded.resolved_at_ms`,
		[
			await mapper.userIdFor(str(d.owner, doc.key.split('#')[0] ?? '')),
			marketId,
			str(d.title),
			str(d.side),
			outcome,
			num(d.netVxp),
			num(d.resolvedAtMs)
		]
	);

	return true;
});

// ---------------------------------------------------------------------------
// vxp_awards (+ onboarding and referral synthesis)

const AWARD_TYPES = new Set([
	'onboarding',
	'streak',
	'calibration',
	'referral',
	'worlds_podium',
	'tournament_prize',
	'achievement',
	'comeback',
	'flow_milestone',
	'flow_overtime',
	'league_founder'
]);

const AWARD_STATUSES = new Set(['pending', 'paid', 'failed']);

/** Insert an award row; an existing row only updates while still 'pending',
 * so progress recorded on either stack is never demoted or re-fired. */
const upsertAward = async ({
	q,
	userId,
	awardType,
	awardKey,
	amountBaseUnits,
	status,
	earnedAtMs,
	paidAtMs,
	blockIndex,
	errorMessage
}: {
	q: TxQuery;
	userId: string;
	awardType: string;
	awardKey: string;
	amountBaseUnits: bigint;
	status: string;
	earnedAtMs: number;
	paidAtMs?: number;
	blockIndex?: string;
	errorMessage?: string;
}): Promise<void> => {
	await q(
		`insert into vxp_awards (user_id, award_type, award_key, amount_base_units, status, earned_at_ms, paid_at_ms, block_index, error_message)
		 values ($1, $2, $3, $4, $5, $6, $7, $8, $9)
		 on conflict (user_id, award_type, award_key) do update set
		   status = excluded.status,
		   paid_at_ms = excluded.paid_at_ms,
		   block_index = excluded.block_index,
		   error_message = excluded.error_message
		 where vxp_awards.status = 'pending'`,
		[
			userId,
			awardType,
			awardKey,
			amountBaseUnits.toString(),
			status,
			earnedAtMs,
			paidAtMs ?? null,
			blockIndex ?? null,
			errorMessage ?? null
		]
	);
};

const parseBaseUnits = (v: unknown): bigint => {
	try {
		return BigInt(str(v, '0'));
	} catch {
		return ZERO;
	}
};

const importVxpAwards: ImporterRun = perDoc(async (doc, { q, mapper, stats }) => {
	const d = rec(doc.data);
	const awardType = str(d.awardType);
	const status = str(d.status);
	const amount = parseBaseUnits(d.amountBaseUnits);

	if (!AWARD_TYPES.has(awardType) || !AWARD_STATUSES.has(status) || amount <= ZERO) {
		stats.warnings.push(`vxp_awards: unsupported shape on ${doc.key}; skipped`);

		return false;
	}

	// Referral award keys are the referee's identifier: on the legacy
	// stack that is a principal, here the settlement path dedupes on the
	// referee's user id, so the key must be rewritten alongside it.
	const rawKey = str(d.awardKey);
	const awardKey =
		awardType === 'referral' && rawKey !== '' ? await mapper.userIdFor(rawKey) : rawKey;

	await upsertAward({
		q,
		userId: await mapper.userIdFor(str(d.recipient)),
		awardType,
		awardKey,
		amountBaseUnits: amount,
		status,
		earnedAtMs: num(d.earnedAtMs),
		paidAtMs: optNum(d.paidAtMs) ?? undefined,
		blockIndex: optStr(d.blockIndex) ?? undefined,
		errorMessage: optStr(d.errorMessage) ?? undefined
	});

	return true;
});

const ONBOARDING_MILESTONES = ['m1', 'm2', 'm3'] as const;

const importVxpOnboarding: ImporterRun = perDoc(async (doc, { q, mapper, nowMs }) => {
	const d = rec(doc.data);
	const milestones = rec(d.milestones);
	const userId = await mapper.userIdFor(doc.key);
	const stampMs = msFromNs(doc.updatedAtNs) ?? nowMs;
	let wrote = false;

	for (const milestone of ONBOARDING_MILESTONES) {
		const state = rec(milestones[milestone]);
		const status = str(state.status, 'none');
		const amount = parseBaseUnits(state.amountBaseUnits);

		if (status !== 'none' && amount > ZERO) {
			await upsertAward({
				q,
				userId,
				awardType: 'onboarding',
				awardKey: milestone,
				amountBaseUnits: amount,
				status: status === 'paid' ? 'paid' : 'pending',
				earnedAtMs: stampMs,
				paidAtMs: status === 'paid' ? stampMs : undefined,
				blockIndex: optStr(state.blockIndex) ?? undefined
			});
			wrote = true;
		}
	}

	return wrote;
});

// ---------------------------------------------------------------------------
// referral codes + referrals

const REFERRAL_CODE_RE = /^[0-9A-HJKMNP-TV-Z]{8}$/;

const importReferralCodes: ImporterRun = perDoc(async (doc, { q, mapper, stats }) => {
	const code = doc.key;

	if (!REFERRAL_CODE_RE.test(code)) {
		stats.warnings.push(`referral_codes: invalid code ${code}; skipped`);

		return false;
	}

	await q(
		`insert into referral_codes (code, owner_user_id) values ($1, $2)
		 on conflict do nothing`,
		[code, await mapper.userIdFor(str(rec(doc.data).owner))]
	);

	return true;
});

const importReferrals: ImporterRun = perDoc(async (doc, { q, mapper, nowMs, stats }) => {
	const d = rec(doc.data);
	const referee = await mapper.userIdFor(doc.key);
	const referrerPrincipal = str(d.referrer);

	if (referrerPrincipal === '' || referrerPrincipal === doc.key) {
		stats.warnings.push(`referrals: unsupported row on ${doc.key}; skipped`);

		return false;
	}

	const referrer = await mapper.userIdFor(referrerPrincipal);
	const stampMs = msFromNs(doc.updatedAtNs) ?? nowMs;

	// within_referrer_cap is write-once: an already-decided slot on this
	// side never moves, an undecided one adopts the exported decision.
	await q(
		`insert into referrals (referee_user_id, referrer_user_id, code, redeemed_at_ms, within_referrer_cap)
		 values ($1, $2, $3, $4, $5)
		 on conflict (referee_user_id) do update set
		   within_referrer_cap = coalesce(referrals.within_referrer_cap, excluded.within_referrer_cap)`,
		[referee, referrer, str(d.code), num(d.redeemedAtMs), bool(d.withinReferrerCap)]
	);

	// Payout sides become the vxp_awards rows the settlement path dedupes
	// on, so an already-paid legacy referral can never pay again here.
	const sides: Array<{ recipient: string; state: Record<string, unknown> }> = [
		{ recipient: referee, state: rec(d.refereePayout) },
		{ recipient: referrer, state: rec(d.referrerPayout) }
	];

	for (const { recipient, state } of sides) {
		const status = str(state.status, 'none');
		const amount = parseBaseUnits(state.amountBaseUnits);

		if (status !== 'none' && amount > ZERO) {
			await upsertAward({
				q,
				userId: recipient,
				awardType: 'referral',
				awardKey: referee,
				amountBaseUnits: amount,
				status: status === 'paid' ? 'paid' : 'pending',
				earnedAtMs: num(d.redeemedAtMs, stampMs),
				paidAtMs: status === 'paid' ? stampMs : undefined,
				blockIndex: optStr(state.blockIndex) ?? undefined
			});
		}
	}

	return true;
});

// ---------------------------------------------------------------------------
// leagues + members + stats

const LEAGUE_INVITE_CODE_RE = /^[A-Z0-9]{6}$/;

const leaguePrivacyOf = (d: Record<string, unknown>): 'open' | 'private' => {
	const privacy = optStr(d.privacy);

	if (nonNullish(privacy)) {
		return privacy === 'private' || privacy === 'invite' ? 'private' : 'open';
	}

	return d.private === true ? 'private' : 'open';
};

const importLeagues: ImporterRun = perDoc(async (doc, { q, mapper, nowMs, stats }) => {
	const d = rec(doc.data);
	const id = str(d.id, doc.key);
	const name = str(d.name);
	const inviteCode = str(d.inviteCode);

	if (name.length < 3 || name.length > 40 || !LEAGUE_INVITE_CODE_RE.test(inviteCode)) {
		stats.warnings.push(`leagues: invalid identity fields on ${doc.key}; skipped`);

		return false;
	}

	await q(
		`insert into leagues (id, name, description, invite_code, owner_user_id, created_at_ms,
		   accent_color, emblem, privacy, image_url, created_at, updated_at)
		 values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)
		 on conflict (id) do update set
		   name = excluded.name,
		   description = excluded.description,
		   owner_user_id = excluded.owner_user_id,
		   accent_color = excluded.accent_color,
		   emblem = excluded.emblem,
		   privacy = excluded.privacy,
		   image_url = excluded.image_url,
		   updated_at = excluded.updated_at`,
		[
			id,
			name,
			optStr(d.description)?.slice(0, 240) ?? null,
			inviteCode,
			await mapper.userIdFor(str(d.owner, doc.owner ?? '')),
			num(d.createdAtMs, msFromNs(doc.createdAtNs) ?? nowMs),
			optStr(d.accentColor),
			optStr(d.emblem),
			leaguePrivacyOf(d),
			optStr(d.imageUrl),
			isoFromMs(msFromNs(doc.createdAtNs) ?? nowMs),
			isoFromMs(msFromNs(doc.updatedAtNs) ?? nowMs)
		]
	);

	return true;
});

const leagueExists = (q: TxQuery, leagueId: string): Promise<boolean> =>
	rowExists(q, `select 1 as one from leagues where id = $1`, [leagueId]);

const LEAGUE_MEMBER_ROLES = new Set(['owner', 'admin', 'member']);

const importLeagueMembers: ImporterRun = perDoc(async (doc, { q, mapper, stats }) => {
	const d = rec(doc.data);
	const leagueId = str(d.leagueId, doc.key.split('/')[0] ?? '');
	const role = str(d.role);
	const memberPrincipal = str(d.member, doc.key.split('/')[1] ?? '');

	if (!LEAGUE_MEMBER_ROLES.has(role) || !(await leagueExists(q, leagueId))) {
		stats.warnings.push(`league_members: missing league or bad role on ${doc.key}; skipped`);

		return false;
	}

	await q(
		`insert into league_members (league_id, member_user_id, joined_at_ms, role)
		 values ($1, $2, $3, $4)
		 on conflict (league_id, member_user_id) do update set
		   joined_at_ms = excluded.joined_at_ms,
		   role = excluded.role`,
		[leagueId, await mapper.userIdFor(memberPrincipal), num(d.joinedAtMs), role]
	);

	return true;
});

const importLeagueStats: ImporterRun = perDoc(async (doc, { q, stats }) => {
	const d = rec(doc.data);
	const leagueId = str(d.leagueId, doc.key);

	if (!(await leagueExists(q, leagueId))) {
		stats.warnings.push(`league_stats: missing league ${leagueId}; skipped`);

		return false;
	}

	const totalCalls = Math.max(0, num(d.totalCalls));
	const wins = Math.min(totalCalls, Math.max(0, num(d.wins)));

	await q(
		`insert into league_stats (league_id, total_calls, wins, categories, updated_at_ms)
		 values ($1, $2, $3, $4, $5)
		 on conflict (league_id) do update set
		   total_calls = excluded.total_calls,
		   wins = excluded.wins,
		   categories = excluded.categories,
		   updated_at_ms = excluded.updated_at_ms`,
		[leagueId, totalCalls, wins, JSON.stringify(rec(d.categories)), num(d.updatedAtMs)]
	);

	return true;
});

// ---------------------------------------------------------------------------
// battles

const BATTLE_STATES = new Set([
	'proposed',
	'accepted',
	'in_flight',
	'resolved',
	'declined',
	'expired'
]);

const BATTLE_WINNERS = new Set(['A', 'B', 'draw']);

const clamp = ({ v, lo, hi }: { v: number; lo: number; hi: number }): number =>
	Math.min(hi, Math.max(lo, v));

const importBattles: ImporterRun = perDoc(async (doc, { q, mapper, nowMs, stats }) => {
	const d = rec(doc.data);
	const kind = str(d.kind);
	const state = str(d.state);
	const kickoffMs = num(d.kickoffMs);
	const settleMs = num(d.settleMs);

	if (
		(kind !== 'league' && kind !== 'duel') ||
		!BATTLE_STATES.has(state) ||
		kickoffMs >= settleMs
	) {
		stats.warnings.push(`battles: unsupported shape on ${doc.key}; skipped`);

		return false;
	}

	// Duel sides are principals on the legacy stack, user ids here;
	// league sides keep the league id text either way.
	const mapSide = async (side: string): Promise<string> =>
		kind === 'duel' ? await mapper.userIdFor(side) : side;

	const winner = optStr(d.winner);
	const wager = optNum(d.wager);
	const scoreA = optNum(d.scoreA);
	const scoreB = optNum(d.scoreB);

	await q(
		`insert into battles (id, kind, side_a, side_b, proposer_user_id, state, kickoff_ms, settle_ms,
		   scope, wager, trash_talk, respond_by_ms, responded_at_ms, baseline_a, baseline_b,
		   score_a, score_b, calls_a, calls_b, winner, resolved_at_ms, created_at, updated_at)
		 values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18,
		   $19, $20, $21, $22, $23)
		 on conflict (id) do update set
		   state = excluded.state,
		   respond_by_ms = excluded.respond_by_ms,
		   responded_at_ms = excluded.responded_at_ms,
		   baseline_a = excluded.baseline_a,
		   baseline_b = excluded.baseline_b,
		   score_a = excluded.score_a,
		   score_b = excluded.score_b,
		   calls_a = excluded.calls_a,
		   calls_b = excluded.calls_b,
		   winner = excluded.winner,
		   resolved_at_ms = excluded.resolved_at_ms,
		   updated_at = excluded.updated_at`,
		[
			str(d.id, doc.key),
			kind,
			await mapSide(str(d.sideA)),
			await mapSide(str(d.sideB)),
			await mapper.userIdFor(str(d.proposer)),
			state,
			kickoffMs,
			settleMs,
			optStr(d.scope),
			nonNullish(wager) ? clamp({ v: wager, lo: 0, hi: 500 }) : null,
			optStr(d.trashTalk)?.slice(0, 60) ?? null,
			optNum(d.respondByMs),
			optNum(d.respondedAtMs),
			nonNullish(d.baselineA) ? JSON.stringify(d.baselineA) : null,
			nonNullish(d.baselineB) ? JSON.stringify(d.baselineB) : null,
			nonNullish(scoreA) ? clamp({ v: scoreA, lo: 0, hi: 100 }) : null,
			nonNullish(scoreB) ? clamp({ v: scoreB, lo: 0, hi: 100 }) : null,
			nonNullish(optNum(d.callsA)) ? Math.max(0, num(d.callsA)) : null,
			nonNullish(optNum(d.callsB)) ? Math.max(0, num(d.callsB)) : null,
			nonNullish(winner) && BATTLE_WINNERS.has(winner) ? winner : null,
			optNum(d.resolvedAtMs),
			isoFromMs(msFromNs(doc.createdAtNs) ?? nowMs),
			isoFromMs(msFromNs(doc.updatedAtNs) ?? nowMs)
		]
	);

	return true;
});

// ---------------------------------------------------------------------------
// affiliations + affiliation_stats

const AFFILIATION_KINDS = new Set(['university', 'country']);

const importAffiliations: ImporterRun = perDoc(async (doc, { q, mapper, stats }) => {
	const d = rec(doc.data);
	const kind = str(d.kind);
	const identifier = str(d.affiliationIdentifier);

	if (!AFFILIATION_KINDS.has(kind) || identifier === '') {
		stats.warnings.push(`affiliations: unsupported shape on ${doc.key}; skipped`);

		return false;
	}

	await q(
		`insert into affiliations (member_user_id, kind, affiliation_identifier, joined_at_ms, locked_until_ms)
		 values ($1, $2, $3, $4, $5)
		 on conflict (member_user_id, kind) do update set
		   affiliation_identifier = excluded.affiliation_identifier,
		   joined_at_ms = excluded.joined_at_ms,
		   locked_until_ms = excluded.locked_until_ms`,
		[
			await mapper.userIdFor(str(d.member, doc.key.split('/')[0] ?? '')),
			kind,
			identifier,
			num(d.joinedAtMs),
			num(d.lockedUntilMs)
		]
	);

	return true;
});

const importAffiliationStats: ImporterRun = perDoc(async (doc, { q, stats }) => {
	const d = rec(doc.data);
	const kind = str(d.kind);
	const identifier = str(d.affiliationIdentifier);
	const monthAnchor = str(d.monthAnchor);

	if (!AFFILIATION_KINDS.has(kind) || identifier === '' || !MONTH_ANCHOR_RE.test(monthAnchor)) {
		stats.warnings.push(`affiliation_stats: unsupported shape on ${doc.key}; skipped`);

		return false;
	}

	const totalCalls = Math.max(0, num(d.totalCalls));
	const wins = Math.min(totalCalls, Math.max(0, num(d.wins)));
	const monthTotalCalls = Math.max(0, num(d.monthTotalCalls));
	const monthWins = Math.min(monthTotalCalls, Math.max(0, num(d.monthWins)));

	await q(
		`insert into affiliation_stats (kind, affiliation_identifier, month_anchor, total_calls, wins,
		   month_total_calls, month_wins, updated_at_ms)
		 values ($1, $2, $3, $4, $5, $6, $7, $8)
		 on conflict (kind, affiliation_identifier, month_anchor) do update set
		   total_calls = excluded.total_calls,
		   wins = excluded.wins,
		   month_total_calls = excluded.month_total_calls,
		   month_wins = excluded.month_wins,
		   updated_at_ms = excluded.updated_at_ms`,
		[
			kind,
			identifier,
			monthAnchor,
			totalCalls,
			wins,
			monthTotalCalls,
			monthWins,
			num(d.updatedAtMs)
		]
	);

	return true;
});

// ---------------------------------------------------------------------------
// tournaments + matches

const TOURNAMENT_ROUNDS = new Set(['r1', 'quarter', 'semifinal', 'final']);

const importTournaments: ImporterRun = perDoc(async (doc, { q, stats }) => {
	const d = rec(doc.data);
	const id = str(d.id, doc.key);
	const state = str(d.state);

	if (!MONTH_ANCHOR_RE.test(id) || (state !== 'in_flight' && state !== 'concluded')) {
		stats.warnings.push(`tournaments: unsupported shape on ${doc.key}; skipped`);

		return false;
	}

	await q(
		`insert into tournaments (id, month_start_ms, month_end_ms, bracket_size, state, seeded_league_ids, created_at_ms)
		 values ($1, $2, $3, $4, $5, $6, $7)
		 on conflict (id) do update set
		   state = excluded.state,
		   seeded_league_ids = excluded.seeded_league_ids`,
		[
			id,
			num(d.monthStartMs),
			num(d.monthEndMs),
			num(d.bracketSize),
			state,
			JSON.stringify(strArr(d.seededLeagueIds)),
			num(d.createdAtMs)
		]
	);

	return true;
});

const importTournamentMatches: ImporterRun = perDoc(async (doc, { q, stats }) => {
	const d = rec(doc.data);
	const tournamentId = str(d.tournamentId, doc.key.split('/')[0] ?? '');
	const round = str(d.round);
	const index = num(d.index, -1);
	const startMs = num(d.startMs);
	const endMs = num(d.endMs);

	if (
		!TOURNAMENT_ROUNDS.has(round) ||
		index < 0 ||
		endMs <= startMs ||
		!(await rowExists(q, `select 1 as one from tournaments where id = $1`, [tournamentId]))
	) {
		stats.warnings.push(`tournament_matches: unsupported shape on ${doc.key}; skipped`);

		return false;
	}

	await q(
		`insert into tournament_matches (tournament_id, round, index, from_league_id, to_league_id,
		   from_start_calls, from_start_wins, to_start_calls, to_start_wins, from_acc, to_acc,
		   winner_league_id, start_ms, end_ms)
		 values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14)
		 on conflict (tournament_id, round, index) do update set
		   from_league_id = excluded.from_league_id,
		   to_league_id = excluded.to_league_id,
		   from_start_calls = excluded.from_start_calls,
		   from_start_wins = excluded.from_start_wins,
		   to_start_calls = excluded.to_start_calls,
		   to_start_wins = excluded.to_start_wins,
		   from_acc = excluded.from_acc,
		   to_acc = excluded.to_acc,
		   winner_league_id = excluded.winner_league_id`,
		[
			tournamentId,
			round,
			index,
			optStr(d.fromLeagueId),
			optStr(d.toLeagueId),
			optNum(d.fromStartCalls),
			optNum(d.fromStartWins),
			optNum(d.toStartCalls),
			optNum(d.toStartWins),
			optNum(d.fromAcc),
			optNum(d.toAcc),
			optStr(d.winnerLeagueId),
			startMs,
			endMs
		]
	);

	return true;
});

// ---------------------------------------------------------------------------
// schools

const importSchools: ImporterRun = perDoc(async (doc, { q, nowMs, stats }) => {
	const d = rec(doc.data);
	const schoolId = str(d.schoolId, doc.key);
	const status = str(d.status, 'pending');

	if (schoolId === '' || (status !== 'pending' && status !== 'public')) {
		stats.warnings.push(`schools: unsupported shape on ${doc.key}; skipped`);

		return false;
	}

	await q(
		`insert into schools (school_id, name, country, domains, verified_member_count, status, created_at_ms, updated_at_ms)
		 values ($1, $2, $3, $4, $5, $6, $7, $8)
		 on conflict (school_id) do update set
		   name = excluded.name,
		   country = excluded.country,
		   domains = excluded.domains,
		   verified_member_count = excluded.verified_member_count,
		   status = excluded.status,
		   updated_at_ms = excluded.updated_at_ms`,
		[
			schoolId,
			str(d.name),
			optStr(d.country),
			strArr(d.domains),
			Math.max(0, num(d.verifiedMemberCount)),
			status,
			num(d.createdAtMs, msFromNs(doc.createdAtNs) ?? nowMs),
			num(d.updatedAtMs, msFromNs(doc.updatedAtNs) ?? nowMs)
		]
	);

	return true;
});

// ---------------------------------------------------------------------------
// market metadata + translations + tag index

const importMarketMetadata: ImporterRun = perDoc(async (doc, { q, mapper }) => {
	const d = rec(doc.data);
	const seriesId = str(d.seriesId, doc.key);

	await q(
		`insert into market_metadata (series_id, why_now, events, tags, suggested, subtitle, updated_at_ms, updated_by)
		 values ($1, $2, $3, $4, $5, $6, $7, $8)
		 on conflict (series_id) do update set
		   why_now = excluded.why_now,
		   events = excluded.events,
		   tags = excluded.tags,
		   suggested = excluded.suggested,
		   subtitle = excluded.subtitle,
		   updated_at_ms = excluded.updated_at_ms,
		   updated_by = excluded.updated_by`,
		[
			seriesId,
			nonNullish(d.whyNow) ? JSON.stringify(d.whyNow) : null,
			JSON.stringify(arr(d.events)),
			JSON.stringify(strArr(d.tags)),
			bool(d.suggested),
			optStr(d.subtitle),
			num(d.updatedAt),
			// Curators are existing accounts or nobody: a provisional user
			// is never minted for an editorial byline.
			mapper.lookup(str(d.updatedBy)) ?? null
		]
	);

	return true;
});

const importMarketTranslations: ImporterRun = perDoc(async (doc, { q, mapper, stats }) => {
	const d = rec(doc.data);
	const seriesId = str(d.seriesId);
	const locale = str(d.locale);

	if (seriesId === '' || locale === '') {
		stats.warnings.push(`market_translations: unsupported shape on ${doc.key}; skipped`);

		return false;
	}

	await q(
		`insert into market_translations (series_id, locale, title, description, resolution, outcomes, updated_at_ms, updated_by)
		 values ($1, $2, $3, $4, $5, $6, $7, $8)
		 on conflict (series_id, locale) do update set
		   title = excluded.title,
		   description = excluded.description,
		   resolution = excluded.resolution,
		   outcomes = excluded.outcomes,
		   updated_at_ms = excluded.updated_at_ms,
		   updated_by = excluded.updated_by`,
		[
			seriesId,
			locale,
			str(d.title),
			str(d.description),
			str(d.resolution),
			JSON.stringify(arr(d.outcomes)),
			num(d.updatedAt),
			mapper.lookup(str(d.updatedBy)) ?? null
		]
	);

	return true;
});

const importMarketTagIndex: ImporterRun = perDoc(async (doc, { q, stats }) => {
	const d = rec(doc.data);
	const tag = str(d.tag, doc.key);
	let wroteAny = false;

	for (const seriesId of strArr(d.seriesIds)) {
		// The row references market_metadata; an unknown series (metadata
		// doc missing from the export) cannot be indexed.
		const known = await rowExists(q, `select 1 as one from market_metadata where series_id = $1`, [
			seriesId
		]);

		if (known) {
			await q(
				`insert into market_tag_index (tag, series_id) values ($1, $2)
				 on conflict (tag, series_id) do nothing`,
				[tag, seriesId]
			);
			wroteAny = true;
		} else {
			stats.warnings.push(`market_tag_index: unknown series ${seriesId} under ${tag}; skipped`);
		}
	}

	return wroteAny;
});

// ---------------------------------------------------------------------------
// exit_signals + app_config

const EXIT_REASONS = new Set(['not-for-me', 'too-busy', 'privacy', 'duplicate', 'bugs', 'other']);

/** A stable uuid for a legacy doc key that is not itself a uuid, so re-import
 * collides instead of duplicating the anonymous log. */
const uuidFromKey = (key: string): string => {
	const hex = createHash('sha256').update(key).digest('hex').slice(0, 32);

	return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20, 32)}`;
};

const importExitSignals: ImporterRun = perDoc(async (doc, { q, nowMs, stats }) => {
	const d = rec(doc.data);
	const reason = str(d.reason);

	if (!EXIT_REASONS.has(reason)) {
		stats.warnings.push(`exit_signals: unsupported reason on ${doc.key}; skipped`);

		return false;
	}

	await q(
		`insert into exit_signals (id, reason, note, created_at_ms)
		 values ($1, $2, $3, $4)
		 on conflict (id) do nothing`,
		[
			UUID_RE.test(doc.key) ? doc.key : uuidFromKey(doc.key),
			reason,
			str(d.note).slice(0, 240),
			num(d.createdAtMs, msFromNs(doc.createdAtNs) ?? nowMs)
		]
	);

	return true;
});

const importProfilePrivate: ImporterRun = perDoc(async (doc, { q, mapper }) => {
	const d = rec(doc.data);
	const email = str(d.email).trim();

	if (email === '') {
		return false;
	}

	// The address moved off the public profiles doc into this owner-private
	// collection; on this stack it lands back on the profiles row, which is
	// not publicly readable here.
	const userId = await mapper.userIdFor(doc.key);
	await q(`update profiles set email = $2 where user_id = $1`, [userId, email]);

	return true;
});

const importAppConfig: ImporterRun = perDoc(async (doc, { q }) => {
	// Settings managed on this stack win: existing keys are never
	// overwritten by an import pass.
	await q(
		`insert into app_settings (key, value) values ($1, $2)
		 on conflict (key) do nothing`,
		[doc.key, JSON.stringify(doc.data ?? null)]
	);

	return true;
});

// ---------------------------------------------------------------------------
// Registry (in import order: user-owned rows first, FK targets before their
// dependents)

export const IMPORTERS: CollectionImporter[] = [
	{
		collection: 'profiles',
		mode: 'import',
		run: importProfiles,
		pgCount: (q) => countSql(q, `select count(*)::text as count from profiles`),
		exists: (doc, { q, mapper }) => {
			const userId = mapper.lookup(str(rec(doc.data).owner, doc.key));

			return nonNullish(userId)
				? rowExists(q, `select 1 as one from profiles where user_id = $1`, [userId])
				: Promise.resolve(false);
		}
	},
	{
		collection: 'user_stats',
		mode: 'import',
		run: importUserStats,
		pgCount: (q) => countSql(q, `select count(*)::text as count from user_stats`),
		exists: (doc, { q, mapper }) => {
			const userId = mapper.lookup(str(rec(doc.data).owner, doc.key));

			return nonNullish(userId)
				? rowExists(q, `select 1 as one from user_stats where user_id = $1`, [userId])
				: Promise.resolve(false);
		}
	},
	{
		collection: 'user_monthly_stats',
		mode: 'import',
		run: importUserMonthlyStats,
		pgCount: (q) => countSql(q, `select count(*)::text as count from user_monthly_stats`),
		exists: (doc, { q, mapper }) => {
			const d = rec(doc.data);
			const userId = mapper.lookup(str(d.owner));

			return nonNullish(userId)
				? rowExists(
						q,
						`select 1 as one from user_monthly_stats where user_id = $1 and month_anchor = $2`,
						[userId, str(d.monthAnchor)]
					)
				: Promise.resolve(false);
		}
	},
	{
		collection: 'roles',
		mode: 'import',
		run: importRoles,
		pgCount: (q) =>
			countSql(
				q,
				`select count(*)::text as count from users where role in ('admin', 'solver', 'creator')`
			)
	},
	{
		collection: 'relations',
		mode: 'import',
		run: importRelations,
		pgCount: (q) => countSql(q, `select count(*)::text as count from relations`)
	},
	{
		collection: 'activities',
		mode: 'import',
		run: importActivities,
		pgCount: (q) => countSql(q, `select count(*)::text as count from activities`)
	},
	{
		collection: 'activity_reactions',
		mode: 'import',
		run: importActivityReactions,
		pgCount: (q) => countSql(q, `select count(*)::text as count from activity_reactions`)
	},
	{
		collection: 'activity_reaction_counts',
		mode: 'import',
		run: importActivityReactionCounts,
		pgCount: (q) => countSql(q, `select count(*)::text as count from activity_reaction_counts`)
	},
	{
		collection: 'resolved_results',
		mode: 'import',
		run: importResolvedResults,
		pgCount: (q) => countSql(q, `select count(*)::text as count from resolved_results`)
	},
	{
		collection: 'vxp_awards',
		mode: 'import',
		run: importVxpAwards,
		pgCount: (q) =>
			countSql(q, `select count(*)::text as count from vxp_awards where award_type <> 'onboarding'`)
	},
	{
		collection: 'vxp_onboarding',
		mode: 'import',
		run: importVxpOnboarding,
		pgCount: (q) =>
			countSql(
				q,
				`select count(distinct user_id)::text as count from vxp_awards where award_type = 'onboarding'`
			)
	},
	{
		collection: 'referral_codes',
		mode: 'import',
		run: importReferralCodes,
		pgCount: (q) => countSql(q, `select count(*)::text as count from referral_codes`)
	},
	{
		collection: 'referrals',
		mode: 'import',
		run: importReferrals,
		pgCount: (q) => countSql(q, `select count(*)::text as count from referrals`)
	},
	{
		collection: 'leagues',
		mode: 'import',
		run: importLeagues,
		pgCount: (q) => countSql(q, `select count(*)::text as count from leagues`),
		exists: (doc, { q }) =>
			rowExists(q, `select 1 as one from leagues where id = $1`, [str(rec(doc.data).id, doc.key)])
	},
	{
		collection: 'league_members',
		mode: 'import',
		run: importLeagueMembers,
		pgCount: (q) => countSql(q, `select count(*)::text as count from league_members`)
	},
	{
		collection: 'league_stats',
		mode: 'import',
		run: importLeagueStats,
		pgCount: (q) => countSql(q, `select count(*)::text as count from league_stats`)
	},
	{
		collection: 'battles',
		mode: 'import',
		run: importBattles,
		pgCount: (q) => countSql(q, `select count(*)::text as count from battles`),
		exists: (doc, { q }) =>
			rowExists(q, `select 1 as one from battles where id = $1`, [str(rec(doc.data).id, doc.key)])
	},
	{
		collection: 'affiliations',
		mode: 'import',
		run: importAffiliations,
		pgCount: (q) => countSql(q, `select count(*)::text as count from affiliations`)
	},
	{
		collection: 'affiliation_stats',
		mode: 'import',
		run: importAffiliationStats,
		pgCount: (q) => countSql(q, `select count(*)::text as count from affiliation_stats`)
	},
	{
		collection: 'tournaments',
		mode: 'import',
		run: importTournaments,
		pgCount: (q) => countSql(q, `select count(*)::text as count from tournaments`)
	},
	{
		collection: 'tournament_matches',
		mode: 'import',
		run: importTournamentMatches,
		pgCount: (q) => countSql(q, `select count(*)::text as count from tournament_matches`)
	},
	{
		collection: 'schools',
		mode: 'import',
		run: importSchools,
		pgCount: (q) => countSql(q, `select count(*)::text as count from schools`),
		exists: (doc, { q }) =>
			rowExists(q, `select 1 as one from schools where school_id = $1`, [
				str(rec(doc.data).schoolId, doc.key)
			])
	},
	{
		collection: 'school_submissions',
		mode: 'skip',
		skipReason:
			'ephemeral verification codes (salted digests with a short TTL); the durable outcome already lands via schools and profiles.school_status'
	},
	{
		collection: 'market_metadata',
		mode: 'import',
		run: importMarketMetadata,
		pgCount: (q) => countSql(q, `select count(*)::text as count from market_metadata`),
		exists: (doc, { q }) =>
			rowExists(q, `select 1 as one from market_metadata where series_id = $1`, [
				str(rec(doc.data).seriesId, doc.key)
			])
	},
	{
		collection: 'market_translations',
		mode: 'import',
		run: importMarketTranslations,
		pgCount: (q) => countSql(q, `select count(*)::text as count from market_translations`)
	},
	{
		collection: 'market_tag_index',
		mode: 'import',
		run: importMarketTagIndex,
		pgCount: (q) => countSql(q, `select count(distinct tag)::text as count from market_tag_index`)
	},
	{
		collection: 'exit_signals',
		mode: 'import',
		run: importExitSignals,
		pgCount: (q) => countSql(q, `select count(*)::text as count from exit_signals`)
	},
	{
		collection: 'app_config',
		mode: 'import',
		run: importAppConfig,
		pgCount: (q) => countSql(q, `select count(*)::text as count from app_settings`)
	},
	{
		collection: 'profile_private',
		mode: 'import',
		run: importProfilePrivate,
		pgCount: (q) => countSql(q, `select count(*)::text as count from profiles where email <> ''`)
	},
	{
		collection: 'chats',
		mode: 'skip',
		skipReason: 'dormant surface with no target table'
	},
	{
		collection: 'comments',
		mode: 'skip',
		skipReason: 'dormant surface with no target table'
	},
	{
		collection: 'events',
		mode: 'skip',
		skipReason: 'behavioural history already drained to the warehouse via the analytics export'
	},
	{
		collection: 'event_rollups',
		mode: 'skip',
		skipReason: 'derived from events, which are skipped; rollups rebuild from fresh ingest'
	}
];

export const importerFor = (collection: string): CollectionImporter | undefined =>
	IMPORTERS.find((importer) => importer.collection === collection);

/**
 * Import one collection's exported docs: one transaction, statement timeout
 * lifted (bulk import), principal map preloaded. Returns the run stats.
 */
export const importDocs = async ({
	collection,
	docs,
	nowMs = Date.now()
}: {
	collection: string;
	docs: ExportedDoc[];
	nowMs?: number;
}): Promise<ImportStats> => {
	const importer = importerFor(collection);

	if (isNullish(importer)) {
		throw new Error(`Unknown collection: ${collection}`);
	}

	if (importer.mode === 'skip' || isNullish(importer.run)) {
		return {
			imported: 0,
			skipped: docs.length,
			createdUsers: 0,
			warnings: [`${collection}: skipped (${importer.skipReason ?? 'not imported'})`]
		};
	}

	const { run } = importer;

	return await tx(async (q) => {
		await q(`set local statement_timeout = 0`);

		const mapper = new PrincipalMapper(q);

		await mapper.load();

		const stats: ImportStats = { imported: 0, skipped: 0, createdUsers: 0, warnings: [] };

		await run(docs, { q, mapper, nowMs, stats });

		stats.createdUsers = mapper.createdCount;

		return stats;
	});
};
