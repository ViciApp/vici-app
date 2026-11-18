<script lang="ts">
	import { slide } from 'svelte/transition';
	import {
		SOCIAL_PREMIUM_OTHER_ID,
		SOCIAL_PREMIUM_PRESETS,
		type SocialPremiumOptionId
	} from '#lib/constants/social-premium.constants.ts';
	import { localeStore } from '#lib/stores/locale.store.ts';
	import { t } from '#lib/utils/i18n.utils.ts';

	interface Props {
		optionId: SocialPremiumOptionId;
		customTitle: string;
		onChange: (next: { optionId: SocialPremiumOptionId; customTitle: string }) => void;
	}

	const { optionId, customTitle, onChange }: Props = $props();

	const otherSelected = $derived(optionId === SOCIAL_PREMIUM_OTHER_ID);

	const selectPreset = (id: SocialPremiumOptionId) => {
		onChange({ optionId: id, customTitle });
	};

	const updateCustom = (next: string) => {
		onChange({ optionId: SOCIAL_PREMIUM_OTHER_ID, customTitle: next });
	};
</script>

<div class="space-y-3">
	<span class="text-muted-foreground text-xs font-bold tracking-widest uppercase">
		{t({ locale: $localeStore, key: 'arena.premium.label' })}
	</span>
	<div class="grid grid-cols-2 gap-2 sm:grid-cols-3">
		{#each SOCIAL_PREMIUM_PRESETS as preset (preset.id)}
			{@const selected = optionId === preset.id}
			<button
				class="flex flex-col items-center gap-1 rounded-2xl border-2 px-3 py-3 text-center transition-all {selected
					? 'border-primary bg-primary/10 text-primary'
					: 'border-border bg-foreground/5 text-muted-foreground hover:border-foreground/10'}"
				aria-pressed={selected}
				onclick={() => selectPreset(preset.id)}
				type="button"
			>
				<span class="text-2xl" aria-hidden="true">{preset.emoji}</span>
				<span class="text-sm font-bold">
					{t({ locale: $localeStore, key: preset.descKey })}
				</span>
			</button>
		{/each}
		<button
			class="flex flex-col items-center gap-1 rounded-2xl border-2 border-dashed px-3 py-3 text-center transition-all {otherSelected
				? 'border-primary bg-primary/10 text-primary'
				: 'border-border bg-foreground/5 text-muted-foreground hover:border-foreground/10'}"
			aria-pressed={otherSelected}
			onclick={() => selectPreset(SOCIAL_PREMIUM_OTHER_ID)}
			type="button"
		>
			<span class="text-2xl" aria-hidden="true">✦</span>
			<span class="text-sm font-bold">
				{t({ locale: $localeStore, key: 'arena.premium.other.label' })}
			</span>
		</button>
	</div>
	{#if otherSelected}
		<div class="space-y-2" transition:slide={{ duration: 200 }}>
			<label
				class="text-muted-foreground text-[10px] font-bold uppercase"
				for="social-premium-custom"
			>
				{t({ locale: $localeStore, key: 'arena.premium.other.input_label' })}
			</label>
			<input
				id="social-premium-custom"
				class="bg-foreground/5 text-foreground ring-border focus:bg-card focus:ring-primary w-full rounded-xl border-none px-4 py-3 text-sm ring-1 ring-inset focus:ring-2"
				oninput={(e) => updateCustom(e.currentTarget.value)}
				placeholder={t({ locale: $localeStore, key: 'arena.premium.other.placeholder' })}
				type="text"
				value={customTitle}
			/>
		</div>
	{/if}
</div>
