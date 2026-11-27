import { isReservedHandle, RESERVED_HANDLES } from '#lib/constants/profile.constants.ts';
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

describe('RESERVED_HANDLES', () => {
	it('holds only folded handles of 3 to 15 lowercase letters and digits', () => {
		for (const handle of RESERVED_HANDLES) {
			assert.match(handle, /^[a-z0-9]{3,15}$/, handle);
		}
	});

	it('reserves the brand, staff roles and system voices', () => {
		for (const handle of ['vici', 'viciofficial', 'founders', 'noreply', 'oracle', 'everyone']) {
			assert.ok(RESERVED_HANDLES.has(handle), handle);
		}
	});
});

describe('isReservedHandle', () => {
	it('matches a reserved handle whatever its case, accents or separators', () => {
		for (const handle of [
			'vici',
			'VICI',
			'VÍCI',
			'vicí',
			'vi.ci',
			'Vi_Ci',
			'vici-official',
			' Founders '
		]) {
			assert.ok(isReservedHandle(handle), handle);
		}
	});

	it('leaves ordinary handles alone, including ones that start with vici', () => {
		for (const handle of ['victoria', 'vicinity', 'vicious', 'aurelia']) {
			assert.equal(isReservedHandle(handle), false, handle);
		}
	});
});
