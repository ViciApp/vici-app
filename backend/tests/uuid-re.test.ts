// UUID_RE gates user ids in profile lookups, activity keys and the friends
// filter of resolved results; pin exactly what it accepts.

import { describe, expect, test } from 'bun:test';
import { UUID_RE } from '../src/lib/constants';

describe('UUID_RE', () => {
	test('accepts a canonical uuid in lower, upper and mixed case', () => {
		expect(UUID_RE.test('123e4567-e89b-12d3-a456-426614174000')).toBe(true);
		expect(UUID_RE.test('123E4567-E89B-12D3-A456-426614174000')).toBe(true);
		expect(UUID_RE.test('123e4567-E89B-12d3-A456-426614174000')).toBe(true);
		expect(UUID_RE.test('00000000-0000-0000-0000-000000000000')).toBe(true);
	});

	test('rejects other shapes', () => {
		expect(UUID_RE.test('')).toBe(false);
		expect(UUID_RE.test('123e4567e89b12d3a456426614174000')).toBe(false);
		expect(UUID_RE.test('{123e4567-e89b-12d3-a456-426614174000}')).toBe(false);
		expect(UUID_RE.test('123e4567-e89b-12d3-a456-42661417400g')).toBe(false);
		expect(UUID_RE.test('123e4567-e89b-12d3-a456-4266141740000')).toBe(false);
	});

	test('is anchored at both ends', () => {
		expect(UUID_RE.test(' 123e4567-e89b-12d3-a456-426614174000')).toBe(false);
		expect(UUID_RE.test('123e4567-e89b-12d3-a456-426614174000\n')).toBe(false);
		expect(UUID_RE.test('x123e4567-e89b-12d3-a456-426614174000')).toBe(false);
	});

	test('gives the same answer on repeated calls', () => {
		const id = '123e4567-e89b-12d3-a456-426614174000';

		expect(UUID_RE.test(id)).toBe(true);
		expect(UUID_RE.test(id)).toBe(true);
	});
});
