import { browser } from '$app/env';

/**
 * Svelte action that pins a `position: fixed` full-viewport overlay to
 * `window.visualViewport` — the only reliable measure of the *actually-visible*
 * area on iOS.
 *
 * iOS browsers (notably iOS Chrome) resolve a fixed `inset: 0` / `100dvh`
 * against the *large* layout viewport (toolbars retracted), so a bottom-docked
 * footer lands behind the browser's bottom toolbar and gets clipped. `dvh` is
 * supposed to track the visible height but iOS Chrome doesn't honour it
 * reliably. Driving the node's `top`/`left`/`width`/`height` off
 * `visualViewport` overlays it exactly on the visible region (including the
 * horizontal offset under pinch-zoom / iPad split view), so a `flex-end` child
 * docks above the toolbar.
 *
 * Runs wherever `visualViewport` exists, including desktop — there it simply
 * mirrors the layout viewport (`offsetTop`/`offsetLeft` ≈ 0, size ≈ inner*), so
 * the overlay is unchanged. It is a true no-op only when `visualViewport` is
 * unavailable (SSR / older engines), where the CSS `100dvh` baseline stands.
 *
 * It also self-corrects the iOS bottom-bar inset for its own subtree. Docked
 * footers add `--ios-bottom-bar-inset` (nominally 56px on iOS) to clear the
 * native bottom toolbar — but where `visualViewport` already *excludes* that
 * toolbar (Safari, most in-app webviews) this pin has already docked the
 * overlay above it, so adding the full token on top doubles the gap. We
 * subtract what the pin already cleared and override the token within the node
 * to the residual only: 0 in those browsers, the full nominal in iOS Chrome,
 * whose `visualViewport` does *not* exclude its toolbar (#718). Off iOS the
 * nominal token is `0px`, so the override is inert.
 */
export const pinToVisualViewport = (node: HTMLElement) => {
	if (!browser) {
		return;
	}

	const viewport = window.visualViewport;

	if (!viewport) {
		return;
	}

	// Read once: the token is stamped pre-paint and never changes for the session.
	const nominalBarInset =
		parseFloat(
			getComputedStyle(document.documentElement).getPropertyValue('--ios-bottom-bar-inset')
		) || 0;

	const sync = () => {
		// `top`/`left` track the visible region's offset within the layout
		// viewport (notch, collapsed top bar, pinch-zoom, split view); `width`/
		// `height` are its size. Together they overlay the node on exactly the
		// visible area.
		node.style.top = `${viewport.offsetTop}px`;
		node.style.left = `${viewport.offsetLeft}px`;
		node.style.width = `${viewport.width}px`;
		node.style.height = `${viewport.height}px`;

		if (nominalBarInset > 0) {
			// How far the visible region's bottom already sits above the layout
			// viewport's bottom — i.e. the chrome (toolbar / keyboard) the pin has
			// already cleared. Whatever it leaves uncleared still needs the inset.
			const cleared = Math.max(
				0,
				document.documentElement.clientHeight - (viewport.offsetTop + viewport.height)
			);
			node.style.setProperty(
				'--ios-bottom-bar-inset',
				`${Math.max(0, nominalBarInset - cleared)}px`
			);
		}
	};

	// Passive: the listeners only read viewport metrics to size the node; they
	// never call `preventDefault`.
	const opts: AddEventListenerOptions = { passive: true };

	sync();
	viewport.addEventListener('resize', sync, opts);
	viewport.addEventListener('scroll', sync, opts);

	return {
		destroy: () => {
			viewport.removeEventListener('resize', sync, opts);
			viewport.removeEventListener('scroll', sync, opts);
			node.style.removeProperty('top');
			node.style.removeProperty('left');
			node.style.removeProperty('width');
			node.style.removeProperty('height');
			node.style.removeProperty('--ios-bottom-bar-inset');
		}
	};
};
