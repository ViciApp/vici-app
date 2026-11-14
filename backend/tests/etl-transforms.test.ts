// The ETL per-collection transforms: principal mapping (including the
// provisional claim_pending account path), idempotent re-import convergence,
// award status preservation across the pending-only update clause, key
// rewrites onto user ids, FK-guarded skips, and the documented skips.

import { beforeAll, describe, expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { SATELLITE_COLLECTIONS, type ExportedDoc } from '../scripts/etl/lib';
import { importDocs, importerFor, IMPORTERS } from '../scripts/etl/transforms';
import { query } from '../src/db/client';
import { ensureMigrated, uniquePrincipal } from './helpers/auth';
import { uniqueNickname } from './helpers/profiles';
import { dbAvailable } from './helpers/setup';

const doc = ({
	key,
	data,
	createdAtNs = '1700000000000000000',
	updatedAtNs = '1710000000000000000'
}: {
	key: string;
	data: unknown;
	createdAtNs?: string;
	updatedAtNs?: string;
}): ExportedDoc => ({ key, data, createdAtNs, updatedAtNs });

const profileDoc = (principal: string, nickname: string, extra: Record<string, unknown> = {}) =>
	doc({
		key: principal,
		data: {
			owner: principal,
			nickname,
			email: 'imported@test.vici.invalid',
			pnl: 12.5,
			visibility: 'public',
			totalTrades: 42,
			points: 990,
			level: 5,
			dailyGoalDone: 3,
			dailyGoalDate: '2026-08-01',
			deletedAtMs: undefined,
			preferences: { hapticsEnabled: false },
			...extra
		}
	});

const userIdForPrincipal = async (principal: string): Promise<string | undefined> => {
	const rows = await query<{ user_id: string }>(
		`select user_id from legacy_principals where principal = $1`,
		[principal]
	);

	return rows[0]?.user_id;
};

describe('etl collection registry', () => {
	test('covers every satellite collection exactly once', () => {
		const registered = IMPORTERS.map(({ collection }) => collection).sort();

		expect(registered).toEqual([...SATELLITE_COLLECTIONS].sort());
		expect(new Set(registered).size).toBe(registered.length);
	});

	test('matches the app collection catalog on disk', () => {
		const catalog = JSON.parse(
			readFileSync(join(import.meta.dir, '../../juno.collections.json'), 'utf8')
		) as Record<string, string>;

		const registered: string[] = [...SATELLITE_COLLECTIONS];

		expect(registered.sort()).toEqual(Object.values(catalog).sort());
	});

	test('skipped collections declare a reason and import nothing', async () => {
		for (const collection of [
			'school_submissions',
			'events',
			'event_rollups',
			'chats',
			'comments'
		]) {
			const importer = importerFor(collection);

			expect(importer?.mode).toBe('skip');
			expect(importer?.skipReason ?? '').not.toBe('');

			const stats = await importDocs({
				collection,
				docs: [doc({ key: 'x', data: {} })]
			});

			expect(stats.imported).toBe(0);
			expect(stats.skipped).toBe(1);
		}
	});
});

describe.if(dbAvailable)('principal mapping', () => {
	beforeAll(async () => {
		await ensureMigrated();
	});

	test('creates a provisional claim_pending user and etl link for unmatched principals', async () => {
		const principal = uniquePrincipal();
		const stats = await importDocs({
			collection: 'profiles',
			docs: [profileDoc(principal, uniqueNickname())]
		});

		expect(stats.imported).toBe(1);
		expect(stats.createdUsers).toBe(1);

		const userId = await userIdForPrincipal(principal);

		expect(userId).toBeDefined();

		const users = await query<{ claim_pending: boolean; role: string }>(
			`select claim_pending, role from users where id = $1`,
			[userId]
		);

		expect(users[0]?.claim_pending).toBe(true);

		const links = await query<{ matched_via: string }>(
			`select matched_via from legacy_principals where principal = $1`,
			[principal]
		);

		expect(links[0]?.matched_via).toBe('etl');
	});

	test('reuses an existing legacy principal link instead of creating a user', async () => {
		const principal = uniquePrincipal();
		const rows = await query<{ id: string }>(`insert into users default values returning id`);
		const existingUserId = rows[0]?.id;

		await query(
			`insert into legacy_principals (principal, user_id, matched_via) values ($1, $2, 'openid_email')`,
			[principal, existingUserId]
		);

		const stats = await importDocs({
			collection: 'profiles',
			docs: [profileDoc(principal, uniqueNickname())]
		});

		expect(stats.createdUsers).toBe(0);

		const profiles = await query<{ nickname: string }>(
			`select nickname from profiles where user_id = $1`,
			[existingUserId]
		);

		expect(profiles).toHaveLength(1);
	});
});

describe.if(dbAvailable)('profiles import', () => {
	beforeAll(async () => {
		await ensureMigrated();
	});

	test('maps fields and re-imports idempotently', async () => {
		const principal = uniquePrincipal();
		const nickname = uniqueNickname();
		const docs = [profileDoc(principal, nickname, { hibernatedAtMs: 1720000000000 })];

		await importDocs({ collection: 'profiles', docs });

		const again = await importDocs({ collection: 'profiles', docs });

		expect(again.createdUsers).toBe(0);

		const userId = await userIdForPrincipal(principal);
		const rows = await query<{
			nickname: string;
			nickname_key: string;
			visibility: string;
			points: number;
			hibernated_at_ms: string | null;
			deleted_at_ms: string | null;
		}>(
			`select nickname, nickname_key, visibility, points, hibernated_at_ms::text, deleted_at_ms::text
			 from profiles where user_id = $1`,
			[userId]
		);

		expect(rows).toHaveLength(1);
		expect(rows[0]?.nickname).toBe(nickname);
		expect(rows[0]?.nickname_key).toBe(nickname.toLowerCase());
		expect(rows[0]?.visibility).toBe('public');
		expect(rows[0]?.points).toBe(990);
		expect(rows[0]?.hibernated_at_ms).toBe('1720000000000');
		expect(rows[0]?.deleted_at_ms).toBeNull();
	});

	test('a nickname fold conflict imports without a reserved handle', async () => {
		const nickname = uniqueNickname();

		await importDocs({
			collection: 'profiles',
			docs: [profileDoc(uniquePrincipal(), nickname)]
		});

		const loser = uniquePrincipal();
		const stats = await importDocs({
			collection: 'profiles',
			docs: [profileDoc(loser, nickname.toUpperCase())]
		});

		expect(stats.imported).toBe(1);
		expect(stats.warnings.some((w) => w.includes('nickname fold conflict'))).toBe(true);

		const userId = await userIdForPrincipal(loser);
		const rows = await query<{ nickname_key: string }>(
			`select nickname_key from profiles where user_id = $1`,
			[userId]
		);

		expect(rows[0]?.nickname_key).toBe('');
	});
});

describe.if(dbAvailable)('vxp awards import', () => {
	beforeAll(async () => {
		await ensureMigrated();
	});

	test('preserves the exported status verbatim, paid stays paid', async () => {
		const paidPrincipal = uniquePrincipal();
		const pendingPrincipal = uniquePrincipal();

		const stats = await importDocs({
			collection: 'vxp_awards',
			docs: [
				doc({
					key: `${paidPrincipal}/streak/streak_7`,
					data: {
						recipient: paidPrincipal,
						awardType: 'streak',
						awardKey: 'streak_7',
						amountBaseUnits: '1500000',
						status: 'paid',
						earnedAtMs: 1715000000000,
						paidAtMs: 1715000005000,
						blockIndex: '42'
					}
				}),
				doc({
					key: `${pendingPrincipal}/achievement/owl`,
					data: {
						recipient: pendingPrincipal,
						awardType: 'achievement',
						awardKey: 'owl',
						amountBaseUnits: '250000',
						status: 'pending',
						earnedAtMs: 1716000000000
					}
				})
			]
		});

		expect(stats.imported).toBe(2);

		const paidUser = await userIdForPrincipal(paidPrincipal);
		const paidRows = await query<{ status: string; block_index: string | null }>(
			`select status, block_index from vxp_awards where user_id = $1 and award_type = 'streak' and award_key = 'streak_7'`,
			[paidUser]
		);

		expect(paidRows[0]?.status).toBe('paid');
		expect(paidRows[0]?.block_index).toBe('42');

		const pendingUser = await userIdForPrincipal(pendingPrincipal);
		const pendingRows = await query<{ status: string }>(
			`select status from vxp_awards where user_id = $1 and award_type = 'achievement'`,
			[pendingUser]
		);

		expect(pendingRows[0]?.status).toBe('pending');
	});

	test('re-import never demotes a paid row back to pending', async () => {
		const principal = uniquePrincipal();
		const paid = doc({
			key: `${principal}/flow_milestone/10`,
			data: {
				recipient: principal,
				awardType: 'flow_milestone',
				awardKey: '10',
				amountBaseUnits: '500000',
				status: 'paid',
				earnedAtMs: 1715000000000,
				paidAtMs: 1715000001000
			}
		});

		await importDocs({ collection: 'vxp_awards', docs: [paid] });

		// A stale export re-imported after the payout landed must not undo it.
		const stale = structuredClone(paid);

		(stale.data as Record<string, unknown>).status = 'pending';
		delete (stale.data as Record<string, unknown>).paidAtMs;

		await importDocs({ collection: 'vxp_awards', docs: [stale] });

		const userId = await userIdForPrincipal(principal);
		const rows = await query<{ status: string; paid_at_ms: string | null }>(
			`select status, paid_at_ms::text from vxp_awards where user_id = $1 and award_type = 'flow_milestone'`,
			[userId]
		);

		expect(rows).toHaveLength(1);
		expect(rows[0]?.status).toBe('paid');
		expect(rows[0]?.paid_at_ms).toBe('1715000001000');
	});

	test('a pending row adopts the exported paid progression on re-import', async () => {
		const principal = uniquePrincipal();
		const base = {
			recipient: principal,
			awardType: 'worlds_podium',
			awardKey: '2026-07_1',
			amountBaseUnits: '10000000',
			earnedAtMs: 1717000000000
		};

		await importDocs({
			collection: 'vxp_awards',
			docs: [doc({ key: 'k', data: { ...base, status: 'pending' } })]
		});
		await importDocs({
			collection: 'vxp_awards',
			docs: [doc({ key: 'k', data: { ...base, status: 'paid', paidAtMs: 1717000002000 } })]
		});

		const userId = await userIdForPrincipal(principal);
		const rows = await query<{ status: string }>(
			`select status from vxp_awards where user_id = $1 and award_type = 'worlds_podium'`,
			[userId]
		);

		expect(rows[0]?.status).toBe('paid');
	});

	test('onboarding milestones synthesize idempotent onboarding awards', async () => {
		const principal = uniquePrincipal();
		const onboardingDoc = doc({
			key: principal,
			data: {
				version: 1,
				tradeCount: 6,
				milestones: {
					m1: { status: 'paid', amountBaseUnits: '15000000', blockIndex: '7' },
					m2: { status: 'owed', amountBaseUnits: '1000000' },
					m3: { status: 'none', amountBaseUnits: '0' }
				}
			}
		});

		await importDocs({ collection: 'vxp_onboarding', docs: [onboardingDoc] });
		await importDocs({ collection: 'vxp_onboarding', docs: [onboardingDoc] });

		const userId = await userIdForPrincipal(principal);
		const rows = await query<{ award_key: string; status: string }>(
			`select award_key, status from vxp_awards
			 where user_id = $1 and award_type = 'onboarding' order by award_key`,
			[userId]
		);

		expect(rows).toEqual([
			{ award_key: 'm1', status: 'paid' },
			{ award_key: 'm2', status: 'pending' }
		]);
	});
});

describe.if(dbAvailable)('referrals import', () => {
	beforeAll(async () => {
		await ensureMigrated();
	});

	test('maps both principals, preserves the cap slot and synthesizes payout awards', async () => {
		const referee = uniquePrincipal();
		const referrer = uniquePrincipal();
		const referralDoc = doc({
			key: referee,
			data: {
				version: 1,
				referrer,
				code: 'ABCD2345',
				redeemedAtMs: 1718000000000,
				withinReferrerCap: true,
				refereePayout: { status: 'paid', amountBaseUnits: '5000000', blockIndex: '9' },
				referrerPayout: { status: 'owed', amountBaseUnits: '2500000' }
			}
		});

		await importDocs({ collection: 'referrals', docs: [referralDoc] });
		await importDocs({ collection: 'referrals', docs: [referralDoc] });

		const refereeId = await userIdForPrincipal(referee);
		const referrerId = await userIdForPrincipal(referrer);

		const referralRows = await query<{ within_referrer_cap: boolean; code: string }>(
			`select within_referrer_cap, code from referrals where referee_user_id = $1`,
			[refereeId]
		);

		expect(referralRows).toHaveLength(1);
		expect(referralRows[0]?.within_referrer_cap).toBe(true);

		const awardRows = await query<{ user_id: string; status: string; award_key: string }>(
			`select user_id, status, award_key from vxp_awards
			 where award_type = 'referral' and award_key = $1 order by status`,
			[refereeId]
		);

		expect(awardRows).toHaveLength(2);
		expect(awardRows.find((r) => r.user_id === refereeId)?.status).toBe('paid');
		expect(awardRows.find((r) => r.user_id === referrerId)?.status).toBe('pending');
	});
});

describe.if(dbAvailable)('social graph import', () => {
	beforeAll(async () => {
		await ensureMigrated();
	});

	test('rewrites relation and activity keys onto user ids', async () => {
		const sender = uniquePrincipal();
		const target = uniquePrincipal();

		await importDocs({
			collection: 'relations',
			docs: [
				doc({
					key: [sender, target].sort().join('#'),
					data: { category: 'FRIEND', state: 'ACTIVE', participants: [sender, target] }
				}),
				doc({
					key: `follow#${sender}#${target}`,
					data: { category: 'follow', state: 'ACTIVE', participants: [sender, target] }
				})
			]
		});

		const senderId = await userIdForPrincipal(sender);
		const targetId = await userIdForPrincipal(target);
		const friendKey = [senderId, targetId].sort().join('#');

		const relations = await query<{ key: string; state: string }>(
			`select key, state from relations where key in ($1, $2) order by key`,
			[friendKey, `follow#${senderId}#${targetId}`]
		);

		expect(relations).toHaveLength(2);

		const timestamp = 1719000000000;

		await importDocs({
			collection: 'activities',
			docs: [
				doc({
					key: `${sender}#${timestamp}#trade`,
					data: { type: 'trade', user: sender, title: 'Called YES', timestamp }
				})
			]
		});

		await importDocs({
			collection: 'activity_reactions',
			docs: [
				doc({
					key: `${sender}#${timestamp}#trade#${target}`,
					data: {
						activityKey: `${sender}#${timestamp}#trade`,
						liker: target,
						timestamp: timestamp + 5,
						activityTitle: 'Called YES'
					}
				})
			]
		});

		await importDocs({
			collection: 'activity_reaction_counts',
			docs: [
				doc({
					key: `${sender}#${timestamp}#trade`,
					data: { activityKey: `${sender}#${timestamp}#trade`, count: 1, updatedAtMs: timestamp }
				})
			]
		});

		const mappedKey = `${senderId}#${timestamp}#trade`;
		const activities = await query<{ key: string }>(`select key from activities where key = $1`, [
			mappedKey
		]);

		expect(activities).toHaveLength(1);

		const reactions = await query<{ liker: string }>(
			`select liker from activity_reactions where activity_key = $1`,
			[mappedKey]
		);

		expect(reactions[0]?.liker).toBe(targetId);

		const counts = await query<{ count: number }>(
			`select count from activity_reaction_counts where activity_key = $1`,
			[mappedKey]
		);

		expect(counts[0]?.count).toBe(1);
	});
});

describe.if(dbAvailable)('leagues import', () => {
	beforeAll(async () => {
		await ensureMigrated();
	});

	test('imports leagues with legacy privacy fallback and duel side mapping', async () => {
		const owner = uniquePrincipal();
		const challenger = uniquePrincipal();
		const leagueId = `etl-league-${crypto.randomUUID().slice(0, 8)}`;
		const code = crypto
			.randomUUID()
			.replace(/[^0-9A-Z]/gi, 'A')
			.slice(0, 6)
			.toUpperCase();

		await importDocs({
			collection: 'leagues',
			docs: [
				doc({
					key: leagueId,
					data: {
						id: leagueId,
						name: 'Imported League',
						inviteCode: code,
						owner,
						createdAtMs: 1712000000000,
						privacy: 'invite',
						imageUrl: 'https://legacy.example.invalid/cover.png'
					}
				})
			]
		});

		const leagues = await query<{ privacy: string; image_url: string }>(
			`select privacy, image_url from leagues where id = $1`,
			[leagueId]
		);

		expect(leagues[0]?.privacy).toBe('private');
		expect(leagues[0]?.image_url).toBe('https://legacy.example.invalid/cover.png');

		await importDocs({
			collection: 'league_members',
			docs: [
				doc({
					key: `${leagueId}/${owner}`,
					data: { leagueId, member: owner, joinedAtMs: 1712000000000, role: 'owner' }
				}),
				doc({
					key: `missing-league/${owner}`,
					data: {
						leagueId: 'missing-league',
						member: owner,
						joinedAtMs: 1712000000000,
						role: 'member'
					}
				})
			]
		});

		const ownerId = await userIdForPrincipal(owner);
		const members = await query<{ role: string }>(
			`select role from league_members where league_id = $1 and member_user_id = $2`,
			[leagueId, ownerId]
		);

		expect(members[0]?.role).toBe('owner');

		const orphanMembers = await query<{ league_id: string }>(
			`select league_id from league_members where league_id = 'missing-league'`
		);

		expect(orphanMembers).toHaveLength(0);

		const battleId = `etl-battle-${crypto.randomUUID().slice(0, 8)}`;

		await importDocs({
			collection: 'battles',
			docs: [
				doc({
					key: battleId,
					data: {
						id: battleId,
						kind: 'duel',
						sideA: owner,
						sideB: challenger,
						proposer: owner,
						state: 'resolved',
						kickoffMs: 1712000000000,
						settleMs: 1712600000000,
						// Proposed before the rename: the amount sits under the old name.
						wager: 150,
						scoreA: 60,
						scoreB: 40,
						callsA: 10,
						callsB: 8,
						winner: 'A',
						resolvedAtMs: 1712600001000
					}
				})
			]
		});

		const challengerId = await userIdForPrincipal(challenger);
		const battles = await query<{
			side_a: string;
			side_b: string;
			winner: string;
			amount: number | null;
		}>(`select side_a, side_b, winner, amount from battles where id = $1`, [battleId]);

		expect(battles[0]?.side_a).toBe(ownerId ?? '');
		expect(battles[0]?.side_b).toBe(challengerId ?? '');
		expect(battles[0]?.winner).toBe('A');
		expect(battles[0]?.amount).toBe(150);
	});
});

describe.if(dbAvailable)('roles import', () => {
	beforeAll(async () => {
		await ensureMigrated();
	});

	test('grants exported roles without clobbering roles granted here', async () => {
		const grantedPrincipal = uniquePrincipal();
		const localAdminPrincipal = uniquePrincipal();

		const rows = await query<{ id: string }>(
			`insert into users (role) values ('admin') returning id`
		);

		await query(
			`insert into legacy_principals (principal, user_id, matched_via) values ($1, $2, 'openid_email')`,
			[localAdminPrincipal, rows[0]?.id]
		);

		await importDocs({
			collection: 'roles',
			docs: [
				doc({ key: grantedPrincipal, data: { role: 'solver' } }),
				doc({ key: localAdminPrincipal, data: { role: 'creator' } }),
				doc({ key: uniquePrincipal(), data: { role: 'controller' } })
			]
		});

		const grantedId = await userIdForPrincipal(grantedPrincipal);
		const granted = await query<{ role: string }>(`select role from users where id = $1`, [
			grantedId
		]);

		expect(granted[0]?.role).toBe('solver');

		const localAdmin = await query<{ role: string }>(`select role from users where id = $1`, [
			rows[0]?.id
		]);

		expect(localAdmin[0]?.role).toBe('admin');
	});
});

describe.if(dbAvailable)('market surfaces import', () => {
	beforeAll(async () => {
		await ensureMigrated();
	});

	test('imports metadata, translations and the tag index with FK-guarded fanout', async () => {
		const seriesId = `etl-series-${crypto.randomUUID().slice(0, 8)}`;

		await importDocs({
			collection: 'market_metadata',
			docs: [
				doc({
					key: seriesId,
					data: {
						seriesId,
						events: [],
						tags: ['football', 'world-cup'],
						suggested: true,
						updatedAt: 1713000000000,
						updatedBy: uniquePrincipal()
					}
				})
			]
		});

		const metadata = await query<{ suggested: boolean; updated_by: string | null }>(
			`select suggested, updated_by from market_metadata where series_id = $1`,
			[seriesId]
		);

		expect(metadata[0]?.suggested).toBe(true);
		// Unknown curators map to null, never to a provisional account.
		expect(metadata[0]?.updated_by).toBeNull();

		await importDocs({
			collection: 'market_translations',
			docs: [
				doc({
					key: `${seriesId}#it`,
					data: {
						seriesId,
						locale: 'it',
						title: 'Titolo',
						description: 'Descrizione',
						resolution: 'Risoluzione',
						outcomes: [{ id: 'YES', title: 'Si' }],
						updatedAt: 1713000000000,
						updatedBy: uniquePrincipal()
					}
				})
			]
		});

		const translations = await query<{ title: string }>(
			`select title from market_translations where series_id = $1 and locale = 'it'`,
			[seriesId]
		);

		expect(translations[0]?.title).toBe('Titolo');

		const tagStats = await importDocs({
			collection: 'market_tag_index',
			docs: [
				doc({
					key: 'football',
					data: { tag: 'football', seriesIds: [seriesId, 'unknown-series'], updatedAtMs: 1 }
				})
			]
		});

		expect(tagStats.imported).toBe(1);
		expect(tagStats.warnings.some((w) => w.includes('unknown-series'))).toBe(true);

		const tagRows = await query<{ series_id: string }>(
			`select series_id from market_tag_index where tag = 'football' and series_id = $1`,
			[seriesId]
		);

		expect(tagRows).toHaveLength(1);
	});
});

describe.if(dbAvailable)('exit signals import', () => {
	beforeAll(async () => {
		await ensureMigrated();
	});

	test('derives a stable id so re-import never duplicates', async () => {
		const key = `legacy-exit-${crypto.randomUUID()}`;
		const note = `imported note ${crypto.randomUUID()}`;
		const exitDoc = doc({
			key,
			data: { reason: 'too-busy', note, createdAtMs: 1714000000000 }
		});

		await importDocs({ collection: 'exit_signals', docs: [exitDoc] });
		await importDocs({ collection: 'exit_signals', docs: [exitDoc] });

		const rows = await query<{ count: string }>(
			`select count(*)::text as count from exit_signals where note = $1`,
			[note]
		);

		expect(Number(rows[0]?.count)).toBe(1);
	});
});
