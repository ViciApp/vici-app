// League cover images. Two storage backends behind one interface: an
// S3-compatible bucket (Tigris) via Bun's built-in S3 client when S3_* env is
// set, local disk under backend/uploads/league-images/ otherwise (dev).
// The stored asset is a square 256px JPEG produced with sharp, the same
// downscaled cover shape every league surface renders; originals are not
// kept. The league row carries only the serving URL.

import { isNullish, nonNullish } from '@dfinity/utils';
import { existsSync, mkdirSync, unlinkSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import sharp from 'sharp';
import { tx } from '../db/client';
import { env } from '../env';
import { logger } from '../lib/logger';
import { getLeague, LeagueError, shapeLeague, type League } from './leagues';

export const LEAGUE_IMAGE_SIZE_PX = 256;
export const LEAGUE_IMAGE_JPEG_QUALITY = 82;

/** Upload size cap; the client downscales before upload so anything larger
 * is not a legitimate cover. */
export const LEAGUE_IMAGE_MAX_BYTES = 5 * 1024 * 1024;

// Anchored to the backend package root through this module's own location
// (src/leagues -> backend), never the process cwd, so the dev uploads land in
// backend/uploads/league-images no matter which directory bun runs from.
const backendRoot = join(dirname(fileURLToPath(import.meta.url)), '../..');

const uploadsDir = join(backendRoot, 'uploads/league-images');

const s3 = env.s3.enabled
	? new Bun.S3Client({
			endpoint: env.s3.endpoint,
			bucket: env.s3.bucket,
			accessKeyId: env.s3.accessKeyId,
			secretAccessKey: env.s3.secretAccessKey
		})
	: null;

/** League ids are client-minted slugs; only path-safe ids may reach the disk
 * backend, blocking traversal by construction. */
const SAFE_ID_PATTERN = /^[A-Za-z0-9_-]+$/;

const storageKey = (leagueId: string): string => `league-images/${leagueId}.jpg`;

const diskPath = (leagueId: string): string => join(uploadsDir, `${leagueId}.jpg`);

const assertSafeId = (leagueId: string): void => {
	if (!SAFE_ID_PATTERN.test(leagueId)) {
		throw new LeagueError('league id is not a valid image key.');
	}
};

/**
 * Decode a raster, downscale it to the square 256px cover JPEG, persist it,
 * and return the serving URL. Shared between the owner upload route and the
 * data-migration tooling; callers own their access checks and the row write.
 */
export const storeLeagueCoverBytes = async ({
	leagueId,
	bytes
}: {
	leagueId: string;
	bytes: ArrayBuffer | Uint8Array;
}): Promise<string> => {
	assertSafeId(leagueId);

	// Every caller (upload route and migration tooling alike) gets the same
	// non-empty / 5 MB gate before any decode work.
	if (bytes.byteLength === 0 || bytes.byteLength > LEAGUE_IMAGE_MAX_BYTES) {
		throw new LeagueError('leagues cover image must be a non-empty file up to 5 MB.');
	}

	let thumbnail: Buffer;

	try {
		thumbnail = await sharp(bytes instanceof Uint8Array ? bytes : Buffer.from(bytes))
			.rotate()
			.resize(LEAGUE_IMAGE_SIZE_PX, LEAGUE_IMAGE_SIZE_PX, { fit: 'cover' })
			.jpeg({ quality: LEAGUE_IMAGE_JPEG_QUALITY, mozjpeg: true })
			.toBuffer();
	} catch {
		// Sharp rejects anything that is not a decodable raster image, which
		// also keeps SVG/HTML payloads out of storage entirely.
		throw new LeagueError('leagues cover image must be a decodable raster image.');
	}

	if (nonNullish(s3)) {
		await s3.write(storageKey(leagueId), thumbnail, { type: 'image/jpeg' });
	} else {
		if (!existsSync(uploadsDir)) {
			mkdirSync(uploadsDir, { recursive: true });
		}

		await Bun.write(diskPath(leagueId), thumbnail);
	}

	return `${env.apiBaseUrl}/api/v1/leagues/${leagueId}/image`;
};

/**
 * Store a league's cover: decode whatever raster the client sent, downscale
 * to a square 256px cover JPEG with sharp, persist it, and stamp the serving
 * URL on the league row. Owner-only.
 */
export const uploadLeagueImage = async ({
	leagueId,
	callerId,
	bytes
}: {
	leagueId: string;
	callerId: string;
	bytes: ArrayBuffer | Uint8Array;
}): Promise<League> => {
	assertSafeId(leagueId);

	const league = await getLeague(leagueId);

	if (isNullish(league)) {
		throw new LeagueError('league_not_found');
	}

	if (league.ownerUserId !== callerId) {
		throw new LeagueError('leagues cover image edits require the owner.');
	}

	const imageUrl = await storeLeagueCoverBytes({ leagueId, bytes });

	return await tx(async (q) => {
		const rows = await q<Parameters<typeof shapeLeague>[0]>(
			`update leagues set image_url = $2, updated_at = now() where id = $1
			 returning id, name, description, invite_code, owner_user_id,
			   created_at_ms::text, accent_color, emblem, privacy, image_url`,
			[leagueId, imageUrl]
		);
		const [row] = rows;

		if (isNullish(row)) {
			throw new LeagueError('league_not_found');
		}

		return shapeLeague(row);
	});
};

/** Clear a league's cover (owner-only): the field falls back to the emblem.
 * Storage deletion is best-effort; the row is the source of truth. */
export const deleteLeagueImage = async ({
	leagueId,
	callerId
}: {
	leagueId: string;
	callerId: string;
}): Promise<League> => {
	assertSafeId(leagueId);

	const league = await getLeague(leagueId);

	if (isNullish(league)) {
		throw new LeagueError('league_not_found');
	}

	if (league.ownerUserId !== callerId) {
		throw new LeagueError('leagues cover image edits require the owner.');
	}

	try {
		if (nonNullish(s3)) {
			await s3.delete(storageKey(leagueId));
		} else if (existsSync(diskPath(leagueId))) {
			unlinkSync(diskPath(leagueId));
		}
	} catch (err) {
		logger.error(`league image delete failed for ${leagueId} (row still cleared):`, err);
	}

	return await tx(async (q) => {
		const rows = await q<Parameters<typeof shapeLeague>[0]>(
			`update leagues set image_url = null, updated_at = now() where id = $1
			 returning id, name, description, invite_code, owner_user_id,
			   created_at_ms::text, accent_color, emblem, privacy, image_url`,
			[leagueId]
		);
		const [row] = rows;

		if (isNullish(row)) {
			throw new LeagueError('league_not_found');
		}

		return shapeLeague(row);
	});
};

export type LeagueImageLocation =
	{ kind: 'redirect'; url: string } | { kind: 'file'; path: string } | { kind: 'missing' };

/** Where a GET for the cover goes: a short-lived presigned S3 URL, the local
 * file (dev), or 404. */
export const locateLeagueImage = (leagueId: string): LeagueImageLocation => {
	if (!SAFE_ID_PATTERN.test(leagueId)) {
		return { kind: 'missing' };
	}

	if (nonNullish(s3)) {
		return {
			kind: 'redirect',
			url: s3.presign(storageKey(leagueId), { expiresIn: 3600, method: 'GET' })
		};
	}

	const path = diskPath(leagueId);

	if (!existsSync(path)) {
		return { kind: 'missing' };
	}

	return { kind: 'file', path };
};
