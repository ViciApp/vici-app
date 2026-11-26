import { openDeferredTab } from '#lib/services/deferred-tab.services.ts';
import assert from 'node:assert/strict';
import { afterEach, beforeEach, describe, it } from 'node:test';

const HREF = 'https://vici.app/claim#blob';

interface FakeTab {
	opener: unknown;
	closed: boolean;
	/** `opener` as it was when the tab was navigated. */
	openerAtNavigation: unknown;
	navigatedTo: string | undefined;
	location: { href: string };
	close: () => void;
}

interface FakeAnchor {
	href: string;
	target: string;
	rel: string;
	clicked: boolean;
	click: () => void;
}

const fakeTab = (): FakeTab => {
	const tab: FakeTab = {
		opener: 'the legacy app',
		closed: false,
		openerAtNavigation: undefined,
		navigatedTo: undefined,
		location: {
			get href(): string {
				return tab.navigatedTo ?? 'about:blank';
			},
			set href(href: string) {
				tab.openerAtNavigation = tab.opener;
				tab.navigatedTo = href;
			}
		},
		close: () => {
			tab.closed = true;
		}
	};

	return tab;
};

const fakeAnchor = (): FakeAnchor => {
	const anchor: FakeAnchor = {
		href: '',
		target: '',
		rel: '',
		clicked: false,
		click: () => {
			anchor.clicked = true;
		}
	};

	return anchor;
};

describe('openDeferredTab', () => {
	const globals = globalThis as Record<string, unknown>;
	const originalWindow = globals.window;
	const originalDocument = globals.document;

	/** Arguments of every `window.open` call, in order. */
	let openCalls: unknown[][];
	let anchors: FakeAnchor[];

	/** Stubs `window.open` to hand back `tab` (null: the popup was blocked). */
	const stubWindow = (tab: FakeTab | null): void => {
		globals.window = {
			open: (...args: unknown[]) => {
				openCalls.push(args);

				return tab;
			}
		};
	};

	beforeEach(() => {
		openCalls = [];
		anchors = [];
		globals.document = {
			createElement: () => {
				const anchor = fakeAnchor();

				anchors.push(anchor);

				return anchor;
			}
		};
	});

	afterEach(() => {
		globals.window = originalWindow;
		globals.document = originalDocument;
	});

	it('opens the tab without features that make window.open return null', async () => {
		stubWindow(fakeTab());

		await openDeferredTab({ resolveHref: () => Promise.resolve(HREF) });

		assert.deepEqual(openCalls, [['', '_blank']]);
	});

	it('severs the opener, then navigates the pre-opened tab', async () => {
		const tab = fakeTab();

		stubWindow(tab);

		const opened = await openDeferredTab({ resolveHref: () => Promise.resolve(HREF) });

		assert.equal(opened, true);
		assert.equal(tab.navigatedTo, HREF);
		assert.equal(tab.openerAtNavigation, null);
		assert.equal(tab.closed, false);
		assert.equal(anchors.length, 0);
	});

	it('opens the tab before the destination resolves', async () => {
		const tab = fakeTab();

		stubWindow(tab);

		await openDeferredTab({
			resolveHref: () => {
				assert.equal(openCalls.length, 1);
				assert.equal(tab.opener, null);

				return Promise.resolve(HREF);
			}
		});
	});

	it('closes the tab when there is no destination', async () => {
		const tab = fakeTab();

		stubWindow(tab);

		const opened = await openDeferredTab({ resolveHref: () => Promise.resolve(undefined) });

		assert.equal(opened, false);
		assert.equal(tab.closed, true);
		assert.equal(tab.navigatedTo, undefined);
		assert.equal(anchors.length, 0);
	});

	it('closes the tab and rethrows when resolving fails', async () => {
		const tab = fakeTab();
		const failure = new Error('signing failed');

		stubWindow(tab);

		await assert.rejects(openDeferredTab({ resolveHref: () => Promise.reject(failure) }), failure);
		assert.equal(tab.closed, true);
		assert.equal(tab.navigatedTo, undefined);
	});

	it('falls back to an anchor click when the popup is blocked', async () => {
		stubWindow(null);

		const opened = await openDeferredTab({ resolveHref: () => Promise.resolve(HREF) });

		assert.equal(opened, true);
		assert.equal(anchors.length, 1);
		assert.equal(anchors[0].href, HREF);
		assert.equal(anchors[0].target, '_blank');
		assert.equal(anchors[0].rel, 'noopener noreferrer');
		assert.equal(anchors[0].clicked, true);
	});

	it('opens nothing when the popup is blocked and there is no destination', async () => {
		stubWindow(null);

		const opened = await openDeferredTab({ resolveHref: () => Promise.resolve(undefined) });

		assert.equal(opened, false);
		assert.equal(anchors.length, 0);
	});
});
