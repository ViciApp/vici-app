// League cover images on the local-disk fallback (no S3 env in tests): the
// stored asset is a 256px square JPEG, the row carries the serving URL, and
// every write path is owner-gated.

import { beforeAll, describe, expect, test } from 'bun:test';
import { randomBytes } from 'node:crypto';
import sharp from 'sharp';
import {
	deleteLeagueImage,
	LEAGUE_IMAGE_SIZE_PX,
	locateLeagueImage,
	uploadLeagueImage
} from '../src/leagues/images';
import { createLeague, getLeague } from '../src/leagues/leagues';
import { createTestUser, ensureMigrated } from './helpers/auth';
import { dbAvailable } from './helpers/setup';

const uniqueLeagueId = (): string => `img-${randomBytes(6).toString('hex')}`;

const samplePng = (): Promise<Buffer> =>
	sharp({
		create: { width: 800, height: 500, channels: 3, background: { r: 40, g: 90, b: 200 } }
	})
		.png()
		.toBuffer();

describe.if(dbAvailable)('league images (local-disk fallback)', () => {
	beforeAll(async () => {
		await ensureMigrated();
	});

	test('upload stores a 256px square JPEG and stamps the serving URL', async () => {
		const ownerId = await createTestUser();
		const league = await createLeague({
			id: uniqueLeagueId(),
			name: 'Image League',
			ownerUserId: ownerId
		});

		const updated = await uploadLeagueImage({
			leagueId: league.id,
			callerId: ownerId,
			bytes: await samplePng()
		});

		expect(updated.imageUrl).toContain(`/api/v1/leagues/${league.id}/image`);

		const location = locateLeagueImage(league.id);

		expect(location.kind).toBe('file');

		if (location.kind === 'file') {
			const metadata = await sharp(location.path).metadata();

			expect(metadata.format).toBe('jpeg');
			expect(metadata.width).toBe(LEAGUE_IMAGE_SIZE_PX);
			expect(metadata.height).toBe(LEAGUE_IMAGE_SIZE_PX);
		}
	});

	test('rejects non-owners and undecodable payloads', async () => {
		const ownerId = await createTestUser();
		const stranger = await createTestUser();
		const league = await createLeague({
			id: uniqueLeagueId(),
			name: 'Gated League',
			ownerUserId: ownerId
		});

		expect(
			uploadLeagueImage({ leagueId: league.id, callerId: stranger, bytes: await samplePng() })
		).rejects.toThrow('require the owner');

		expect(
			uploadLeagueImage({
				leagueId: league.id,
				callerId: ownerId,
				bytes: new TextEncoder().encode('<svg onload=alert(1)></svg>')
			})
		).rejects.toThrow('decodable raster image');
	});

	test('delete clears the row and the stored file', async () => {
		const ownerId = await createTestUser();
		const league = await createLeague({
			id: uniqueLeagueId(),
			name: 'Clearable League',
			ownerUserId: ownerId
		});

		await uploadLeagueImage({ leagueId: league.id, callerId: ownerId, bytes: await samplePng() });

		const stranger = await createTestUser();

		expect(deleteLeagueImage({ leagueId: league.id, callerId: stranger })).rejects.toThrow(
			'require the owner'
		);

		const cleared = await deleteLeagueImage({ leagueId: league.id, callerId: ownerId });

		expect(cleared.imageUrl).toBeUndefined();
		expect((await getLeague(league.id))?.imageUrl).toBeUndefined();
		expect(locateLeagueImage(league.id).kind).toBe('missing');
	});

	test('an unsafe league id never reaches the disk backend', () => {
		expect(locateLeagueImage('../../etc/passwd').kind).toBe('missing');
	});
});
