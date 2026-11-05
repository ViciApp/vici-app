<script lang="ts">
	import BaseButton from '#lib/components/ui/BaseButton.svelte';
	import { haptic } from '#lib/utils/haptics.utils.ts';

	interface TabOption {
		value: string;
		label: string;
	}

	interface Props {
		tabs: Array<string | TabOption>;
		activeTab: string;
		onTabChange?: (tab: string) => void;
	}

	let { tabs, activeTab = $bindable(), onTabChange }: Props = $props();

	const tabOptions = $derived(
		tabs.map((tab) => (typeof tab === 'string' ? { value: tab, label: tab } : tab))
	);

	const handleTabClick = (value: string) => {
		if (value === activeTab) {
			return;
		}

		activeTab = value;
		haptic('light-tap');
		onTabChange?.(value);
	};
</script>

<div class="border-border bg-foreground/5 shadow-inset-hi flex w-full gap-1 rounded-xl border p-1">
	{#each tabOptions as tab (tab.value)}
		<BaseButton
			class="ease-vici duration-hover flex-1 rounded-lg px-3 py-2.5 text-sm font-semibold transition-colors {activeTab ===
			tab.value
				? 'bg-popover text-foreground shadow-card'
				: 'text-muted-foreground hover:text-foreground hover:bg-foreground/5'}"
			onclick={() => handleTabClick(tab.value)}
		>
			{tab.label}
		</BaseButton>
	{/each}
</div>
