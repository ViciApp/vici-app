import { describe, expect, test } from 'bun:test';
import { app } from '../src/index';
import { dbAvailable } from './helpers/setup';

describe('GET /health', () => {
	test('answers the probe shape and reflects DB connectivity', async () => {
		const res = await app.handle(new Request('http://localhost/health'));
		const body = (await res.json()) as { ok: boolean; db: string };

		if (dbAvailable) {
			expect(res.status).toBe(200);
			expect(body).toEqual({ ok: true, db: 'connected' });
		} else {
			expect(res.status).toBe(503);
			expect(body).toEqual({ ok: false, db: 'unreachable' });
		}
	});

	test('sets the hardening headers on every response', async () => {
		const res = await app.handle(new Request('http://localhost/health'));

		expect(res.headers.get('x-content-type-options')).toBe('nosniff');
		expect(res.headers.get('x-frame-options')).toBe('DENY');
		expect(res.headers.get('referrer-policy')).toBe('no-referrer');
	});
});

describe('error mapping', () => {
	test('unknown routes answer 404 JSON with credentialed CORS headers', async () => {
		const res = await app.handle(
			new Request('http://localhost/nope', {
				headers: { origin: 'http://localhost:5173' }
			})
		);

		expect(res.status).toBe(404);
		expect(await res.json()).toEqual({ error: 'not found' });
		expect(res.headers.get('access-control-allow-origin')).toBe('http://localhost:5173');
		expect(res.headers.get('access-control-allow-credentials')).toBe('true');
	});

	test('an origin off the allowlist is not echoed back', async () => {
		const res = await app.handle(
			new Request('http://localhost/nope', {
				headers: { origin: 'https://evil.example' }
			})
		);

		expect(res.status).toBe(404);
		expect(res.headers.get('access-control-allow-origin')).toBe('http://localhost:5173');
	});
});
