// The global request body ceiling. Bun enforces it in the server itself, so
// this suite serves the real app on a random port: `app.handle` skips the
// server and would never see the limit.

import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import { app } from '../src/index';
import { LEAGUE_IMAGE_MAX_BYTES } from '../src/leagues/images';

describe('request body limit', () => {
	let baseUrl = '';

	beforeAll(() => {
		app.listen(0);
		baseUrl = `http://localhost:${app.server?.port}`;
	});

	afterAll(async () => {
		await app.stop();
	});

	test('a body over 16 MB is refused with 413 before any route reads it', async () => {
		const res = await fetch(`${baseUrl}/api/v1/events`, {
			method: 'POST',
			headers: { 'content-type': 'application/json' },
			body: JSON.stringify({
				events: [{ name: 'app_error', sessionId: 'x'.repeat(17 * 1024 * 1024) }]
			})
		});

		expect(res.status).toBe(413);
	});

	test('a full-size league cover upload still reaches its route', async () => {
		const form = new FormData();

		form.append('image', new File([new Uint8Array(LEAGUE_IMAGE_MAX_BYTES)], 'cover.jpg'));

		const res = await fetch(
			`${baseUrl}/api/v1/leagues/00000000-0000-0000-0000-000000000000/image`,
			{
				method: 'POST',
				body: form
			}
		);

		// The route answered (no session), so the body got past the server cap.
		expect(res.status).toBe(401);
	});
});
