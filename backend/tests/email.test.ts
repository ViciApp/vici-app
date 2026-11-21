// The one-time-code emails state how long the code lives from the TTL the
// server enforces, never from a figure written into the copy.

import { describe, expect, test } from 'bun:test';
import { codeExpiryNotice } from '../src/lib/email';
import { MINUTE_IN_MS } from '../src/lib/time';

describe('codeExpiryNotice', () => {
	test('names the lifetime it is given, in minutes', () => {
		expect(codeExpiryNotice(45 * MINUTE_IN_MS)).toBe(
			"It expires in 45 minutes. If you didn't request it, ignore this email."
		);
		expect(codeExpiryNotice(10 * MINUTE_IN_MS)).toStartWith('It expires in 10 minutes.');
	});

	test('refuses a lifetime that is not a whole number of minutes', () => {
		expect(() => codeExpiryNotice(30.5 * MINUTE_IN_MS)).toThrow();
		expect(() => codeExpiryNotice(90_000)).toThrow();
		expect(() => codeExpiryNotice(0)).toThrow();
	});
});
