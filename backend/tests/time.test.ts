import { describe, expect, setSystemTime, test } from 'bun:test';
import { msToNs, nowNs, optionalMs } from '../src/lib/time';

describe('msToNs', () => {
	test('scales milliseconds to nanoseconds', () => {
		expect(msToNs(0)).toBe(BigInt(0));
		expect(msToNs(1)).toBe(BigInt(1_000_000));
		expect(msToNs(1_700_000_000_123)).toBe(BigInt('1700000000123000000'));
	});
});

describe('nowNs', () => {
	test('reads the wall clock in nanoseconds', () => {
		setSystemTime(new Date(1_700_000_000_123));

		try {
			expect(nowNs()).toBe(BigInt('1700000000123000000'));
		} finally {
			setSystemTime();
		}
	});
});

describe('optionalMs', () => {
	test('reads a text ms column as a number, null as undefined', () => {
		expect(optionalMs('1700000000123')).toBe(1_700_000_000_123);
		expect(optionalMs('0')).toBe(0);
		expect(optionalMs(null)).toBeUndefined();
	});
});
