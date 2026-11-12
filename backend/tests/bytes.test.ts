import { describe, expect, test } from 'bun:test';
import { concatBytes } from '../src/lib/bytes';

describe('concatBytes', () => {
	test('joins the parts in order', () => {
		expect([...concatBytes(Uint8Array.of(1, 2), Uint8Array.of(3), Uint8Array.of(4, 5, 6))]).toEqual(
			[1, 2, 3, 4, 5, 6]
		);
	});

	test('skips empty parts and returns an empty array for no input', () => {
		expect([...concatBytes(new Uint8Array(0), Uint8Array.of(7), new Uint8Array(0))]).toEqual([7]);
		expect(concatBytes()).toHaveLength(0);
		expect(concatBytes(new Uint8Array(0))).toHaveLength(0);
	});

	test('returns a plain Uint8Array even for Buffer parts', () => {
		const out = concatBytes(Buffer.from([1]), Uint8Array.of(2));

		expect(out.constructor).toBe(Uint8Array);
		expect([...out]).toEqual([1, 2]);
	});

	test('copies the inputs instead of aliasing them', () => {
		const first = Uint8Array.of(1, 2);
		const second = Uint8Array.of(3);
		const out = concatBytes(first, second);

		out[0] = 9;
		second[0] = 8;

		expect([...first]).toEqual([1, 2]);
		expect([...out]).toEqual([9, 2, 3]);
		expect(concatBytes(first)).not.toBe(first);
	});
});
