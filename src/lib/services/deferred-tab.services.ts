import { isNullish, nonNullish } from '@dfinity/utils';

/**
 * Open a new tab for a destination that is only known after some async work.
 *
 * The tab is opened synchronously, inside the click's call stack: Safari
 * blocks a popup opened after the gesture has unwound. It is opened without
 * the `noopener` / `noreferrer` features on purpose, because with either of
 * them `window.open` returns `null` and the blank tab could be neither
 * navigated nor closed. The opener link is severed by hand instead, before
 * the tab loads anything.
 *
 * `resolveHref` yields the destination, or `undefined` when there is none:
 * the blank tab is then closed, as it is when `resolveHref` throws. False
 * when nothing was opened.
 */
export const openDeferredTab = async ({
	resolveHref
}: {
	resolveHref: () => Promise<string | undefined>;
}): Promise<boolean> => {
	const tab = window.open('', '_blank');

	if (nonNullish(tab)) {
		tab.opener = null;
	}

	try {
		const href = await resolveHref();

		if (isNullish(href)) {
			tab?.close();

			return false;
		}

		if (nonNullish(tab)) {
			tab.location.href = href;

			return true;
		}

		// The pre-open was blocked: fall back to an anchor click, which some
		// browsers still honour for the original gesture.
		const anchor = document.createElement('a');

		anchor.href = href;
		anchor.target = '_blank';
		anchor.rel = 'noopener noreferrer';
		anchor.click();

		return true;
	} catch (err: unknown) {
		tab?.close();

		throw err;
	}
};
