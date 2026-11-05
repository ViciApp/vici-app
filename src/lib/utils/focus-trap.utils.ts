/**
 * Focus trap for custom-built modal surfaces ({@link
 * #lib/components/ui/BottomSheet.svelte}, etc.). Native `<dialog>`
 * elements opened via `showModal()` already trap focus and return
 * focus on close — only reach for this helper when the container
 * isn't a native dialog.
 *
 * Usage:
 *
 * ```ts
 * const trap = createFocusTrap(sheetEl);
 * trap.activate(); // remembers previously-focused element, focuses
 *                   // the first focusable child, starts Tab cycling
 * trap.deactivate(); // returns focus to the original element
 * ```
 */

const FOCUSABLE_SELECTOR = [
	'a[href]',
	'area[href]',
	'button:not([disabled])',
	'input:not([disabled]):not([type="hidden"])',
	'select:not([disabled])',
	'textarea:not([disabled])',
	'iframe',
	'object',
	'embed',
	'[tabindex]:not([tabindex="-1"])',
	'[contenteditable="true"]'
].join(',');

const isVisible = (el: HTMLElement): boolean =>
	el.offsetWidth > 0 || el.offsetHeight > 0 || el.getClientRects().length > 0;

const getFocusable = (container: HTMLElement): HTMLElement[] =>
	Array.from(container.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR)).filter(
		(el) => !el.hasAttribute('disabled') && isVisible(el)
	);

export interface FocusTrap {
	activate(): void;
	deactivate(): void;
}

export const createFocusTrap = (container: HTMLElement): FocusTrap => {
	let previouslyFocused: HTMLElement | null = null;

	const handleKeyDown = (event: KeyboardEvent) => {
		if (event.key !== 'Tab') {
			return;
		}

		const focusable = getFocusable(container);

		if (focusable.length === 0) {
			event.preventDefault();
			container.focus();

			return;
		}

		const [first] = focusable;
		const last = focusable[focusable.length - 1];
		const active = document.activeElement;

		if (event.shiftKey) {
			if (active === first || !container.contains(active)) {
				event.preventDefault();
				last.focus();
			}

			return;
		}

		if (active === last || !container.contains(active)) {
			event.preventDefault();
			first.focus();
		}
	};

	const activate = () => {
		// `instanceof` narrowing (not a cast): `document.activeElement` is an
		// `Element`, and only an `HTMLElement` can be re-focused on deactivate.
		const active = document.activeElement;
		previouslyFocused = active instanceof HTMLElement ? active : null;
		const focusable = getFocusable(container);
		(focusable[0] ?? container).focus();
		document.addEventListener('keydown', handleKeyDown);
	};

	const deactivate = () => {
		document.removeEventListener('keydown', handleKeyDown);
		previouslyFocused?.focus();
		previouslyFocused = null;
	};

	return { activate, deactivate };
};
