import { describe, expect, test } from 'bun:test';
import { badRequest, serviceUnavailable, type StatusContext } from '../src/lib/http';

describe('status helpers', () => {
	test('badRequest sets 400 and returns the code', () => {
		const set: StatusContext = {};

		expect(badRequest(set, 'invalid_amount')).toEqual({ error: 'invalid_amount' });
		expect(set.status).toBe(400);
	});

	test('serviceUnavailable sets 503 and returns the code', () => {
		const set: StatusContext = {};

		expect(serviceUnavailable(set, 'chain_unavailable')).toEqual({ error: 'chain_unavailable' });
		expect(set.status).toBe(503);
	});
});
