<script lang="ts">
	import { FlaskConical, ShieldCheck } from '@lucide/svelte/icons';
	import { balanceDomain } from '#lib/derived/balance-domain.derived.ts';
	import { isDev } from '#lib/env/app.env.ts';
	import { setBalanceDomain } from '#lib/services/balance-domain.services.ts';
	import { localeStore } from '#lib/stores/locale.store.ts';
	import type { BalanceDomainKey } from '#lib/types/balance-domain.ts';
	import { isPlaygroundExperience, isSettlement } from '#lib/utils/balance-domain.utils.ts';
	import { t } from '#lib/utils/i18n.utils.ts';

	const setDomain = (domain: BalanceDomainKey) => {
		if (domain === 'settlement' && !isDev()) {
			return;
		}

		setBalanceDomain(domain);
	};

	const setPlaygroundDomain = () => setDomain('playground');

	const setSettlementDomain = () => setDomain('settlement');
</script>

<div class="px-4 py-2">
	<div class="text-muted-foreground eyebrow-xs mb-2">
		{t({ locale: $localeStore, key: 'layout.domain.title' })}
	</div>
	<div class="flex gap-1">
		<button
			class="flex flex-1 flex-col items-center justify-center gap-1 rounded-md border p-2 transition-all {isPlaygroundExperience(
				$balanceDomain
			)
				? 'border-primary bg-primary/10 text-primary shadow-sm'
				: 'border-border text-muted-foreground hover:bg-muted'}"
			aria-label={t({ locale: $localeStore, key: 'a11y.playground_domain' })}
			onclick={setPlaygroundDomain}
		>
			<FlaskConical size={16} />
			<span class="text-[9px] font-bold">
				{t({ locale: $localeStore, key: 'layout.domain.playground' })}
			</span>
		</button>

		<button
			class="relative flex flex-1 flex-col items-center justify-center gap-1 rounded-md border p-2 transition-all {isSettlement(
				$balanceDomain
			)
				? 'border-primary bg-primary/10 text-primary shadow-sm'
				: !isDev()
					? 'border-border text-muted-foreground hover:bg-muted cursor-not-allowed opacity-50'
					: 'border-border text-muted-foreground hover:bg-muted active:scale-95'}"
			aria-label={isDev()
				? t({ locale: $localeStore, key: 'a11y.settlement_domain' })
				: t({ locale: $localeStore, key: 'a11y.settlement_domain_disabled' })}
			disabled={!isDev()}
			onclick={setSettlementDomain}
		>
			<ShieldCheck size={16} />
			<span class="text-[9px] font-bold">
				{t({ locale: $localeStore, key: 'layout.domain.settlement' })}
			</span>
			{#if !isDev()}
				<span
					class="bg-foreground/8 text-muted-foreground absolute -top-1 -right-1 flex h-3 w-6 items-center justify-center rounded-full text-[7px] font-black tracking-tighter uppercase"
				>
					{t({ locale: $localeStore, key: 'layout.domain.soon' })}
				</span>
			{/if}
		</button>
	</div>
</div>
