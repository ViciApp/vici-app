// Drains the satellite's admin-gated auth-identity export into
// legacy_auth_identities, the table the login auto-match reads. Keyset-paged
// and resumable: the last processed page key persists in etl_cursors, so a
// crashed run continues where it stopped; a completed run clears the cursor
// so the next invocation re-walks from the start (the cutover delta pass,
// safe because every row upserts).
//
// Env: ETL_SATELLITE_PEM (path to the admin key), ETL_SATELLITE_ID, optional
// ETL_SATELLITE_CONTAINER (emulator URL), DATABASE_URL.

import { isNullish, nonNullish } from '@dfinity/utils';
import { Actor, HttpAgent } from '@icp-sdk/core/agent';
import { Principal } from '@icp-sdk/core/principal';
import { pool, query, type TxQuery } from '../../src/db/client';
import {
	idlFactorySatellite,
	type SatelliteDid,
	type SatelliteService
} from '../../src/declarations';
import { clearCursor, getCursor, loadSatelliteConfig, printTable, setCursor } from './lib';

export const DRAIN_CURSOR_ID = 'drain-auth-identities';

/** The satellite export page ceiling; larger asks are clamped server-side. */
const PAGE_SIZE = 100;

const opt = <T>(value: [] | [T]): T | undefined => value[0];

/** The one satellite method this drain needs, structurally (not the full
 * ActorMethod shape) so tests inject a plain fake at this boundary. */
export interface AuthIdentitySource {
	app_get_auth_identities: (
		args: SatelliteDid.AppGetAuthIdentitiesArgs
	) => Promise<SatelliteDid.AppGetAuthIdentitiesResult>;
}

export interface DrainResult {
	upserted: number;
	pages: number;
}

export const drainAuthIdentities = async ({
	actor,
	pageSize = PAGE_SIZE,
	q = query
}: {
	actor: AuthIdentitySource;
	pageSize?: number;
	q?: TxQuery;
}): Promise<DrainResult> => {
	let afterKey = await getCursor({ id: DRAIN_CURSOR_ID, q });
	let upserted = 0;
	let pages = 0;

	for (;;) {
		const result = await actor.app_get_auth_identities({
			limit: pageSize,
			after_key: isNullish(afterKey) ? [] : [afterKey]
		});

		for (const row of result.rows) {
			await q(
				`insert into legacy_auth_identities (principal, provider, openid_email, profile_email, exported_at)
				 values ($1, $2, $3, $4, now())
				 on conflict (principal) do update set
				   provider = excluded.provider,
				   openid_email = excluded.openid_email,
				   profile_email = excluded.profile_email,
				   exported_at = now()`,
				[
					row.key,
					opt(row.provider) ?? null,
					opt(row.openid_email) ?? null,
					opt(row.profile_email) ?? null
				]
			);
			upserted += 1;
		}

		pages += 1;

		// A has_more page with no rows can never advance the cursor; failing
		// loudly beats spinning on the same call forever.
		if (result.has_more && result.rows.length === 0) {
			throw new Error(
				`satellite returned has_more with an empty page (cursor ${afterKey ?? 'start'}); aborting drain`
			);
		}

		const lastKey = result.rows[result.rows.length - 1]?.key;

		// The cursor lands only after the page's rows committed, so a crash
		// between pages replays at most one page of idempotent upserts.
		if (nonNullish(lastKey)) {
			afterKey = lastKey;
			await setCursor({ id: DRAIN_CURSOR_ID, cursor: lastKey, q });
		}

		if (!result.has_more) {
			break;
		}
	}

	await clearCursor({ id: DRAIN_CURSOR_ID, q });

	return { upserted, pages };
};

if (import.meta.main) {
	const { identity, satelliteId, container } = loadSatelliteConfig();
	const agent = await HttpAgent.create({
		host: container ?? 'https://icp-api.io',
		identity,
		shouldFetchRootKey: nonNullish(container)
	});
	const actor = Actor.createActor<SatelliteService>(idlFactorySatellite, {
		agent,
		canisterId: Principal.fromText(satelliteId)
	});

	const { upserted, pages } = await drainAuthIdentities({ actor });

	printTable([
		['pages', 'rows upserted'],
		[pages.toString(), upserted.toString()]
	]);

	await pool.end();
}
