<script lang="ts">
	import type { Snippet } from 'svelte';

	interface Props {
		children: Snippet;
		// Fires on click or Enter / Space activation.
		onclick: (event: MouseEvent | KeyboardEvent) => void;
		// The control has no implicit accessible name (it's a <span>), so a label
		// is required.
		label: string;
		class?: string;
		// Maps to aria-expanded when the control toggles a disclosure (tooltip,
		// popover); leave unset for plain actions.
		expanded?: boolean;
		// Stop activation from bubbling to an interactive ancestor: the whole
		// reason this exists instead of a real <button>. On by default.
		stopPropagation?: boolean;
	}

	const {
		children,
		onclick,
		label,
		class: className,
		expanded,
		stopPropagation = true
	}: Props = $props();

	// A button-like control built on a <span role="button"> so it can live inside
	// another interactive element (e.g. a clickable row <button>) without the
	// invalid `<button>`-in-`<button>` nesting. Carries keyboard activation and
	// stops propagation so the ancestor doesn't fire too; styling is caller-owned
	// via `class`.
	const activate = (event: MouseEvent | KeyboardEvent) => {
		if (stopPropagation) {
			event.stopPropagation();
		}

		onclick(event);
	};
</script>

<span
	class={className}
	aria-expanded={expanded}
	aria-label={label}
	onclick={activate}
	onkeydown={(event) => {
		if (event.key === 'Enter') {
			// Enter activates on keydown; ignore auto-repeat so a held key fires once.
			if (event.repeat) {
				return;
			}

			event.preventDefault();
			activate(event);
		} else if (event.key === ' ') {
			// Match native buttons: Space activates on keyup. preventDefault here
			// only to stop the page scrolling while the key is held.
			event.preventDefault();
		}
	}}
	onkeyup={(event) => {
		if (event.key === ' ') {
			event.preventDefault();
			activate(event);
		}
	}}
	role="button"
	tabindex="0"
>
	{@render children()}
</span>
