import { nonNullish } from '@dfinity/utils';
import { describe, expect, test } from 'bun:test';
import {
	addVary,
	badRequest,
	serviceUnavailable,
	type HeadersContext,
	type StatusContext
} from '../src/lib/http';

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

describe('addVary', () => {
	const varyAfter = (initial: string | undefined, ...names: string[]): unknown => {
		const set: HeadersContext = { headers: {} };

		if (nonNullish(initial)) {
			set.headers['vary'] = initial;
		}

		for (const name of names) {
			addVary(set, name);
		}

		return set.headers['vary'];
	};

	test('sets the header when there is none', () => {
		expect(varyAfter(undefined, 'Cookie')).toBe('Cookie');
		expect(varyAfter('', 'Cookie')).toBe('Cookie');
	});

	test('keeps what is already there', () => {
		expect(varyAfter('Origin', 'Cookie')).toBe('Origin, Cookie');
		expect(varyAfter('Accept-Encoding, Origin', 'Cookie')).toBe('Accept-Encoding, Origin, Cookie');
	});

	test('never repeats a name, whatever its case or spacing', () => {
		expect(varyAfter('Origin', 'Origin')).toBe('Origin');
		expect(varyAfter('origin', 'Origin')).toBe('origin');
		expect(varyAfter('Accept-Encoding ,  COOKIE', 'Cookie')).toBe('Accept-Encoding ,  COOKIE');
		expect(varyAfter(undefined, 'Cookie', 'cookie', 'Origin')).toBe('Cookie, Origin');
	});
});
