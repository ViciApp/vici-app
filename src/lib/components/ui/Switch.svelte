<script lang="ts">
	import { localeStore } from '#lib/stores/locale.store.ts';
	import { t } from '#lib/utils/i18n.utils.ts';

	interface Props {
		checked: boolean;
		disabled?: boolean;
	}

	let { checked = $bindable(), disabled = false }: Props = $props();

	const toggle = () => {
		if (disabled) {
			return;
		}

		checked = !checked;
	};
</script>

<button
	class="focus-visible:ring-primary relative inline-flex h-5 w-9 shrink-0 items-center rounded-full border-2 border-transparent transition-colors duration-200 ease-in-out focus-visible:ring-2 focus-visible:ring-offset-2 focus-visible:outline-hidden disabled:cursor-not-allowed disabled:opacity-50 {checked
		? 'bg-primary'
		: 'bg-foreground/8'}"
	aria-checked={checked}
	aria-label={t({ locale: $localeStore, key: 'a11y.toggle_switch' })}
	{disabled}
	onclick={toggle}
	role="switch"
	type="button"
>
	<span
		class="bg-card pointer-events-none inline-block h-4 w-4 transform rounded-full shadow-sm ring-0 transition duration-200 ease-in-out {checked
			? 'translate-x-4'
			: 'translate-x-0'}"
		aria-hidden="true"
	>
	</span>
</button>
