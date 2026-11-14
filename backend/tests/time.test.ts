import { describe, expect, setSystemTime, test } from 'bun:test';
import {
	monthAnchorFromMs,
	monthEndMs,
	monthStartMs,
	msToNs,
	nowNs,
	optionalMs,
	previousMonthAnchor
} from '../src/lib/time';

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

describe('monthAnchorFromMs', () => {
	test('is the UTC YYYY-MM of the timestamp', () => {
		expect(monthAnchorFromMs(Date.UTC(2026, 10, 13, 12))).toBe('2026-11');
		expect(monthAnchorFromMs(Date.UTC(2026, 0, 1, 0, 0, 0, 0))).toBe('2026-01');
		expect(monthAnchorFromMs(Date.UTC(2026, 11, 31, 23, 59, 59, 999))).toBe('2026-12');
	});
});

describe('monthStartMs', () => {
	test('is the first UTC instant of the anchor month, the inverse of monthAnchorFromMs', () => {
		expect(monthStartMs('2026-11')).toBe(Date.UTC(2026, 10, 1));
		expect(monthStartMs('2026-01')).toBe(Date.UTC(2026, 0, 1));
		expect(monthAnchorFromMs(monthStartMs('2026-12'))).toBe('2026-12');
		expect(monthAnchorFromMs(monthStartMs('2026-12') - 1)).toBe('2026-11');
	});
});

describe('monthEndMs', () => {
	test('is the first UTC instant after the anchor month, across a year end too', () => {
		expect(monthEndMs('2026-11')).toBe(Date.UTC(2026, 11, 1));
		expect(monthEndMs('2026-12')).toBe(Date.UTC(2027, 0, 1));
		expect(monthEndMs('2026-11')).toBe(monthStartMs('2026-12'));
		expect(monthAnchorFromMs(monthEndMs('2026-11') - 1)).toBe('2026-11');
	});
});

describe('previousMonthAnchor', () => {
	test('is the UTC month before the one holding the timestamp', () => {
		expect(previousMonthAnchor(Date.UTC(2026, 10, 13))).toBe('2026-10');
		expect(previousMonthAnchor(Date.UTC(2026, 0, 1))).toBe('2025-12');
		expect(previousMonthAnchor(Date.UTC(2026, 2, 31, 23, 59, 59, 999))).toBe('2026-02');
	});
});
