import { notificationsStore } from '#lib/stores/notification.store.ts';
import { copyToClipboard, writeToClipboard } from '#lib/utils/clipboard.utils.ts';
import { isNullish } from '@dfinity/utils';
import assert from 'node:assert/strict';
import { afterEach, beforeEach, describe, it, mock } from 'node:test';
import { get } from 'svelte/store';

const originalNavigator = Object.getOwnPropertyDescriptor(globalThis, 'navigator');

const mockNavigator = (navigator: unknown) => {
	Object.defineProperty(globalThis, 'navigator', {
		value: navigator,
		configurable: true,
		writable: true
	});
};

const mockClipboard = (writeText: (value: string) => Promise<void>) => {
	const spy = mock.fn(writeText);

	mockNavigator({ clipboard: { writeText: spy } });

	return spy;
};

describe('clipboard.utils', () => {
	beforeEach(() => {
		mock.timers.enable({ apis: ['setTimeout'] });
	});

	afterEach(() => {
		mock.timers.runAll();
		mock.timers.reset();

		if (isNullish(originalNavigator)) {
			Reflect.deleteProperty(globalThis, 'navigator');

			return;
		}

		Object.defineProperty(globalThis, 'navigator', originalNavigator);
	});

	describe('writeToClipboard', () => {
		it('writes the value and resolves true', async () => {
			const writeText = mockClipboard(() => Promise.resolve());

			assert.equal(await writeToClipboard('invite-code'), true);
			assert.deepEqual(
				writeText.mock.calls.map(({ arguments: args }) => args),
				[['invite-code']]
			);
		});

		it('resolves false when the write is refused', async () => {
			mockClipboard(() => Promise.reject(new DOMException('denied', 'NotAllowedError')));

			assert.equal(await writeToClipboard('invite-code'), false);
		});

		it('resolves false when the clipboard API is missing', async () => {
			mockNavigator({});

			assert.equal(await writeToClipboard('invite-code'), false);
		});

		it('adds no notification', async () => {
			mockClipboard(() => Promise.reject(new Error('denied')));

			await writeToClipboard('invite-code');

			assert.deepEqual(get(notificationsStore), []);
		});
	});

	describe('copyToClipboard', () => {
		it('shows the success toast for two seconds', async () => {
			mockClipboard(() => Promise.resolve());

			await copyToClipboard({ value: '0xabc', text: 'Address' });

			assert.deepEqual(
				get(notificationsStore).map(({ title, message, type }) => ({ title, message, type })),
				[{ title: 'Copied', message: 'Address copied to clipboard.', type: 'success' }]
			);

			mock.timers.tick(2000);

			assert.deepEqual(get(notificationsStore), []);
		});

		it('shows the failure toast when the write is refused', async () => {
			mockClipboard(() => Promise.reject(new DOMException('denied', 'NotAllowedError')));

			await copyToClipboard({ value: '0xabc', text: 'Address' });

			assert.deepEqual(
				get(notificationsStore).map(({ title, message, type }) => ({ title, message, type })),
				[{ title: 'Copy failed', message: 'Could not copy Address to clipboard.', type: 'error' }]
			);
		});
	});
});
