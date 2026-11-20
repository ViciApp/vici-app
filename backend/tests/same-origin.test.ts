// Writes come from the app's own pages only: an unsafe request from another
// origin (a sibling subdomain included) is refused before any route runs, a
// JSON route refuses a form or text body, and the two routes that take
// another body (Apple's cross-site form callback, the league cover upload)
// keep working.

import { beforeAll, describe, expect, test } from 'bun:test';
import { createSession } from '../src/auth/sessions';
import { env } from '../src/env';
import { app } from '../src/index';
import { createTestUser, ensureMigrated } from './helpers/auth';
import { dbAvailable } from './helpers/setup';

const appOrigin = new URL(env.publicAppUrl).origin;

const siblingOrigin = (): string => {
	const url = new URL(env.publicAppUrl);

	url.hostname = `other.${url.hostname}`;

	return url.origin;
};

const send = ({
	method = 'POST',
	path,
	headers = {},
	body
}: {
	method?: string;
	path: string;
	headers?: Record<string, string>;
	body?: BodyInit;
}): Promise<Response> =>
	app.handle(new Request(`http://localhost${path}`, { method, headers, body }));

const formBody = (fields: Record<string, string>): string => new URLSearchParams(fields).toString();

describe('unsafe requests from another origin', () => {
	test('a write from another origin is refused', async () => {
		for (const origin of ['https://elsewhere.example', siblingOrigin(), 'null']) {
			const response = await send({ path: '/api/v1/auth/logout', headers: { origin } });

			expect(response.status).toBe(403);
			expect(await response.json()).toEqual({ error: 'origin_not_allowed' });
		}
	});

	test('a write a browser marks cross-site or same-site without an origin is refused', async () => {
		for (const site of ['cross-site', 'same-site']) {
			const response = await send({
				path: '/api/v1/auth/logout',
				headers: { 'sec-fetch-site': site }
			});

			expect(response.status).toBe(403);
		}
	});

	test("a write from the app's origin, or from a client that is not a browser, goes through", async () => {
		const fromApp = await send({ path: '/api/v1/auth/logout', headers: { origin: appOrigin } });
		const fromServer = await send({ path: '/api/v1/auth/logout' });
		const sameOrigin = await send({
			path: '/api/v1/auth/logout',
			headers: { 'sec-fetch-site': 'same-origin' }
		});

		expect(fromApp.status).toBe(200);
		expect(fromServer.status).toBe(200);
		expect(sameOrigin.status).toBe(200);
	});

	test('a read from another origin is not refused', async () => {
		const response = await send({
			method: 'GET',
			path: '/api/v1/auth/providers',
			headers: { origin: 'https://elsewhere.example' }
		});

		expect(response.status).toBe(200);
	});
});

describe('request bodies', () => {
	test('a JSON route refuses a form or text body, even from the app', async () => {
		for (const [contentType, body] of [
			['application/x-www-form-urlencoded', formBody({ email: 'a@b.example' })],
			['text/plain', JSON.stringify({ email: 'a@b.example' })],
			['multipart/form-data; boundary=x', '--x--']
		]) {
			const response = await send({
				path: '/api/v1/auth/otp/request',
				headers: { origin: appOrigin, 'content-type': contentType ?? '' },
				body
			});

			expect(response.status).toBe(415);
			expect(await response.json()).toEqual({ error: 'unsupported_media_type' });
		}
	});

	test("Apple's cross-site form callback still reaches its route", async () => {
		const response = await send({
			path: '/api/v1/auth/apple/callback',
			headers: {
				origin: 'https://appleid.apple.com',
				'sec-fetch-site': 'cross-site',
				'content-type': 'application/x-www-form-urlencoded'
			},
			body: formBody({ code: 'c', state: 's' })
		});

		expect([403, 415]).not.toContain(response.status);
	});
});

describe.if(dbAvailable)('signed-in writes', () => {
	beforeAll(async () => {
		await ensureMigrated();
	});

	test('a form withdrawal from another origin never reaches the route', async () => {
		const token = await createSession(await createTestUser());
		const response = await send({
			path: '/api/v1/wallet/withdrawals',
			headers: {
				cookie: `vici_session=${token}`,
				origin: siblingOrigin(),
				'content-type': 'application/x-www-form-urlencoded'
			},
			body: formBody({ assetId: 'any', amount: '1', destination: 'somewhere' })
		});

		expect(response.status).toBe(403);
	});

	test('the league cover upload still takes multipart from the app', async () => {
		const token = await createSession(await createTestUser());
		const body = new FormData();

		body.append('image', new Blob([new Uint8Array([1, 2, 3])], { type: 'image/jpeg' }), 'c.jpg');

		const response = await send({
			path: `/api/v1/leagues/lg-${crypto.randomUUID()}/image`,
			headers: { cookie: `vici_session=${token}`, origin: appOrigin },
			body
		});

		expect([403, 415]).not.toContain(response.status);
	});
});
